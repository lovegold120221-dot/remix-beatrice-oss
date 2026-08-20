/**
 * Google Workspace tools — REAL Google REST API integration.
 *
 * RULE: Beatrice NEVER fabricates Google data. Every handler:
 *   1. Resolves the user's OAuth access token from RTDB `google_tokens/{uid}`
 *      (written by the client AuthContext on every grant/renewal; read here
 *      with firebase-admin, which bypasses RTDB rules).
 *   2. Verifies the token is present, unexpired (JWT `exp`), and carries the
 *      scope the requested API needs.
 *   3. If disconnected / expired / missing scope → returns a clear message
 *      telling the user to connect (or reconnect) Google. NO mock results.
 *   4. Otherwise calls the real Google REST API and returns ONLY live results,
 *      surfacing the actual error when a call fails (401/403/network…).
 */

import { GoogleGenAI } from '@google/genai';
import {
  readGoogleAuthRecord,
  saveGoogleAuthRecord,
  refreshGoogleAccessToken,
} from './googleOAuth.js';

export interface WorkspaceToolContext {
  ai?: GoogleGenAI;
  broadcast: (msg: unknown) => void;
  /** Verified Firebase uid of the session owner. Absent when guest mode. */
  uid?: string;
}

// ---------------------------------------------------------------------------
// Google OAuth token lookup + verification
// ---------------------------------------------------------------------------

const GOOGLE_NOT_CONNECTED =
  'Your Google account is not connected. Please sign in with Google from the profile menu (or the auth page) so I can access your Gmail, Calendar, Drive, Tasks, Contacts, Docs and Forms.';

const GOOGLE_EXPIRED =
  'Your Google connection has expired or been revoked. Please reconnect from the profile menu (Sign in with Google) and try again.';

// Resolve a usable Google access token for a user. Reads the stored record
// (accessToken + refreshToken, written by the client and/or the server OAuth
// flow in server/googleOAuth.ts) and, when the access token is expired and a
// refresh token exists, silently renews it server-side and writes the fresh
// token back to RTDB — so Beatrice's Google tools keep working without the
// user re-consenting.
async function resolveGoogleAccessToken(uid: string): Promise<string | null> {
  const rec = await readGoogleAuthRecord(uid);
  if (!rec?.accessToken) return null;
  if (!isGoogleTokenExpired(rec.accessToken, rec.expiresAt)) return rec.accessToken;
  if (rec.refreshToken) {
    try {
      const refreshed = await refreshGoogleAccessToken(rec.refreshToken);
      if (refreshed?.accessToken) {
        await saveGoogleAuthRecord(uid, {
          accessToken: refreshed.accessToken,
          expiresAt: Date.now() + refreshed.expiresIn * 1000,
        });
        return refreshed.accessToken;
      }
    } catch (err: any) {
      console.error('[GoogleWorkspace] access token refresh failed:', err?.message || err);
    }
  }
  // Expired and no refresh token (or refresh failed) — return the stored token
  // so requireGoogle() surfaces the "reconnect" message to the user.
  return rec.accessToken;
}

// Whether a Google access token is expired: prefers the stored expiresAt
// (server-written) and falls back to the JWT `exp` claim. Opaque tokens with
// no expiry info are treated as usable (matches the previous behavior).
function isGoogleTokenExpired(accessToken: string, expiresAt?: number): boolean {
  if (expiresAt !== undefined) return Date.now() > expiresAt;
  const payload = decodeJwtPayload(accessToken);
  if (payload && typeof payload.exp === 'number') return payload.exp * 1000 < Date.now();
  return false;
}

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null; // opaque token, not a JWT
    const raw = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function grantedScopes(payload: Record<string, any> | null): string[] {
  if (!payload || typeof payload.scope !== 'string') return [];
  return payload.scope.split(/\s+/).filter(Boolean);
}

// Canonical OAuth scopes each Google API needs. A token is usable for a
// service when it carries ANY of the listed scopes for that service.
const NEEDED_SCOPES: Record<string, string[]> = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.compose',
    'https://mail.google.com/',
  ],
  calendar: ['https://www.googleapis.com/auth/calendar'],
  drive: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.readonly',
  ],
  tasks: ['https://www.googleapis.com/auth/tasks'],
  contacts: ['https://www.googleapis.com/auth/contacts'],
  docs: ['https://www.googleapis.com/auth/documents'],
  sheets: ['https://www.googleapis.com/auth/spreadsheets'],
  forms: [
    'https://www.googleapis.com/auth/forms.body',
    'https://www.googleapis.com/auth/forms.body.readonly',
  ],
  youtube: ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube'],
};

interface GoogleAuth {
  token: string;
  email?: string;
  error?: string;
  /** "not_connected" | "expired" | "missing_scope" | "unavailable" */
  reason?: string;
}

async function requireGoogle(ctx: WorkspaceToolContext, service: string): Promise<GoogleAuth> {
  const uid = ctx.uid;
  if (!uid) {
    return { token: '', error: GOOGLE_NOT_CONNECTED, reason: 'not_connected' };
  }
  const token = await resolveGoogleAccessToken(uid);
  if (!token) {
    return { token: '', error: GOOGLE_NOT_CONNECTED, reason: 'not_connected' };
  }
  const payload = decodeJwtPayload(token);
  const scopes = grantedScopes(payload);
  if (payload?.exp && payload.exp * 1000 < Date.now()) {
    return { token: '', error: GOOGLE_EXPIRED, reason: 'expired' };
  }
  if (scopes.length > 0 && service !== 'account') {
    const needed = NEEDED_SCOPES[service] || [];
    const ok = needed.some((n) => scopes.includes(n));
    if (!ok) {
      return {
        token: '',
        error: `Your Google connection does not include access to ${serviceLabel(service)}. Please disconnect and reconnect Google from the profile menu to grant the required permission (${needed[0] || service}).`,
        reason: 'missing_scope',
      };
    }
  }
  return { token, email: payload?.email };
}

