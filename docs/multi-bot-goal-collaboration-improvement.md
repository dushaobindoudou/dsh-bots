# 多 Bot 目标协作改进方案与验收规格

日期：2026-10-08；状态：待实施设计；范围：dsh-bots 工作台 + sdk-bots 执行引擎。

## 1. 结论与产品目标

当前系统已经具备多 Bot 通信、群聊轮转、异步唤醒、例行调度、单 Bot 持续目标及人工验收，但还没有把这些能力组合成可恢复、可追责、可验收的多 Bot 任务执行闭环。主要问题不是 Bot 数量少，而是“谁承担哪个任务、任务是否真的执行、结果如何回到父任务、何时停止”仍大量依赖自然语言和模型自觉。

建议新增引擎拥有的 Goal → Task DAG → Attempt → Artifact → Verification 执行模型。指挥官负责提出计划和汇总；执行器负责派发、恢复、限额和状态转换；各 Bot 只提交受约束的动作与证据。群聊用于讨论和展示，不承担任务状态数据库的职责。

目标体验：用户输入一个目标、验收标准和资源限制，选择一个团队；系统拆解任务、按依赖并行执行、自动接收结果并验证；页面关闭或进程重启后可以恢复；缺少条件时明确指出阻塞及解决路径；达到标准后提交完整交付包，等待用户验收。

本次仅产出设计文档及诊断结果，没有修改业务代码、重启服务、发消息给 Bot 或执行真实业务目标。

## 2. 调查范围与证据可信度

### 2.1 基线

| 对象 | 检查基线 | 限制 |
|---|---|---|
| dsh-bots | 工作目录 `/Users/liepin/workspace/dsh-workspace/dsh-bots`；0.2.65；HEAD `cf86e21` | 检查开始时工作树干净 |
| sdk-bots | `/Users/liepin/workspaces/sdk-bots`；0.5.0；HEAD `1250fda` | 已有未提交修改：`automation-run-path.ts`、`automation-goal-guard.test.ts`；本报告按当前工作树分析，未修改这些文件 |
| 宿主日志 | `/tmp/sdk-bots-host.log`，读取时 935 行 | 多段启动日志混合，大部分没有时间戳，不能全部归于今天，也不能据此证明当前进程运行的是当前源码 |
| 当前协作样本 | 6 个角色的转录，2026-10-08；共 270 行 JSONL | 是用户/assistant 镜像，不是完整工具执行结果日志；工具调用次数不等于成功次数、网络请求数或费用 |
| 工作台诊断 | `~/.sdk-bots/dsh-bots-diag.jsonl` | 当日 98 条，98 条版本为 `unresolved` |
| 历史蜂群 | `~/.sdk-bots/swarm/GOAL.md`、`PROGRESS.md` | 75 条方括号开头记录，包含初始化；历史目标是循环自检，不能拿重复自检直接证明业务空转 |
| 交付物 | `~/.sdk-bots/box-workspace/AI股票交易台/` | 读取时仅发现 PLAN、PROGRESS、WATCHLIST、PORTFOLIO 四个文件；未在指定目录发现情报报告或信号卡，不排除产物在其他位置 |

没有发现当前 `agents/*/automations/*/automation.json` 文件；因此不能把旧蜂群记录描述为当前仍在运行的自动化。本次不需要外部产品资料：结论来自本地实现、测试和运行样本。

证据分级：**L** 为日志/文件直接观察；**R** 为隔离执行真实代码后的复现；**C** 为源码明确行为或接口缺口；**H** 为尚需故障注入确认的风险。下面区分等级，不把模型自己的陈述当成工具执行结果。

### 2.2 今日样本的协作链

1. 11:37 左右，用户在群中要求查看当日港股市场。
2. 指挥官首先把角色名称放进 `target_id`，随后改用实际 ID。情报和量化转录都记录了 11:39 左右收到异步派活，证明至少这两条派活实际进入了接收端上下文。
3. 情报角色在完整样本内出现 86 次 WebSearch、26 次 WebFetch；其中分别有 53、11 次 input 顶层包含 `arguments` 包装。转录出现“参数格式写错了，重新调用”。不能直接把这些全部算作执行失败，但参数契约明显值得专项验证。
4. 情报、量化转录中 `SendToAgent` 调用均为 0；分别出现 11、6 次 `SendMessage`。这证明没有通过约定的点对点工具回报，不能据此断言指挥官完全没有从群消息获得信息。
5. 宿主日志尾部出现“无新增内容”“口径一致”等表态；14:18 的工作区进展只记录数据红线和共识。日志最后仍在派模板任务，而非呈现目标级验收结果。

这条链条支持“派活—执行—回报—验收没有强制闭环”，不支持“所有 Bot 都没做事”或“全部网络请求失败”。

## 3. 已发现问题与优先级

P0 为多 Bot 目标模式上线前必须完成；P1 为提高效率及可运维性；P2 为后续扩展。

