import { initials } from '@/lib/utils'

const HUES = [200, 170, 250, 130, 20, 330]

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'w-16 h-16 text-xl' : size === 'sm' ? 'w-6 h-6 text-xs' : 'w-9 h-9 text-sm'
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  const hue = HUES[hash % HUES.length]
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0 ${cls}`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 48%), hsl(${(hue + 40) % 360} 70% 38%))` }}
      title={name}
    >
      {initials(name)}
    </span>
  )
}
