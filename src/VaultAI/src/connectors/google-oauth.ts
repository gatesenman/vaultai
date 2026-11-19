import type { EncryptedBlob, GoogleOAuthSettings, GoogleTokens, ToolResult } from '../types/index.js';
import type { VaultStore } from '../store/db.js';
import { googleConnectScopes } from './permissions.js';
import { randomBytes, createHash } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';

/** In-memory pending OAuth states (code verifier + createdAt) */
const pending = new Map<string, { verifier: string; createdAt: number }>();

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function getGoogleSettings(store: VaultStore): GoogleOAuthSettings | undefined {
  return store.getSettings().google;
}

export function hasGoogleClient(store: VaultStore): boolean {
  const g = getGoogleSettings(store);
  return Boolean(g?.clientId && g?.clientSecretEnc);
}

export function isGoogleConnected(store: VaultStore): boolean {
  const g = getGoogleSettings(store);
  return Boolean(g?.tokensEnc);
}

export function saveGoogleClient(store: VaultStore, clientId: string, clientSecret: string): void {
  const enc = store.encryptForVault(clientSecret);
  const prev = store.getSettings().google || { clientId: '' };
  store.updateSettings({
    google: {
      ...prev,
      clientId,
      clientSecretEnc: enc,
    },
  });
}

export function clearGoogleTokens(store: VaultStore): void {
  const prev = store.getSettings().google;
  if (!prev) return;
  const { tokensEnc: _, email: __, connectedAt: ___, ...rest } = prev;
  store.updateSettings({ google: { ...rest, clientId: rest.clientId || '' } });
  store.markGoogleAppsConnected(false);
}

export function buildAuthUrl(store: VaultStore, redirectUri: string): { url: string; state: string } {
  const g = getGoogleSettings(store);
  if (!g?.clientId || !g.clientSecretEnc) {
    throw new Error('Google OAuth Client ID/Secret not configured');
  }
  const { verifier, challenge } = pkce();
  const state = randomBytes(16).toString('hex');
  pending.set(state, { verifier, createdAt: Date.now() });
  // purge old
  for (const [k, v] of pending) {
    if (Date.now() - v.createdAt > 600_000) pending.delete(k);
  }
  const q = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: googleConnectScopes(),
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return { url: `${AUTH_URL}?${q}`, state };
}

export async function exchangeCode(
  store: VaultStore,
  code: string,
  state: string,
  redirectUri: string
): Promise<{ email: string }> {
  const pend = pending.get(state);
  pending.delete(state);
  if (!pend) throw new Error('Invalid or expired OAuth state');
  const g = getGoogleSettings(store);
  if (!g?.clientId || !g.clientSecretEnc) throw new Error('Google client not configured');
  const clientSecret = store.decryptBlob(g.clientSecretEnc);

  const body = new URLSearchParams({
    code,
    client_id: g.clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: pend.verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${json.error || res.status}`);
  }
  const tokens: GoogleTokens = {
    access_token: String(json.access_token),
    refresh_token: json.refresh_token ? String(json.refresh_token) : undefined,
    expiry_date: json.expires_in
      ? Date.now() + Number(json.expires_in) * 1000
      : undefined,
    scope: json.scope ? String(json.scope) : undefined,
  };

  // Keep previous refresh_token if Google omits it on re-consent
  if (!tokens.refresh_token && g.tokensEnc) {
    try {
      const old = JSON.parse(store.decryptBlob(g.tokensEnc)) as GoogleTokens;
      if (old.refresh_token) tokens.refresh_token = old.refresh_token;
    } catch {
      /* ignore */
    }
  }

  // Fetch email
  let email = '';
  try {
    const u = await fetch(USERINFO, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (u.ok) {
      const ui = (await u.json()) as { email?: string };
      email = ui.email || '';
      tokens.email = email;
    }
  } catch {
    /* optional */
  }

  store.updateSettings({
    google: {
      ...g,
      tokensEnc: store.encryptForVault(JSON.stringify(tokens)),
      email: email || g.email,
      connectedAt: new Date().toISOString(),
    },
  });
  store.markGoogleAppsConnected(true, email || undefined);
  return { email: email || 'connected' };
}

export async function getAccessToken(store: VaultStore): Promise<string> {
  const g = getGoogleSettings(store);
  if (!g?.tokensEnc || !g.clientId || !g.clientSecretEnc) {
    throw Object.assign(new Error('Google not connected'), {
      code: 'GOOGLE_NOT_CONNECTED',
    });
  }
  let tokens = JSON.parse(store.decryptBlob(g.tokensEnc)) as GoogleTokens;
  const needsRefresh =
    !tokens.access_token ||
    (tokens.expiry_date && tokens.expiry_date < Date.now() + 60_000);

  if (needsRefresh) {
    if (!tokens.refresh_token) {
      throw Object.assign(new Error('Google refresh token missing — reconnect'), {
        code: 'GOOGLE_RECONNECT',
      });
    }
    const clientSecret = store.decryptBlob(g.clientSecretEnc);
    const body = new URLSearchParams({
      client_id: g.clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw Object.assign(new Error(`Refresh failed: ${json.error || res.status}`), {
        code: 'GOOGLE_REFRESH_FAILED',
      });
    }
    tokens = {
      ...tokens,
      access_token: String(json.access_token),
      expiry_date: json.expires_in
        ? Date.now() + Number(json.expires_in) * 1000
        : undefined,
      scope: json.scope ? String(json.scope) : tokens.scope,
    };
    store.updateSettings({
      google: {
        ...g,
        tokensEnc: store.encryptForVault(JSON.stringify(tokens)),
      },
    });
  }
  return tokens.access_token;
}

export function googleNotConfiguredResult(): ToolResult {
  return {
    ok: false,
    code: 'GOOGLE_NOT_CONFIGURED',
    message: 'Google OAuth Client ID/Secret not set',
    fix: 'VaultAI → Connections → Google: paste Client ID & Secret from Google Cloud Console (Desktop OAuth client). Enable Gmail API + Google Calendar API.',
  };
}

export function googleNotConnectedResult(): ToolResult {
  return {
    ok: false,
    code: 'GOOGLE_NOT_CONNECTED',
    message: 'Google account not connected',
    fix: 'Click Connect Google in VaultAI → Connections and complete the browser consent.',
  };
}

// silence unused EncryptedBlob import path for typings consumers
void (null as unknown as EncryptedBlob);