| ID | 优先级 / 证据 | 问题与影响 | 改进方向 |
|---|---|---|---|
| F01 | P0 / C | `src/goals.ts:181` 明确拒绝 group；目标归属于单一 agent，无团队任务实体 | 引擎原生团队 Goal，保留单 Bot 兼容入口 |
| F02 | P0 / L+C | SendToAgent 只有目标、文本、图片、优先级；任务 ID、回报与黑板主要写在提示词里。今日接收者没有点对点结果回报 | 结构化 Task/Attempt/Result；结果入库后由引擎唤醒父任务 |
| F03 | P0 / R | Goal Guard 以 `updatedAt > lastFiredAt` 认定记录了进展；仅改时间戳也能无限重置停滞计数 | 证据、验证和任务状态驱动 progress revision |
| F04 | P0 / C | 模型可直接写 goal.json 的 done/status；引擎据此停止。工作台有人工验收，这是已有保护，但引擎没有独立验证证据 | 区分 reported、verified、accepted；禁止 Bot 修改目标定义和正式状态 |
| F05 | P0 / R+C | 群聊 `GROUP_MAX_MEMBER_TURNS=10` 实际按发出的有效消息计数；pass 不计入。16 人全 pass 实际模型调用 16 次 | 执行前扣减 invocation 预算；消息量和执行量分开统计 |
| F06 | P1 / L+C | 群聊串行 await 成员，最多 3 轮并附接力/收尾扫描；尾部重复表态也会作为 say 传播 | 任务 DAG 调度；按待办唤醒，纯共识不触发新工作 |
| F07 | P0 / L+C | 名称误作 ID、嵌套 arguments、技能及数据源反复探索；今天有高调用量但未发现指定产物 | 能力预检、结构化目录、严格工具 schema、有限参数修复与失败分类 |
| F08 | P0 / C+H | 本地 cron 在保存下次时间后 await 实际执行；同一 tick 内后续例行任务可能被长任务拖延。游标落盘和任务接收之间没有统一事务 | 持久化就绪队列、事务 outbox、并发调度；崩溃恢复测试 |
| F09 | P0 / C+H | 目标、设置与黑板分别写文件；插件 exclusive 是进程内锁；缺少跨目标的产物版本和工作区写入所有权 | 引擎单写者 + 数据库事务、任务工作区、交付 manifest |
| F10 | P0 / C | 当前引擎未提交补丁已对 DSH-GOAL 缺失/无效台账停机；通用 parser 仍返回 null，旧 SWARM 名称不享有同一名称保护 | 明确 routine kind + goalId；目标存储异常必须 fail closed，普通 cron 不受影响 |
| F11 | P1 / L | 宿主样本有 14 次 JSON parse unhandledRejection、14 次 SIGTERM；无统一时间/任务关联。不能断言二者有因果关系 | 结构化错误、版本、run/task 关联、独立健康状态 |
| F12 | P1 / L+C | 当日工作台版本全是 unresolved；README 仍称群上限 6，源码/UI 已为默认 8、硬上限 16 | 能力握手、构建版本、协议契约测试与文档同步 |
| F13 | P0 / C | SWARM-v1 是 persona 字符串开关，授权、任务链和重复派活约束靠文本；工具描述仍要求显式 fan-out 授权，与 swarm 段落存在歧义 | Goal 成员 ACL、允许的动作与显式协作模式，由工具层校验 |

### 3.1 必须保留的现有能力

已有持久化自动化、运行记录、消息接收账本、用户可见确认补偿、群聊 epoch 取消、目标创建幂等、暂停先关闭调度、人工验收、路径校验、SSE 重连与转录对账。应复用这些边界，不另造一套聊天传输，也不能把“收到消息的 ACK”误当作“完成委派工作的 ACK”。

### 3.2 尚不能下结论的部分

- JSON parse 异常来自哪个 HTTP 服务、是否导致目标中断，需要补 requestId、endpoint 类别和 runId 后复现。
- 技能/行情后端缺失在日志中主要是 Bot 的判断；本次没有对外部后端做实连测试，不认定真实服务故障。
- 多 Bot 文件覆盖、崩溃丢任务属于代码风险，未在生产制造故障验证。
- 现有消息接收幂等不等于缺失；缺的是业务任务、执行 attempt、外部副作用之间的统一幂等语义。

## 4. 目标、非目标和成功指标

### 4.1 必须达成

- **G1 闭环交付**：所有派活都有唯一任务、负责人、输入、产物、验收项、状态和父任务；发送成功不能标记完成。
- **G2 可恢复执行**：关闭 UI 不影响执行；重启后未完成任务可追踪恢复；同一任务同一时刻最多一个有效租约。
- **G3 有限自主性**：并发、重试、调用量、token、时长和派生任务数量受引擎限制。
- **G4 可信验收**：模型自报与验证结果分离；最终交付可逐项回溯证据。
- **G5 可诊断**：用户能看到当前谁在做什么、卡在哪里、已耗多少预算、下一步由谁触发。

