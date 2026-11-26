import { describe, it, expect } from 'vitest'
import { stripModeratorFields, buildAuthorUpdate, MODERATOR_FIELDS } from '@/lib/services/moderator-fields'

describe('stripModeratorFields — author writes never carry moderator fields', () => {
  it('drops moderator-owned fields per type', () => {
    const stripped = stripModeratorFields('thread', { title: 't', sticky: true, lockedAt: 9, modState: 3, body: 'x' })
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

  it('adds author-owned fields and ignores unknown attempts that are not moderator-owned', () => {
    const out = buildAuthorUpdate('profile', {}, { displayName: 'N', website: 'https://x', bogus: 1 })
    expect(out.displayName).toBe('N')
    expect(out.website).toBe('https://x')
  })
})

describe('MODERATOR_FIELDS — profile contract has no modNote', () => {
  it('profile lists only fields the profile contract owns', () => {
    expect(MODERATOR_FIELDS.profile).not.toContain('modNote')
    expect(MODERATOR_FIELDS.profile).toContain('customTitle')
    expect(MODERATOR_FIELDS.profile).toContain('modState')
  })
})
