import { initials } from '@/lib/utils'

const HUES = [200, 170, 250, 130, 20, 330]

/**
 * Identity-stable avatar. `id` (an identity id, when known) drives the color
 * hash so the same account looks identical everywhere; `name` drives the
 * initials. Falls back to `name` for the hash when no id is given.
 */
export function Avatar({ name, id, size = 'md' }: { name: string; id?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'w-16 h-16 text-xl' : size === 'sm' ? 'w-6 h-6 text-xs' : 'w-9 h-9 text-sm'
  const seed = id || name
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  const hue = HUES[hash % HUES.length]
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0 ${cls}`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 32%), hsl(${(hue + 40) % 360} 55% 28%))` }}
      title={name}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}