### 4.2 首期范围

单宿主、多个已有或目标专用 Bot、有限 DAG、单协调者、结构化回报、文件/测试/人工三类验证器。每个 worker attempt 使用独立任务上下文，避免复用角色聊天历史造成串任务；角色本身可以复用。

首期不做跨宿主共识、任意层级自繁殖 Bot、全自动开放式授权、不受限长期任务，也不把研究请求自动升级成交易或发布等外部执行。持续监控使用独立 Monitor 模式，避免循环自检被当作有限目标完成任务。

### 4.3 衡量口径

以下是拟定验收门槛，不是已测得的线上效果：

| 指标 | 首期门槛 | 统计方式 |
|---|---|---|
| 状态完整性 | 100% 派活可关联 goal/task/attempt | 事件与任务表关联校验 |
| 完成可信度 | 0 个无证据 succeeded；0 个未验收 completed | 全量状态约束检查 |
| 恢复正确性 | 故障注入集中 0 丢失已接收任务、0 双有效租约 | 重启前后对账 |
| 调度延迟 | 就绪且有空闲配额时 p95 ≤5 秒 | 本地 mock、3 worker、100 任务，不含模型延迟 |
| 空转 | 连续 3 个无实质进展周期必须重规划或停为 blocked | 时间戳/复述/重复检索场景 |
| 资源上限 | 无新调用越过配置硬预算 | 每次调度和工具执行前校验 |
| 用户通知 | 同一阻塞不重复通知；完成/需行动只通知一次 | 以事件去重键验证 |

## 5. 领域模型与存储规格

新增 sdk-bots `src/host/collaboration/`，使用引擎现有 SQLite 能力建设独立 `collaboration.db`。任务状态和事件同事务写入；SQLite 是权威，Markdown 黑板是只读投影/导出。

| 实体 | 关键字段 | 约束 |
|---|---|---|
| Goal | id, objective, criteriaVersion, mode, teamId, coordinatorId, status, revision, policy, budget, createdBy | 目标和标准不可由 worker 改写；修改产生新版本与审计 |
| Criterion | id, goalId, version, text, verifierKind, verifierSpec, required | 指定验证方法；无法机器验证时明确为人工判断 |
| Task | id, goalId, parentTaskId, title, inputRefs, outputContract, dependsOn, assigneeId, state, revision, priority | 依赖同一 Goal；无环；成功的依赖才可解锁 |
| Attempt | id, taskId, number, runId, sessionId, leaseOwner, leaseEpoch, leaseUntil, heartbeatAt, state, errorCode | 重试新建 attempt；不能覆盖历史失败 |
| Artifact | id, taskId, attemptId, uri, sha256, size, mediaType, createdAt | 产物不可变或有版本；只接受允许路径内真实文件 |
| Verification | id, criterionId, criteriaVersion, artifactRefs, verifierVersion, status, evidence, checkedAt | 绑定产物 hash；新版本使旧验证失效 |
| Event | eventId, goalId, taskId?, attemptId?, type, revision, causationId, occurredAt | 可按游标重放；不保存凭证或全量敏感提示词 |
| Outbox | id, operationKey, target, payloadRef, deliveryState, retryAt | 唯一 operationKey；与派活状态同事务提交 |
| Blocker | id, scope, code, requiredAction, dependencyRef, retryPolicy, notifiedAt | 共享依赖失败只探测一次，避免各角色重复排查 |
| Budget | scopeId, tokenLimit, reservedTokens, actualTokens, callLimit, deadline, maxAttempts | Goal/Task/Attempt 分层；预留和结算原子化 |

`inputRefs` 至少包含：目标摘要、当前标准版本、允许工具、指定依赖产物、交付格式、回报约定。模型不得自行扫描所有 Bot 私聊来恢复上下文。

### 5.1 状态机

Goal：`draft → planning → running → verifying → awaiting_review → completed`。

- `planning/running/verifying` 可因用户暂停进入 `paused`，保存 resumeState。
- 无可运行任务且存在缺失条件时进入 `blocked`；能力恢复、用户补充或明确重规划后恢复。
- 必需任务永久失败且重规划额度耗尽进入 `failed`；预算耗尽进入 `paused(reason=budget_exhausted)`。
- 用户取消进入 `cancelling`，停止派发、撤销租约并收敛到 `cancelled`。
- `awaiting_review` 的通过只能来自用户；退回产生 revision 和修订任务，原证据保留。

Task：`pending → ready → leased → running → submitted → verifying → succeeded`。

- 临时失败：`running → retry_wait → ready`，受次数和截止时间限制。
- 资料/权限缺失：`running → blocked`；解除后回 ready。
- 验证失败：原 attempt 结束为 rejected，新 attempt 重新执行；耗尽重试则 task failed。
- 取消/目标修订使旧任务进入 cancelled/superseded；旧结果可以归档，不能推进新版本。
- 租约过期先执行副作用对账；只有确认可重试才重新 ready。不能直接把 timeout 当作安全重做的许可。

