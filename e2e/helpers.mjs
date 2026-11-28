/**
 * Testnet end-to-end helpers: drive the site in a real Chrome (CDP) and answer App Connect
 * requests with the yappr test-wallet responder (a stand-in for DashPay).
 */
export const SITE = process.env.E2E_SITE ?? 'http://127.0.0.1:8899'
export const RESPONDER = process.env.E2E_RESPONDER ?? 'http://127.0.0.1:8791'
export const CDP = process.env.E2E_CDP ?? 'http://127.0.0.1:9347'

export function log(...a) { console.log(`[e2e ${new Date().toISOString().slice(11, 19)}]`, ...a) }

export async function respond(uri, persona) {
  const res = await fetch(`${RESPONDER}/respond`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uri, persona }) })
  const text = await res.text()
  if (!res.ok) throw new Error(`responder ${res.status}: ${text.slice(0, 400)}`)
  return text
}

/** Logs in through the real login page; returns the identity id shown in the session. */
export async function login(page, persona, { shots } = {}) {
  await page.goto(`${SITE}/login/`, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Log in with Dash' }).last().click()
  const link = page.getByRole('link', { name: 'Open your Dash wallet to log in' })
  await link.waitFor({ timeout: 120_000 })
  if (shots) await page.screenshot({ path: `${shots}-login-qr.png` })
  const uri = await link.getAttribute('href')
  log('login uri', uri.slice(0, 48) + '…', 'persona', persona)
  await respond(uri, persona)
  const candidate = page.getByRole('dialog').locator('li button').first()
  await candidate.waitFor({ timeout: 180_000 })
  if (shots) await page.screenshot({ path: `${shots}-login-confirm.png` })
  await candidate.click()
  await page.getByRole('button', { name: 'Account menu' }).waitFor({ timeout: 180_000 })
  log('logged in')
}

export async function logout(page) {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('button', { name: 'Log out' }).click()
  await page.getByRole('link', { name: 'Log in with Dash' }).first().waitFor({ timeout: 30_000 })
}
