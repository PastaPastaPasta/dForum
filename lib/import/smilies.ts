/** Codes from the forum's older software that survive as plain text in old posts. */
const LEGACY_CODES: Record<string, string> = {
  grin: '😁', tongue: '😛', sad: '🙁', what: '😳', smile: '🙂', wink: '😉', cry: '😢', mad: '😠', cool: '😎', eek: '😳', rolleyes: '🙄', confused: '😕', oops: '😳',
}
// Lookarounds (not consumed), so back-to-back codes like ":grin::grin:" both convert.
const LEGACY_RE = new RegExp(`(?<=^|[\\s(:])\\\\?:(${Object.keys(LEGACY_CODES).join('|')}):(?=$|[\\s.,!?):])`, 'gm')

/** Replaces legacy smiley codes in plain text. */
export function legacySmilies(text: string): string {
  return text.replace(LEGACY_RE, (_, code: string) => LEGACY_CODES[code])
}

/** Applies `fn` to Markdown outside fenced and inline code. */
export function withoutCode(md: string, fn: (text: string) => string): string {
  return md.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => (i % 2 ? part : fn(part))).join('')
}

type MdNode = { type: string; value?: string; children?: MdNode[] }

/** remark plugin: legacy smiley codes in text nodes only (code of every kind keeps its text). */
export function remarkLegacySmilies() {
  const walk = (node: MdNode) => {
    if (node.type === 'text' && node.value) node.value = legacySmilies(node.value)
    else if (node.type !== 'code' && node.type !== 'inlineCode') node.children?.forEach(walk)
  }
  return (tree: MdNode) => walk(tree)
}