不变量：没有 lease 的 worker 不能提交；旧 leaseEpoch 的结果不能改变状态；没有验证通过不能 succeeded；required 标准未通过不能 awaiting_review；未获用户接受不能 completed；重复事件不能解锁或消费预算两次。

## 6. 核心执行方案

### 6.1 规划与角色分配

1. 用户选择已有团队或创建目标专用团队，填写目标、标准和预算。默认有限目标；需要周期监控时显式选择 Monitor。
2. 引擎获取成员 capability snapshot：工具名称/schema 版本、权限、工作区、数据源健康、可用性。健康有 TTL，预检成功不代表整个执行期永远可用。
3. 协调者提出结构化 plan，包含每个任务的交付物、验收项、依赖、估算和推荐角色。
4. `PlanValidator` 校验 DAG、标准覆盖、能力匹配、重复输出路径、预算与权限。不合格计划最多自动修正 2 次，再进入 actionable blocked。
5. 独立任务并行；同一任务仅一个负责人；验证者可复用独立角色，但不能用自己的自然语言声明替代验证器。
6. 不为任务自动创建无限角色。优先使用已有成员；目标专用 Bot 的创建数量计入配额，归档需保留引用和审计。

### 6.2 派发、回报与恢复

- 同一数据库事务：Task ready→leased、创建 Attempt、预算预留、写 outbox。
- Dispatcher 发送结构化执行信封；传输采用至少一次投递，接收端按 attemptId 去重，不承诺任意外部副作用 exactly once。
- Worker 收到后提交 started；进程执行器每 10 秒心跳，默认 lease 60 秒。模型无需调用工具维持存活。
- Worker 必须调用 `SubmitTaskResult` 或 `BlockTask`。结束但未提交由 runtime 标记 `missing_result`，最多 1 次恢复提示，随后显式失败或重试。
- 结果成功入库后，outbox 通知协调者并解锁依赖。父任务不靠“下次 cron 记起来”才能获知完成。
- 重启扫描未完成 Attempt 和未投递 outbox：有效运行可重新关联，失联任务回收租约。晚到消息依据 epoch/revision 丢弃状态更新但保留审计。
- 发布、发送邮件等副作用用 operationKey 记录 intent/confirmed/unknown。unknown 必须先查询外部结果；不支持查询或幂等键时进入人工处理，不能盲目重试。

### 6.3 调度、预算与防空转

事件触发是主路径：task ready、result submitted、verification finished、blocker resolved。定时器只做过期租约、可重试事件和健康状态的恢复扫描。

建议首期默认值（产品参数，可配置）：每 Goal 最多 3 worker 并发；同一 Bot 1 个工作 attempt；协调者单独串行；每 Goal 最多 30 个任务、派生深度 2、每 Task 最多 3 个 attempt；每 attempt 默认 20 次工具调用、10 分钟；Goal 默认 60 分钟、200,000 token；未知 token 用量必须标记 unknown，并依赖硬调用量/时长限额，不能显示为 0。

- 群聊旧模式先修 invocation 计数：调用成员前消耗预算，pass/空答/失败都计入；消息预算另计。
- token 按请求上限预留，响应后结算；限制可能发生的单次 overshoot 为已预留的在途输出额度，停止后不得启动新请求。
- 进展由引擎计算：新产物被验证、任务状态前进、具体 blocker 解除。改时间、改措辞、重写相同 hash 不算进展。
- 连续 3 个无进展周期先触发一次有预算的 replan；再次达到阈值进入 blocked(no_progress)。等待有效 worker/外部依赖时不算空转，只检查 SLA。
- 429/临时网络错误使用有限退避（建议 1s、5s、15s 并抖动）；认证、缺工具、schema 错误不按网络错误无限重试。
- 多个 Bot 依赖同一数据源时复用一次能力探测和同一版本快照，避免每个角色重复搜索。

### 6.4 验证与交付

验证器必须按目标类型注册，首期至少包含：

- 文件：允许根目录内、非逃逸 symlink、真实存在、大小和格式正确、hash 匹配。
- 测试：预先允许的检查命令、固定 cwd、timeout、exit code、输出摘要和代码版本。不能执行 worker 提交的任意验证命令。
- 资料：来源、获取时间、业务日期/时区、适用范围和必要字段；“有 URL”不足以证明内容正确，无法自动判断的结论进入人工验证。
- 人工：验证方法明确为 human，UI 展示证据并由用户逐项确认。

协调者提交交付包：目标摘要、每条标准的验证状态、产物链接、未解决事项、预算消耗。完成任务的数量不能替代目标验收。数据不足时输出“已完成部分 + 缺失条件”，不能用模板文件冒充当日分析完成。

### 6.5 工作区与上下文

