/** Free-text tag input → the contract's tag shape (≤5, ^[a-z0-9-]{1,32}$, unique). */
export function normalizeTagInput(input: string): string[] {
  const out: string[] = []
  for (const raw of input.split(/[,\n]/)) {
    const t = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
    if (t && !out.includes(t)) out.push(t)
    if (out.length === 5) break
  }
  return out
}
