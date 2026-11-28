import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { theme } = require('../tailwind.config.js')

// A color token named e.g. `base` makes Tailwind emit BOTH `.text-base` rules —
// the font-size one and the color one — and the color rule wins, making every
// `text-base` typed field unreadable (r4 UI review). Default text sizes are the
// full scale; a color token must never shadow one.
const TAILWIND_FONT_SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl']

describe('tailwind color tokens do not shadow utilities', () => {
  it('no top-level color token is a default text-size class', () => {
    const colorTokens = Object.keys(theme?.extend?.colors ?? {})
    for (const token of colorTokens) {
      expect(TAILWIND_FONT_SIZES).not.toContain(token)
    }
  })

  it('the built site never assigns text-base to a color', () => {
    // Guard the case the collision produces: the token is renamed but the
    // name must not be used again (either token or utility).
    const colorTokens = Object.keys(theme?.extend?.colors ?? {})
    expect(colorTokens).toContain('paper')
    expect(colorTokens).not.toContain('base')
  })
})
