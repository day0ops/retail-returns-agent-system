import { describe, expect, it } from 'vitest'
import { extractReplyText, extractToolCallSteps } from './a2a.js'

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

  it('falls back to the last artifact text when status.message and history have none', () => {
    // Matches a real multi-hop A2A chain response (Stage 3): a completed task
    // with no status.message and no agent-role history entry, only a text
    // part mixed into the last artifact alongside function_call/response data.
    const result = {
      kind: 'task',
      status: { state: 'completed' },
      history: [{ role: 'user', parts: [{ kind: 'text', text: 'question' }] }],
      artifacts: [
        {
          parts: [
            { kind: 'data', data: { name: 'order_lookup' } },
            { kind: 'text', text: 'The return has been approved.' },
          ],
        },
      ],
    }
    expect(extractReplyText(result)).toBe('The return has been approved.')
  })
})

describe('extractToolCallSteps', () => {
  it('pairs a function_call with its function_response by id', () => {
    const result = {
      kind: 'task',
      artifacts: [
        {
          parts: [
            {
              kind: 'data',
              data: { id: 'call_1', name: 'order_lookup', args: { order_id: 'ORD-1001' } },
              metadata: { adk_type: 'function_call' },
            },
            {
              kind: 'data',
              data: {
                id: 'call_1',
                name: 'order_lookup',
                response: { output: { result: 'shipped' } },
              },
              metadata: { adk_type: 'function_response' },
            },
          ],
        },
      ],
    }
    expect(extractToolCallSteps(result)).toEqual([
      { name: 'order_lookup', args: { order_id: 'ORD-1001' }, result: { result: 'shipped' } },
    ])
  })

  it('preserves call order across multiple artifacts', () => {
    const result = {
      kind: 'task',
      artifacts: [
        {
          parts: [
            {
              kind: 'data',
              data: { id: 'a', name: 'first' },
              metadata: { adk_type: 'function_call' },
            },
            {
              kind: 'data',
              data: { id: 'a', name: 'first', response: { output: 'ok-1' } },
              metadata: { adk_type: 'function_response' },
            },
          ],
        },
        {
          parts: [
            {
              kind: 'data',
              data: { id: 'b', name: 'second' },
              metadata: { adk_type: 'function_call' },
            },
            {
              kind: 'data',
              data: { id: 'b', name: 'second', response: { output: 'ok-2' } },
              metadata: { adk_type: 'function_response' },
            },
          ],
        },
      ],
    }
    expect(extractToolCallSteps(result).map((s) => s.name)).toEqual(['first', 'second'])
    expect(extractToolCallSteps(result).map((s) => s.result)).toEqual(['ok-1', 'ok-2'])
  })

  it('surfaces an error string when the response carries one', () => {
    const result = {
      kind: 'task',
      artifacts: [
        {
          parts: [
            {
              kind: 'data',
              data: { id: 'c', name: 'fraud_check', response: { error: 'card request failed' } },
              metadata: { adk_type: 'function_response' },
            },
          ],
        },
      ],
    }
    expect(extractToolCallSteps(result)).toEqual([
      { name: 'fraud_check', error: 'card request failed' },
    ])
  })

  it('returns an empty array for a non-task result', () => {
    expect(extractToolCallSteps({ kind: 'message', parts: [] })).toEqual([])
  })
})
