import { chromium } from '/work/scratch/dforum-tools/node_modules/playwright-core/index.mjs'
import { CDP, login, log } from './helpers.mjs'

const browser = await chromium.connectOverCDP(CDP)
const ctx = browser.contexts()[0]
const page = await ctx.newPage()
await page.setViewportSize({ width: 1440, height: 900 })
page.on('console', (m) => { if (m.type() === 'error') log('console', m.text().slice(0, 200)) })
try {
  await login(page, Number(process.argv[2] ?? 92), { shots: '/work/tmp/shots/e2e' })
  await page.screenshot({ path: '/work/tmp/shots/e2e-logged-in.png' })
} catch (e) {
  await page.screenshot({ path: '/work/tmp/shots/e2e-fail.png' })
  throw e
} finally {
  await page.close()
  await browser.close()
}
