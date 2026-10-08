// Check client activation as well as HTTP boot. Read the private local URL
// from stdin so its per-process auth token does not appear in command output.
import { chromium } from 'playwright-core'

let url = ''
for await (const chunk of process.stdin) url += chunk
url = url.trim()
if (!/^http:\/\/127\.0\.0\.1:\d+\/\?token=/.test(url)) throw new Error('Missing local dsh test URL')

const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE
  ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }) })
try {
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const body = await page.locator('body').innerText()
  if (/Failed to load plugins|entries did not activate|waiting for service: shortcuts|authentication required/i.test(body)) {
    throw new Error('Client plugin activation failed: ' + body.slice(0, 1800))
  }
  if (body.trim().length === 0) throw new Error('dsh client rendered an empty page')
  console.log('PASS dsh client loaded without pending plugins')
} finally {
  await browser.close()
}