代码任务使用 task worktree/独立 checkout，最终由集成任务合并并运行整体验证；普通文档使用 task/attempt 独立目录和不可变产物。共享 PROGRESS.md 由投影器生成，不允许多个 Bot 并发改权威台账。

Worker 只获得任务输入和已验证依赖；跨轮恢复读取 snapshot，而不是全部群聊。新计划引用旧产物必须显式版本绑定。角色私聊和 Goal task session 分开；任务间共享知识走公开 artifact，不隐式共享私人聊天。

### 6.6 授权与中断

Goal 创建时保存允许成员、工具、工作区和外部动作范围；正常范围内的派活不重复询问用户。persona 和来信文本不能扩大权限。成员身份由宿主注入，不能用“我是指挥官”文字作为授权凭证。

暂停先停止派发，再请求中断本 Goal 的 active attempts，不能误停成员的无关聊天。UI 显示 pausing 直到 worker 确认或超时隔离；暂停期间结果可以存档，不解锁后续执行。恢复显式重新评估依赖和预算；取消后晚到结果不得复活目标。

## 7. API 与事件协议

新增接口均为拟议协议，不是现有 API；名称可按项目风格调整，语义不得省略。

| 接口 | 输入要点 | 返回/约束 |
|---|---|---|
| createCollaborationGoal | requestId, objective, criteria, teamId, policy, budget | 同 requestId 同内容返回同 goal；不同内容 CONFLICT |
| submitGoalPlan | goalId, expectedRevision, tasks, criteriaCoverage | 原子校验并落 DAG；禁止环和越权成员 |
| getGoalSnapshot | goalId | 一致性快照 + revision + eventCursor |
| listGoalEvents | goalId, afterCursor, limit | 持久化增量；游标过期要求重取快照 |
| updateGoalControl | goalId, expectedRevision, action, reason? | pause/resume/cancel/revise；CAS 防覆盖 |
| claimTask / heartbeatTask | taskId/attemptId, leaseEpoch | 仅执行器身份可调用 |
| SubmitTaskResult | taskId, attemptId, leaseEpoch, criteriaVersion, artifactRefs, summary | submitted 不等于 succeeded；引擎安排验证 |
| BlockTask | attemptId, leaseEpoch, code, requiredAction, evidenceRefs | 阻塞原因结构化，通知去重 |
| acceptGoal / rejectGoal | goalId, revision, feedback? | 用户身份；拒绝保留历史证据并生成修订 |

通用错误：`REVISION_CONFLICT`、`STALE_LEASE`、`CAPABILITY_MISSING`、`BUDGET_EXHAUSTED`、`INVALID_PLAN`、`INVALID_RESULT`、`GOAL_PAUSED`。每个返回包含 requestId；不靠解析自然语言判断失败类别。

事件 envelope：`{schemaVersion,eventId,goalId,taskId?,attemptId?,type,revision,causationId,occurredAt,payload}`。关键事件为 goal.created、plan.accepted、task.leased、attempt.started、artifact.submitted、verification.failed/passed、task.blocked/succeeded、goal.review_requested、goal.accepted。

旧 SendToAgent 保留聊天用途；团队 Goal 内委派走任务 API。旧消息 ACK 继续用于投递确认，TaskResult 用于工作结果。

## 8. 工作台规格

- 侧栏新增“团队目标”，不强迫用户先进入单 Bot 聊天。群页面可发起目标；聊天不会自动变成无限持续任务。
- 目标概览：目标、验收标准、总状态、预算、阻塞摘要、下一次事件或检查时间。
- 任务视图：负责人、依赖、当前 attempt、最后实质进展、租约/超时、结果与验证。图形 DAG 可后做，列表必须先可用。
- 证据视图：标准 → artifact/version → 验证结果；明确区分“Bot 声称完成”“已验证”“用户已接受”。
- 时间线默认只展示任务状态、重要错误、产物和决策；群讨论、工具调用放可展开详情。
- 用户操作：暂停整个目标、恢复、取消、补充条件、退回指定标准、确认验收；有进行中副作用时展示真实状态，不提前显示已停止。
- SSE 只作增量提示。连接重建、宿主重启、游标过期时以 Goal snapshot 对账；不能把 3000 项内存环当任务事件持久层。
- 网关握手返回 engineVersion、buildCommit、protocolVersion、capabilities；缺团队目标能力时明确提示升级，保留旧单 Bot 功能。

## 9. 可观测性规格

每条关键日志包含 UTC 时间、hostInstanceId、engineVersion/buildCommit、goalId/taskId/attemptId/runId、eventType、durationMs、outcome/errorCode；展示层可转上海时间。工具参数仅保留脱敏摘要/hash，默认不记录令牌、完整正文、私聊内容。

至少提供：ready queue age、active leases、stale lease rejects、missing_result、retry_by_code、no_progress_cycles、capability failures、verification rejection、tokens/calls per goal、end-to-end completion time、notification dedupe count。

