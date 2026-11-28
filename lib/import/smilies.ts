/** Codes from the forum's older software that survive as plain text in old posts. */
const LEGACY_CODES: Record<string, string> = {
  grin: '😁', tongue: '😛', smile: '🙂', wink: '😉', cry: '😢', mad: '😠', cool: '😎', eek: '😳', rolleyes: '🙄', confused: '😕', oops: '😳',
}
const LEGACY_RE = new RegExp(`(^|[\\s(])\\\\?:(${Object.keys(LEGACY_CODES).join('|')}):(?=$|[\\s.,!?)])`, 'gm')

/** Replaces legacy smiley codes in plain text. */
export function legacySmilies(text: string): string {
  return text.replace(LEGACY_RE, (_, pre: string, code: string) => `${pre}${LEGACY_CODES[code]}`)
}

/** Applies `fn` to Markdown outside fenced and inline code. */
export function withoutCode(md: string, fn: (text: string) => string): string {
  return md.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => (i % 2 ? part : fn(part))).join('')
}
