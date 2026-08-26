import { describe, expect, it } from 'vitest'
import { extractReplyText } from './a2a.js'

describe('extractReplyText', () => {
  it('extracts text from a direct Message result', () => {
    const result = {
      kind: 'message',
      parts: [{ kind: 'text', text: 'Your order ships tomorrow.' }],
    }
    expect(extractReplyText(result)).toBe('Your order ships tomorrow.')
  })

  it('joins multiple text parts with a newline', () => {
    const result = {
      kind: 'message',
      parts: [
        { kind: 'text', text: 'First line.' },
        { kind: 'text', text: 'Second line.' },
      ],
    }
    expect(extractReplyText(result)).toBe('First line.\nSecond line.')
  })

  it('extracts text from a Task result via status.message', () => {
    const result = {
      kind: 'task',
      status: {
        message: { parts: [{ kind: 'text', text: 'Working on it.' }] },
      },
    }
    expect(extractReplyText(result)).toBe('Working on it.')
  })

  it('falls back to the last agent message in Task history', () => {
    const result = {
      kind: 'task',
      status: {},
      history: [
        { role: 'user', parts: [{ kind: 'text', text: 'question' }] },
        { role: 'agent', parts: [{ kind: 'text', text: 'first answer' }] },
        { role: 'agent', parts: [{ kind: 'text', text: 'final answer' }] },
      ],
    }
    expect(extractReplyText(result)).toBe('final answer')
  })

  it('falls back to raw JSON when no recognizable text is found', () => {
    const result = { kind: 'something-unexpected' }
    expect(extractReplyText(result)).toBe(JSON.stringify(result))
  })

  it('handles null/non-object results without throwing', () => {
    expect(extractReplyText(null)).toBe('null')
    expect(extractReplyText('a plain string')).toBe('"a plain string"')
  })
})