健康检查拆成 gateway reachable、storage writable、scheduler ready、provider usable、required tools available。当前日志中的通用 inference credential 告警不能直接覆盖本地 provider 的可用状态。

JSON parse 错误必须在响应边界捕获，记录 endpoint 类别、HTTP status、content-type、响应长度、requestId；不打印密钥或整段敏感响应。host 保持存活不能掩盖 attempt 失败。

## 10. 实施拆分与交付顺序

| 阶段 | 改动位置 | 交付内容 | 退出标准 |
|---|---|---|---|
| M0 可靠性基线 | sdk group-chat-orchestrator、goal-ledger、automation-run-path；dsh version/README | 修执行计数、统一目标存储错误策略、版本可观测、补本文复现用例 | A03/A04/A13/A15 通过；现有回归保持通过 |
| M1 任务核心 | 新增 collaboration/store、schemas、state-machine、dispatcher、outbox、leases、budget | Goal/Task/Attempt 持久化及结果回报 API，mock worker 可跑通 DAG | A01/A02/A05/A06/A07/A08/A09 通过 |
| M2 实际执行 | runner 任务工具与独立 session；capabilities、artifacts、verifiers、workspace adapter | 2–3 worker 协作、能力预检、证据验证、集成交付 | A10/A11/A12/A14/A16 通过 |
| M3 工作台 | dsh goals 适配器、新团队目标 UI、事件与 snapshot 投影 | 用户可创建、监控、中断、补充、验收 | A17/A18/A19 通过 |
| M4 迁移灰度 | swarm-bootstrap、兼容适配、功能开关 | 单目标白名单试跑 → 小团队 → 默认可用 | A20/A21 通过，才开启默认团队模式 |

依赖顺序：M0 → M1 → M2；M3 可以在 M1 协议固定后使用 mock 开发；M4 等待全部验收通过。工作量先按上述切片拆 issue，由实施者基于存储/runner 接入成本估算，不在缺少评估时给出承诺工期。

首期不要仅扩展 `src/goals.ts` 为多 agentId 数组：这个文件属于插件适配层，执行状态机必须在 sdk 引擎，才能保证 dsh 退出后仍可靠运行。

## 11. 验收矩阵

所有故障测试先使用 fake clock、mock provider、临时数据目录和可控崩溃点，不操作用户真实数据或调用真实交易服务。

| ID | 场景/输入 | 必须满足的验收结果 |
|---|---|---|
| A01 | 同 requestId 并发创建 20 次；一次响应丢失后重试 | 只有 1 个 Goal、1 个计划版本；重试不恢复已暂停目标；内容冲突明确报错 |
| A02 | 任务 A/B 可并行，C 依赖 A+B | A/B 有重叠执行；C 仅在二者验证成功后开始；任一失败不能假完成 |
| A03 | 只改 updatedAt 或反复写相同 hash，连续 20 周期 | 不产生实质 progress revision；3 次无进展进入重规划，按规定再次停滞后 blocked |
| A04 | 16 人全 pass；混合空答、异常、有效答复；调用预算 10 | 每种情况模型调用 ≤10；剩余工作可见为待调度；pass 不广播为业务消息 |
| A05 | 派活前、事务后投递前、投递后 ACK 前分别崩溃 | 重启后任务不丢，重复投递不生成双 attempt；状态与 outbox 可对账 |
| A06 | worker lease 过期，接替 worker 成功，旧 worker 晚到 | 旧结果 STALE_LEASE；只有新租约可完成任务；旧产物仅归档 |
| A07 | 暂停/取消时有多个 active worker 和无关私聊 | 立即停止新派发；5 秒内发出中断，30 秒内确认或隔离并显示未停止原因；无关聊天不受影响 |
| A08 | 超 token、工具调用、attempt、deadline 任一预算 | 不再启动超限调用；预留在途额度有界；UI 给出暂停原因，不自动加预算 |
| A09 | 终止前副作用已发生但确认消息丢失 | 先按 operationKey 查询；可幂等恢复；无法确认进入 unknown/待处理，不能重复副作用 |
| A10 | 未接入所需数据源；6 角色都依赖该数据源 | 一次共享预检失败，相关任务 blocked；无效搜索不扩散；独立任务仍可运行 |
| A11 | tool input 多层 arguments、错误 target_id、畸形 schema | 执行前拒绝并给字段级错误；最多一次受限修复；无递归猜测、无错误收件人副作用 |
| A12 | Bot 提交 achieved/done 但无产物，或产物 hash 变化 | 无法 succeeded/awaiting_review；版本变化使旧验证失效；真实验收后才能提交用户 |
| A13 | 已声明 goal 的台账缺失/损坏/无法写；普通 cron 无台账 | Goal 停为 attention/blocked 并报警；不退化为普通无限 cron；普通 cron 继续兼容 |
| A14 | 两 worker 写同目标文件、两个代码分支冲突 | 独立目录保留双方产物；集成冲突形成任务，不能静默覆盖；整体验证后交付 |
| A15 | HTTP 返回空/截断 JSON，启动期间 provider 不可用 | 请求边界记录关联错误；没有未归因 unhandledRejection；相关 attempt 显式失败/重试 |
| A16 | Worker 工作结束但没调 SubmitTaskResult | 1 次恢复机会后 missing_result；父任务收到失败或阻塞；不能永久等待自然语言回报 |
| A17 | 页面关闭；宿主重启；SSE 游标落后超缓存容量 | 执行不依赖页面；重新打开恢复 snapshot；任务状态、验证和预算不丢失 |
| A18 | 用户退回一项已提交验收标准 | 生成新 revision 和修订任务；保留原交付；旧回报不能完成新版 Goal |
| A19 | 缺权限/需要用户输入连续扫描 10 次 | 同一 blocker 只通知一次；补充输入后恢复；完成通知也只发送一次 |
| A20 | 升级/迁移失败中途退出再重试 | 导入幂等；旧目标不自动启动；备份和映射可恢复；一个目标只有一个执行 owner |
| A21 | 100 任务 mock 队列 + 24 小时 fake-clock/重启 soak | 满足调度 p95 ≤5 秒；0 丢任务/双有效租约/无证据成功；预算和通知不变量始终成立 |

