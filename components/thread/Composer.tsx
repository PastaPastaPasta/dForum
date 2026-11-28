'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Bold, Code, Eye, Italic, Link2, List, Pencil, Quote } from 'lucide-react'
import { Markdown } from '@/components/ui/Markdown'
import { BODY_MAX_BYTES, byteLength } from '@/lib/forum/actions'

export interface ComposerHandle {
  insert(text: string): void
  focus(): void
}

const WRAPS: Array<{ label: string; icon: typeof Bold; before: string; after: string; placeholder: string }> = [
  { label: 'Bold', icon: Bold, before: '**', after: '**', placeholder: 'bold text' },
  { label: 'Italic', icon: Italic, before: '*', after: '*', placeholder: 'italic text' },
  { label: 'Link', icon: Link2, before: '[', after: '](https://)', placeholder: 'link text' },
  { label: 'Quote', icon: Quote, before: '\n> ', after: '\n', placeholder: 'quoted text' },
  { label: 'Code', icon: Code, before: '\n```\n', after: '\n```\n', placeholder: 'code' },
  { label: 'List', icon: List, before: '\n- ', after: '', placeholder: 'item' },
]

export const Composer = forwardRef<ComposerHandle, {
  value: string
  onChange(v: string): void
  onSubmit(): void
  busy: boolean
  submitLabel: string
  placeholder?: string
  label: string
  autoFocus?: boolean
  onCancel?(): void
  error?: string | null
}>(function Composer({ value, onChange, onSubmit, busy, submitLabel, placeholder, label, autoFocus, onCancel, error }, ref) {
  const area = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)
  const bytes = byteLength(value)
  const over = bytes > BODY_MAX_BYTES

  const apply = (before: string, after: string, placeholder: string) => {
    const el = area.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    const sel = value.slice(a, b) || placeholder
    const next = value.slice(0, a) + before + sel + after + value.slice(b)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + before.length, a + before.length + sel.length)
    })
  }
  useImperativeHandle(ref, () => ({
    insert(text: string) {
      onChange(value ? `${value.replace(/\s*$/, '')}\n\n${text}` : text)
      setPreview(false)
      requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(area.current.value.length, area.current.value.length) })
    },
    focus() { area.current?.focus() },
  }), [value, onChange])

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center gap-0.5 border-b border-rule bg-sunk/50 px-2 py-1">
        {WRAPS.map((w) => (
          <button key={w.label} type="button" className="btn-ghost" aria-label={w.label} title={w.label} disabled={preview}
            onClick={() => apply(w.before, w.after, w.placeholder)}>
            <w.icon className="h-4 w-4" />
          </button>
        ))}
        <button type="button" className="btn-ghost ml-auto text-sm" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
          {preview ? <><Pencil className="h-4 w-4" />Write</> : <><Eye className="h-4 w-4" />Preview</>}
        </button>
      </div>
      {preview ? (
        <div className="min-h-[9rem] px-4 py-3">{value.trim() ? <Markdown source={value} /> : <p className="text-ink-2">Nothing to preview.</p>}</div>
      ) : (
        <textarea ref={area} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder={placeholder}
          autoFocus={autoFocus} rows={6}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !busy && !over && value.trim()) onSubmit() }}
          className="block min-h-[9rem] w-full resize-y bg-sheet px-4 py-3 font-serif text-[1.0625rem] leading-relaxed outline-none" />
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-rule px-3 py-2">
        <p className="text-xs text-ink-2">Markdown supported. Posts are public and stored on Dash Platform.</p>
        <span className={`ml-auto text-xs tabnum ${over ? 'font-semibold text-danger' : 'text-ink-2'}`}>{over ? `Too long by ${(bytes - BODY_MAX_BYTES).toLocaleString('en-US')} characters` : bytes > BODY_MAX_BYTES * 0.8 ? `${Math.round((bytes / BODY_MAX_BYTES) * 100)}% of the length limit` : ''}</span>
        {onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>Cancel</button>}
        <button type="button" className="btn btn-primary" onClick={onSubmit} disabled={busy || over || !value.trim()}>
          {busy ? (submitLabel.startsWith('Save') ? 'Saving…' : 'Posting…') : submitLabel}
        </button>
      </div>
      {error && <p role="alert" className="border-t border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  )
})
