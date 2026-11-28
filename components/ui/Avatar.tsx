/** Deterministic initials avatar; an https image when the profile sets one. Archive authors get
 * a square, sepia mark so imported history never reads as a live identity. */
function hue(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return h % 360
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L} ._-]/gu, '').split(/[\s._-]+/).filter(Boolean)
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? '').slice(0, 2)
  return (s || '?').toUpperCase()
}

export function Avatar({ seed, name, src, size = 40, archive = false }: {
  seed: string
  name: string
  src?: string
  size?: number
  archive?: boolean
}) {
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }
  if (src && /^https:\/\//.test(src) && !archive) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer"
        className="shrink-0 rounded-full object-cover bg-sunk" style={style} />
    )
  }
  if (archive) {
    return (
      <span aria-hidden className="shrink-0 inline-flex items-center justify-center rounded-md font-semibold bg-archive-wash text-archive ring-1 ring-archive/40" style={style}>
        {initials(name)}
      </span>
    )
  }
  const h = hue(seed)
  return (
    <span aria-hidden className="shrink-0 inline-flex items-center justify-center rounded-full font-semibold text-white"
      style={{ ...style, background: `hsl(${h} 50% 36%)` }}>
      {initials(name)}
    </span>
  )
}
