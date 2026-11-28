import { describe, expect, it } from 'vitest'
import { writeFailureMessage } from '@/lib/services/write-errors'

const consensus = (detail: string) => new Error(`state transition outcome is unconfirmed: a node accepted it or may have received it; last error: state transition broadcast error: ${detail}`)

describe('write failure copy', () => {
  it('explains consensus refusals in plain words', () => {
    expect(writeFailureMessage(consensus(`the document's { "notEqual": { "const": true } } does not agree with the referenced document's locked (where on threadId)`)).message)
      .toBe("This thread is locked. New replies can't be posted.")
    expect(writeFailureMessage(consensus(`the document's { "notEqual": { "const": true } } does not agree with the referenced document's archived (where on forumId)`)).message)
      .toBe("This forum is archived. New threads and replies can't be posted.")
    expect(writeFailureMessage(consensus('identity is banned on contract')).message).toMatch(/banned/)
  })
})