function serviceLabel(service: string): string {
  const labels: Record<string, string> = {
    gmail: 'Gmail',
    calendar: 'Google Calendar',
    drive: 'Google Drive',
    tasks: 'Google Tasks',
    contacts: 'Google Contacts',
    docs: 'Google Docs',
    sheets: 'Google Sheets',
    forms: 'Google Forms',
    youtube: 'YouTube',
  };
  return labels[service] || service;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function gfetch(
  url: string,
  auth: GoogleAuth,
  opts: { method?: string; body?: any; headers?: Record<string, string> } = {}
): Promise<any> {
  const method = opts.method || 'GET';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err: any = new Error(data?.error?.message || data?.message || `Google API HTTP ${res.status}`);
    err.status = res.status;
    err.googleData = data;
    throw err;
  }
  return data;
}

function apiFailure(ctx: WorkspaceToolContext, service: string, err: any) {
  const status = err?.status;
  // Auth-gate errors carry status 0 + empty googleData — pass the clear
  // message through verbatim instead of re-wrapping it as an API failure.
  if (!status && err?.googleData && Object.keys(err.googleData).length === 0 && err?.message) {
    ctx.broadcast({ type: 'workspaceOutput', service, data: { error: err.message } });
    return { error: err.message };
  }
  let error: string;
  if (status === 401) {
    error = GOOGLE_EXPIRED;
  } else if (status === 403) {
    const detail = err?.googleData?.error?.message || err?.message || 'permission denied';
    error = `Google returned a permission error for ${serviceLabel(service)}: ${detail} — the connected account may not have access. Please reconnect Google from the profile menu if you expected access.`;
  } else if (status === 404) {
    error = `Google could not find that ${serviceLabel(service)} item: ${err?.message || 'not found'}`;
  } else if (status === 429) {
    error = `Google ${serviceLabel(service)} rate limit exceeded — try again in a moment.`;
  } else {
    error = `Google ${serviceLabel(service)} request failed: ${err?.message || err || 'unknown error'}`;
  }
  ctx.broadcast({ type: 'workspaceOutput', service, data: { error } });
  return { error };
}

function decodeGmailBody(payload: any): { text: string; html?: string } {
  let text = '';
  let html = '';
  const walk = (p: any) => {
    if (!p) return;
    if (p.body?.data) {
      const decoded = Buffer.from(p.body.data, 'base64url').toString('utf8');
      if (p.mimeType === 'text/html') html = decoded;
      else if (p.mimeType === 'text/plain') text = decoded;
    }
    for (const part of p.parts || []) walk(part);
  };
  walk(payload);
  return { text, html: html || undefined };
}

function encodeRawEmail(from: string, to: string, subject: string, body: string): string {
  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0',
    '',
    body,
  ].join('\r\n');
  return Buffer.from(raw, 'utf8').toString('base64url');
}

// ---------------------------------------------------------------------------
// 1. Google Meet — create a meeting via Calendar API (conference data)
// ---------------------------------------------------------------------------
export async function handleCreateGoogleMeet(
  args: { summary: string; startTime?: string; description?: string; attendees?: string[] },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'calendar');
  if (auth.error) return apiFailure(ctx, 'meet', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  try {
    const start = args.startTime || new Date().toISOString();
    const end = new Date(new Date(start).getTime() + 60 * 60000).toISOString();
    const requestId = 'meet_' + Date.now();
    const body: any = {
      summary: args.summary || 'Beatrice AI Strategy Session',
      description: args.description,
      start: { dateTime: start },
      end: { dateTime: end },
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };
    if (args.attendees?.length) {
      body.attendees = args.attendees.map((email) => ({ email }));
    }
    const created = await gfetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', auth, {
      method: 'POST',
      body,
    });
    const meetUri =
      created.hangoutLink ||
      created.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri ||
      null;
    const result = {
      id: created.id,
      summary: created.summary,
      meetingUri: meetUri,
      conferenceCode: meetUri ? meetUri.split('/').pop() : null,
      status: 'created',
      startTime: created.start?.dateTime || start,
      endTime: created.end?.dateTime || end,
      attendees: (created.attendees || []).map((a: any) => a.email),
      notes: 'Meeting created in your Google Calendar with a Google Meet video conference.',
      timestamp: new Date().toISOString(),
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'meet', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'meet', err);
  }
}

