/**
 * Moderator-owned fields per document type (mirrors contracts/build.mjs
 * moderatorAbilities.changeFields). The author may never write these — the
 * contract rejects the write (41124) and the UI must never even send them.
 * Author-side writes strip moderator-owned fields before the write.
 */
export const MODERATOR_FIELDS: Record<string, readonly string[]> = {
  thread: ['sticky', 'locked', 'modState', 'modNote', 'movedToForumId', 'modFlags'],
  post: ['modState', 'modNote', 'modFlags'],
  profile: ['customTitle', 'modState', 'modFlags'],
  report: ['status', 'resolution'],
}

/** Strip moderator-owned fields from author-side writes. */
export function stripModeratorFields(type: string, properties: Record<string, unknown>): Record<string, unknown> {
  const fields = MODERATOR_FIELDS[type]
  if (!fields || fields.length === 0) return properties
  const out = { ...properties }
  for (const field of fields) delete out[field]
  return out
}

/**
 * Build a replace-changes object for an author-side write: the stored
 * moderator-owned values pass through unchanged (a moderator-set field must
 * not be dropped or reset by an author edit), and any moderator-owned field
 * the caller tries to set is refused — it never reaches the chain.
 */
export function buildAuthorUpdate(
  type: string,
  existingProps: Record<string, unknown>,
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const fields = MODERATOR_FIELDS[type] ?? []
  const out = { ...existingProps }
  for (const [k, v] of Object.entries(changes)) {
    if (fields.includes(k)) continue
    out[k] = v
  }
  return out
}
