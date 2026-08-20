/**
 * Server-side Google OAuth2 client for Beatrice's Google Workspace tools.
 *
 * The client app signs in with Google via Firebase and stores the resulting
 * access token in RTDB `google_tokens/{uid}`. Access tokens expire after ~1h
 * and Firebase does NOT expose a Google refresh token to the browser — so to
 * keep the token renewable server-side, this module runs its own OAuth2 web
 * flow (authorization code + refresh token) against the app's Google Cloud
 * web client:
 *
 *   1. `POST /api/google/connect` (authenticated) mints a single-use nonce
 *      bound to the caller's uid and returns Google's consent URL.
 *   2. The user consents in a popup; Google redirects to
 *      `GET /api/google/callback?code=...&state=<nonce>`, which exchanges the
 *      code for access + refresh tokens and stores them under the uid that
 *      owns the nonce.
 *   3. Whenever a workspace tool needs a token and the stored access token is
 *      expired, `refreshGoogleAccessToken()` renews it with the refresh token
 *      and the fresh token is written back to RTDB.
 *
 * Credentials come from `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`
 * env vars, falling back to `google-web-credentials.json` (web.client_id /
 * web.client_secret). If no client is configured, the OAuth flow is disabled
 * and the workspace tools fall back to the client-provided access token only.
 */

import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

// Scopes mirror `GOOGLE_SCOPES` in src/lib/firebase.ts — the single source for
// the client's Firebase provider + GIS renewal. Keep them in sync.
export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.body.readonly',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/documents',
];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUri: string;
  tokenUri: string;
}

const DEFAULT_AUTH_URI = 'https://accounts.google.com/o/oauth2/auth';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

let cachedConfig: GoogleOAuthConfig | null | undefined;

// Load OAuth client credentials. Returns null when not configured — the
// server-side flow is then disabled (workspace tools keep using whatever
// access token the client stored).
export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 5555}`;
  let clientId = process.env.GOOGLE_CLIENT_ID || '';
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    try {
      const credPath = path.resolve(process.cwd(), 'google-web-credentials.json');
      if (fs.existsSync(credPath)) {
        const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
        clientId = clientId || cred?.web?.client_id || '';
        clientSecret = clientSecret || cred?.web?.client_secret || '';
      }
    } catch (err) {
      console.error('[GoogleOAuth] failed to load google-web-credentials.json:', err);
    }
  }
  if (!clientId || !clientSecret) {
    cachedConfig = null;
    return null;
  }
  cachedConfig = {
    clientId,
    clientSecret,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `${appUrl}/api/google/callback`,
    authUri: process.env.GOOGLE_AUTH_URI || DEFAULT_AUTH_URI,
    tokenUri: process.env.GOOGLE_TOKEN_URI || DEFAULT_TOKEN_URI,
  };
  return cachedConfig;
}

// Build the Google consent URL for a server-side OAuth attempt. `state` is the
// single-use nonce minted by createConnectNonce() for the authenticated caller.
export function buildGoogleAuthUrl(state: string, scopes: string[] = GOOGLE_OAUTH_SCOPES): string {
  const cfg = getGoogleOAuthConfig();
  if (!cfg) throw new Error('Google OAuth client is not configured');
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline', // issue a refresh token
    prompt: 'consent', // ensure a refresh token is returned on every connect
    include_granted_scopes: 'true',
    state,
  });
  return `${cfg.authUri}?${params.toString()}`;
}

// Exchange an authorization code for tokens (access + refresh).
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number; scope?: string }> {
  const cfg = getGoogleOAuthConfig();
  if (!cfg) throw new Error('Google OAuth client is not configured');
  const res = await fetch(cfg.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google token exchange failed (${res.status}): ${data?.error_description || data?.error || 'unknown error'}`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || undefined,
    expiresIn: Number(data.expires_in) || 3600,
    scope: data.scope,
  };
}