// ---------------------------------------------------------------------------
// 2. Gmail — list / get / send / draft / modify / trash / delete
// ---------------------------------------------------------------------------
export async function handleListGmailMessages(
  args: { query?: string; maxResults?: number },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'gmail');
  if (auth.error) return apiFailure(ctx, 'gmail', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  try {
    const params = new URLSearchParams();
    params.set('q', args.query || 'in:inbox');
    params.set('maxResults', String(Math.min(50, args.maxResults || 25)));
    const data = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, auth);
    const messages = [];
    for (const m of data.messages || []) {
      try {
        const meta = await gfetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          auth
        );
        const headers: Record<string, string> = {};
        for (const h of meta.payload?.headers || []) headers[h.name.toLowerCase()] = h.value;
        messages.push({
          id: meta.id,
          threadId: meta.threadId,
          subject: headers.subject || '(no subject)',
          from: headers.from || '',
          date: headers.date || '',
          snippet: meta.snippet || '',
          labels: meta.labelIds || [],
        });
      } catch {
        // skip a single message that failed to load metadata; keep the rest
      }
    }
    const result = { query: args.query || 'in:inbox', messages, totalCount: data.resultSizeEstimate ?? messages.length };
    ctx.broadcast({ type: 'workspaceOutput', service: 'gmail', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'gmail', err);
  }
}

export async function handleGetGmailMessage(
  args: { id: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'gmail');
  if (auth.error) return apiFailure(ctx, 'gmail', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.id) return { error: 'Missing Gmail message id.' };
  try {
    const data = await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.id}?format=full`, auth);
    const headers: Record<string, string> = {};
    for (const h of data.payload?.headers || []) headers[h.name.toLowerCase()] = h.value;
    const { text, html } = decodeGmailBody(data.payload);
    const result = {
      id: data.id,
      threadId: data.threadId,
      subject: headers.subject || '(no subject)',
      from: headers.from || '',
      to: headers.to || '',
      date: headers.date || '',
      labels: data.labelIds || [],
      snippet: data.snippet || '',
      body: text || html || '',
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'gmail_get', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'gmail', err);
  }
}

export async function handleSendGmailMessage(
  args: { to: string; subject: string; body: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'gmail');
  if (auth.error) return apiFailure(ctx, 'gmail_send', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.to || !args.subject) return { error: 'Recipient (to) and subject are required to send an email.' };
  try {
    const from = auth.email || 'me';
    const raw = encodeRawEmail(from, args.to, args.subject, args.body || '');
    const sent = await gfetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', auth, {
      method: 'POST',
      body: { raw },
    });
    const result = {
      messageId: sent.id,
      threadId: sent.threadId,
      to: args.to,
      subject: args.subject,
      status: 'sent',
      timestamp: new Date().toISOString(),
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'gmail_send', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'gmail_send', err);
  }
}

export async function handleCreateGmailDraft(
  args: { to: string; subject: string; body: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'gmail');
  if (auth.error) return apiFailure(ctx, 'gmail_draft', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.to || !args.subject) return { error: 'Recipient (to) and subject are required to create a draft.' };
  try {
    const raw = encodeRawEmail(auth.email || 'me', args.to, args.subject, args.body || '');
    const created = await gfetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', auth, {
      method: 'POST',
      body: { message: { raw } },
    });
    const result = {
      draftId: created.id,
      messageId: created.message?.id,
      to: args.to,
      subject: args.subject,
      status: 'draft_created',
      message: 'Draft saved to Gmail. Not sent yet.',
      timestamp: new Date().toISOString(),
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'gmail_draft', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'gmail_draft', err);
  }
}

export async function handleModifyGmailMessage(
  args: { id: string; addLabels?: string[]; removeLabels?: string[] },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'gmail');
  if (auth.error) return apiFailure(ctx, 'gmail_modify', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.id) return { error: 'Missing Gmail message id.' };
  try {
    const body: any = {};
    if (args.addLabels?.length) body.addLabelIds = args.addLabels;
    if (args.removeLabels?.length) body.removeLabelIds = args.removeLabels;
    const updated = await gfetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.id}/modify`,
      auth,
      { method: 'POST', body }
    );
    const result = {
      id: updated.id,
      addLabels: args.addLabels || [],
      removeLabels: args.removeLabels || [],
      status: 'modified',
      timestamp: new Date().toISOString(),
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'gmail_modify', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'gmail_modify', err);
  }
}

export async function handleTrashGmailMessage(
  args: { id: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'gmail');
  if (auth.error) return apiFailure(ctx, 'gmail_trash', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.id) return { error: 'Missing Gmail message id.' };
  try {
    await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.id}/trash`, auth, {
      method: 'POST',
    });
    const result = { id: args.id, status: 'trashed', message: 'Message moved to Gmail Trash.', timestamp: new Date().toISOString() };
    ctx.broadcast({ type: 'workspaceOutput', service: 'gmail_trash', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'gmail_trash', err);
  }
}

export async function handleDeleteGmailMessage(
  args: { id: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'gmail');
  if (auth.error) return apiFailure(ctx, 'gmail_delete', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.id) return { error: 'Missing Gmail message id.' };
  try {
    await gfetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.id}`, auth, {
      method: 'DELETE',
    });
    const result = { id: args.id, status: 'deleted', message: 'Message permanently deleted from Gmail.', timestamp: new Date().toISOString() };
    ctx.broadcast({ type: 'workspaceOutput', service: 'gmail_delete', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'gmail_delete', err);
  }
}