发布门禁：P0 对应验收全部通过、已有单 Bot/群聊回归通过、真实模型小样本只读试运行完成。真实模型质量单独评估，不用一次 mock 测试声称已解决复杂目标的全部正确率问题。

## 12. 迁移、兼容与回滚

1. 新增 `collaborationGoalsV1` capability 与显式功能开关；旧客户端调用旧端点保持行为。
2. 普通 cron 默认仍是 routine；有限目标显式 kind=goal。用名字前缀识别仅作为迁移兼容，不能作为长期机制。
3. 旧 DSH-GOAL 迁移为一个 Goal + 单 worker Task；旧模型 done 仅导入为 reported，不自动成为 verified/completed；已由用户确认的旧完成状态保留并标注历史来源。
4. SWARM 黑板导入为历史附件和候选任务，不能从自然语言随意推断任务已完成。旧循环自检导入为 Monitor 候选，不自动改成有限目标。
5. 切换执行 owner 前先暂停旧 routine、等待在途工作收敛、备份、建立 oldId→newId 映射，再启用新调度；重试可检测完成步骤。
6. 回滚时关闭新派发、收敛租约并保留数据库。旧版只能读取导出状态，不能同时恢复相同目标的旧 cron；需要显式转换回去才可恢复执行。

## 13. 验证记录与可重复诊断

本次是方案审计，未执行修复阶段；日志问题只做只读检查，机制缺口使用隔离真实函数验证。没有对运行中的生产协作注入故障。

### 13.1 当前回归基线

在 sdk-bots 运行：

```sh
node --import tsx --test test/unit/goal-ledger.test.ts test/unit/group-turn-stall.test.ts test/unit/agent-collaboration-prompt.test.ts test/unit/local-cron-scheduler.test.ts test/unit/automation-goal-guard.test.ts
```

结果：62 tests，62 pass，0 fail（包含原本已有的未提交 guard 补丁）。

在 dsh-bots 运行：

```sh
pnpm exec vitest run tests/goals.spec.ts tests/sse.spec.ts
```

结果：2 files，25 tests，全部通过。合计 87 个现有测试通过；未运行全量集成或真实模型目标，不能推导为全部系统可靠。

### 13.2 R1：时间戳替代进展

在 sdk-bots 根目录执行以下诊断（断言预期改进行为，因此当前应返回非零）：

```sh
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { decideGoalFire } from './src/host/automations/goal-ledger.ts';
let ledger = {version:1,objective:'produce verified artifact',status:'active',
  acceptance:[{id:'c1',text:'artifact verified',done:false}],
  cycle:0,stallCount:0,updatedAt:1,lastFiredAt:null};
let fires=0;
for(let i=1;i<=20;i++) {
  const d=decideGoalFire({ledger,nowMs:i*1000,stallLimit:3});
  if(d.decision==='stop') break;
  fires++; ledger={...d.advanced,updatedAt:i*1000+1};
}
console.log({fires,done:ledger.acceptance[0].done,stallCount:ledger.stallCount});
assert.ok(fires < 20, 'timestamp-only updates must not sustain all 20 cycles');
JS
```

本次已执行上述完整断言命令（exit 1，AssertionError），并执行相同循环的观测版本：`fires=20, done=false, stallCount=0, GAP_REPRODUCED`。文档中的断言用于后续自动化回归门禁；实现新状态机后应在其真实调度入口补集成测试。

