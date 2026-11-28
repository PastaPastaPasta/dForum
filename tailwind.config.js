/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

module.exports = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        paper: token('paper'),
        sheet: token('sheet'),
        sunk: token('sunk'),
        rule: token('rule'),
        ink: token('ink'),
        'ink-2': token('ink-2'),
        dash: token('dash'),
        'dash-ink': token('dash-ink'),
        live: token('live'),
        archive: token('archive'),
        'archive-wash': token('archive-wash'),
        danger: token('danger'),
      },
      maxWidth: { page: '76rem', read: '44rem' },
    },
  },
  plugins: [],
}