// ---------------------------------------------------------------------------
// 3. Google Calendar — list / create / update / delete events
// ---------------------------------------------------------------------------
export async function handleListCalendarEvents(
  args: { timeMin?: string; maxResults?: number },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'calendar');
  if (auth.error) return apiFailure(ctx, 'calendar', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  try {
    const params = new URLSearchParams({
      calendarId: 'primary',
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(Math.min(100, args.maxResults || 25)),
    });
    if (args.timeMin) params.set('timeMin', new Date(args.timeMin).toISOString());
    const data = await gfetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, auth);
    const events = (data.items || []).map((ev: any) => ({
      id: ev.id,
      summary: ev.summary || '(no title)',
      start: ev.start?.dateTime || ev.start?.date,
      end: ev.end?.dateTime || ev.end?.date,
      location: ev.location,
      meetLink: ev.hangoutLink,
      status: ev.status,
    }));
    const result = { events, count: events.length, nextPageToken: data.nextPageToken };
    ctx.broadcast({ type: 'workspaceOutput', service: 'calendar', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'calendar', err);
  }
}

export async function handleCreateCalendarEvent(
  args: { summary: string; startTime: string; durationMinutes?: number; addGoogleMeet?: boolean },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'calendar');
  if (auth.error) return apiFailure(ctx, 'calendar_create', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.summary) return { error: 'An event summary/title is required to create a calendar event.' };
  try {
    const duration = args.durationMinutes || 60;
    const start = new Date(args.startTime || Date.now());
    const end = new Date(start.getTime() + duration * 60000);
    const body: any = {
      summary: args.summary,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };
    if (args.addGoogleMeet !== false) {
      body.conferenceData = {
        createRequest: {
          requestId: 'evt_' + Date.now(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }
    const created = await gfetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', auth, {
      method: 'POST',
      body,
    });
    const result = {
      id: created.id,
      summary: created.summary,
      start: created.start?.dateTime || start.toISOString(),
      end: created.end?.dateTime || end.toISOString(),
      meetLink: created.hangoutLink,
      status: created.status,
      htmlLink: created.htmlLink,
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'calendar_create', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'calendar_create', err);
  }
}

export async function handleUpdateCalendarEvent(
  args: { id: string; summary?: string; startTime?: string; durationMinutes?: number; addGoogleMeet?: boolean },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'calendar');
  if (auth.error) return apiFailure(ctx, 'calendar_update', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.id) return { error: 'Missing calendar event id.' };
  try {
    const body: any = {};
    if (args.summary) body.summary = args.summary;
    if (args.startTime) {
      const start = new Date(args.startTime);
      body.start = { dateTime: start.toISOString() };
      body.end = { dateTime: new Date(start.getTime() + (args.durationMinutes || 60) * 60000).toISOString() };
    }
    if (args.addGoogleMeet !== undefined) {
      body.conferenceData = args.addGoogleMeet
        ? { createRequest: { requestId: 'upd_' + Date.now(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
        : { createRequest: { requestId: 'none_' + Date.now() } };
    }
    const updated = await gfetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(args.id)}`,
      auth,
      { method: 'PATCH', body }
    );
    const result = {
      id: updated.id,
      summary: updated.summary,
      start: updated.start?.dateTime,
      end: updated.end?.dateTime,
      meetLink: updated.hangoutLink,
      status: updated.status,
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'calendar_update', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'calendar_update', err);
  }
}

export async function handleDeleteCalendarEvent(
  args: { id: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'calendar');
  if (auth.error) return apiFailure(ctx, 'calendar_delete', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.id) return { error: 'Missing calendar event id.' };
  try {
    await gfetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(args.id)}`,
      auth,
      { method: 'DELETE' }
    );
    const result = { id: args.id, status: 'deleted', message: 'Calendar event removed.', timestamp: new Date().toISOString() };
    ctx.broadcast({ type: 'workspaceOutput', service: 'calendar_delete', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'calendar_delete', err);
  }
}

// ---------------------------------------------------------------------------
// 4. Google Drive — list / search / get / create / update / delete
// ---------------------------------------------------------------------------
async function driveList(args: { query?: string; maxResults?: number }, ctx: WorkspaceToolContext, service: string) {
  const auth = await requireGoogle(ctx, 'drive');
  if (auth.error) return apiFailure(ctx, service, Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  try {
    const params = new URLSearchParams({
      pageSize: String(Math.min(100, args.maxResults || 25)),
      fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size),nextPageToken',
      q: 'trashed=false',
    });
    if (args.query) {
      const safe = args.query.replace(/'/g, "\\'");
      params.set('q', `trashed=false and (name contains '${safe}' or fullText contains '${safe}')`);
    }
    const data = await gfetch(`https://www.googleapis.com/drive/v3/files?${params}`, auth);
    const files = (data.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      size: f.size,
      webViewLink: f.webViewLink,
    }));
    const result = { files, query: args.query || '', count: files.length };
    ctx.broadcast({ type: 'workspaceOutput', service, data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, service, err);
  }
}

export async function handleListDriveFiles(
  args: { query?: string },
  ctx: WorkspaceToolContext
) {
  return driveList(args, ctx, 'drive');
}

export async function handleSearchDriveFiles(
  args: { query: string; maxResults?: number },
  ctx: WorkspaceToolContext
) {
  return driveList(args, ctx, 'drive_search');
}

export async function handleGetDriveFile(
  args: { id: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'drive');
  if (auth.error) return apiFailure(ctx, 'drive_get', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.id) return { error: 'Missing Drive file id.' };
  try {
    const meta = await gfetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.id)}?fields=id,name,mimeType,modifiedTime,webViewLink,size`,
      auth
    );
    let content = '';
    if (meta.mimeType?.startsWith('application/vnd.google-apps.')) {
      const exportMime = meta.mimeType === 'application/vnd.google-apps.spreadsheet' ? 'text/csv' : 'text/plain';
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.id)}/export?mimeType=${encodeURIComponent(exportMime)}`,
        { headers: { Authorization: `Bearer ${auth.token}` } }
      );
      if (res.ok) content = await res.text();
      else {
        const err: any = new Error(`Google export HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
    } else {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.id)}?alt=media`,
        { headers: { Authorization: `Bearer ${auth.token}` } }
      );
      if (res.ok) content = await res.text();
      else {
        const err: any = new Error(`Google media HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
    }
    const result = {
      id: meta.id,
      name: meta.name,
      mimeType: meta.mimeType,
      size: meta.size,
      modifiedTime: meta.modifiedTime,
      webViewLink: meta.webViewLink,
      content: content.slice(0, 100000),
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'drive_get', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'drive_get', err);
  }
}

export async function handleCreateDriveFile(
  args: { name: string; mimeType?: string; content?: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'drive');
  if (auth.error) return apiFailure(ctx, 'drive_create', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.name) return { error: 'A file name is required to create a Drive file.' };
  try {
    const meta = await gfetch('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink', auth, {
      method: 'POST',
      body: { name: args.name, mimeType: args.mimeType || 'text/plain' },
    });
    if (args.content) {
      const res = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${meta.id}?uploadType=media`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': args.mimeType || 'text/plain' },
          body: args.content,
        }
      );
      if (!res.ok) {
        const err: any = new Error(`Google upload HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
    }
    const result = {
      id: meta.id,
      name: meta.name,
      mimeType: meta.mimeType,
      content: args.content || '',
      webViewLink: meta.webViewLink,
      status: 'created',
      timestamp: new Date().toISOString(),
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'drive_create', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'drive_create', err);
  }
}

export async function handleUpdateDriveFileContent(
  args: { id: string; content: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'drive');
  if (auth.error) return apiFailure(ctx, 'drive_update', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.id || args.content === undefined) return { error: 'Drive file id and content are required to update a file.' };
  try {
    const meta = await gfetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.id)}?fields=id,name,mimeType,webViewLink`,
      auth
    );
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(args.id)}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': meta.mimeType || 'text/plain' },
        body: args.content,
      }
    );
    if (!res.ok) {
      const err: any = new Error(`Google upload HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const result = {
      id: args.id,
      status: 'updated',
      message: 'File content replaced.',
      contentLength: args.content.length,
      timestamp: new Date().toISOString(),
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'drive_update', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'drive_update', err);
  }
}

export async function handleDeleteDriveFile(
  args: { id: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'drive');
  if (auth.error) return apiFailure(ctx, 'drive_delete', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.id) return { error: 'Missing Drive file id.' };
  try {
    await gfetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.id)}`, auth, {
      method: 'DELETE',
    });
    const result = { id: args.id, status: 'deleted', message: 'File moved to Google Drive Trash.', timestamp: new Date().toISOString() };
    ctx.broadcast({ type: 'workspaceOutput', service: 'drive_delete', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'drive_delete', err);
  }
}

