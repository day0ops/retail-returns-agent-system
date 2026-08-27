import { describe, expect, it } from 'vitest'
import { extractReplyText, extractToolCallSteps, extractPendingQuestion } from './a2a.js'

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

describe('extractPendingQuestion', () => {
  // Shape confirmed live against the real 3-hop chain (order_lookup ->
  // fraud_check -> refund_approval), not just kagent's hitl_test.go
  // fixtures -- live traffic uses the 'adk_' metadata prefix (checked first
  // by kagent's own ReadMetadataValue), and the DataPart's originalFunctionCall
  // only ever names the immediate next hop, never 'ask_user' itself no matter
  // how deep the real pause is. See extractPendingQuestion's own comment.
  function inputRequiredTask(overrides: Record<string, unknown> = {}) {
    return {
      kind: 'task',
      id: 'task_1',
      contextId: 'ctx_1',
      status: {
        state: 'input-required',
        message: {
          role: 'agent',
          parts: [
            {
              kind: 'data',
              data: {
                name: 'adk_request_confirmation',
                id: 'confirm_1',
                args: {
                  originalFunctionCall: { name: 'fraud_check', id: 'call_1', args: {} },
                  toolConfirmation: {
                    confirmed: false,
                    hint: "Remote agent 'order_lookup' requires approval for tool(s): fraud_check",
                    payload: {
                      task_id: 'task_ol_1',
                      context_id: 'ctx_ol_1',
                      subagent_name: 'order_lookup',
                    },
                  },
                },
              },
              metadata: { adk_type: 'function_call', adk_is_long_running: true },
            },
          ],
        },
      },
      ...overrides,
    }
  }

  it('extracts the pending question from an input-required task', () => {
    expect(extractPendingQuestion(inputRequiredTask())).toEqual({
      taskId: 'task_1',
      contextId: 'ctx_1',
      confirmationId: 'confirm_1',
      payload: { task_id: 'task_ol_1', context_id: 'ctx_ol_1', subagent_name: 'order_lookup' },
      questions: [
        {
          question: 'How would you like your refund issued?',
          choices: ['Cash refund', 'Store credit'],
        },
      ],
    })
  })

  it('returns null for a completed task', () => {
    const task = inputRequiredTask()
    task.status.state = 'completed'
    expect(extractPendingQuestion(task)).toBeNull()
  })

  it('also recognizes the kagent_ metadata prefix (fallback convention)', () => {
    const task = {
      kind: 'task',
      id: 'task_1',
      contextId: 'ctx_1',
      status: {
        state: 'input-required',
        message: {
          parts: [
            {
              kind: 'data',
              data: { name: 'adk_request_confirmation', id: 'confirm_1' },
              metadata: { kagent_type: 'function_call', kagent_is_long_running: true },
            },
          ],
        },
      },
    }
    expect(extractPendingQuestion(task)).not.toBeNull()
  })

  it('returns null for a non-task result', () => {
    expect(extractPendingQuestion({ kind: 'message', parts: [] })).toBeNull()
  })

  it('returns null when there is no message on the status', () => {
    expect(extractPendingQuestion({ kind: 'task', status: { state: 'input-required' } })).toBeNull()
  })
})
