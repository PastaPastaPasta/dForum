/**
 * Full testnet scenario against a running build (E2E_SITE) with the yappr test-wallet responder.
 * Personas (contracts/deployments/testnet.json): 92 bob, 93 carol (moderator), 94 mallory.
 *
 *   node e2e/testnet-e2e.mjs            (from the repo root; needs .env.local for carol's key)
 *
 * Writes evidence screenshots to E2E_SHOTS (default /work/tmp/shots/e2e) and a JSON summary.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from '/work/scratch/dforum-tools/node_modules/playwright-core/index.mjs'
import { CDP, SITE, log, login } from './helpers.mjs'
import { deriveIdentityKeys } from '../scripts/derive-identities.mjs'

const SHOTS = process.env.E2E_SHOTS ?? '/work/tmp/shots/e2e'
mkdirSync(SHOTS, { recursive: true })
const RUN = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '')
const result = { run: RUN, steps: [] }
const hydrationErrors = []
let shotN = 0

const browser = await chromium.connectOverCDP(CDP)
async function persona(name) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  // Confirms answer yes in the page itself: another client attached to this shared browser can
  // otherwise dismiss a native dialog before Playwright accepts it.
  await ctx.addInitScript(() => {
    window.confirm = (message) => { console.info(`confirm: ${message}`); return true }
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => {
    log(name, 'pageerror', e.message.slice(0, 200))
    if (/#418|#423|#425|Hydration/i.test(e.message)) hydrationErrors.push(`${name} ${page.url()}`)
  })
  page.on('dialog', (d) => { log(name, 'confirm:', d.message().slice(0, 120)); d.accept().catch(() => undefined) })
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) log(name, 'console', m.text().slice(0, 200)) })
  return { name, ctx, page }
}
/** Posts a reply straight through the SDK as persona `index`, bypassing the UI's lock check.
 * Returns the refusal message, or null when the write was accepted. */
async function replyFromNode(index, threadId, body) {
  const sdkMod = await import('@dashevo/evo-sdk')
  const record = JSON.parse(readFileSync('contracts/deployments/testnet.json', 'utf8'))
  const contractId = record.contracts.team.contractId
  const identityId = record.personas.find((p) => p.index === index).id
  const k = deriveIdentityKeys(index).find((x) => x.securityLevel === 'HIGH' && x.purpose === 'AUTHENTICATION')
  const sdk = sdkMod.EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000 } })
  await sdk.connect()
  const thread = (await sdk.documents.get(contractId, 'thread', threadId)).toJSON()
  const identity = await sdk.identities.fetch(identityId)
  const signer = new sdkMod.IdentitySigner()
  signer.addKeyFromWif(k.wif)
  const document = new sdkMod.Document({
    properties: { threadId, forumId: thread.forumId, body },
    documentTypeName: 'post', dataContractId: contractId, ownerId: identityId, revision: 1n,
    entropy: crypto.getRandomValues(new Uint8Array(32)),
  })
  try {
    await sdk.documents.create({ document, identityKey: identity.getPublicKeyById(k.keyIndex), signer })
    return null
  } catch (e) {
    return String(e?.message ?? e).replace(/[59c][1-9A-HJ-NP-Za-km-z]{50,51}/g, '[redacted]').replace(/^.*last error: /s, '')
  }
}

/** Replaces persona `index`'s post in `threadId` whose body contains `match`. Returns the refusal,
 * or null when the edit was accepted. */