// ---------------------------------------------------------------------------
// 5. Google Docs / Sheets / Slides — create via Drive + content APIs
// ---------------------------------------------------------------------------
async function createGoogleNativeFile(
  ctx: WorkspaceToolContext,
  name: string,
  mimeType: string,
  service: string,
  mutate?: (id: string, auth: GoogleAuth) => Promise<any>
): Promise<any> {
  const auth = await requireGoogle(ctx, service);
  if (auth.error) return apiFailure(ctx, service, Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!name) return { error: 'A title is required.' };
  try {
    const meta = await gfetch('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,webViewLink', auth, {
      method: 'POST',
      body: { name, mimeType },
    });
    if (mutate) await mutate(meta.id, auth);
    return { ...meta, status: 'created', timestamp: new Date().toISOString() };
  } catch (err: any) {
    return apiFailure(ctx, service, err);
  }
}

export async function handleCreateGoogleDoc(
  args: { title: string; content: string },
  ctx: WorkspaceToolContext
) {
  return createGoogleNativeFile(ctx, args.title, 'application/vnd.google-apps.document', 'docs', async (id, auth) => {
    if (!args.content) return;
    await gfetch(`https://docs.googleapis.com/v1/documents/${id}:batchUpdate`, auth, {
      method: 'POST',
      body: { requests: [{ insertText: { location: { index: 1 }, text: args.content } }] },
    });
  }).then((base) => ({
    docId: base.id,
    title: base.name,
    webViewLink: base.webViewLink,
    status: base.status,
    timestamp: base.timestamp,
  }));
}

