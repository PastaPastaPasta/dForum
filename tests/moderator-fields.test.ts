import { describe, it, expect } from 'vitest'
import { stripModeratorFields, buildAuthorUpdate, MODERATOR_FIELDS } from '@/lib/services/moderator-fields'
import { buildContract as _buildContract } from '../contracts/build.mjs'

// The generator is plain JS — cast away the unhelpful structural types; the
// tests that follow assert the shape they rely on.
const buildContract = _buildContract as (opts: { moderation?: string; deployer?: string | null }) => any

describe('stripModeratorFields — author writes never carry moderator fields', () => {
  it('drops moderator-owned fields per type', () => {
    const stripped = stripModeratorFields('thread', { title: 't', sticky: true, locked: true, modState: 3, body: 'x' })
    expect(stripped).toEqual({ title: 't', body: 'x' })
  })

  it('drops post moderator fields but keeps the author body', () => {
    const stripped = stripModeratorFields('post', { body: 'hi', modState: 1, modNote: 'x', forumId: 'f' })
    expect(stripped).toEqual({ body: 'hi', forumId: 'f' })
  })

  it('drops profile moderator fields', () => {
    const stripped = stripModeratorFields('profile', { displayName: 'n', customTitle: 'c', modState: 2, bio: 'b' })
    expect(stripped).toEqual({ displayName: 'n', bio: 'b' })
  })

  it('passes types with no moderator fields through untouched', () => {
    const props = { slug: 's', sort: 1 }
    expect(stripModeratorFields('forum', props)).toEqual(props)
  })
})

describe('buildAuthorUpdate — stored moderator fields pass through unchanged', () => {
  const stored = { displayName: 'Me', customTitle: 'Veteran', modState: 2, bio: 'old' }

  it('keeps moderator-owned fields from the stored doc, ignoring attempts to set them', () => {
    const out = buildAuthorUpdate('profile', stored, { displayName: 'Me2', customTitle: 'Hacker', modState: 1 })
    expect(out.displayName).toBe('Me2')
    expect(out.customTitle).toBe('Veteran') // stored value wins — never reset by the author
    expect(out.modState).toBe(2)
    expect(out.bio).toBe('old') // untouched
  })

  it('adds author-owned fields; unknown non-moderator fields pass through (the chain rejects them)', () => {
    // Documents the actual behavior: buildAuthorUpdate only guarantees that
    // moderator-owned fields are dropped from the author's attempt. Author-
    // owned and unknown fields are passed through to the write — the contract
    // then validates and rejects anything not in the profile type.
    const out = buildAuthorUpdate('profile', {}, { displayName: 'N', website: 'https://x', bogus: 1 })
    expect(out.displayName).toBe('N')
    expect(out.website).toBe('https://x')
    expect(out.bogus).toBe(1)
  })

  it('refuses a change that tries to set a moderator-owned field via the changes object', () => {
    const out = buildAuthorUpdate('profile', {}, { modState: 99 })
    expect(out.modState).toBeUndefined()
  })
})

describe('MODERATOR_FIELDS — mirrors the contract changeFields (team mode)', () => {
  // The app-side moderator field list and the contract's moderatorAbilities.
  // changeFields must agree — a mismatch means the app refuses writes the
  // contract would allow, or allows ones it would refuse.
  // The deployer only affects the appointed-moderator list, never the
  // moderatorAbilities.changeFields — any syntactically valid identity works.
  const team = buildContract({ moderation: 'team', deployer: '6Dftf346svGz5btcf7NpQ3iPurku4JTit4kzWX7P7VwM' })

  for (const type of Object.keys(MODERATOR_FIELDS)) {
    it(`${type}: app fields == contract changeFields`, () => {
      const schema = team.documentSchemas[type]
      expect(schema, `contract has a ${type} schema`).toBeDefined()
      const changeFields = schema.moderatorAbilities?.changeFields ?? []
      expect([...MODERATOR_FIELDS[type]].sort()).toEqual([...changeFields].sort())
    })
  }

  it('thread/post/profile/report all carry a moderated schema (none mode drops them)', () => {
    for (const type of Object.keys(MODERATOR_FIELDS)) {
      expect(team.documentSchemas[type].moderatorAbilities, `${type} has moderatorAbilities`).toBeTruthy()
    }
  })
})

describe('MODERATOR_FIELDS — profile contract has no modNote', () => {
  it('profile lists only fields the profile contract owns', () => {
    expect(MODERATOR_FIELDS.profile).not.toContain('modNote')
    expect(MODERATOR_FIELDS.profile).toContain('customTitle')
    expect(MODERATOR_FIELDS.profile).toContain('modState')
  })
})
