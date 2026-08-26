// Decodes (without verifying) a JWT's payload claims, for display purposes only.
// The BFF never treats this as an authentication check -- Keycloak and
// agentgateway are the actual authorities on token validity.
export function decodeJwtClaims(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error(`not a JWT: expected 3 dot-separated parts, got ${parts.length}`)
  }
  const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
  return JSON.parse(payload) as Record<string, unknown>
}