// Renew an expired access token with the stored refresh token.
export async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const cfg = getGoogleOAuthConfig();
  if (!cfg) throw new Error('Google OAuth client is not configured');
  const res = await fetch(cfg.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google token refresh failed (${res.status}): ${data?.error_description || data?.error || 'unknown error'}`);
  }
  return {
    accessToken: data.access_token,
    expiresIn: Number(data.expires_in) || 3600,
  };
}

// ---------------------------------------------------------------------------
// RTDB persistence (google_tokens/{uid}) — shared with googleWorkspace.ts.
// ---------------------------------------------------------------------------

const RTDB_URL = process.env.FIREBASE_RTDB_URL || 'https://beatrice-os-default-rtdb.europe-west1.firebasedatabase.app';

let fbDb: any = null;
let rtdbFailed = false;

export async function initRTDB(): Promise<any> {
  if (fbDb) return fbDb;
  if (rtdbFailed) return null;
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT || '/opt/beatrice-services/beatrice-os-service-account.json';
  if (!fs.existsSync(saPath)) {
    rtdbFailed = true;
    return null;
  }
  try {
    const appMod: any = await import('firebase-admin/app');
    const dbMod: any = await import('firebase-admin/database');
    if (!appMod.getApps?.().length) {
      appMod.initializeApp({ credential: appMod.cert(saPath), databaseURL: RTDB_URL });
    }
    fbDb = dbMod.getDatabase();
    return fbDb;
  } catch (err: any) {
    rtdbFailed = true;
    console.error('[GoogleOAuth] RTDB init failed:', err?.message || err);
    return null;
  }
}

export function sanitizeUid(uid: string): string {
  return uid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

export interface GoogleAuthRecord {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
}

export async function readGoogleAuthRecord(uid: string): Promise<GoogleAuthRecord | null> {
  const safeUid = sanitizeUid(uid);
  if (!safeUid) return null;
  const db = await initRTDB();
  if (!db) return null;
  try {
    const snap = await db.ref(`google_tokens/${safeUid}`).get();
    const val = snap?.val?.();
    if (!val || typeof val !== 'object') return null;
    return {
      accessToken: typeof val.accessToken === 'string' ? val.accessToken : undefined,
      refreshToken: typeof val.refreshToken === 'string' ? val.refreshToken : undefined,
      expiresAt: typeof val.expiresAt === 'number' ? val.expiresAt : undefined,
      email: typeof val.email === 'string' ? val.email : undefined,
    };
  } catch (err: any) {
    console.error('[GoogleOAuth] record read failed:', err?.message || err);
    return null;
  }
}

// Merge (update) fields into the user's google_tokens/{uid} record. Uses
// update() so callers never clobber fields they don't set (e.g. refreshToken
// survives a client-side access-token refresh write).
export async function saveGoogleAuthRecord(uid: string, record: GoogleAuthRecord): Promise<boolean> {
  const safeUid = sanitizeUid(uid);
  if (!safeUid) return false;
  const db = await initRTDB();
  if (!db) return false;
  const patch: Record<string, any> = {};
  if (record.accessToken !== undefined) patch.accessToken = record.accessToken;
  if (record.refreshToken !== undefined) patch.refreshToken = record.refreshToken;
  if (record.expiresAt !== undefined) patch.expiresAt = record.expiresAt;
  if (record.email !== undefined) patch.email = record.email;
  patch.updatedAt = Date.now();
  try {
    await db.ref(`google_tokens/${safeUid}`).update(patch);
    return true;
  } catch (err: any) {
    console.error('[GoogleOAuth] record save failed:', err?.message || err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Connect-attempt nonces: bind an authenticated caller to the callback so a
// third party can't redirect Google's callback into storing tokens under
// another user's uid. Single-use, 10-minute expiry, in-memory (one server).
// ---------------------------------------------------------------------------

const NONCE_TTL_MS = 10 * 60 * 1000;
const connectNonces = new Map<string, { uid: string; createdAt: number }>();

export function createConnectNonce(uid: string): string {
  const nonce = randomBytes(24).toString('hex');
  connectNonces.set(nonce, { uid, createdAt: Date.now() });
  return nonce;
}

export function consumeConnectNonce(nonce: string): string | null {
  const entry = connectNonces.get(nonce);
  if (!entry) return null;
  connectNonces.delete(nonce);
  if (Date.now() - entry.createdAt > NONCE_TTL_MS) return null;
  return entry.uid;
}
