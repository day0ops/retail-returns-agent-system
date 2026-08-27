import { describe, expect, it } from 'vitest'
import { decodeJwtClaims } from './jwt.js'

function jwtWithPayload(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

describe('decodeJwtClaims', () => {
  it('decodes a well-formed JWT payload', () => {
    const token = jwtWithPayload({ sub: 'demo-customer', aud: 'retail-returns-ui' })
    expect(decodeJwtClaims(token)).toEqual({ sub: 'demo-customer', aud: 'retail-returns-ui' })
  })

  it('throws for a token with the wrong number of segments', () => {
    expect(() => decodeJwtClaims('not.a.jwt.token')).toThrow(/expected 3 dot-separated parts/)
    expect(() => decodeJwtClaims('onlyonepart')).toThrow(/expected 3 dot-separated parts/)
  })

  it('throws for a payload that is not valid JSON', () => {
    const notJson = Buffer.from('not json').toString('base64url')
    expect(() => decodeJwtClaims(`aaa.${notJson}.ccc`)).toThrow()
  })
})