export async function handleCreateGoogleSheet(
  args: { title: string; headers?: string[]; rows?: string[][] },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'sheets');
  if (auth.error) return apiFailure(ctx, 'sheet_create', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.title) return { error: 'A title is required.' };
  try {
    const created = await gfetch('https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId,properties.title,sheets.properties.title', auth, {
      method: 'POST',
      body: { properties: { title: args.title } },
    });
    const sheetId = created.spreadsheetId;
    const values = args.rows || [];
    if (args.headers?.length) values.unshift(args.headers);
    if (values.length) {
      await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:ZZ${values.length}`, auth, {
        method: 'PUT',
        body: { range: `A1:ZZ${values.length}`, majorDimension: 'ROWS', values },
      });
    }
    const result = {
      sheetId,
      title: args.title,
      headers: args.headers || ['Item', 'Quantity', 'Cost', 'Status'],
      rowCount: (args.rows || []).length,
      webViewLink: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
      status: 'created',
      timestamp: new Date().toISOString(),
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'sheet_create', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'sheet_create', err);
  }
}

export async function handleCreateGoogleSlide(
  args: { title: string; slideTitles?: string[] },
  ctx: WorkspaceToolContext
) {
  return createGoogleNativeFile(ctx, args.title, 'application/vnd.google-apps.presentation', 'docs', async (id, auth) => {
    const titles = args.slideTitles || ['Title Slide', 'Overview', 'Workspace Integrations', 'Next Steps'];
    const requests: any[] = [{ createSlide: { objectId: 'slide_0', slideLayoutReference: { predefinedLayout: 'TITLE_ONLY' } } }];
    titles.slice(1).forEach((t, i) => {
      requests.push({ createSlide: { objectId: `slide_${i + 1}`, slideLayoutReference: { predefinedLayout: 'TITLE_ONLY' } } });
    });
    requests.push(
      ...titles.map((t, i) => ({
        insertText: { objectId: `slide_${i}`, insertionIndex: 0, text: t },
      }))
    );
    await gfetch(`https://slides.googleapis.com/v1/presentations/${id}:batchUpdate`, auth, {
      method: 'POST',
      body: { requests },
    });
  }).then((base) => ({
    slideId: base.id,
    title: base.name,
    slides: args.slideTitles || ['Title Slide', 'Overview', 'Workspace Integrations', 'Next Steps'],
    webViewLink: base.webViewLink,
    status: base.status,
    timestamp: base.timestamp,
  }));
}

// ---------------------------------------------------------------------------
// 6. Google Forms — create / list
// ---------------------------------------------------------------------------
export async function handleCreateGoogleForm(
  args: { title: string; description?: string; questions?: { type: string; title: string; required?: boolean; options?: string[] }[] },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'forms');
  if (auth.error) return apiFailure(ctx, 'form_create', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.title) return { error: 'A form title is required.' };
  try {
    const created = await gfetch('https://forms.googleapis.com/v1/forms?fields=formId,info.title,responderUri', auth, {
      method: 'POST',
      body: { info: { title: args.title, description: args.description || '' } },
    });
    const formId = created.formId;
    if (args.questions?.length) {
      const requests = args.questions.map((q) => ({
        createItem: {
          item: {
            title: q.title,
            questionItem: {
              question: {
                required: !!q.required,
                ...(q.options?.length
                  ? { choiceQuestion: { type: 'RADIO', options: q.options.map((o) => ({ value: o })) } }
                  : { textQuestion: {} }),
              },
            },
          },
        },
      }));
      await gfetch(`https://forms.googleapis.com/v1/forms/${formId}:batchUpdate`, auth, {
        method: 'POST',
        body: { requests },
      });
    }
    const result = {
      formId,
      title: args.title,
      description: args.description || '',
      questions: args.questions || [],
      responderUri: created.responderUri,
      webViewLink: `https://docs.google.com/forms/d/${formId}/edit`,
      status: 'created',
      timestamp: new Date().toISOString(),
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'form_create', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'form_create', err);
  }
}

export async function handleListGoogleForms(
  args: { query?: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'drive');
  if (auth.error) return apiFailure(ctx, 'form_list', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  try {
    const params = new URLSearchParams({
      pageSize: '50',
      fields: 'files(id,name,mimeType,modifiedTime,webViewLink),nextPageToken',
      q: `trashed=false and mimeType='application/vnd.google-apps.form'`,
    });
    const data = await gfetch(`https://www.googleapis.com/drive/v3/files?${params}`, auth);
    const forms = [];
    for (const f of data.files || []) {
      const entry: any = { id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, webViewLink: f.webViewLink };
      if (args.query && !f.name.toLowerCase().includes(args.query.toLowerCase())) continue;
      try {
        const detail = await gfetch(`https://forms.googleapis.com/v1/forms/${f.id}?fields=formId,info,responderUri`, auth);
        entry.responderUri = detail.responderUri;
        entry.description = detail.info?.description;
      } catch {
        // metadata-only if the Forms API denies detail lookup
      }
      forms.push(entry);
    }
    const result = { forms, query: args.query || '' };
    ctx.broadcast({ type: 'workspaceOutput', service: 'form_list', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'form_list', err);
  }
}

// ---------------------------------------------------------------------------
// 7. Google Tasks — list / create / update / delete
// ---------------------------------------------------------------------------
async function getDefaultTaskList(auth: GoogleAuth): Promise<string> {
  const data = await gfetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100', auth);
  const lists = data.items || [];
  const def = lists.find((l: any) => l.id === '@default') || lists[0];
  if (!def) {
    const created = await gfetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists', auth, {
      method: 'POST',
      body: { title: 'My Tasks' },
    });
    return created.id;
  }
  return def.id;
}