async function editFromNode(index, threadId, match, body) {
  const sdkMod = await import('@dashevo/evo-sdk')
  const record = JSON.parse(readFileSync('contracts/deployments/testnet.json', 'utf8'))
  const contractId = record.contracts.team.contractId
  const identityId = record.personas.find((p) => p.index === index).id
  const k = deriveIdentityKeys(index).find((x) => x.securityLevel === 'HIGH' && x.purpose === 'AUTHENTICATION')
  const sdk = sdkMod.EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000 } })
  await sdk.connect()
  const res = await sdk.documents.query({ dataContractId: contractId, documentTypeName: 'post', where: [['threadId', '==', threadId]], orderBy: [['$createdAt', 'asc']], limit: 50 })
  const post = [...res.values()].filter(Boolean).map((d) => d.toJSON()).find((j) => j.$ownerId === identityId && String(j.body).includes(match))
  if (!post) throw new Error(`no post matching "${match}"`)
  const identity = await sdk.identities.fetch(identityId)
  const signer = new sdkMod.IdentitySigner()
  signer.addKeyFromWif(k.wif)
  const document = new sdkMod.Document({
    properties: { threadId, forumId: post.forumId, body }, documentTypeName: 'post', dataContractId: contractId, ownerId: identityId,
    revision: BigInt(post.$revision) + 1n, id: post.$id,
  })
  try {
    await sdk.documents.replace({ document, identityKey: identity.getPublicKeyById(k.keyIndex), signer })
    // A lagging node may answer with the old revision: look a few times before calling it refused.
    for (let i = 0; i < 5; i++) {
      if ((await sdk.documents.get(contractId, 'post', post.$id)).toJSON().body === body) return null
      await new Promise((r) => setTimeout(r, 3000))
    }
    return 'edit was not applied'
  } catch (e) {
    return String(e?.message ?? e).replace(/[59c][1-9A-HJ-NP-Za-km-z]{50,51}/g, '[redacted]').replace(/^.*last error: /s, '')
  }
}

/** Replaces persona `index`'s document — by id, or the first one of theirs matching `where` — with
 * `props(current)`. Returns the refusal, or null when the change was applied. */
async function replaceFromNode(index, type, idOrWhere, props) {
  const sdkMod = await import('@dashevo/evo-sdk')
  const record = JSON.parse(readFileSync('contracts/deployments/testnet.json', 'utf8'))
  const contractId = record.contracts.team.contractId
  const identityId = record.personas.find((p) => p.index === index).id
  const k = deriveIdentityKeys(index).find((x) => x.securityLevel === 'HIGH' && x.purpose === 'AUTHENTICATION')
  const sdk = sdkMod.EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000 } })
  await sdk.connect()
  let cur
  if (typeof idOrWhere === 'string') cur = (await sdk.documents.get(contractId, type, idOrWhere))?.toJSON()
  else {
    const res = await sdk.documents.query({ dataContractId: contractId, documentTypeName: type, where: [['threadId', '==', idOrWhere.threadId]], orderBy: [['$createdAt', 'asc']], limit: 50 })
    cur = [...res.values()].filter(Boolean).map((d) => d.toJSON()).find((j) => j.$ownerId === identityId)
  }
  if (!cur) throw new Error(`no ${type} of persona ${index} to change`)
  const next = props(cur)
  const identity = await sdk.identities.fetch(identityId)
  const signer = new sdkMod.IdentitySigner()
  signer.addKeyFromWif(k.wif)
  const document = new sdkMod.Document({ properties: next, documentTypeName: type, dataContractId: contractId, ownerId: identityId, revision: BigInt(cur.$revision) + 1n, id: cur.$id })
  try {
    await sdk.documents.replace({ document, identityKey: identity.getPublicKeyById(k.keyIndex), signer })
    for (let i = 0; i < 5; i++) {
      if (Number((await sdk.documents.get(contractId, type, cur.$id)).toJSON().$revision) > Number(cur.$revision)) return null
      await new Promise((r) => setTimeout(r, 3000))
    }
    return 'change was not applied'
  } catch (e) {
    return String(e?.message ?? e).replace(/[59c][1-9A-HJ-NP-Za-km-z]{50,51}/g, '[redacted]').replace(/^.*last error: /s, '')
  }
}

