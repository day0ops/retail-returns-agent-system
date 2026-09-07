// Resource Owner Password Credentials (ROPC) login against the
// retail-returns-customers Keycloak realm, for a fixed demo customer persona.
// This is a guided-tour demo, not a real login screen -- there's no
// credential-entry form, just a "log in as the demo customer" action.

export interface KeycloakLoginConfig {
  tokenUrl: string // full https://.../realms/<realm>/protocol/openid-connect/token
  clientId: string
  clientSecret: string
  username: string
  password: string
}

export interface TokenResponse {
  access_token: string
  expires_in: number
  token_type: string
}

export async function loginResourceOwnerPasswordCredentials(
  cfg: KeycloakLoginConfig,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    username: cfg.username,
    password: cfg.password,
  })

  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Keycloak token request failed: ${res.status} ${res.statusText} ${text}`)
  }

  return (await res.json()) as TokenResponse
}
