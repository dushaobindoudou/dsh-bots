return {
  inject: ['fs', 'shell'],
  apply(ctx) {
    const DISCOVERY_CANDIDATES = [
      '~/.sdk-bots/gateway.json',
      '/Users/liepin/.sdk-bots/gateway.json',
    ]
    const DIAG_PATH = '/Users/liepin/.sdk-bots/dsh-bots-diag.jsonl'
    const TOKEN_RE = /^[A-Za-z0-9._~+-]+$/
    let nonceCounter = 0

    function shellQuote(s) {
      return "'" + String(s).replace(/'/g, "'\\''") + "'"
    }

    async function shellCurl(url, opts) {
      opts = opts || {}
      const timeoutSec = opts.timeoutSec || 30
      let cmd = 'curl -sS -m ' + timeoutSec + " -w '\\n__HTTP__%{http_code}'"
      if (opts.post) cmd += " -X POST -H 'content-type: application/json'"
      if (opts.token) cmd += ' -H ' + shellQuote('authorization: Bearer ' + opts.token)
      cmd += ' ' + shellQuote(url)
      const spec = ctx.shell.resolve({
        command: cmd,
        stdin: opts.post ? (opts.body || '{}') : undefined,
        timeoutMs: (timeoutSec + 5) * 1000,
        stdoutMaxBytes: 16 * 1024 * 1024,
      })
      const res = await ctx.shell.run(spec)
      if (res.exitCode !== 0) {
        const err = new Error('curl exit ' + res.exitCode + (res.stderr && res.stderr.text ? ': ' + res.stderr.text.slice(0, 200) : ''))
        err.code = 'curl-failed'
        throw err
      }
      const text = res.stdout.text
      const marker = text.lastIndexOf('\n__HTTP__')
      const status = marker >= 0 ? Number(text.slice(marker + 9)) : 0
      const body = marker >= 0 ? text.slice(0, marker) : text
      return { status, body }
    }

    async function appendDiag(line) {
      try {
        const spec = ctx.shell.resolve({
          command: 'cat >> ' + shellQuote(DIAG_PATH),
          stdin: line,
          timeoutMs: 5000,
        })
        await ctx.shell.run(spec)
      } catch (e) {
        try {
          const target = await ctx.fs.resolve(DIAG_PATH)
          await ctx.fs.writeText(target, line)
        } catch (e2) { console.error('[bots] diag append failed: ' + String((e2 && e2.message) || e2)) }
      }
    }

    async function readDiscovery(dataDir) {
      const candidates = dataDir ? [dataDir + '/gateway.json'] : DISCOVERY_CANDIDATES
      for (const p of candidates) {
        try {
          const target = await ctx.fs.resolve(p)
          const text = await ctx.fs.readText(target)
          const parsed = JSON.parse(text)
          if (parsed && Number.isInteger(parsed.port) && parsed.port > 0) {
            return {
              port: parsed.port,
              pid: Number.isInteger(parsed.pid) ? parsed.pid : null,
              token: (typeof parsed.token === 'string' && TOKEN_RE.test(parsed.token)) ? parsed.token : null,
              host: parsed.host === '0.0.0.0' ? '127.0.0.1' : (parsed.host || '127.0.0.1'),
            }
          }
        } catch (e) { /* 尝试下一个候选路径 */ }
      }
      return null
    }

    async function discover(dataDir) {
      const d = await readDiscovery(dataDir)
      if (d == null) return { ok: false, reason: 'no-gateway-json' }
      const baseUrl = 'http://' + d.host + ':' + d.port
      let health
      try {
        const r = await shellCurl(baseUrl + '/health', { timeoutSec: 5 })
        if (r.status !== 200) return { ok: false, reason: 'health-http-' + r.status, baseUrl: baseUrl, port: d.port, pid: d.pid }
        health = JSON.parse(r.body)
      } catch (e) {
        return { ok: false, reason: 'health-failed', baseUrl: baseUrl, port: d.port, pid: d.pid, detail: String((e && e.message) || e) }
      }
      if (d.pid != null && health && health.pid !== d.pid) {
        return { ok: false, reason: 'stale-gateway-json', baseUrl: baseUrl, port: d.port, pid: d.pid, healthPid: health ? health.pid : null }
      }
      return {
        ok: true,
        baseUrl: baseUrl,
        port: d.port,
        pid: d.pid,
        hasToken: d.token != null,
        health: {
          pid: health ? health.pid : null,
          isBusy: !!(health && health.isBusy),
          activeAgentId: (health && health.activeAgentId) || null,
          startedAt: (health && health.startedAt) || null,
        },
      }
    }

    async function callGateway(method, args) {
      const d = await readDiscovery(null)
      if (d == null) { const err = new Error('gateway.json not found — sdk-bots host 是否在运行？'); err.code = 'no-gateway'; throw err }
      const baseUrl = 'http://' + d.host + ':' + d.port
      const r = await shellCurl(baseUrl + '/api/' + method, {
        post: true,
        body: JSON.stringify(args || {}),
        token: d.token,
        timeoutSec: 90,
      })
      let json
      try { json = JSON.parse(r.body) } catch (e) {
        const err = new Error('bad-json-from-gateway: ' + r.body.slice(0, 200)); err.code = 'bad-json'; throw err
      }
      if (r.status === 401) { const err = new Error('gateway unauthorized — 需要 token'); err.code = 'unauthorized'; throw err }
      if (json && typeof json === 'object' && json.error) {
        const err = new Error((json.error && json.error.message) || JSON.stringify(json.error))
        err.code = 'gateway-error'
        throw err
      }
      return (json && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, 'result')) ? json.result : json
    }

    function trimAgent(a) {
      if (!a || typeof a !== 'object') return null
      return {
        id: a.id, name: a.name, description: a.description || '', title: a.title || '',
        isGroup: !!a.isGroup,
        memberIds: Array.isArray(a.memberIds) ? a.memberIds : [],
        isRunning: !!a.isRunning, isActive: a.isActive !== false,
        lastMessagePreview: a.lastMessagePreview || null,
        updatedAt: a.updatedAt || null,
        avatarColor: a.avatarColor || null, avatarShape: a.avatarShape || null,
      }
    }

    function normalizeAgents(raw) {
      const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.agents) ? raw.agents : [])
      return list.map(trimAgent).filter(Boolean)
    }

    function nextNonce() {
      nonceCounter += 1
      return 'dsh-m1-' + Date.now().toString(36) + '-' + nonceCounter
    }

    ctx.effect(() => {
      const disposers = []
      const reg = (method, handler) => disposers.push(harness.handle(method, handler))

      reg('bots.diag', async (args) => {
        await appendDiag(JSON.stringify(args) + '\n')
        return null
      })

      reg('bots.gatewayInfo', async (args) => discover(args && args.dataDir))

      reg('bots.list', async () => normalizeAgents(await callGateway('listAgents', {})))

      // dsh 工作区列表（只取叶子字段；服务缺失时返回空表）
      reg('bots.workspaces', async () => {
        const registry = ctx.get('workspaceRegistry')
        if (registry == null || typeof registry.list !== 'function') return { workspaces: [] }
        try {
          const list = await registry.list()
          const rows = []
          for (const w of Array.isArray(list) ? list : []) {
            rows.push({ id: w.id, title: w.title || '', path: (w.path) || null })
          }
          return { workspaces: rows }
        } catch (e) {
          return { workspaces: [], error: String((e && e.message) || e) }
        }
      })

      // 最近 dsh 会话（listSessions + 标题快照；只取叶子字段）
      reg('bots.sessions', async () => {
        const q = ctx.get('sessionQuery')
        if (q == null || typeof q.listSessions !== 'function') return { sessions: [] }
        try {
          const records = await q.listSessions()
          const recent = (Array.isArray(records) ? records : [])
            .filter((r) => r && r.header)
            .sort((a, b) => (b.header.createdAt || 0) - (a.header.createdAt || 0))
            .slice(0, 15)
          const titleMap = {}
          const titleSvc = ctx.get('sessionTitle')
          if (titleSvc != null && typeof titleSvc.readTitleSnapshots === 'function') {
            const obs = await titleSvc.readTitleSnapshots(recent.map((r) => r.header.id))
            for (const o of Array.isArray(obs) ? obs : []) {
              if (o && o.status === 'fulfilled' && o.value && o.value.title) titleMap[o.sessionId] = o.value.title.title
            }
          }
          return {
            sessions: recent.map((r) => ({
              id: r.header.id,
              title: titleMap[r.header.id] || (r.header.cwd ? String(r.header.cwd).split('/').pop() : '未命名会话'),
              live: !!r.live,
            })),
          }
        } catch (e) {
          return { sessions: [], error: String((e && e.message) || e) }
        }
      })

      reg('bots.create', async (args) => {
        const created = await callGateway('createAgent', {
          name: String(args && args.name || '').trim(),
          description: args && args.description ? String(args.description) : '',
          clientNonce: nextNonce(),
        })
        return trimAgent(created && (created.agent || created)) || created
      })

      reg('bots.createGroup', async (args) => {
        const created = await callGateway('createGroup', {
          name: String(args && args.name || '').trim(),
          description: args && args.description ? String(args.description) : '',
          memberAgentIds: Array.isArray(args && args.memberIds) ? args.memberIds : [],
        })
        return trimAgent(created && (created.agent || created)) || created
      })

      reg('bots.update', async (args) => {
        const updated = await callGateway('updateAgent', {
          id: args && args.id,
          profile: (args && args.profile) || {},
        })
        return trimAgent(updated && (updated.agent || updated)) || updated
      })

      reg('bots.delete', async (args) => callGateway('deleteAgent', { id: args && args.id }))

      reg('bots.send', async (args) => callGateway('sendPrompt', {
        agentId: args && args.agentId,
        prompt: String(args && args.prompt || ''),
        clientNonce: nextNonce(),
      }))

      reg('bots.transcriptTail', async (args) => {
        const res = await callGateway('getAgentTranscriptTail', {
          id: args && args.id,
          limit: (args && Number(args.limit)) || 40,
        })
        const entries = (res && Array.isArray(res.entries)) ? res.entries : []
        return {
          entries: entries.map((en) => ({
            id: en.id, kind: en.kind, timestampMs: en.timestampMs || null,
            role: en.role || null,
            content: en.kind === 'message' ? en.content : (en.message && en.message.content) || '',
            authorId: en.author ? en.author.id : null,
            authorName: en.author ? en.author.name : null,
          })),
        }
      })

      return () => { for (const d of disposers) d() }
    })

    ;(async () => {
      try {
        const info = await discover(null)
        await appendDiag(JSON.stringify({ at: new Date().toISOString(), stage: 'host-self-check', ok: info.ok, reason: info.reason || null }) + '\n')
        if (info.ok) {
          const raw = await callGateway('listAgents', {})
          await appendDiag(JSON.stringify({ at: new Date().toISOString(), stage: 'host-list-agents', count: normalizeAgents(raw).length }) + '\n')
        }
      } catch (e) {
        await appendDiag(JSON.stringify({ at: new Date().toISOString(), stage: 'host-self-check-error', error: String((e && e.message) || e) }) + '\n')
      }
    })()
  },
}