async function shot(p, label) {
  const file = `${SHOTS}/${String(++shotN).padStart(2, '0')}-${p.name}-${label}.png`
  await p.page.screenshot({ path: file, fullPage: true })
  return file
}
async function step(label, fn) {
  const t0 = Date.now()
  log('▶', label)
  try {
    const detail = await fn()
    result.steps.push({ label, ok: true, ms: Date.now() - t0, ...(detail ? { detail } : {}) })
    log('✓', label, `${((Date.now() - t0) / 1000).toFixed(1)}s`)
    return detail
  } catch (e) {
    for (const p of [bob, carol, mallory]) await p?.page.screenshot({ path: `${SHOTS}/FAIL-${p.name}.png`, fullPage: true }).catch(() => undefined)
    result.steps.push({ label, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 500) })
    log('✗', label, String(e?.message ?? e).slice(0, 300))
    throw e
  }
}
const WRITE_TIMEOUT = 120_000

let bob, carol, mallory
bob = await persona('bob')
carol = await persona('carol')
mallory = await persona('mallory')
let threadUrl, threadId, spamThreadId

try {
  // A previous run ends with mallory banned; lift it so this run starts from the same fixture.
  await step('fixture: mallory is not banned', async () => {
    const sdkMod = await import('@dashevo/evo-sdk')
    const record = JSON.parse(readFileSync('contracts/deployments/testnet.json', 'utf8'))
    const carolId = record.personas.find((p) => p.index === 3).id
    const malloryId = record.personas.find((p) => p.index === 4).id
    const k = deriveIdentityKeys(3).find((x) => x.securityLevel === 'CRITICAL' && x.purpose === 'AUTHENTICATION')
    const sdk = sdkMod.EvoSDK.testnetTrusted({ settings: { timeoutMs: 60000 } })
    await sdk.connect()
    const signer = new sdkMod.IdentitySigner()
    signer.addKeyFromWif(k.wif)
    try {
      await sdk.contracts.unbanUser({ identity: await sdk.identities.fetch(carolId), contractId: record.contracts.team.contractId, identityId: malloryId, signer })
      return { unbanned: true }
    } catch (e) {
      return { unbanned: false, note: String(e?.message ?? e).replace(/[59c][1-9A-HJ-NP-Za-km-z]{50,51}/g, '[redacted]').slice(-160) }
    }
  })
  await step('bob logs in with Dash (App Connect v2 via test wallet)', () => login(bob.page, 92, { shots: `${SHOTS}/00-bob` }))
  await step('bob saves a profile', async () => {
    await bob.page.goto(`${SITE}/settings/`)
    await bob.page.locator('fieldset:not([disabled])').waitFor({ timeout: 60_000 })
    await bob.page.getByLabel('Display name').fill(`Bob ${RUN}`)
    await bob.page.getByLabel('Location').fill('Testnet')
    await bob.page.getByLabel('About you').fill('I test **dForum** on testnet.')
    await bob.page.getByLabel('Signature').fill('Bob, testnet persona')
    await bob.page.getByRole('button', { name: 'Save profile' }).click()
    await bob.page.getByText('Profile saved to Dash Platform.').waitFor({ timeout: WRITE_TIMEOUT })
    return shot(bob, 'profile-saved')
  })
  await step('bob starts a thread', async () => {
    await bob.page.goto(`${SITE}/new/?forum=introductions`)
    await bob.page.getByLabel('Title').fill(`Hello from bob ${RUN}`)
    await bob.page.getByLabel('Tags').fill('introductions, testnet')
    await bob.page.getByLabel('Opening post').fill(`Hi all. This thread was written by the **testnet e2e run ${RUN}**.\n\n- markdown lists work\n- so do [links](https://www.dash.org)\n\n> and quotes`)
    await bob.page.getByRole('button', { name: 'Post thread' }).click()
    await bob.page.waitForURL(/\/t\/[1-9A-HJ-NP-Za-km-z]{40,44}\/?$/, { timeout: WRITE_TIMEOUT })
    threadUrl = bob.page.url()
    threadId = threadUrl.match(/\/t\/([^/]+)/)[1]
    await bob.page.getByRole('heading', { name: `Hello from bob ${RUN}` }).waitFor({ timeout: 60_000 })
    return { threadId, shot: await shot(bob, 'thread-created') }
  })
  await step('bob replies and edits the reply', async () => {
    await bob.page.getByLabel('Write a reply').fill('A first reply, to be edited.')
    await bob.page.getByRole('button', { name: 'Post reply' }).click()
    const found = bob.page.locator('article').filter({ hasText: 'A first reply, to be edited.' })
    await found.waitFor({ timeout: WRITE_TIMEOUT })
    const reply = bob.page.locator(`article#${await found.getAttribute('id')}`)
    await reply.getByRole('button', { name: 'Edit' }).click()
    await reply.getByLabel('Edit post').fill('A first reply, **edited** on chain.')
    await reply.getByRole('button', { name: 'Save changes' }).click()
    await bob.page.locator('article').filter({ hasText: 'edited on chain' }).waitFor({ timeout: WRITE_TIMEOUT })
    return shot(bob, 'reply-edited')
  })
  await step('carol logs in, reacts and quote-replies', async () => {
    await login(carol.page, 93)
    await carol.page.goto(threadUrl)
    const opening = carol.page.locator('article').first()
    await opening.waitFor({ timeout: 60_000 })
    await opening.getByRole('button', { name: 'React' }).click()
    await carol.page.getByRole('group', { name: 'Choose a reaction' }).getByRole('button', { name: 'Like', exact: true }).click()
    await opening.getByRole('button', { name: /Like: 1/ }).waitFor({ timeout: WRITE_TIMEOUT })
    await opening.getByRole('button', { name: 'Quote' }).click()
    await carol.page.getByLabel('Write a reply').press('End')
    await carol.page.getByLabel('Write a reply').pressSequentially('Welcome, bob!')
    await carol.page.getByRole('button', { name: 'Post reply' }).click()
    await carol.page.locator('article').filter({ hasText: 'Welcome, bob!' }).waitFor({ timeout: WRITE_TIMEOUT })
    return shot(carol, 'reacted-quoted')
  })
  await step('mallory posts spam', async () => {
    await login(mallory.page, 94)
    await mallory.page.goto(threadUrl)
    await mallory.page.getByLabel('Write a reply').fill(`BUY CHEAP COINS at scam.example ${RUN}`)
    await mallory.page.getByRole('button', { name: 'Post reply' }).click()
    await mallory.page.locator('article').filter({ hasText: 'BUY CHEAP COINS' }).waitFor({ timeout: WRITE_TIMEOUT })
    await mallory.page.goto(`${SITE}/new/?forum=forum-feedback`)
    await mallory.page.getByLabel('Title').fill(`Free money ${RUN}`)
    await mallory.page.getByLabel('Opening post').fill('Send 1 DASH, get 2 back.')
    await mallory.page.getByRole('button', { name: 'Post thread' }).click()
    await mallory.page.waitForURL(/\/t\/[1-9A-HJ-NP-Za-km-z]{40,44}\/?$/, { timeout: WRITE_TIMEOUT })
    spamThreadId = mallory.page.url().match(/\/t\/([^/]+)/)[1]
    return { spamThreadId, shot: await shot(mallory, 'spam-posted') }
  })
  await step('bob sees alerts and reports the spam reply', async () => {
    await bob.page.goto(`${SITE}/alerts/`)
    await bob.page.getByText('reacted').first().waitFor({ timeout: 90_000 })
    await shot(bob, 'alerts')
    await bob.page.goto(threadUrl)
    const spam = bob.page.locator('article').filter({ hasText: 'BUY CHEAP COINS' })
    await spam.waitFor({ timeout: 90_000 })
    await spam.getByRole('button', { name: 'Report' }).click()
    await spam.getByLabel('Reason').selectOption('1')
    await spam.getByLabel('Details').fill('Scam link')
    await spam.getByRole('button', { name: 'Send report' }).click()
    await spam.getByRole('button', { name: 'Reported' }).waitFor({ timeout: WRITE_TIMEOUT })
    return shot(bob, 'reported')
  })
  const carolKey = deriveIdentityKeys(3).find((k) => k.securityLevel === 'CRITICAL' && k.purpose === 'AUTHENTICATION').wif
  await step('carol unlocks the moderation console', async () => {
    await carol.page.bringToFront()
    await carol.page.goto(`${SITE}/moderation/`)
    await carol.page.getByLabel('CRITICAL key (WIF)').fill(carolKey)
    await carol.page.getByRole('button', { name: 'Unlock console' }).click()
    await carol.page.getByText(/Signing as/).waitFor({ timeout: 60_000 })
  })
  await step('carol hides the reported post from the report queue', async () => {
    const report = carol.page.locator('li').filter({ hasText: 'BUY CHEAP COINS' }).first()
    await report.waitFor({ timeout: 90_000 })
    await shot(carol, 'report-queue')
    await report.getByRole('button', { name: 'Hide post' }).click()
    await carol.page.getByText('Hide post and resolve: done').waitFor({ timeout: WRITE_TIMEOUT })
    return shot(carol, 'report-resolved')
  })
  await step('carol pins and locks bob’s thread', async () => {
    await carol.page.getByRole('tab', { name: 'Content' }).click()
    await carol.page.getByLabel('Thread or post link').fill(threadUrl)
    await carol.page.getByRole('button', { name: 'Find' }).click()
    await carol.page.getByTestId('moderation-target').filter({ hasText: `Hello from bob ${RUN}` }).waitFor({ timeout: 60_000 })
    await carol.page.getByRole('button', { name: 'Pin' }).click()
    await carol.page.getByText('Pin: done').waitFor({ timeout: WRITE_TIMEOUT })
    await carol.page.getByRole('button', { name: 'Lock', exact: true }).click()
    await carol.page.getByText('Lock: done').waitFor({ timeout: WRITE_TIMEOUT })
    return shot(carol, 'pinned-locked')
  })
  await step('carol moves then hides mallory’s spam thread', async () => {
    await carol.page.getByLabel('Thread or post link').fill(`${SITE}/t/${spamThreadId}/`)
    await carol.page.getByRole('button', { name: 'Find' }).click()
    await carol.page.getByTestId('moderation-target').filter({ hasText: `Free money ${RUN}` }).waitFor({ timeout: 60_000 })
    await carol.page.getByLabel('Move to forum').selectOption({ label: 'Announcements' })
    await carol.page.getByRole('button', { name: 'Move' }).click()
    await carol.page.getByText('Move thread: done').waitFor({ timeout: WRITE_TIMEOUT })
    await carol.page.getByRole('button', { name: 'Hide', exact: true }).click()
    await carol.page.getByText('Hide: done').waitFor({ timeout: WRITE_TIMEOUT })
  })
  await step('carol bans mallory', async () => {
    await carol.page.getByRole('tab', { name: 'Members' }).click()
    await carol.page.getByLabel('Member identity id').fill('5T9NKrPoBWrEDgyGfSHqaqDSKeTkHMr3otusqaxGmbyP')
    await carol.page.getByRole('button', { name: 'Look up' }).click()
    await carol.page.getByLabel(/Reason/).fill('Spam and scam links')
    await carol.page.getByRole('button', { name: 'Ban', exact: true }).click()
    await carol.page.getByText('Ban: done').waitFor({ timeout: WRITE_TIMEOUT })
    await carol.page.getByText(/banned/).first().waitFor({ timeout: 30_000 })
    await shot(carol, 'banned')
    await carol.page.getByRole('tab', { name: 'Audit log' }).click()
    await carol.page.getByText(/report actioned|hidden/).first().waitFor({ timeout: 60_000 })
    return shot(carol, 'audit-log')
  })
  await step('the network refuses mallory’s next post', async () => {
    await mallory.page.goto(`${SITE}/new/?forum=forum-feedback`)
    await mallory.page.getByLabel('Title').fill(`Banned attempt ${RUN}`)
    await mallory.page.getByLabel('Opening post').fill('This should be refused by consensus.')
    await mallory.page.getByRole('button', { name: 'Post thread' }).click()
    const alert = mallory.page.locator('p[role=alert]').filter({ hasText: /\S/ })
    await alert.waitFor({ timeout: WRITE_TIMEOUT })
    const text = await alert.innerText()
    if (!/banned|suspended/i.test(text)) throw new Error(`unexpected refusal text: ${text}`)
    await shot(mallory, 'ban-refused')
    if (/\/t\//.test(mallory.page.url())) throw new Error('banned write succeeded')
    return { refusal: text.slice(0, 200) }
  })
  await step('bob sees the locked thread with the spam hidden', async () => {
    await bob.page.goto(threadUrl)
    await bob.page.getByText('Hidden by a moderator.').waitFor({ timeout: 90_000 })
    await bob.page.getByText('Locked. No new replies can be posted.').waitFor({ timeout: 30_000 })
    return shot(bob, 'thread-after-moderation')
  })
  await step('consensus refuses a reply to the locked thread', async () => {
    // Control: the same script path can write to an open thread (the hidden spam thread).
    const control = await replyFromNode(2, spamThreadId, `Control write ${RUN}`)
    if (control) throw new Error(`control write refused: ${control}`)
    const refusal = await replyFromNode(2, threadId, 'Writing past the lock from a script.')
    if (!refusal) throw new Error('a reply to a locked thread was accepted')
    if (!/referenced document's locked/.test(refusal)) throw new Error(`refused for another reason: ${refusal}`)
    // v4: the lock also freezes existing posts. bob's earlier reply can't be edited any more.
    const editRefusal = await editFromNode(2, threadId, 'A first reply', 'Edited after the lock.')
    if (!editRefusal) throw new Error('an edit in a locked thread was accepted')
    // The lock also freezes the thread's title and reaction toggles (carol liked the opening post).
    const titleRefusal = await replaceFromNode(2, 'thread', threadId, (j) => ({ ...Object.fromEntries(Object.entries(j).filter(([k, v]) => !k.startsWith('$') && v !== null)), title: `${j.title} (edited)` }))
    if (!titleRefusal) throw new Error('a title edit in a locked thread was accepted')
    if (/does not moderate/.test(titleRefusal)) throw new Error(`title edit refused for another reason: ${titleRefusal}`)
    const reactionRefusal = await replaceFromNode(3, 'reaction', { threadId }, (j) => ({ postId: j.postId, postOwnerId: j.postOwnerId, threadId: j.threadId, kind: 0 }))
    if (!reactionRefusal) throw new Error('a reaction change in a locked thread was accepted')
    return { refusal: refusal.slice(0, 200), editRefusal: editRefusal.slice(0, 200), titleRefusal: titleRefusal.slice(0, 200), reactionRefusal: reactionRefusal.slice(0, 200) }
  })
  await step('pages hydrate without errors', async () => {
    if (hydrationErrors.length) throw new Error(`hydration failed: ${[...new Set(hydrationErrors)].join(', ')}`)
    return { checked: 'all pages visited in this run' }
  })
} finally {
  result.threadId = threadId
  result.spamThreadId = spamThreadId
  writeFileSync(`${SHOTS}/result.json`, JSON.stringify(result, null, 2))
  for (const p of [bob, carol, mallory]) await p.ctx.close().catch(() => undefined)
  await browser.close()
}
console.log(JSON.stringify(result, null, 1))
