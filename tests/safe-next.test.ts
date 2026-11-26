import { describe, it, expect, afterEach } from 'vitest'
import { safeNextPath } from '@/lib/safe-next'

const ORIGIN = 'https://pastapastapasta.github.io'

describe('safeNextPath', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_BASE_PATH
  })

  it('returns null for missing or empty input', () => {
    expect(safeNextPath(null, ORIGIN)).toBeNull()
    expect(safeNextPath('', ORIGIN)).toBeNull()
    expect(safeNextPath('   ', ORIGIN)).toBeNull()
  })

  it('accepts an ordinary app-relative path', () => {
    expect(safeNextPath('/settings', ORIGIN)).toBe('/settings')
    expect(safeNextPath('/t/abc123', ORIGIN)).toBe('/t/abc123')
    expect(safeNextPath('/s/../settings', ORIGIN)).toBe('/settings')
  })

  it('rejects protocol-relative and backslash paths', () => {
    // Browsers treat both // and \\ as / — an external host must never pass.
    expect(safeNextPath('//evil.com', ORIGIN)).toBeNull()
    expect(safeNextPath('/evil.com', ORIGIN)).toBe('/evil.com') // same-origin path — allowed
    expect(safeNextPath('/\\\\evil.com', ORIGIN)).toBeNull()
    expect(safeNextPath('/\\t/evil.com', ORIGIN)).toBeNull() // tab inside the URL
    expect(safeNextPath('/settings\t.evil.com', ORIGIN)).toBeNull()
  })

  it('rejects paths carrying other origins (dot-segment normalized)', () => {
    // URL parsing collapses dot segments — the normalized result must not
    // escape the origin.
    expect(safeNextPath('/./evil.com', ORIGIN)).toBe('/evil.com') // same-origin, stays
    expect(safeNextPath('/a/../../evil.com', ORIGIN)).toBe('/evil.com')
    expect(safeNextPath('http://evil.com/settings', ORIGIN)).toBeNull()
  })

  it('accepts slashes-only fall-throughs but never produces a protocol-relative path', () => {
    // A path that normalizes to a protocol-relative URL must be rejected.
    expect(safeNextPath('/.//evil.com', ORIGIN)).toBeNull()
  })

  it('prepends the base path on the Pages deploy and re-roots bare paths', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/dForum'
    expect(safeNextPath('/settings', ORIGIN)).toBe('/dForum/settings')
    expect(safeNextPath('/dForum/settings', ORIGIN)).toBe('/dForum/settings')
    expect(safeNextPath('/t/abc123', ORIGIN)).toBe('/dForum/t/abc123')
  })

  it('accepts a bare base path and never returns a malformed one', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/dForum'
    // Bare base = home page — allowed and normalized.
    expect(safeNextPath('/dForum', ORIGIN)).toBe('/dForum')
    expect(safeNextPath('/dForum/', ORIGIN)).toBe('/dForum/')
    // A sibling-repo path with no base prefix is re-rooted under the base.
    expect(safeNextPath('/', ORIGIN)).toBe('/dForum/')
  })

  it('rejects paths that would escape the base path on the Pages deploy', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/dForum'
    // A sibling-repo path on the shared GitHub Pages origin would read
    // sessionStorage keys shared across repos — must be impossible.
    expect(safeNextPath('/other-repo/settings', ORIGIN)).toBe('/dForum/other-repo/settings')
    expect(safeNextPath('../../other', ORIGIN)).toBeNull()
  })

  it('keeps query string and hash', () => {
    expect(safeNextPath('/search?q=forum#top', ORIGIN)).toBe('/search?q=forum#top')
    process.env.NEXT_PUBLIC_BASE_PATH = '/dForum'
    expect(safeNextPath('/search?q=forum#top', ORIGIN)).toBe('/dForum/search?q=forum#top')
  })

  it('rejects non-absolute paths', () => {
    expect(safeNextPath('settings', ORIGIN)).toBeNull()
    expect(safeNextPath('./settings', ORIGIN)).toBeNull()
    expect(safeNextPath('https://pastapastapasta.github.io/settings', ORIGIN)).toBeNull() // absolute URL (not same-origin path)
  })
})