**修复记录（2026-10-08，M0）**：goal-ledger 新增引擎持有的 `progressHash`（status + acceptance done 态的指纹，排除 updatedAt/note/objective），`recordedProgressSinceLastFire` 改为内容比对；时间戳空转循环现于第 5 次决策停止（`fires=4 < 20`，stallCount=3）。回归锁定：`test/unit/goal-ledger.test.ts`（R1 20 周期循环 + 指纹往返 + 实质进展重置）。

### 13.3 R2：pass 未消耗成员执行预算

```sh
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { GroupChatOrchestrator } from './src/host/extensions/transcript/group-chat-orchestrator.ts';
const members=Array.from({length:16},(_,i)=>({id:String(i),name:'bot'+i,description:''}));
let calls=0;
await new GroupChatOrchestrator({
  resolveMembers:async()=>members,
  readHistory:()=>[{speaker:{kind:'user'},content:'@全员 检查任务'}],
  isCurrent:()=>true,
  runMemberTurn:async()=>{calls++;return ['(pass)'];},
  postMemberMessage:()=>{}
}).run({group:{name:'fixture',description:''},memberIds:members.map(x=>x.id)});
console.log({configuredCap:10,actualModelTurns:calls});
assert.ok(calls<=10,'pass must count toward invocation budget');
JS
```

本次已执行上述完整断言命令（exit 1，AssertionError），并执行相同 orchestrator 观测版本：`configuredCap=10, actualModelTurns=16, GAP_REPRODUCED`。这是允许最大成员数量下的计数错误，不表示当前 6 人群已出现 16 次调用，也不表示群聊完全无上界。

**修复记录（2026-10-08，M0）**：GroupChatOrchestrator 将执行预算与消息量分开——每次成员回合（pass/空答/异常/有效答复一律）在执行前扣减 `GROUP_MAX_MEMBER_TURNS` 预算，消息计数保留原有上限；预算耗尽后剩余成员以待调度可见日志收场。复现断言现为 `actualModelTurns=10 ≤ 10`，6 人 pending 有日志可见。回归锁定：`test/unit/group-invocation-budget.test.ts`（16 人全 pass、混合空答、预算耗尽待调度、异常计入）。

### 13.4 主要证据索引

代码路径以下相对各自仓库根目录；日志位于本机，可能轮转，实施前应保存脱敏 fixture，不把私人转录全量提交 Git。

| 引用 | 定位 | 支持的结论 |
|---|---|---|
| E01 | dsh `src/goals.ts:169–241` | 单 Bot 目标、创建幂等、文件台账与调度连接 |
| E02 | sdk `src/host/agents/agent-messaging.ts:70–110` | swarm 派活回执是提示词协议；persona marker 开关 |
| E03 | sdk `src/host/runner/tools/sand-agent-management-tools.ts:44–67` | SendToAgent 无结构化 task/attempt/验收字段 |
| E04 | sdk `src/host/automations/goal-ledger.ts`，recordedProgressSinceLastFire/decideGoalFire | 时间戳进展与自报完成 |
| E05 | sdk `src/host/extensions/transcript/group-chat-orchestrator.ts:37–118` | 串行调度、消息计数、接力收尾 |
| E06 | sdk `src/host/extensions/automations/local-cron-scheduler.ts:132–153`；`automation-runtime.ts:460` | 游标先保存，再 await 实际执行 |
| E07 | sdk `src/host/extensions/transcript/automation-run-path.ts:158–184` | 已有 DSH-GOAL 存储保护补丁的适用边界 |
| E08 | `~/.sdk-bots/agent-transcripts/e0b9f84f-e0c7-4098-8d97-5e5a590b7b97/e0b9f84f-e0c7-4098-8d97-5e5a590b7b97.jsonl:3–6,59–60` | 名称/ID 和 arguments 格式问题 |
| E09 | `~/.sdk-bots/agent-transcripts/3a5eeab3-53bd-4c66-b599-d295122d7399/3a5eeab3-53bd-4c66-b599-d295122d7399.jsonl`；量化 `6e7dbb07-e2a0-4c1c-a3cc-42d876568fd1` 同路径规则 | 派活接收、调用统计、无 SendToAgent 回报 |
| E10 | `/tmp/sdk-bots-host.log:897–935` | 重复共识、pass 与末尾仍在派活 |
| E11 | `/tmp/sdk-bots-host.log:18` 起各启动段；`~/.sdk-bots/dsh-bots-diag.jsonl` | JSON 错误与版本不可追溯 |
| E12 | dsh `src/sse.ts`；sdk `src/host/groups/group-store.ts:12–15`；dsh `src/client.ts:3634` | 内存事件环、成员上限已经升级，README 过时 |

## 14. 最终实施建议

优先完成任务回报和验证闭环，再扩大团队规模。第一条可上线的纵向链路应当是：一个目标、两个并行 worker、一个汇总/验证任务、一次中途重启、一次用户退回，最终通过逐项验收。在这条链路满足预算、幂等、恢复和证据约束之前，不以增加 cron 频率、放宽发言轮数或强化 persona 作为主要改进手段。