async function findTaskListForTask(auth: GoogleAuth, taskId: string): Promise<string | null> {
  const lists = (await gfetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100', auth)).items || [];
  for (const list of lists) {
    const tasks = await gfetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?maxResults=100`,
      auth
    );
    if ((tasks.items || []).some((t: any) => t.id === taskId)) return list.id;
  }
  return null;
}

export async function handleListGoogleTasks(
  args: { tasklist?: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'tasks');
  if (auth.error) return apiFailure(ctx, 'tasks_list', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  try {
    const listId = args.tasklist || (await getDefaultTaskList(auth));
    const data = await gfetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks?maxResults=100&showCompleted=true`, auth);
    const tasks = (data.items || []).map((t: any) => ({
      id: t.id,
      title: t.title || '',
      notes: t.notes,
      due: t.due,
      status: t.status,
    }));
    const result = { tasks, count: tasks.length, tasklist: listId };
    ctx.broadcast({ type: 'workspaceOutput', service: 'tasks_list', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'tasks_list', err);
  }
}

export async function handleCreateGoogleTask(
  args: { title: string; notes?: string; due?: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'tasks');
  if (auth.error) return apiFailure(ctx, 'task_create', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.title) return { error: 'A task title is required.' };
  try {
    const listId = await getDefaultTaskList(auth);
    const body: any = { title: args.title };
    if (args.notes) body.notes = args.notes;
    if (args.due) body.due = new Date(args.due).toISOString();
    const created = await gfetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`, auth, {
      method: 'POST',
      body,
    });
    const result = {
      id: created.id,
      title: created.title,
      notes: created.notes,
      due: created.due,
      status: created.status,
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'task_create', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'task_create', err);
  }
}

export async function handleUpdateGoogleTask(
  args: { id: string; title?: string; notes?: string; due?: string; status?: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'tasks');
  if (auth.error) return apiFailure(ctx, 'task_update', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.id) return { error: 'Missing task id.' };
  try {
    const listId = (await findTaskListForTask(auth, args.id)) || (await getDefaultTaskList(auth));
    const body: any = {};
    if (args.title !== undefined) body.title = args.title;
    if (args.notes !== undefined) body.notes = args.notes;
    if (args.due !== undefined) body.due = args.due ? new Date(args.due).toISOString() : null;
    if (args.status !== undefined) body.status = args.status === 'completed' ? 'completed' : 'needsAction';
    const updated = await gfetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(args.id)}`,
      auth,
      { method: 'PATCH', body }
    );
    const result = {
      id: updated.id,
      title: updated.title,
      notes: updated.notes,
      due: updated.due,
      status: updated.status,
      updatedAt: updated.updated,
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'task_update', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'task_update', err);
  }
}

export async function handleDeleteGoogleTask(
  args: { id: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'tasks');
  if (auth.error) return apiFailure(ctx, 'task_delete', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.id) return { error: 'Missing task id.' };
  try {
    const listId = (await findTaskListForTask(auth, args.id)) || (await getDefaultTaskList(auth));
    await gfetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(args.id)}`,
      auth,
      { method: 'DELETE' }
    );
    const result = { id: args.id, status: 'deleted', message: 'Task removed from Google Tasks.', timestamp: new Date().toISOString() };
    ctx.broadcast({ type: 'workspaceOutput', service: 'task_delete', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'task_delete', err);
  }
}

// ---------------------------------------------------------------------------
// 8. Google Contacts (People API) — list / search / create / update / delete
// ---------------------------------------------------------------------------
function contactFromPerson(p: any) {
  const name = p.names?.[0]?.displayName || p.names?.[0]?.givenName || '';
  return {
    id: p.resourceName,
    resourceName: p.resourceName,
    name,
    email: p.emailAddresses?.[0]?.value || '',
    phone: p.phoneNumbers?.[0]?.value || '',
    organization: p.organizations?.[0]?.name || '',
    emails: p.emailAddresses?.map((e: any) => e.value) || [],
    phones: p.phoneNumbers?.map((ph: any) => ph.value) || [],
    organizations: p.organizations?.map((o: any) => o.name) || [],
  };
}

export async function handleListGoogleContacts(
  args: { query?: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'contacts');
  if (auth.error) return apiFailure(ctx, 'contacts_list', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  try {
    let contacts: any[] = [];
    if (args.query) {
      const params = new URLSearchParams({
        query: args.query,
        pageSize: '30',
        readMask: 'names,emailAddresses,phoneNumbers,organizations',
      });
      const data = await gfetch(`https://people.googleapis.com/v1/people:searchContacts?${params}`, auth);
      contacts = (data.results || []).map((r: any) => contactFromPerson(r.person));
    } else {
      const params = new URLSearchParams({
        pageSize: '100',
        personFields: 'names,emailAddresses,phoneNumbers,organizations',
      });
      const data = await gfetch(`https://people.googleapis.com/v1/people/me/connections?${params}`, auth);
      contacts = (data.connections || []).map(contactFromPerson);
    }
    const result = { contacts, count: contacts.length, query: args.query || '' };
    ctx.broadcast({ type: 'workspaceOutput', service: 'contacts_list', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'contacts_list', err);
  }
}

