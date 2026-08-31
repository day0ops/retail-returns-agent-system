// Stage 9 (agentgateway interactive elicitation): wraps the enterprise
// agentgateway controller's own STS /elicitations lifecycle. Distinct from
// Stage 2's token exchange -- this is a real third-party OAuth consent grant
// (the carrier-portal realm standing in for a carrier's own OAuth server),
// not the customer's own identity being exchanged. See agentic-field-kit's
// docs/superpowers/plans/2026-08-31-retail-returns-phase9-agentgateway-elicitation.md
// for the full mechanism this wraps (entElicitation.interactive.oauth +
// entTokenExchange.solo), live-verified end to end against a real deployed
// cluster before any of this code was written.

export interface OAuthProviderInfo {
  clientId: string
  authorizeUrl: string
  redirectUri: string
  scopes: string[]
}

export interface PendingElicitation {
  id: number
  resource: string
  status: 'pending' | 'completed' | 'failed'
  oauth: OAuthProviderInfo
}

interface RawElicitationEntry {
  Elicitation: { ID: number; resource: string; status: string }
  OAuthConfig: {
    client_id: string
    authorize_url: string
    redirect_uri: string
    scopes: string[]
  }
}

// Lists every elicitation visible to this customer. The STS's own API has no
// per-resource filter -- carrier-linking is the only elicitation this demo
// ever produces, so the caller just picks the pending one.
export async function listElicitations(
  stsUrl: string,
  bearerToken: string,
): Promise<PendingElicitation[]> {
  const res = await fetch(`${stsUrl}/elicitations`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  })
  if (!res.ok) {
    throw new Error(`elicitations list failed: HTTP ${res.status} ${await res.text()}`)
  }
  const entries = (await res.json()) as RawElicitationEntry[]
  return entries.map((e) => ({
    id: e.Elicitation.ID,
    resource: e.Elicitation.resource,
    status: e.Elicitation.status as PendingElicitation['status'],
    oauth: {
      clientId: e.OAuthConfig.client_id,
      authorizeUrl: e.OAuthConfig.authorize_url,
      redirectUri: e.OAuthConfig.redirect_uri,
      scopes: e.OAuthConfig.scopes,
    },
  }))
}

// Completes a pending elicitation with a real OAuth authorization code. The
// STS itself performs the code -> token exchange server-side (the client
// secret never leaves the controller) and banks the resulting access token,
// which a retried MCP call through the same gate will then be served.
export async function completeElicitation(
  stsUrl: string,
  bearerToken: string,
  elicitation: Pick<PendingElicitation, 'id' | 'resource'>,
  code: string,
): Promise<void> {
  const res = await fetch(`${stsUrl}/elicitations`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${bearerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: elicitation.id,
      resource: elicitation.resource,
      status: 'completed',
      oauth_config: { code },
    }),
  })
  if (!res.ok) {
    throw new Error(`elicitation completion failed: HTTP ${res.status} ${await res.text()}`)
  }
}