export async function handleCreateGoogleContact(
  args: { name: string; email: string; phone?: string; organization?: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'contacts');
  if (auth.error) return apiFailure(ctx, 'contact_create', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.name) return { error: 'A contact name is required.' };
  try {
    const body: any = { names: [{ displayName: args.name, givenName: args.name.split(' ')[0] }] };
    if (args.email) body.emailAddresses = [{ value: args.email }];
    if (args.phone) body.phoneNumbers = [{ value: args.phone }];
    if (args.organization) body.organizations = [{ name: args.organization }];
    const created = await gfetch('https://people.googleapis.com/v1/people:createContact', auth, {
      method: 'POST',
      body,
    });
    const result = { ...contactFromPerson(created), status: 'created', timestamp: new Date().toISOString() };
    ctx.broadcast({ type: 'workspaceOutput', service: 'contact_create', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'contact_create', err);
  }
}

export async function handleUpdateGoogleContact(
  args: { id: string; name?: string; email?: string; phone?: string; organization?: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'contacts');
  if (auth.error) return apiFailure(ctx, 'contact_update', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.id) return { error: 'Missing contact id (resourceName).' };
  try {
    const resourceName = args.id.startsWith('people/') ? args.id : `people/${args.id}`;
    const body: any = {};
    if (args.name) body.names = [{ displayName: args.name, givenName: args.name.split(' ')[0] }];
    if (args.email !== undefined) body.emailAddresses = args.email ? [{ value: args.email }] : [];
    if (args.phone !== undefined) body.phoneNumbers = args.phone ? [{ value: args.phone }] : [];
    if (args.organization !== undefined) body.organizations = args.organization ? [{ name: args.organization }] : [];
    const fields = ['names', 'emailAddresses', 'phoneNumbers', 'organizations']
      .filter((f) => f === 'names' ? args.name : (f === 'emailAddresses' ? args.email !== undefined : f === 'phoneNumbers' ? args.phone !== undefined : args.organization !== undefined))
      .join(',');
    const updated = await gfetch(
      `https://people.googleapis.com/v1/${encodeURIComponent(resourceName)}:updateContact?updatePersonFields=${encodeURIComponent(fields)}`,
      auth,
      { method: 'PATCH', body }
    );
    const result = { ...contactFromPerson(updated), status: 'updated', timestamp: new Date().toISOString() };
    ctx.broadcast({ type: 'workspaceOutput', service: 'contact_update', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'contact_update', err);
  }
}

export async function handleDeleteGoogleContact(
  args: { id: string },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'contacts');
  if (auth.error) return apiFailure(ctx, 'contact_delete', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.id) return { error: 'Missing contact id (resourceName).' };
  try {
    const resourceName = args.id.startsWith('people/') ? args.id : `people/${args.id}`;
    await gfetch(`https://people.googleapis.com/v1/${encodeURIComponent(resourceName)}:deleteContact`, auth, {
      method: 'DELETE',
    });
    const result = { id: args.id, status: 'deleted', message: 'Contact removed from Google Contacts.', timestamp: new Date().toISOString() };
    ctx.broadcast({ type: 'workspaceOutput', service: 'contact_delete', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'contact_delete', err);
  }
}

// ---------------------------------------------------------------------------
// 9. YouTube — search (requires youtube scope; surfaces the real error if the
//    connected account did not grant YouTube access)
// ---------------------------------------------------------------------------
export async function handleSearchYoutube(
  args: { query: string; maxResults?: number },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'youtube');
  if (auth.error) return apiFailure(ctx, 'youtube_search', Object.assign(new Error(auth.error), { status: 0, googleData: {} }));
  if (!args.query) return { error: 'A search query is required.' };
  try {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      q: args.query,
      maxResults: String(Math.min(25, args.maxResults || 10)),
    });
    const data = await gfetch(`https://www.googleapis.com/youtube/v3/search?${params}`, auth);
    const videos = (data.items || []).map((v: any) => ({
      id: v.id?.videoId || v.id,
      title: v.snippet?.title || '',
      description: v.snippet?.description || '',
      channel: v.snippet?.channelTitle || '',
      publishedAt: v.snippet?.publishedAt || '',
      thumbnail: v.snippet?.thumbnails?.default?.url,
    }));
    const result = { query: args.query, videos, count: videos.length };
    ctx.broadcast({ type: 'workspaceOutput', service: 'youtube_search', data: result });
    return result;
  } catch (err: any) {
    return apiFailure(ctx, 'youtube_search', err);
  }
}

// ---------------------------------------------------------------------------
// 10. Google Account — connection status
// ---------------------------------------------------------------------------
export async function handleConnectGoogleAccount(
  args: { scopes?: string[] },
  ctx: WorkspaceToolContext
) {
  const auth = await requireGoogle(ctx, 'account');
  if (auth.error) {
    const result = {
      status: 'requires_connection',
      connected: false,
      message: 'Sign in with Google from the app header profile button or the auth page to connect Gmail, Calendar, Tasks, Drive, Contacts, Docs, Sheets, Forms and Meet.',
      requiredScopes: args.scopes || ['Gmail', 'Calendar', 'Tasks', 'Drive', 'Contacts', 'Docs', 'Sheets', 'Forms', 'Meet'],
      appUrl: 'https://oss.eburon.ai',
    };
    ctx.broadcast({ type: 'workspaceOutput', service: 'account_connect', data: result });
    return result;
  }
  const payload = decodeJwtPayload(auth.token);
  const scopes = grantedScopes(payload);
  const connectedScopes = Object.entries(NEEDED_SCOPES)
    .filter(([key, needed]) => key !== 'account' && needed.some((n) => scopes.includes(n)))
    .map(([key]) => key);
  const result = {
    status: 'connected',
    connected: true,
    email: auth.email,
    connectedServices: connectedScopes,
    message: `Connected to Google as ${auth.email || 'your account'}.`,
    timestamp: new Date().toISOString(),
  };
  ctx.broadcast({ type: 'workspaceOutput', service: 'account_connect', data: result });
  return result;
}