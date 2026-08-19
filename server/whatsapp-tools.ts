import fs from 'fs';
import path from 'path';
import pino from 'pino';
import QRCode from 'qrcode';
import { webcrypto } from 'node:crypto';

// Node 18 (used by the systemd unit's `/usr/bin/node dist/server.cjs`) does not
// expose `globalThis.crypto` when the main entry is a CJS file, only for
// stdin/eval entrypoints. Baileys v7 destructures `globalThis.crypto.subtle`
// at module load, so polyfill it from node:crypto before any lazy import runs.
if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

// Baileys is ESM-only. We load it lazily so the CommonJS production bundle can start.
let baileys: typeof import('@whiskeysockets/baileys') | null = null;
async function getBaileys() {
  if (!baileys) baileys = await import('@whiskeysockets/baileys');
  return baileys;
}

import type { WASocket, WAMessage, AnyMessageContent } from '@whiskeysockets/baileys';

const BASE_AUTH_DIR =
  process.env.WHATSAPP_AUTH_DIR || path.join(process.cwd(), 'data', 'whatsapp-auth');
const MEDIA_DIR = path.join(process.cwd(), 'data', 'whatsapp-media');
const AUTO_APPROVE = (process.env.WHATSAPP_SEND_AUTO_APPROVE ?? 'true') !== 'false';
const MAX_MESSAGES_PER_CHAT = 300;
const MAX_CONTEXT_MESSAGES = 8;

// ---------------------------------------------------------------------------
// Per-user session namespace
// ---------------------------------------------------------------------------
// Each signed-in Firebase account gets its own WhatsApp pairing, auth state,
// chat store, and Boss Mode settings, keyed by a sanitized uid. The module
// keeps ONE active socket at a time and switches namespaces when the current
// user changes (setWhatsAppUser). When no user is set (server boot / legacy
// paths) everything falls back to the original shared namespace so existing
// behavior is preserved.
let currentUser: { uid: string; email: string | null } | null = null;

// Monotonic session epoch. Bumped on every user switch (setWhatsAppUser) so
// async work started for the previous user (a connecting socket, a debounced
// persist, an in-flight reconnect timer, a Gemini auto-reply) can detect it no
// longer belongs to the active session and bail out. Without this, stale
// callbacks from the old user's socket keep writing into the new user's store,
// state, and RTDB doc.
let sessionEpoch = 0;

function sanitizeUid(uid: string | null | undefined): string {
  return String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

function userKey(): string {
  return currentUser ? sanitizeUid(currentUser.uid) : '';
}

function authDirFor(uidKey: string): string {
  return uidKey ? path.join(BASE_AUTH_DIR, uidKey) : BASE_AUTH_DIR;
}

function metaFileFor(uidKey: string): string {
  return path.join(authDirFor(uidKey), '.meta.json');
}

function localStoreFileFor(uidKey: string): string {
  return uidKey
    ? path.join(process.cwd(), 'data', `whatsapp-store-${uidKey}.json`)
    : path.join(process.cwd(), 'data', 'whatsapp-store.json');
}

// RTDB doc names must avoid ".", "#", "$", "/", "[", "]" — sanitized uid is safe.
function storeDocFor(uidKey: string): string {
  return uidKey ? `whatsapp_${uidKey}` : 'whatsapp_main';
}

// Switch the active session to the given Firebase user. Tears down the previous
// user's socket (persisting first), loads the new user's store from RTDB/local
// file, and reconnects if that user has saved credentials. Safe to call
// repeatedly with the same uid — it just refreshes the email.
export async function setWhatsAppUser(uid: string | null | undefined, email?: string | null): Promise<void> {
  const clean = sanitizeUid(uid);
  // Cancel any debounced persist so it cannot fire mid-switch and write the
  // previous user's store under the next user's key (or vice versa).
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!clean) {
    // No identity supplied — stay on the legacy/shared namespace.
    if (currentUser) {
      // Invalidate the old session's async paths BEFORE tearing it down so its
      // close/creds events are guaranteed stale and cannot touch new state.
      sessionEpoch += 1;
      await stopCurrentSocket('cancel');
      clearPerUserCaches();
      waStore.chats.clear();
      waStore.contacts.clear();
      waStore.messages.clear();
      waStore.calls.length = 0;
      currentUser = null;
      bossMode = false;
      setState('disconnected');
    }
    return;
  }
  if (currentUser && currentUser.uid === clean) {
    // Refresh email only when a non-empty value is provided; keep the stored
    // email otherwise (requests often omit the email header).
    if (email && email !== currentUser.email) currentUser.email = email;
    return;
  }
  // Persist the previous user's store before switching namespaces.
  if (currentUser) {
    // Invalidate the old session's async paths BEFORE tearing it down so its
    // close/creds events are guaranteed stale and cannot touch new state.
    sessionEpoch += 1;
    await stopCurrentSocket('cancel');
    try {
      await persistStore();
    } catch {
      // best effort
    }
    waStore.chats.clear();
    waStore.contacts.clear();
    waStore.messages.clear();
    waStore.calls.length = 0;
  }
  sessionEpoch += 1;
  clearPerUserCaches();
  ensureDirs();
  // Boss Mode and the linked email are per-user — restore from THIS user's
  // meta (readMeta() would target the previous user, so read the file directly).
  let savedMeta: { bossMode?: boolean; email?: string | null } = {};
  try {
    savedMeta = JSON.parse(fs.readFileSync(metaFileFor(clean), 'utf8')) || {};
  } catch {
    // no meta yet
  }
  bossMode = !!savedMeta.bossMode;
  currentUser = { uid: clean, email: email || savedMeta.email || null };
  ensureDirs();
  await loadStoreFromRTDB();
  let hasCreds = fs.existsSync(path.join(authDirFor(clean), 'creds.json'));
  // One-time migration for sessions linked before the per-user refactor: the
  // legacy shared namespace still holds the creds + store. Claim them for this
  // user (move auth dir + RTDB/local store into their namespace) so the linked
  // phone does not silently disappear and has to be re-paired.
  if (!hasCreds) {
    hasCreds = await claimLegacySession(clean);
  }
  if (hasCreds) {
    setState('disconnected', { error: null });
    await connectSocket();
  } else {
    setState('disconnected', {
      error: 'No WhatsApp credentials yet for this account. Link from Settings > Connect WhatsApp.',
    });
  }
}

// Per-user mutable state that must never leak across a user switch.
function clearPerUserCaches() {
  pendingApprovals.clear();
  approvedRecipients.clear();
  autoReplyCooldowns.clear();
  autoReplyInFlight.clear();
  kbCache = null;
}

// Move the pre-refactor shared namespace (creds + auth state + store) into this
// user's namespace so their existing linked WhatsApp session survives. Returns
// true when credentials now exist for the user.
async function claimLegacySession(uidKey: string): Promise<boolean> {
  const sharedCreds = path.join(BASE_AUTH_DIR, 'creds.json');
  if (!fs.existsSync(sharedCreds)) return false;
  try {
    const sharedMeta = JSON.parse(fs.readFileSync(path.join(BASE_AUTH_DIR, '.meta.json'), 'utf8')) || {};
    if (sharedMeta.claimedBy) return false;
    // Move the whole shared auth dir (creds, signal keys, app-state sync...).
    // Only files: existing per-user subdirectories must be left untouched.
    for (const f of fs.readdirSync(BASE_AUTH_DIR)) {
      if (f === '.meta.json') continue;
      const from = path.join(BASE_AUTH_DIR, f);
      if (!fs.statSync(from).isFile()) continue;
      const to = path.join(authDirFor(uidKey), f);
      if (!fs.existsSync(to)) fs.renameSync(from, to);
    }
    // Tombstone the shared namespace so a later user (or a dying shared
    // socket's saveCreds) cannot resurrect the legacy session.
    fs.writeFileSync(
      path.join(BASE_AUTH_DIR, '.meta.json'),
      JSON.stringify({ connectedOnce: false, claimedBy: uidKey })
    );
    // Claim the shared store (RTDB doc + local file) if the user has none yet.
    if (fs.existsSync(localStoreFileFor(''))) {
      fs.renameSync(localStoreFileFor(''), localStoreFileFor(uidKey));
    }
    try {
      const db = await initRTDB();
      if (db) {
        const snap = await db.ref(`${STORE_COLLECTION}/whatsapp_main`).get();
        if (snap.exists()) {
          await db.ref(`${STORE_COLLECTION}/${storeDocFor(uidKey)}`).set(snap.val());
          await db.ref(`${STORE_COLLECTION}/whatsapp_main`).remove();
        }
      }
    } catch {
      // best effort — the local file copy above still carries the store
    }
    await loadStoreFromRTDB();
    writeMeta({ connectedOnce: true, bossMode: !!sharedMeta.bossMode });
    console.log(`[WhatsApp] Claimed legacy shared session for user ${uidKey}`);
    return fs.existsSync(path.join(authDirFor(uidKey), 'creds.json'));
  } catch (err: any) {
    console.error('[WhatsApp] Legacy session claim failed:', err?.message || err);
    return false;
  }
}

// ---------------------------------------------------------------------------

let sock: WASocket | null = null;
// Broadcast receivers are registered per-user so a user only sees their own
// WhatsApp session's events. Key '' = shared/legacy (no uid) receivers.
const broadcastFns: Map<string, Set<(msg: unknown) => void>> = new Map();
function broadcast(msg: unknown) {
  const key = userKey();
  const targets = new Set<(msg: unknown) => void>([...(broadcastFns.get(key) || [])]);
  // No active user -> include the shared receivers too (pre-bootstrap clients).
  if (!key) for (const fn of broadcastFns.get('') || []) targets.add(fn);
  for (const fn of targets) {
    try {
      fn(msg);
    } catch {
      // ignore per-receiver failures
    }
  }
}
let connectionState: 'disconnected' | 'connecting' | 'pairing' | 'connected' | 'failed' | 'logged_out' =
  'disconnected';
let pairingCode: string | null = null;
let pairingPhone: string | null = null;
let qrRaw: string | null = null;
let qrDataUrl: string | null = null;
let lastError: string | null = null;
let profile: { name: string | null; phone: string | null; avatarUrl: string | null } | null = null;
let bossMode = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let pairingTimeout: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let closeIntent: 'none' | 'cancel' | 'logout' = 'none';
let reconnectAttempt = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_MS = 5_000;
const MAX_RECONNECT_MS = 120_000;
const PAIRING_TIMEOUT_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

const STORE_COLLECTION = 'whatsapp_store';

interface ChatRecord {
  jid: string;
  name: string;
  unreadCount: number;
  archived: boolean;
  muteEndsAt: number | null;
  pinned: boolean;
  lastMessageAt: number | null;
}

interface ContactRecord {
  jid: string;
  name: string;
  pushName: string | null;
  notify: string | null;
  number: string;
}

interface CallRecord {
  jid: string;
  id: string;
  fromMe: boolean;
  type: string;
  timestamp: number;
}

const waStore = {
  chats: new Map<string, ChatRecord>(),
  contacts: new Map<string, ContactRecord>(),
  messages: new Map<string, WAMessage[]>(),
  calls: [] as CallRecord[],
};

const approvedRecipients = new Map<string, number>();
const pendingApprovals = new Map<string, { resolve: (approved: boolean) => void }>();

function ensureDirs() {
  fs.mkdirSync(authDirFor(userKey()), { recursive: true });
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

function withTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function readMeta(): { connectedOnce?: boolean; bossMode?: boolean; uid?: string; email?: string | null } {
  try {
    return JSON.parse(fs.readFileSync(metaFileFor(userKey()), 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeMeta(meta: { connectedOnce?: boolean; bossMode?: boolean }) {
  try {
    const existing = readMeta();
    fs.writeFileSync(
      metaFileFor(userKey()),
      JSON.stringify({ ...existing, ...meta, uid: currentUser?.uid || existing.uid || null, email: currentUser?.email ?? existing.email ?? null })
    );
  } catch {
    // ignore
  }
}

function purgeStaleAuth() {
  try {
    for (const f of fs.readdirSync(authDirFor(userKey()))) {
      if (f === '.meta.json') continue;
      fs.rmSync(path.join(authDirFor(userKey()), f), { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Store wiring
// ---------------------------------------------------------------------------

function pushMessage(msg: WAMessage) {
  if (!msg.key || !msg.key.remoteJid) return;
  const jid = msg.key.remoteJid;
  const list = waStore.messages.get(jid) || [];
  if (msg.key.id && !list.some((m) => m.key?.id === msg.key.id)) {
    list.push(msg);
    while (list.length > MAX_MESSAGES_PER_CHAT) list.shift();
    waStore.messages.set(jid, list);
  }
  const chat = waStore.chats.get(jid) || {
    jid,
    name: '',
    unreadCount: 0,
    archived: false,
    muteEndsAt: null,
    pinned: false,
    lastMessageAt: null,
  };
  if (msg.messageTimestamp) {
    chat.lastMessageAt =
      typeof msg.messageTimestamp === 'number'
        ? msg.messageTimestamp * 1000
        : Number(msg.messageTimestamp) * 1000;
  }
  if (!msg.key.fromMe && !msg.key.id?.startsWith('3A')) chat.unreadCount += 1;
  waStore.chats.set(jid, chat);

  const stub = msg.messageStubType;
  if (stub && String(stub).startsWith('CALL_')) {
    waStore.calls.push({
      jid,
      id: msg.key.id || '',
      fromMe: !!msg.key.fromMe,
      type: String(stub),
      timestamp: chat.lastMessageAt || Date.now(),
    });
    if (waStore.calls.length > 200) waStore.calls.shift();
  }
  schedulePersist();
}

function seedFromHistorySync({ chats, contacts, messages }: any) {
  if (chats) {
    for (const c of chats) {
      waStore.chats.set(c.id, {
        jid: c.id,
        name: c.name || '',
        unreadCount: c.unreadCount || 0,
        archived: !!c.archived,
        muteEndsAt: c.mute || null,
        pinned: !!c.pinned,
        lastMessageAt: c.conversationTimestamp ? c.conversationTimestamp * 1000 : null,
      });
    }
  }
  if (contacts) {
    for (const c of contacts) {
      registerContact(c.id, c.name, c.notify, c.pushName);
    }
  }
  if (messages) {
    const sorted = [...messages].sort(
      (a, b) => (Number(a.messageTimestamp) || 0) - (Number(b.messageTimestamp) || 0)
    );
    for (const m of sorted) pushMessage(m);
  }
  schedulePersist();
}

function registerContact(jid: string, name?: string, notify?: string, pushName?: string) {
  if (!jid) return;
  const existing = waStore.contacts.get(jid);
  const number = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
  waStore.contacts.set(jid, {
    jid,
    name: name || existing?.name || '',
    pushName: pushName ?? existing?.pushName ?? null,
    notify: notify ?? existing?.notify ?? null,
    number,
  });
}

// ---------------------------------------------------------------------------
// Persistence (local file + Firebase RTDB)
// ---------------------------------------------------------------------------

let fbDb: any = null;

const RTDB_URL =
  process.env.FIREBASE_RTDB_URL ||
  'https://beatrice-os-default-rtdb.europe-west1.firebasedatabase.app';

async function initRTDB(): Promise<any> {
  if (fbDb) return fbDb;
  const saPath =
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    '/opt/beatrice-services/beatrice-os-service-account.json';
  if (!fs.existsSync(saPath)) return null;
  try {
    const appMod: any = await import('firebase-admin/app');
    const dbMod: any = await import('firebase-admin/database');
    if (!appMod.getApps?.().length) {
      appMod.initializeApp({ credential: appMod.cert(saPath), databaseURL: RTDB_URL });
    }
    fbDb = dbMod.getDatabase();
    return fbDb;
  } catch (err: any) {
    console.error('[WhatsApp] RTDB init failed (will use local file only):', err?.message || err);
    return null;
  }
}

let persistTimer: NodeJS.Timeout | null = null;

function schedulePersist() {
  if (persistTimer) return;
  // Capture the epoch when the debounce is scheduled; if the user switches
  // before it fires, the persist must not write the previous user's store
  // into the new user's RTDB doc / local file.
  const epoch = sessionEpoch;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (epoch !== sessionEpoch) return;
    persistStore().catch((err: any) =>
      console.error('[WhatsApp] persist failed:', err?.message || err)
    );
  }, 4000);
}

async function serializeStore() {
  const chats = [...waStore.chats.values()].map((c) => ({ ...c }));
  const contacts = [...waStore.contacts.values()].map((c) => ({ ...c }));
  const calls = [...waStore.calls].slice(-100);
  const messages: Record<string, any[]> = {};
  for (const [jid, list] of waStore.messages) {
    const recent = await Promise.all(list.slice(-30).map(async (m) => {
      const { text, type, meta } = await messageText(m);
      return {
        key: {
          id: m.key?.id ?? null,
          remoteJid: m.key?.remoteJid ?? null,
          fromMe: !!m.key?.fromMe,
          participant: m.key?.participant ?? null,
        },
        messageTimestamp: m.messageTimestamp ?? null,
        pushName: m.pushName || null,
        type,
        text: String(text).slice(0, 400),
        meta: meta ? JSON.parse(JSON.stringify(meta)) : null,
        stub: m.messageStubType ? String(m.messageStubType) : null,
      };
    }));
    // RTDB keys forbid ".", "#", "$", "/", "[", "]" — JIDs contain dots, so encode.
    messages[encodeRTDBKey(jid)] = recent;
  }
  return { updatedAt: Date.now(), chats, contacts, calls, messages };
}

function encodeRTDBKey(jid: string): string {
  return jid.replace(/[.#$\/\[\]]/g, (ch) => `%${ch.charCodeAt(0).toString(16)}`);
}

function decodeRTDBKey(key: string): string {
  return key.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

async function persistStore() {
  const data = await serializeStore();
  const doc = storeDocFor(userKey());
  const localFile = localStoreFileFor(userKey());
  // Primary: Firebase RTDB
  try {
    const db = await initRTDB();
    if (db) {
      await db.ref(`${STORE_COLLECTION}/${doc}`).set(data);
    }
  } catch (err: any) {
    console.error('[WhatsApp] RTDB persist failed:', err?.message || err);
  }
  // Fallback: local file
  try {
    fs.writeFileSync(localFile, JSON.stringify(data));
  } catch (err: any) {
    console.error('[WhatsApp] Local file persist failed:', err?.message || err);
  }
}

async function clearStoreInRTDB() {
  const doc = storeDocFor(userKey());
  const localFile = localStoreFileFor(userKey());
  try {
    if (fs.existsSync(localFile)) fs.rmSync(localFile, { force: true });
  } catch {
    // best effort
  }
  try {
    const db = await initRTDB();
    if (db) {
      await db.ref(`${STORE_COLLECTION}/${doc}`).remove();
    }
  } catch {
    // best effort
  }
}

function restoreMessage(d: any): WAMessage | null {
  if (!d?.key?.id) return null;
  return {
    key: {
      id: d.key.id,
      remoteJid: d.key.remoteJid,
      fromMe: d.key.fromMe,
      participant: d.key.participant,
    },
    messageTimestamp: d.messageTimestamp,
    pushName: d.pushName || undefined,
    messageStubType: d.stub || undefined,
    _restoredText: d.text,
    _restoredType: d.type,
    _restoredMeta: d.meta,
  } as any;
}

function applyStoreData(d: any) {
  for (const c of d.chats || []) {
    waStore.chats.set(c.jid, c);
  }
  for (const c of d.contacts || []) {
    waStore.contacts.set(c.jid, c);
  }
  for (const [jid, list] of Object.entries(d.messages || {})) {
    const restored = (list as any[]).map(restoreMessage).filter(Boolean);
    if (restored.length) waStore.messages.set(decodeRTDBKey(jid), restored);
  }
  for (const c of d.calls || []) {
    waStore.calls.push(c);
  }
}

export async function loadStoreFromRTDB(): Promise<void> {
  const doc = storeDocFor(userKey());
  const localFile = localStoreFileFor(userKey());
  // Primary: Firebase RTDB
  try {
    const db = await initRTDB();
    if (db) {
      const snap = await db.ref(`${STORE_COLLECTION}/${doc}`).get();
      if (snap.exists()) {
        const d = snap.val() || {};
        applyStoreData(d);
        console.log(
          `[WhatsApp] Restored store from RTDB (${userKey() || 'shared'}): ${waStore.chats.size} chats, ${waStore.contacts.size} contacts, ${waStore.messages.size} chats with messages`
        );
        return;
      }
    }
  } catch (err: any) {
    console.error('[WhatsApp] RTDB store load failed:', err?.message || err);
  }
  // Fallback: local file
  try {
    if (fs.existsSync(localFile)) {
      const d = JSON.parse(fs.readFileSync(localFile, 'utf8'));
      applyStoreData(d);
      console.log(
        `[WhatsApp] Restored store from local file (${userKey() || 'shared'}): ${waStore.chats.size} chats, ${waStore.contacts.size} contacts, ${waStore.messages.size} chats with messages`
      );
      return;
    }
  } catch (err: any) {
    console.error('[WhatsApp] Local file store load failed:', err?.message || err);
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

function statusPayload(): Record<string, unknown> {
  return {
    type: 'whatsappStatus',
    uid: currentUser?.uid || null,
    email: currentUser?.email || null,
    status: connectionState,
    connected: connectionState === 'connected',
    pairingCode: connectionState === 'pairing' ? pairingCode : null,
    qrDataUrl: connectionState === 'pairing' ? qrDataUrl : null,
    error: lastError,
    reconnectAttempt: connectionState === 'connecting' ? reconnectAttempt : 0,
    profile: connectionState === 'connected' ? profile : null,
    bossMode: connectionState === 'connected' ? bossMode : false,
  };
}

function setState(state: typeof connectionState, extra?: { error?: string | null }) {
  connectionState = state;
  lastError = extra?.error ?? null;
  try {
    broadcast(statusPayload());
  } catch {
    // no broadcast hook yet
  }
}

export function setBossMode(enabled: boolean): boolean {
  bossMode = !!enabled;
  writeMeta({ connectedOnce: readMeta().connectedOnce, bossMode });
  try {
    broadcast(statusPayload());
  } catch {
    // no broadcast hook yet
  }
  return bossMode;
}

export function getBossMode(): boolean {
  return bossMode;
}

async function fetchProfile(s: WASocket) {
  const epoch = sessionEpoch;
  try {
    const me = s.user;
    if (!me?.id) return;
    const phone = (me.id.split('@')[0] || '').split(':')[0] || null;
    let avatarUrl: string | null = null;
    try {
      avatarUrl = await s.profilePictureUrl(me.id as any, 'image');
    } catch {
      avatarUrl = null;
    }
    // A user switch mid-fetch must not paint the old user's profile onto the
    // new session.
    if (epoch !== sessionEpoch || sock !== s) return;
    profile = { name: me.name || null, phone, avatarUrl };
    broadcast(statusPayload());
  } catch {
    if (epoch === sessionEpoch) profile = null;
  }
}

export function setWhatsAppBroadcaster(uid: string | null | undefined, fn: (msg: unknown) => void) {
  const key = sanitizeUid(uid);
  const set = broadcastFns.get(key) || new Set<(msg: unknown) => void>();
  set.add(fn);
  broadcastFns.set(key, set);
  // Immediately send the current snapshot so the client renders the right state.
  try {
    fn({
      type: 'whatsappStatus',
      uid: currentUser?.uid || null,
      email: currentUser?.email || null,
      status: connectionState,
      connected: connectionState === 'connected',
      pairingCode,
      qrDataUrl,
      error: lastError,
      reconnectAttempt: connectionState === 'connecting' ? reconnectAttempt : 0,
      profile: connectionState === 'connected' ? profile : null,
      bossMode: connectionState === 'connected' ? bossMode : false,
    });
  } catch {
    // ignore
  }
}

export function removeWhatsAppBroadcaster(uid: string | null | undefined, fn: (msg: unknown) => void) {
  const key = sanitizeUid(uid);
  const set = broadcastFns.get(key);
  if (set) {
    set.delete(fn);
    if (set.size === 0) broadcastFns.delete(key);
  }
}

function requireSock(): WASocket {
  if (!sock) throw new Error('WhatsApp session is not initialized. Pair a phone number first.');
  if (connectionState !== 'connected') {
    throw new Error(`WhatsApp is not connected (state: ${connectionState}). Pair or reconnect first.`);
  }
  return sock;
}

export async function initWhatsAppSession(): Promise<void> {
  ensureDirs();
  // Restore the persisted store BEFORE connecting so the live history sync
  // cannot race ahead and clobber the restored chats/messages.
  await loadStoreFromRTDB();
  if (sock) return;
  const hasCreds = fs.existsSync(path.join(authDirFor(userKey()), 'creds.json'));
  if (!hasCreds) {
    setState('disconnected', {
      error: 'No WhatsApp credentials yet. Link from Settings > Connect WhatsApp.',
    });
    return;
  }
  await connectSocket();
}

export async function pairWhatsApp(phone: string): Promise<{ ok: boolean; pairingCode?: string; error?: string }> {
  ensureDirs();
  const digits = String(phone).replace(/[^\d]/g, '');
  if (!/^\d{7,15}$/.test(digits)) {
    return { ok: false, error: 'Invalid phone number. Use country code + number, digits only (e.g. 639171234567).' };
  }
  try {
    // Auto-unlink any existing session so a fresh pairing code is always
    // generated — no manual "Unlink first" step needed.
    if (connectionState === 'connected' || sock) {
      await stopCurrentSocket('logout');
      const credsPath = path.join(authDirFor(userKey()), 'creds.json');
      if (fs.existsSync(credsPath)) fs.rmSync(credsPath, { force: true });
      writeMeta({ connectedOnce: false });
      waStore.chats.clear();
      waStore.contacts.clear();
      waStore.messages.clear();
      waStore.calls.length = 0;
      await clearStoreInRTDB();
    }
    if (!readMeta().connectedOnce) purgeStaleAuth();
    pairingPhone = digits;
    await connectSocket();
    if (!sock) return { ok: false, error: 'Failed to create WhatsApp socket.' };
    // connectSocket() resolves as soon as the socket object exists — before the
    // underlying WebSocket is open. Baileys' requestPairingCode() throws
    // "Connection Closed" when called early (sendRawMessage refuses to write to
    // a non-open ws), so wait for the socket to open before requesting the code.
    try {
      await withTimeout(20_000, sock.waitForSocketOpen());
    } catch {
      setState('failed', { error: 'Timed out waiting for the WhatsApp connection to open. Try again.' });
      return { ok: false, error: 'Timed out waiting for the WhatsApp connection to open. Try again.' };
    }
    setState('pairing');
    pairingCode = await sock.requestPairingCode(digits);
    setState('pairing');
    return { ok: true, pairingCode };
  } catch (err: any) {
    setState('failed', { error: err.message });
    return { ok: false, error: err.message };
  }
}

export async function pairWhatsAppWithQr(): Promise<{ ok: boolean; error?: string }> {
  ensureDirs();
  try {
    // Auto-unlink any existing session so a fresh QR is always generated —
    // no manual "Unlink first" step needed.
    if (connectionState === 'connected' || sock) {
      await stopCurrentSocket('logout');
      const credsPath = path.join(authDirFor(userKey()), 'creds.json');
      if (fs.existsSync(credsPath)) fs.rmSync(credsPath, { force: true });
      writeMeta({ connectedOnce: false });
      waStore.chats.clear();
      waStore.contacts.clear();
      waStore.messages.clear();
      waStore.calls.length = 0;
      await clearStoreInRTDB();
    }
    if (!readMeta().connectedOnce) purgeStaleAuth();
    pairingPhone = null;
    pairingCode = null;
    await connectSocket();
    setState('pairing');
    return { ok: true };
  } catch (err: any) {
    setState('failed', { error: err.message });
    return { ok: false, error: err.message };
  }
}

export async function cancelWhatsAppPairing(): Promise<{ ok: boolean; error?: string }> {
  if (connectionState === 'connected') {
    return { ok: false, error: 'Session is already connected. Use logout to unlink.' };
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  await stopCurrentSocket('cancel');
  setState('disconnected');
  return { ok: true };
}

async function stopCurrentSocket(intent: 'cancel' | 'logout'): Promise<void> {
  // Invalidate any in-flight connectSocket() first — it may still be awaiting
  // getBaileys()/useMultiFileAuthState() with no `sock` to end yet. Without
  // this, cancel/logout during a pending connect lets the connect finish and
  // resurrect a socket (e.g. QR/pairing reappears right after Cancel).
  sessionEpoch += 1;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pairingTimeout) {
    clearTimeout(pairingTimeout);
    pairingTimeout = null;
  }
  stopHeartbeat();
  reconnectAttempt = 0;
  if (sock) {
    closeIntent = intent;
    try {
      if (intent === 'logout') await sock.logout('Logged out by user');
      sock.end(new Error(intent === 'logout' ? 'logout' : 'session reset'));
    } catch {
      // ignore
    }
    sock = null;
  }
  pairingCode = null;
  pairingPhone = null;
  qrRaw = null;
  qrDataUrl = null;
}

export async function logoutWhatsApp(): Promise<{ ok: boolean; error?: string }> {
  try {
    await stopCurrentSocket('logout');
    const credsPath = path.join(authDirFor(userKey()), 'creds.json');
    if (fs.existsSync(credsPath)) fs.rmSync(credsPath, { force: true });
    writeMeta({ connectedOnce: false });
    waStore.chats.clear();
    waStore.contacts.clear();
    waStore.messages.clear();
    waStore.calls.length = 0;
    await clearStoreInRTDB();
    setState('logged_out');
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// Hard reset: removes ALL WhatsApp auth state (not just creds.json) so a
// fresh pairing is possible. Unlike logoutWhatsApp this works even when the
// session is stuck in 'connecting'/'failed' (e.g. a 403-banned session whose
// socket never opens) — logout needs a live socket, reset does not. It also
// clears the persisted store and resets the `connectedOnce` pairing gate that
// otherwise prevents purgeStaleAuth() from running on the next pair attempt.
export async function resetWhatsApp(): Promise<{ ok: boolean; error?: string }> {
  try {
    // Stop any socket + timers without demanding a live connection.
    await stopCurrentSocket('cancel');
    // Wipe every auth artifact (creds, signal keys, app-state sync, sessions).
    purgeStaleAuth();
    // Reset the pairing gate so the next pair() call purges cleanly too.
    writeMeta({ connectedOnce: false });
    // Clear the in-memory + RTDB + local-file stores.
    waStore.chats.clear();
    waStore.contacts.clear();
    waStore.messages.clear();
    waStore.calls.length = 0;
    // clearStoreInRTDB also removes the local whatsapp-store.json file.
    await clearStoreInRTDB();
    setState('disconnected');
    return { ok: true };
  } catch (err: any) {
    setState('failed', { error: err.message });
    return { ok: false, error: err.message };
  }
}

async function connectSocket(): Promise<void> {
  ensureDirs();
  // This socket belongs to the current session epoch. Any user switch between
  // now and when the socket finishes opening makes this socket stale — it must
  // neither become `sock` nor run its event handlers against the new user's
  // store/state.
  const epoch = sessionEpoch;
  closeIntent = 'none';
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pairingTimeout) {
    clearTimeout(pairingTimeout);
    pairingTimeout = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  const {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason,
  } = await getBaileys();
  const { state, saveCreds } = await useMultiFileAuthState(authDirFor(userKey()));
  const logger = pino({ level: 'silent' });

  setState('connecting');
  const newSock = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger as any) },
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Beatrice OSS'),
    logger,
    syncFullHistory: true,
    markOnlineOnConnect: true,
  });
  if (epoch !== sessionEpoch) {
    // A user switch happened while we were creating the socket — discard it.
    try {
      newSock.end(new Error('session switched'));
    } catch {
      // ignore
    }
    return;
  }
  sock = newSock;
  const stale = () => epoch !== sessionEpoch;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update: any) => {
    if (stale()) return;
    const { connection, lastDisconnect, qr } = update || {};
    if (qr) {
      qrRaw = qr;
      void (async () => {
        try {
          const dataUrl = await QRCode.toDataURL(qr, { width: 480, margin: 1 });
          if (stale()) return;
          qrDataUrl = dataUrl;
        } catch {
          if (stale()) return;
          qrDataUrl = null;
        }
        setState('pairing');
      })();
      setState('pairing');
      startPairingTimeout();
    }
    if (connection === 'open') {
      qrRaw = null;
      qrDataUrl = null;
      pairingCode = null;
      reconnectAttempt = 0;
      if (pairingTimeout) {
        clearTimeout(pairingTimeout);
        pairingTimeout = null;
      }
      writeMeta({ connectedOnce: true, bossMode });
      setState('connected');
      schedulePersist();
      startHeartbeat();
      void fetchProfile(sock);
    } else if (connection === 'close') {
      stopHeartbeat();
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || 'unknown';
      const loggedOut =
        statusCode === DisconnectReason.loggedOut || /logged out/i.test(reason);
      if (closeIntent !== 'none') {
        const intent = closeIntent;
        closeIntent = 'none';
        sock = null;
        pairingCode = null;
        pairingPhone = null;
        qrRaw = null;
        qrDataUrl = null;
        profile = null;
        if (pairingTimeout) {
          clearTimeout(pairingTimeout);
          pairingTimeout = null;
        }
        if (intent === 'logout') setState('logged_out');
        else setState('disconnected');
        return;
      }
      if (loggedOut) {
        sock = null;
        reconnectAttempt = 0;
        profile = null;
        setState('logged_out', { error: 'WhatsApp session was logged out from the phone.' });
        return;
      }
      const banned = statusCode === DisconnectReason.badSession || /ban/i.test(reason);
      if (banned) {
        sock = null;
        reconnectAttempt = 0;
        setState('failed', {
          error: 'WhatsApp session appears banned or restricted. Unlink and re-pair after a while.',
        });
        return;
      }
      if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        sock = null;
        reconnectAttempt = 0;
        setState('failed', {
          error: `WhatsApp reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts. Unlink and re-pair.`,
        });
        return;
      }
      // The socket that just closed is dead — drop the reference so the
      // reconnect timer below can build a fresh one. Previously `sock` stayed
      // set here and the timer's `!sock` guard silently blocked every
      // reconnection attempt, leaving the linked session dead until restart.
      sock = null;
      const delay = Math.min(
        BASE_RECONNECT_MS * Math.pow(2, reconnectAttempt) + Math.random() * 1000,
        MAX_RECONNECT_MS
      );
      reconnectAttempt += 1;
      setState('connecting');
      if (reconnectTimer === null) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (stale()) return;
          if (connectionState !== 'connected' && connectionState !== 'pairing' && !sock) {
            connectSocket().catch((err: any) => setState('failed', { error: err.message }));
          }
        }, delay);
      }
    }
  });

  sock.ev.on('messaging-history.set', (ev: any) => {
    if (stale()) return;
    seedFromHistorySync(ev);
  });
  sock.ev.on('messages.upsert', ({ messages }: { messages: WAMessage[] }) => {
    if (stale()) return;
    for (const m of messages) pushMessage(m);
    void broadcastIncomingMessages(messages);
    if (bossMode) void maybeAutoReply(messages);
  });
  sock.ev.on('messages.update', (updates: any[]) => {
    if (stale()) return;
    for (const u of updates) {
      const list = u.key?.remoteJid ? waStore.messages.get(u.key.remoteJid) : null;
      if (!list) continue;
      const idx = list.findIndex((m) => m.key?.id === u.key.id);
      if (idx >= 0) list[idx] = { ...list[idx], ...u };
    }
    schedulePersist();
  });
  sock.ev.on('contacts.upsert', (contacts: any[]) => {
    if (stale()) return;
    for (const c of contacts) registerContact(c.id, c.name, c.notify, c.pushName);
    schedulePersist();
  });
  sock.ev.on('chats.upsert', (chats: any[]) => {
    if (stale()) return;
    for (const c of chats) {
      const existing = waStore.chats.get(c.id);
      waStore.chats.set(c.id, {
        jid: c.id,
        name: c.name || existing?.name || '',
        unreadCount: c.unreadCount ?? existing?.unreadCount ?? 0,
        archived: !!c.archived,
        muteEndsAt: c.mute ?? existing?.muteEndsAt ?? null,
        pinned: !!c.pinned,
        lastMessageAt: existing?.lastMessageAt ?? null,
      });
    }
  });
  sock.ev.on('chats.update', (chats: any[]) => {
    if (stale()) return;
    for (const c of chats) {
      const existing = waStore.chats.get(c.id);
      if (!existing) continue;
      if (c.unreadCount !== undefined) existing.unreadCount = c.unreadCount;
      if (c.archive !== undefined) existing.archived = !!c.archive;
      if (c.pinned !== undefined) existing.pinned = !!c.pinned;
      if (c.mute !== undefined) existing.muteEndsAt = c.mute;
      if (c.name !== undefined) existing.name = c.name;
    }
    schedulePersist();
  });
}

function startPairingTimeout() {
  if (pairingTimeout) clearTimeout(pairingTimeout);
  pairingTimeout = setTimeout(() => {
    pairingTimeout = null;
    if (connectionState === 'pairing') {
      stopCurrentSocket('cancel').catch(() => {});
      setState('disconnected', { error: 'Pairing timed out after 2 minutes. Try again.' });
    }
  }, PAIRING_TIMEOUT_MS);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (sock && connectionState === 'connected') {
      try {
        sock.sendPresenceUpdate('available');
      } catch {
        // ignore heartbeat failures
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function broadcastIncomingMessages(messages: WAMessage[]) {
  if (broadcastFns.size === 0) return;
  const items = (await Promise.all(messages
    .map(async (m) => {
      const { text, type } = await messageText(m);
      if (!text || m.key?.id?.startsWith('3A')) return null;
      return {
        id: m.key?.id,
        chatJid: m.key?.remoteJid,
        chatName: m.key?.remoteJid ? displayNameFor(m.key.remoteJid) : '',
        fromMe: !!m.key?.fromMe,
        sender: m.key?.fromMe ? 'me' : displayNameFor(m.key?.participant || m.key?.remoteJid || ''),
        timestamp: m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : null,
        type,
        text: String(text).slice(0, 200),
      };
    })))
    .filter(Boolean);
  if (items.length === 0) return;
  broadcast({ type: 'whatsappIncomingMessages', messages: items });
}

// ---------------------------------------------------------------------------
// Contact resolution
// ---------------------------------------------------------------------------

function toUserJid(input: string): string {
  const digits = input.replace(/[^\d]/g, '');
  return `${digits}@s.whatsapp.net`;
}

export async function resolveContact(query: string): Promise<{
  ok: boolean;
  jid?: string;
  name?: string;
  matchedBy?: string;
  candidates?: { jid: string; name: string }[];
  error?: string;
}> {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'Empty query. Provide a name, phone number, or JID.' };

  if (q.includes('@')) {
    if (/@(s\.whatsapp\.net|g\.us|broadcast)$/.test(q)) {
      const { jidNormalizedUser } = await getBaileys();
      const jid = jidNormalizedUser(q);
      return { ok: true, jid, name: displayNameFor(jid), matchedBy: 'jid' };
    }
    return { ok: false, error: `Invalid JID: ${q}` };
  }

  if (/^\+?[\d\s\-()]{7,20}$/.test(q)) {
    const jid = toUserJid(q);
    const found = waStore.contacts.get(jid);
    return {
      ok: true,
      jid,
      name: found?.name || found?.pushName || q,
      matchedBy: 'number',
      candidates: found ? [{ jid, name: displayNameFor(jid) }] : [],
    };
  }

  const contacts = [...waStore.contacts.values()].filter(
    (c) => c.name || c.pushName || c.notify
  );
  const score = (c: ContactRecord) => {
    const hay = `${c.name} ${c.pushName || ''} ${c.notify || ''} ${c.number}`.toLowerCase();
    const needle = q.toLowerCase();
    if (hay === needle) return 4;
    if (hay.startsWith(needle)) return 3;
    if (hay.includes(needle)) return 2;
    if (c.number.includes(q.replace(/[^\d]/g, ''))) return 2;
    return 0;
  };
  const ranked = contacts
    .map((c) => ({ c, s: score(c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (ranked.length === 0) {
    return {
      ok: false,
      error: `No contact matches "${query}". Search a different name, or send the full phone number with country code.`,
      candidates: [],
    };
  }
  const top = ranked[0];
  const candidates = ranked.slice(0, 5).map((x) => ({ jid: x.c.jid, name: displayNameFor(x.c.jid) }));
  return {
    ok: true,
    jid: top.c.jid,
    name: displayNameFor(top.c.jid),
    matchedBy: top.s >= 3 ? 'name' : 'fuzzy',
    candidates,
  };
}

export function displayNameFor(jid: string): string {
  const c = waStore.contacts.get(jid);
  if (c?.name) return c.name;
  if (c?.pushName) return c.pushName;
  if (c?.notify) return c.notify;
  if (jid.endsWith('@g.us')) {
    const g = waStore.chats.get(jid);
    if (g?.name) return g.name;
    return jid;
  }
  return jid.replace('@s.whatsapp.net', '');
}

// ---------------------------------------------------------------------------
// Permission gate
// ---------------------------------------------------------------------------

export function approveWhatsAppSend(id: string | null, approve: boolean, recipient?: string): boolean {
  if (id) {
    const pending = pendingApprovals.get(id);
    if (!pending) return false;
    pendingApprovals.delete(id);
    pending.resolve(approve);
    return true;
  }
  if (approve && recipient) {
    const jid = recipient.includes('@') ? recipient : toUserJid(recipient);
    approvedRecipients.set(jid, Date.now() + 10 * 60 * 1000);
    return true;
  }
  return false;
}

async function authorizeSend(recipientJid: string, purpose: string): Promise<{ allowed: boolean; reason?: string }> {
  if (AUTO_APPROVE) return { allowed: true };
  const expiry = approvedRecipients.get(recipientJid);
  if (expiry && expiry > Date.now()) return { allowed: true };

  const id = 'wa_approve_' + Math.random().toString(36).slice(2, 10);
  const promise = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(id);
      resolve(false);
    }, 30_000);
    pendingApprovals.set(id, {
      resolve: (approved) => {
        clearTimeout(timer);
        resolve(approved);
      },
    });
  });

  try {
    broadcast({
      type: 'whatsappApprovalRequest',
      id,
      recipient: recipientJid,
      recipientName: displayNameFor(recipientJid),
      purpose,
    });
  } catch {
    // no client connected — deny
  }
  const approved = await promise;
  if (approved) approvedRecipients.set(recipientJid, Date.now() + 10 * 60 * 1000);
  return { allowed: approved, reason: approved ? undefined : 'Send was not approved by the user.' };
}

async function withApproval(
  ctx: any,
  recipientJid: string,
  action: string,
  run: () => Promise<unknown>
): Promise<unknown> {
  const gate = await authorizeSend(recipientJid, action);
  if (!gate.allowed) {
    return { ok: false, error: gate.reason, requiresApproval: true };
  }
  // The approval wait can take up to 30s — if the user switched accounts in
  // that window, run() would execute on the WRONG user's socket.
  const epoch = sessionEpoch;
  try {
    if (epoch !== sessionEpoch) {
      return { ok: false, error: 'Session switched while awaiting approval. Try again.' };
    }
    const result = await run();
    if (epoch === sessionEpoch) {
      ctx?.broadcast?.({
        type: 'workspaceOutput',
        tool: 'whatsapp',
        action,
        recipient: recipientJid,
        status: 'ok',
      });
    }
    return result;
  } catch (err: any) {
    if (epoch === sessionEpoch) {
      ctx?.broadcast?.({
        type: 'workspaceOutput',
        tool: 'whatsapp',
        action,
        recipient: recipientJid,
        status: 'error',
        error: err.message,
      });
    }
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

async function messageText(m: WAMessage): Promise<{ text: string; type: string; meta?: any }> {
  if ((m as any)._restoredText !== undefined) {
    return {
      text: String((m as any)._restoredText),
      type: (m as any)._restoredType || 'restored',
      meta: (m as any)._restoredMeta,
    };
  }
  const { getContentType } = await getBaileys();
  const content = m.message ? getContentType(m.message) : null;
  if (!content) {
    if (m.messageStubType) return { text: `[${m.messageStubType}]`, type: 'stub' };
    return { text: '[unsupported]', type: 'unknown' };
  }
  const body = (m.message as any)[content];
  const sender = m.key?.fromMe
    ? 'me'
    : displayNameFor(m.key?.participant || m.key?.remoteJid || '');
  const base = { text: '', type: content, meta: { sender } };
  switch (content) {
    case 'conversation':
      return { ...base, text: body || '' };
    case 'extendedTextMessage':
      return { ...base, text: body?.text || '' };
    case 'imageMessage':
      return { ...base, text: body?.caption || '📷 [image]', meta: { ...base.meta, mime: body?.mimetype, size: body?.fileLength } };
    case 'videoMessage':
      return { ...base, text: body?.caption || '🎥 [video]' };
    case 'audioMessage':
      return { ...base, text: body?.ptt ? '🎤 [voice note]' : '🎵 [audio]', meta: { ...base.meta, seconds: body?.seconds, mime: body?.mimetype } };
    case 'documentMessage':
      return { ...base, text: `📄 [document: ${body?.fileName || 'file'}]`, meta: { ...base.meta, mime: body?.mimetype } };
    case 'stickerMessage':
      return { ...base, text: '[sticker]' };
    case 'contactMessage':
      return { ...base, text: `👤 [contact: ${body?.displayName || 'card'}]` };
    case 'locationMessage':
      return { ...base, text: `📍 [location ${body?.degreesLatitude}, ${body?.degreesLongitude}]` };
    case 'pollCreationMessage':
      return { ...base, text: `📊 [poll: ${body?.name}]` };
    case 'reactionMessage':
      return { ...base, text: `[reaction: ${body?.text || ''}]` };
    case 'groupInviteMessage':
      return { ...base, text: `[group invite: ${body?.groupName || ''}]` };
    case 'protocolMessage':
      return { ...base, text: '[protocol/system message]' };
    case 'buttonsResponseMessage':
      return { ...base, text: `[button: ${body?.selectedDisplayText || ''}]` };
    case 'listResponseMessage':
      return { ...base, text: `[list reply: ${body?.title || ''}]` };
    default:
      return { ...base, text: `[${content}]` };
  }
}

function findMessage(chatJid: string, messageId: string): WAMessage | null {
  const list = waStore.messages.get(chatJid) || [];
  return list.find((m) => m.key?.id === messageId) || null;
}

function msgKey(msg: WAMessage) {
  return {
    remoteJid: msg.key?.remoteJid || '',
    id: msg.key?.id || '',
    participant: msg.key?.participant,
    fromMe: !!msg.key?.fromMe,
  };
}

function formatMessageForContext(m: WAMessage): Promise<string | null> {
  return (async () => {
    const { text, type } = await messageText(m);
    if (type === 'stub' || type === 'unknown' || !text) return null;
    if (m.key?.id?.startsWith('3A')) return null;
    const sender = m.key?.fromMe ? 'Me' : displayNameFor(m.key?.participant || m.key?.remoteJid || '');
    const t = Number(m.messageTimestamp || 0) * 1000;
    const time = t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `${sender} (${time}): ${String(text).slice(0, 200)}`;
  })();
}

async function downloadMessageMedia(msg: WAMessage, ctx: any): Promise<{ ok: boolean; path?: string; mimeType?: string; fileName?: string; sizeBytes?: number; error?: string }> {
  try {
    const { getContentType, downloadMediaMessage } = await getBaileys();
    const content = msg.message ? getContentType(msg.message) : null;
    const mediaContent = content?.endsWith('Message') ? (msg.message as any)[content] : null;
    if (!mediaContent?.mimetype) return { ok: false, error: 'Message has no downloadable media.' };
    const buffer: Buffer = await downloadMediaMessage(msg, 'buffer', {});
    const ext = (mediaContent.mimetype.split('/')[1] || 'bin').replace(';', '');
    const safeExt = ext.replace(/[^\w.]/g, '').slice(0, 8);
    const fileName = `${msg.key?.id || Date.now()}.${safeExt}`;
    const fullPath = path.join(MEDIA_DIR, fileName);
    fs.writeFileSync(fullPath, buffer);
    ctx?.broadcast?.({
      type: 'workspaceOutput',
      tool: 'whatsapp',
      action: 'read_whatsapp_attachment',
      status: 'ok',
      file: fullPath,
    });
    return {
      ok: true,
      path: fullPath,
      mimeType: mediaContent.mimetype,
      fileName: mediaContent.fileName || fileName,
      sizeBytes: buffer.length,
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

function locateMediaMessage(args: any): { chatJid?: string; messageId?: string; error?: string } {
  if (args.messageId && args.chatId) {
    return { chatJid: String(args.chatId), messageId: String(args.messageId) };
  }
  if (args.messageId) {
    for (const [jid, list] of waStore.messages) {
      if (list.some((m) => m.key?.id === args.messageId)) {
        return { chatJid: jid, messageId: String(args.messageId) };
      }
    }
  }
  return { error: 'Cannot locate the message. Provide messageId (and chatId if known).' };
}

// ---------------------------------------------------------------------------
// Internal action catalog (capability registry — source of truth for the backend)
// ---------------------------------------------------------------------------

export interface InternalAction {
  id: string;
  group: string;
  description: string;
  implemented: boolean;
}

export const WA_INTERNAL_ACTIONS: InternalAction[] = [
  // ---- read
  { id: 'list_chats', group: 'read', description: 'List WhatsApp chats with unread counts and last activity', implemented: true },
  { id: 'search_chats', group: 'read', description: 'Search chats by name or number', implemented: true },
  { id: 'read_history', group: 'read', description: 'Read recent message history of a chat', implemented: true },
  { id: 'read_attachment', group: 'read', description: 'Download a media attachment from a message', implemented: true },
  { id: 'transcribe_audio', group: 'read', description: 'Transcribe a voice note using Gemini', implemented: true },
  { id: 'get_contacts', group: 'read', description: 'List known contacts', implemented: true },
  { id: 'search_contacts', group: 'read', description: 'Search contacts by name or number', implemented: true },
  { id: 'get_groups', group: 'read', description: 'List joined groups', implemented: true },
  { id: 'get_group_metadata', group: 'read', description: 'Fetch group metadata (subject, description, participants)', implemented: true },
  { id: 'get_group_members', group: 'read', description: 'List group participants with roles', implemented: true },
  { id: 'search_messages', group: 'read', description: 'Search stored messages by text across recent history', implemented: true },
  { id: 'get_calls', group: 'read', description: 'List recent call records', implemented: true },
  { id: 'get_profile_status', group: 'read', description: 'Fetch a contact profile status/about text', implemented: true },
  { id: 'get_avatar', group: 'read', description: 'Fetch a contact or group avatar image URL', implemented: true },
  { id: 'get_business_profile', group: 'read', description: 'Fetch business profile of a contact', implemented: true },
  // ---- send
  { id: 'send_text', group: 'send', description: 'Send a text message', implemented: true },
  { id: 'send_image', group: 'send', description: 'Send an image with optional caption', implemented: true },
  { id: 'send_video', group: 'send', description: 'Send a video', implemented: true },
  { id: 'send_audio', group: 'send', description: 'Send an audio file or voice note', implemented: true },
  { id: 'send_document', group: 'send', description: 'Send a document file', implemented: true },
  { id: 'send_sticker', group: 'send', description: 'Send a sticker (webp image)', implemented: true },
  { id: 'send_contact_card', group: 'send', description: 'Send a vCard contact card', implemented: true },
  { id: 'send_location', group: 'send', description: 'Send a map location pin', implemented: true },
  { id: 'send_poll', group: 'send', description: 'Send a poll with options', implemented: true },
  { id: 'send_reaction', group: 'send', description: 'React to a message with an emoji', implemented: true },
  { id: 'reply_message', group: 'send', description: 'Reply quoting an existing message', implemented: true },
  { id: 'forward_message', group: 'send', description: 'Forward an existing message to another chat', implemented: true },
  { id: 'send_presence_typing', group: 'send', description: 'Send a composing/typing indicator', implemented: true },
  { id: 'send_buttons', group: 'send', description: 'Send a message with quick-reply buttons (via proto relay)', implemented: true },
  { id: 'send_template', group: 'send', description: 'Send a template message with quick-reply buttons (deprecated but functional via proto relay)', implemented: true },
  // ---- message control
  { id: 'mark_read', group: 'control', description: 'Mark a message or chat as read', implemented: true },
  { id: 'mark_unread', group: 'control', description: 'Mark a chat as unread', implemented: true },
  { id: 'star_message', group: 'control', description: 'Star a message', implemented: true },
  { id: 'unstar_message', group: 'control', description: 'Unstar a message', implemented: true },
  { id: 'delete_message', group: 'control', description: 'Delete/revoke a message for everyone', implemented: true },
  { id: 'delete_for_me', group: 'control', description: 'Delete a message only on this device', implemented: true },
  { id: 'archive_chat', group: 'control', description: 'Archive a chat', implemented: true },
  { id: 'unarchive_chat', group: 'control', description: 'Unarchive a chat', implemented: true },
  { id: 'mute_chat', group: 'control', description: 'Mute a chat for a duration', implemented: true },
  { id: 'unmute_chat', group: 'control', description: 'Unmute a chat', implemented: true },
  { id: 'pin_chat', group: 'control', description: 'Pin a chat', implemented: true },
  { id: 'unpin_chat', group: 'control', description: 'Unpin a chat', implemented: true },
  { id: 'clear_chat', group: 'control', description: 'Clear a chat on this device', implemented: true },
  { id: 'delete_chat', group: 'control', description: 'Delete a chat (this device)', implemented: true },
  // ---- group admin
  { id: 'create_group', group: 'group', description: 'Create a new group', implemented: true },
  { id: 'add_participant', group: 'group', description: 'Add participants to a group', implemented: true },
  { id: 'remove_participant', group: 'group', description: 'Remove participants from a group', implemented: true },
  { id: 'promote_participant', group: 'group', description: 'Promote a participant to admin', implemented: true },
  { id: 'demote_participant', group: 'group', description: 'Demote a group admin', implemented: true },
  { id: 'change_group_subject', group: 'group', description: 'Rename a group', implemented: true },
  { id: 'change_group_description', group: 'group', description: 'Update group description', implemented: true },
  { id: 'change_group_picture', group: 'group', description: 'Update group profile picture', implemented: true },
  { id: 'get_invite_code', group: 'group', description: 'Get the group invite link', implemented: true },
  { id: 'revoke_invite_code', group: 'group', description: 'Revoke the group invite link', implemented: true },
  { id: 'join_group', group: 'group', description: 'Join a group via invite code', implemented: true },
  { id: 'leave_group', group: 'group', description: 'Leave a group', implemented: true },
  { id: 'group_setting_announce', group: 'group', description: 'Toggle announcement mode (only admins post)', implemented: true },
  { id: 'group_setting_restrict', group: 'group', description: 'Toggle restrict mode (only admins edit info)', implemented: true },
  { id: 'toggle_disappearing', group: 'group', description: 'Set disappearing messages duration for a chat', implemented: true },
  // ---- account / privacy
  { id: 'block_contact', group: 'account', description: 'Block a contact', implemented: true },
  { id: 'unblock_contact', group: 'account', description: 'Unblock a contact', implemented: true },
  { id: 'get_block_list', group: 'account', description: 'List blocked contacts', implemented: true },
  { id: 'set_profile_picture', group: 'account', description: 'Update the account profile picture', implemented: true },
  { id: 'set_profile_status', group: 'account', description: 'Update the account about/status text', implemented: true },
  { id: 'set_push_name', group: 'account', description: 'Set the display name on WhatsApp', implemented: true },
  { id: 'set_presence_available', group: 'account', description: 'Set presence to available', implemented: true },
  { id: 'set_presence_unavailable', group: 'account', description: 'Set presence to offline/unavailable', implemented: true },
  { id: 'sync_contacts', group: 'account', description: 'Request contact list refresh', implemented: true },
  { id: 'request_history_sync', group: 'account', description: 'Request full history sync from the phone', implemented: true },
  // ---- misc
  { id: 'get_knowledge_base', group: 'misc', description: 'Get the compact WhatsApp knowledge base (contacts, Boss chat style, recent conversations) built from chat history', implemented: true },
  { id: 'set_boss_mode', group: 'misc', description: 'Enable/disable Boss Mode (auto-reply to incoming WhatsApp messages mimicking the Boss\'s style)', implemented: true },
  { id: 'call_contact', group: 'misc', description: 'Initiate a WhatsApp voice call', implemented: false },
  { id: 'get_privacy_settings', group: 'misc', description: 'Read current privacy settings', implemented: true },
  { id: 'update_privacy_settings', group: 'misc', description: 'Update privacy settings (last seen, profile picture, status, read receipts)', implemented: true },
  { id: 'logout', group: 'misc', description: 'Log out the WhatsApp session', implemented: true },
];

export function getWhatsAppCapabilities(): { connected: boolean; state: string; actions: InternalAction[] } {
  return { connected: connectionState === 'connected', state: connectionState, actions: WA_INTERNAL_ACTIONS };
}

export function getWhatsAppStatus(): {
  connected: boolean;
  state: string;
  pairingCode: string | null;
  pairingPhone: string | null;
  qrDataUrl: string | null;
  error: string | null;
  chats: number;
  contacts: number;
  messages: number;
  bossMode: boolean;
  profile: { name: string | null; phone: string | null; avatarUrl: string | null } | null;
  uid: string | null;
  email: string | null;
} {
  return {
    connected: connectionState === 'connected',
    state: connectionState,
    pairingCode,
    pairingPhone,
    qrDataUrl,
    error: lastError,
    chats: waStore.chats.size,
    contacts: waStore.contacts.size,
    messages: [...waStore.messages.values()].reduce((n, l) => n + l.length, 0),
    bossMode,
    profile: connectionState === 'connected' ? profile : null,
    uid: currentUser?.uid || null,
    email: currentUser?.email || null,
  };
}

export function getWhatsAppUser(): { uid: string | null; email: string | null } {
  return { uid: currentUser?.uid || null, email: currentUser?.email || null };
}

// ---------------------------------------------------------------------------
// Gemini-visible handlers (18 first-class tools)
// ---------------------------------------------------------------------------

export async function handleResolveWhatsAppContact(args: { query?: string }, ctx: any) {
  try {
    requireSock();
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
  const r = await resolveContact(args?.query || '');
  ctx?.broadcast?.({ type: 'workspaceOutput', tool: 'whatsapp', action: 'resolve_contact', query: args?.query, status: r.ok ? 'ok' : 'error' });
  return r;
}

export async function handleRequestWhatsAppSend(
  args: { recipient?: string; action?: string; message?: string; channel?: string },
  ctx: any
) {
  try {
    requireSock();
    const recipient = args?.recipient || '';
    if (!recipient) return { ok: false, error: 'recipient is required (name, number, or JID).' };
    const r = await resolveContact(recipient);
    if (!r.ok || !r.jid) return { ok: false, error: r.error };
    const purpose = `${args?.action || 'send'}${args?.message ? `: ${String(args.message).slice(0, 80)}` : ''}`;
    const gate = await authorizeSend(r.jid, purpose);
    return {
      ok: true,
      allowed: gate.allowed,
      autoApproved: AUTO_APPROVE,
      requiresApproval: !AUTO_APPROVE && !gate.allowed,
      recipientJid: r.jid,
      recipientName: r.name,
      reason: gate.reason,
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleSendWhatsAppText(args: { recipient?: string; text?: string }, ctx: any) {
  try {
    const s = requireSock();
    if (!args?.recipient || !args?.text?.trim()) return { ok: false, error: 'recipient and text are required.' };
    const r = await resolveContact(args.recipient);
    if (!r.ok || !r.jid) return { ok: false, error: r.error };
    return await withApproval(ctx, r.jid, 'send_text', async () => {
      await s.sendMessage(r.jid as any, { text: String(args.text) } as AnyMessageContent);
      return { ok: true, to: r.name, jid: r.jid, text: String(args.text).slice(0, 120) };
    });
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleSendWhatsAppMessage(args: { recipient?: string; message?: string; quoteMessageId?: string }, ctx: any) {
  try {
    const s = requireSock();
    const text = args?.message || '';
    if (!args?.recipient || !text.trim()) return { ok: false, error: 'recipient and message are required.' };
    const r = await resolveContact(args.recipient);
    if (!r.ok || !r.jid) return { ok: false, error: r.error };
    return await withApproval(ctx, r.jid, 'send_message', async () => {
      const { getContentType } = await getBaileys();
      const content: any = { text: String(text) };
      if (args.quoteMessageId) {
        const quoted = findMessage(r.jid as string, String(args.quoteMessageId));
        if (quoted?.message) {
          const quotedType = getContentType(quoted.message);
          content.contextInfo = {
            stanzaId: quoted.key?.id,
            participant: quoted.key?.participant,
            remoteJid: quoted.key?.remoteJid,
            quotedMessage: (quoted.message as any)[quotedType]
              ? { [(quotedType || 'conversation') as string]: (quoted.message as any)[quotedType] }
              : undefined,
          };
        }
      }
      await s.sendMessage(r.jid as any, content);
      return { ok: true, to: r.name, jid: r.jid };
    });
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleSendWhatsAppGroupMessage(args: { group?: string; text?: string }, ctx: any) {
  try {
    const s = requireSock();
    if (!args?.group || !args?.text?.trim()) return { ok: false, error: 'group and text are required.' };
    let gid = String(args.group);
    if (!gid.includes('@')) {
      const matches = [...waStore.chats.values()].filter(
        (c) => c.jid.endsWith('@g.us') && c.name.toLowerCase().includes(gid.toLowerCase())
      );
      if (matches.length === 0) return { ok: false, error: `No group matches "${args.group}".` };
      if (matches.length > 1) {
        return {
          ok: false,
          error: `Multiple groups match. Use the exact group id or add more of the name: ${matches.slice(0, 4).map((m) => m.name).join(', ')}`,
        };
      }
      gid = matches[0].jid;
    }
    const gName = displayNameFor(gid);
    return await withApproval(ctx, gid, 'send_group_message', async () => {
      await s.sendMessage(gid as any, { text: String(args.text) } as AnyMessageContent);
      return { ok: true, group: gName, jid: gid };
    });
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleSendWhatsAppContactCard(args: { recipient?: string; name?: string; phone?: string }, ctx: any) {
  try {
    const s = requireSock();
    if (!args?.recipient || !args?.name || !args?.phone) {
      return { ok: false, error: 'recipient, name, and phone are required.' };
    }
    const r = await resolveContact(args.recipient);
    if (!r.ok || !r.jid) return { ok: false, error: r.error };
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${args.name}\nTEL;type=CELL;type=VOICE;waid=${args.phone.replace(/\D/g, '')}:+${args.phone.replace(/\D/g, '')}\nEND:VCARD`;
    return await withApproval(ctx, r.jid, 'send_contact_card', async () => {
      await s.sendMessage(r.jid as any, {
        contacts: { displayName: String(args.name), contacts: [{ displayName: String(args.name), vcard }] },
      });
      return { ok: true, to: r.name };
    });
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleReadWhatsAppChats(args: { limit?: number }, ctx: any) {
  try {
    requireSock();
    const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100);
    const chats = [...waStore.chats.values()]
      .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
      .slice(0, limit)
      .map((c) => ({
        jid: c.jid,
        name: c.name || displayNameFor(c.jid),
        unread: c.unreadCount,
        archived: c.archived,
        pinned: c.pinned,
        muted: c.muteEndsAt ? c.muteEndsAt > Date.now() : false,
        lastActivityAt: c.lastMessageAt,
        type: c.jid.endsWith('@g.us') ? 'group' : 'dm',
      }));
    ctx?.broadcast?.({ type: 'workspaceOutput', tool: 'whatsapp', action: 'read_whatsapp_chats', status: 'ok' });
    return { ok: true, chats };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleGetWhatsAppContacts(args: { query?: string }, ctx: any) {
  try {
    requireSock();
    const q = (args?.query || '').toLowerCase().trim();
    let list = [...waStore.contacts.values()];
    if (q) {
      list = list.filter((c) =>
        `${c.name} ${c.pushName || ''} ${c.notify || ''} ${c.number}`.toLowerCase().includes(q)
      );
    }
    const contacts = list
      .sort((a, b) => (a.name || a.number).localeCompare(b.name || b.number))
      .slice(0, 200)
      .map((c) => ({ jid: c.jid, name: displayNameFor(c.jid), number: c.number }));
    ctx?.broadcast?.({ type: 'workspaceOutput', tool: 'whatsapp', action: 'get_whatsapp_contacts', status: 'ok' });
    return { ok: true, total: contacts.length, contacts };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleGetWhatsAppGroups(_args: any, ctx: any) {
  try {
    requireSock();
    const groups = [...waStore.chats.values()]
      .filter((c) => c.jid.endsWith('@g.us'))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map((c) => ({ jid: c.jid, name: c.name || c.jid, unread: c.unreadCount }));
    ctx?.broadcast?.({ type: 'workspaceOutput', tool: 'whatsapp', action: 'get_whatsapp_groups', status: 'ok' });
    return { ok: true, total: groups.length, groups };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleGetWhatsAppMessageHistory(args: { chatId?: string; limit?: number }, ctx: any) {
  try {
    requireSock();
    const chatId = args?.chatId || '';
    if (!chatId) return { ok: false, error: 'chatId is required (use a jid from read_whatsapp_chats).' };
    const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100);
    const list = (waStore.messages.get(chatId) || []).slice(-limit);
    const messages = (await Promise.all(list
      .map(async (m) => {
        const { text, type, meta } = await messageText(m);
        return {
          id: m.key?.id,
          fromMe: !!m.key?.fromMe,
          sender: meta?.sender || (m.key?.fromMe ? 'me' : 'other'),
          timestamp: m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : null,
          type,
          text,
        };
      })))
      .reverse();
    ctx?.broadcast?.({ type: 'workspaceOutput', tool: 'whatsapp', action: 'get_whatsapp_message_history', status: 'ok' });
    return { ok: true, chatId, chatName: displayNameFor(chatId), messages };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleGetWhatsAppCalls(_args: any, ctx: any) {
  try {
    requireSock();
    const calls = [...waStore.calls]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 50)
      .map((c) => ({
        jid: c.jid,
        name: displayNameFor(c.jid),
        type: c.type,
        fromMe: c.fromMe,
        timestamp: c.timestamp,
      }));
    ctx?.broadcast?.({ type: 'workspaceOutput', tool: 'whatsapp', action: 'get_whatsapp_calls', status: 'ok' });
    return { ok: true, total: calls.length, calls };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleBlockWhatsAppContact(args: { recipient?: string }, ctx: any) {
  try {
    const s = requireSock();
    if (!args?.recipient) return { ok: false, error: 'recipient is required.' };
    const r = await resolveContact(args.recipient);
    if (!r.ok || !r.jid) return { ok: false, error: r.error };
    await s.updateBlockStatus(r.jid as any, 'block');
    ctx?.broadcast?.({ type: 'workspaceOutput', tool: 'whatsapp', action: 'block_whatsapp_contact', status: 'ok' });
    return { ok: true, blocked: r.name };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleUnblockWhatsAppContact(args: { recipient?: string }, ctx: any) {
  try {
    const s = requireSock();
    if (!args?.recipient) return { ok: false, error: 'recipient is required.' };
    const r = await resolveContact(args.recipient);
    if (!r.ok || !r.jid) return { ok: false, error: r.error };
    await s.updateBlockStatus(r.jid as any, 'unblock');
    ctx?.broadcast?.({ type: 'workspaceOutput', tool: 'whatsapp', action: 'unblock_whatsapp_contact', status: 'ok' });
    return { ok: true, unblocked: r.name };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleReadWhatsAppAttachment(args: { messageId?: string; chatId?: string }, ctx: any) {
  try {
    requireSock();
    const loc = locateMediaMessage(args);
    if (loc.error) return { ok: false, error: loc.error };
    const msg = findMessage(loc.chatJid!, loc.messageId!);
    if (!msg) return { ok: false, error: `Message ${loc.messageId} not found in stored history.` };
    const dl = await downloadMessageMedia(msg, ctx);
    if (!dl.ok) return { ok: false, error: dl.error };
    return { ok: true, path: dl.path, mimeType: dl.mimeType, fileName: dl.fileName, sizeBytes: dl.sizeBytes };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleTranscribeWhatsAppAudio(args: { messageId?: string; chatId?: string }, ctx: any) {
  try {
    requireSock();
    const loc = locateMediaMessage(args);
    if (loc.error) return { ok: false, error: loc.error };
    const msg = findMessage(loc.chatJid!, loc.messageId!);
    if (!msg) return { ok: false, error: `Message ${loc.messageId} not found in stored history.` };
    const { getContentType, downloadMediaMessage } = await getBaileys();
    const content = msg.message ? getContentType(msg.message) : null;
    const audioContent = content === 'audioMessage' ? (msg.message as any).audioMessage : null;
    if (!audioContent) return { ok: false, error: 'Message is not a voice note or audio.' };
    const buffer: Buffer = await downloadMediaMessage(msg, 'buffer', {});
    const mimeType = audioContent.mimetype || 'audio/ogg; codecs=opus';
    if (!ctx?.ai) return { ok: false, error: 'No Gemini client available for transcription.' };
    const res = await ctx.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Transcribe this WhatsApp voice message verbatim. Output only the transcript text. If the message is not speech, describe what the audio contains in one sentence.',
            },
            { inlineData: { mimeType, data: buffer.toString('base64') } },
          ],
        },
      ],
    });
    const transcript = res.text?.trim() || '';
    ctx?.broadcast?.({ type: 'workspaceOutput', tool: 'whatsapp', action: 'transcribe_whatsapp_audio', status: 'ok', transcript: transcript.slice(0, 200) });
    return { ok: true, transcript, mimeType, durationSeconds: audioContent.seconds || null };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleSendWhatsAppDocument(
  args: { recipient?: string; filePath?: string; base64?: string; fileName?: string; mimeType?: string; caption?: string },
  ctx: any
) {
  try {
    const s = requireSock();
    if (!args?.recipient) return { ok: false, error: 'recipient is required.' };
    if (!args.filePath && !args.base64) return { ok: false, error: 'Provide filePath (server file) or base64 + fileName.' };
    const r = await resolveContact(args.recipient);
    if (!r.ok || !r.jid) return { ok: false, error: r.error };
    let buffer: Buffer;
    let fileName = args.fileName || 'document';
    if (args.filePath) {
      const full = path.resolve(String(args.filePath));
      if (!fs.existsSync(full)) return { ok: false, error: `File not found: ${args.filePath}` };
      buffer = fs.readFileSync(full);
      fileName = path.basename(full);
    } else {
      buffer = Buffer.from(String(args.base64), 'base64');
      fileName = args.fileName || 'document.bin';
    }
    return await withApproval(ctx, r.jid, 'send_document', async () => {
      await s.sendMessage(r.jid as any, {
        document: buffer,
        mimetype: args.mimeType || 'application/octet-stream',
        fileName,
        caption: args.caption,
      });
      return { ok: true, to: r.name, fileName };
    });
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleSyncWhatsAppHistory(_args: any, ctx: any) {
  try {
    requireSock();
    const st = getWhatsAppStatus();
    return {
      ok: true,
      note: 'WhatsApp history sync runs automatically when the phone allows it. Current in-memory store below.',
      chats: st.chats,
      contacts: st.contacts,
      messages: st.messages,
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function handleWhatsAppCall(args: { recipient?: string }, _ctx: any) {
  try {
    requireSock();
    if (!args?.recipient) return { ok: false, error: 'recipient is required.' };
    const r = await resolveContact(args.recipient);
    return {
      ok: false,
      supported: false,
      error: 'Initiating WhatsApp calls from a WhatsApp Web (Baileys) session is not supported by the WhatsApp protocol. Advise the user to call manually from the phone app.',
      recipient: r.ok ? r.name : args.recipient,
    };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Dynamic context injection for the Live instruction
// ---------------------------------------------------------------------------

export async function getWhatsAppRecentContext(maxMessages: number = MAX_CONTEXT_MESSAGES): Promise<string> {
  if (connectionState !== 'connected' || waStore.chats.size === 0) return '';
  const chats = [...waStore.chats.values()].sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  const lines: string[] = [];
  let remaining = maxMessages;
  for (const chat of chats) {
    if (remaining <= 0) break;
    const list = (waStore.messages.get(chat.jid) || []).slice(-10);
    for (const m of list) {
      if (remaining <= 0) break;
      if (!m.key?.fromMe && m.key?.remoteJid !== chat.jid) continue;
      const line = await formatMessageForContext(m);
      if (line) {
        lines.push(`[${chat.name || displayNameFor(chat.jid)}] ${line}`);
        remaining -= 1;
      }
    }
  }
  if (lines.length === 0) return '';
  return `### LIVE WHATSAPP CONTEXT (most recent activity, refreshed per session)\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// WhatsApp knowledge base + Boss Mode auto-reply
// ---------------------------------------------------------------------------

let genAi: any = null;
async function getLocalGemini() {
  if (genAi) return genAi;
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'MY_GEMINI_API_KEY') return null;
  const mod: any = await import('@google/genai');
  genAi = new mod.GoogleGenAI({ apiKey: key });
  return genAi;
}

// Cache the compact knowledge base so repeated calls are cheap; refresh every 5 min.
let kbCache: { builtAt: number; text: string } | null = null;
const KB_TTL_MS = 5 * 60 * 1000;

const styleStopwords = new Set([
  'the','a','an','and','or','but','of','to','in','on','at','for','with','is','are','was',
  'were','be','been','it','this','that','i','you','he','she','we','they','me','my','your',
  'have','has','had','do','does','did','not','no','yes','ok','okay','sure','so','just',
  'u','im','dont','youre','its','theres','ill','ive','that\'s','there','what','when','where',
  'how','why','can','cant','will','would','should','could','as','by','from','up','out',
]);

function guessLanguage(samples: string[]): string {
  const joined = samples.join(' ').toLowerCase();
  const counts: Record<string, number> = {};
  for (const c of joined) {
    const code = c.charCodeAt(0);
    if (code >= 0x4e00 && code <= 0x9fff) counts.zh = (counts.zh || 0) + 1;
    else if (code >= 0x3040 && code <= 0x30ff) counts.ja = (counts.ja || 0) + 1;
    else if (code >= 0xac00 && code <= 0xd7af) counts.ko = (counts.ko || 0) + 1;
    else if (code >= 0x0400 && code <= 0x04ff) counts.ru = (counts.ru || 0) + 1;
    else if (code >= 0x0600 && code <= 0x06ff) counts.ar = (counts.ar || 0) + 1;
    else if (code >= 0x0900 && code <= 0x097f) counts.hi = (counts.hi || 0) + 1;
    else if (code >= 0x0e00 && code <= 0x0e7f) counts.th = (counts.th || 0) + 1;
    else if (code >= 0x1f00 && code <= 0x1fff) counts.el = (counts.el || 0) + 1;
    else if (code >= 0x0370 && code <= 0x03ff) counts.el = (counts.el || 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 3) return 'English (or romanized)';
  const names: Record<string, string> = {
    zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ru: 'Russian', ar: 'Arabic',
    hi: 'Hindi', th: 'Thai', el: 'Greek',
  };
  return names[best[0]] || 'English (or romanized)';
}

// Build a compact, style-oriented knowledge base from the full in-memory history:
// who the Boss talks to, how the Boss writes, and the most recent conversations.
export async function getWhatsAppKnowledgeBase(force = false): Promise<string> {
  if (connectionState !== 'connected') return '';
  if (!force && kbCache && Date.now() - kbCache.builtAt < KB_TTL_MS) return kbCache.text;

  const lines: string[] = ['### WHATSAPP KNOWLEDGE BASE (built from the Boss\'s chat history)'];

  if (profile) {
    lines.push(`- Linked WhatsApp account: ${profile.name || 'unknown'}${profile.phone ? ` (${profile.phone})` : ''}`);
  }

  // ---- People the Boss talks to (contacts with activity)
  const chats = [...waStore.chats.values()].sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  const people: string[] = [];
  const groups: string[] = [];
  for (const c of chats.slice(0, 40)) {
    const isGroup = c.jid.endsWith('@g.us');
    const msgs = waStore.messages.get(c.jid)?.length || 0;
    const label = `${c.name || displayNameFor(c.jid)} (${msgs} msgs)`;
    if (isGroup) groups.push(label);
    else people.push(label);
  }
  if (people.length) lines.push(`- People the Boss chats with (most recent first): ${people.join(', ')}`);
  if (groups.length) lines.push(`- Groups: ${groups.join(', ')}`);

  // ---- The Boss's own writing style (from their sent messages)
  const myMsgs: string[] = [];
  for (const list of waStore.messages.values()) {
    for (const m of list) {
      if (!m.key?.fromMe || m.key?.id?.startsWith('3A')) continue;
      const { text, type } = await messageText(m);
      const t = String(text || '').trim();
      if (!t || type === 'stub' || type === 'unknown') continue;
      myMsgs.push(t.slice(0, 300));
      if (myMsgs.length >= 120) break;
    }
    if (myMsgs.length >= 120) break;
  }
  if (myMsgs.length >= 3) {
    const lang = guessLanguage(myMsgs);
    const avgLen = Math.round(myMsgs.reduce((n, s) => n + s.length, 0) / myMsgs.length);
    const emojiRe = /[\p{Extended_Pictographic}\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/gu;
    const withEmoji = myMsgs.filter((s) => emojiRe.test(s)).length;
    const qCount = myMsgs.filter((s) => s.includes('?')).length;
    const bangCount = myMsgs.filter((s) => s.includes('!')).length;
    const lower = myMsgs.filter((s) => s === s.toLowerCase() && /[a-z]{2}/.test(s)).length;
    const caps = myMsgs.filter((s) => /[A-Z]/.test(s[0] || '') && /[a-z]/.test(s.slice(1) || '')).length;
    const freq = new Map<string, number>();
    for (const s of myMsgs) {
      for (const w of s.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
        if (w.length > 1 && !styleStopwords.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
    const topWords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
    const styleBits = [
      `language: ${lang}`,
      `avg message length: ${avgLen} chars`,
      `emoji in ~${Math.round((withEmoji / myMsgs.length) * 100)}% of messages`,
      `questions: ${Math.round((qCount / myMsgs.length) * 100)}%, exclamations: ${Math.round((bangCount / myMsgs.length) * 100)}%`,
      `lowercase style: ${Math.round((lower / myMsgs.length) * 100)}%, proper caps: ${Math.round((caps / myMsgs.length) * 100)}%`,
      `frequent words: ${topWords.join(', ') || 'n/a'}`,
    ];
    lines.push(`- Boss chat style: ${styleBits.join('; ')}`);
    const samples = myMsgs.slice(-4).map((s) => `    "…${s.slice(0, 120)}"`);
    lines.push(`- Recent examples of the Boss's own messages:\n${samples.join('\n')}`);
  }

  // ---- Recent conversations (per chat, last few lines)
  const recents: string[] = [];
  for (const c of chats.slice(0, 6)) {
    const list = (waStore.messages.get(c.jid) || []).slice(-6);
    const block: string[] = [];
    for (const m of list) {
      const line = await formatMessageForContext(m);
      if (line) block.push(`    ${line}`);
    }
    if (block.length) recents.push(`- Chat with ${c.name || displayNameFor(c.jid)}:\n${block.join('\n')}`);
  }
  if (recents.length) lines.push(`### RECENT CONVERSATIONS\n${recents.join('\n\n')}`);

  const text = lines.join('\n');
  kbCache = { builtAt: Date.now(), text };
  return text;
}

function isReplyableMessage(m: WAMessage): boolean {
  if (!m.key || !m.key.remoteJid) return false;
  if (m.key.fromMe) return false;
  if (m.key.id?.startsWith('3A')) return false;
  // only personal DMs (skip groups, status, broadcasts)
  if (!m.key.remoteJid.endsWith('@s.whatsapp.net')) return false;
  if (m.messageStubType) return false;
  return true;
}

async function getIncomingText(m: WAMessage): Promise<string> {
  const { text, type } = await messageText(m);
  const t = String(text || '').trim();
  if (!t || type === 'stub' || type === 'unknown' || type === 'locationMessage') return '';
  return t.slice(0, 500);
}

// Per-chat cooldown + one in-flight reply per chat to avoid reply storms.
const autoReplyCooldowns = new Map<string, number>();
const autoReplyInFlight = new Set<string>();
const AUTO_REPLY_COOLDOWN_MS = 60_000;
const AUTO_REPLY_MAX_LEN = 400;

export async function maybeAutoReply(messages: WAMessage[]) {
  if (!bossMode || connectionState !== 'connected' || !sock) return;
  for (const m of messages) {
    if (!isReplyableMessage(m)) continue;
    const jid = m.key!.remoteJid!;
    const now = Date.now();
    const last = autoReplyCooldowns.get(jid) || 0;
    if (now - last < AUTO_REPLY_COOLDOWN_MS || autoReplyInFlight.has(jid)) continue;

    const incoming = await getIncomingText(m);
    if (!incoming) continue;

    autoReplyInFlight.add(jid);
    // Capture BEFORE any further awaits: a user switch during getIncomingText
    // above must not let this reply ride the new user's socket.
    const epoch = sessionEpoch;
    try {
      // mark the message as read
      try {
        if (epoch === sessionEpoch) await sock!.readMessages([m.key!]);
      } catch {
        // ignore
      }

      const kb = await getWhatsAppKnowledgeBase();
      const chatName = displayNameFor(jid);
      const recentList = (waStore.messages.get(jid) || []).slice(-12);
      const recentLines: string[] = [];
      for (const hm of recentList) {
        const line = await formatMessageForContext(hm);
        if (line) recentLines.push(line);
      }

      const ai = await getLocalGemini();
      if (!ai) {
        console.warn('[WhatsApp] Boss Mode: no GEMINI_API_KEY for auto-reply, skipping.');
        autoReplyCooldowns.set(jid, Date.now());
        continue;
      }

      const prompt = `You are replying on WhatsApp IN THE ROLE of "${profile?.name || 'the Boss'}" (Boss Mode). The owner has enabled Boss Mode: you answer incoming WhatsApp messages on their behalf, perfectly mimicking their writing style.

INSTRUCTIONS:
- Reply as the Boss would: match their language, tone, emoji usage, message length, capitalization and punctuation habits exactly.
- Do NOT reveal you are an AI or an assistant. Never say "as an AI" or mention Boss Mode.
- Keep it short and natural, like a real WhatsApp reply. When in doubt, reply briefly.
- Use the Boss's own vocabulary from the knowledge base below.
- If the message needs an answer only the Boss can give, reply as the Boss would handle it (e.g. confirm, defer briefly, ask a short follow-up).
- Output ONLY the reply text. No quotes, no labels, no explanation.

KNOWLEDGE BASE ABOUT THE BOSS:
${kb}

CONVERSATION HISTORY WITH ${chatName}:
${recentLines.join('\n') || '(no prior history)'}

INCOMING MESSAGE FROM ${chatName}:
"${incoming}"

YOUR REPLY:`;

      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });
      const reply = (res?.text || '').trim().replace(/^["']|["']$/g, '');
      if (!reply) {
        console.warn('[WhatsApp] Boss Mode: empty reply generated, skipping.');
        continue;
      }
      const trimmed = reply.slice(0, AUTO_REPLY_MAX_LEN);
      // The user may have switched (or logged out) during the Gemini call —
      // sending on the old socket would reply from the wrong account.
      if (epoch !== sessionEpoch || !sock || connectionState !== 'connected') continue;
      await sock!.sendMessage(jid as any, { text: trimmed } as AnyMessageContent);
      console.log(`[WhatsApp] Boss Mode: replied to ${jid} with ${trimmed.length} chars`);
      autoReplyCooldowns.set(jid, Date.now());
      try {
        broadcast({
          type: 'workspaceOutput',
          tool: 'whatsapp',
          action: 'boss_mode_auto_reply',
          recipient: jid,
          status: 'ok',
          text: trimmed.slice(0, 120),
        });
      } catch {
        // ignore
      }
    } catch (err: any) {
      console.error('[WhatsApp] Boss Mode auto-reply failed:', err?.message || err);
    } finally {
      autoReplyInFlight.delete(jid);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal action runner (capability registry execution)
// ---------------------------------------------------------------------------

export async function runInternalWhatsAppAction(action: string, args: any, ctx: any): Promise<unknown> {
  const entry = WA_INTERNAL_ACTIONS.find((a) => a.id === action);
  if (!entry) return { ok: false, error: `Unknown internal action: ${action}` };
  if (!entry.implemented) {
    return { ok: false, supported: false, error: `Internal action "${action}" is registered but not implemented in this build.` };
  }
  try {
    const s = requireSock();
    switch (action) {
      case 'list_chats':
        return await handleReadWhatsAppChats({ limit: args?.limit }, ctx);
      case 'search_chats': {
        const q = String(args?.query || '');
        const chats = [...waStore.chats.values()]
          .filter((c) => `${c.name} ${c.jid}`.toLowerCase().includes(q.toLowerCase()))
          .slice(0, 20)
          .map((c) => ({ jid: c.jid, name: c.name || c.jid, unread: c.unreadCount }));
        return { ok: true, chats };
      }
      case 'get_contacts':
      case 'search_contacts':
        return await handleGetWhatsAppContacts({ query: args?.query }, ctx);
      case 'get_groups':
        return await handleGetWhatsAppGroups({}, ctx);
      case 'get_group_metadata':
      case 'get_group_members': {
        const gid = String(args?.group || args?.chatId || '');
        if (!gid) return { ok: false, error: 'group is required.' };
        const meta = await s.groupMetadata(gid as any);
        const members = meta.participants.map((p: any) => ({
          jid: p.id,
          name: displayNameFor(p.id),
          admin: p.admin || null,
        }));
        return {
          ok: true,
          jid: meta.id,
          subject: meta.subject,
          description: meta.desc || null,
          owner: meta.owner || null,
          members,
        };
      }
      case 'read_history':
        return await handleGetWhatsAppMessageHistory({ chatId: args?.chatId, limit: args?.limit }, ctx);
      case 'search_messages': {
        const q = String(args?.query || '').toLowerCase();
        const hits: any[] = [];
        for (const [jid, list] of waStore.messages) {
          for (const m of list) {
            const { text } = await messageText(m);
            if (text && text.toLowerCase().includes(q)) {
              hits.push({ chatId: jid, chatName: displayNameFor(jid), id: m.key?.id, fromMe: !!m.key?.fromMe, timestamp: m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : null, text: text.slice(0, 160) });
            }
            if (hits.length >= 20) break;
          }
          if (hits.length >= 20) break;
        }
        return { ok: true, total: hits.length, messages: hits };
      }
      case 'read_attachment':
        return await handleReadWhatsAppAttachment({ messageId: args?.messageId, chatId: args?.chatId }, ctx);
      case 'transcribe_audio':
        return await handleTranscribeWhatsAppAudio({ messageId: args?.messageId, chatId: args?.chatId }, ctx);
      case 'get_calls':
        return await handleGetWhatsAppCalls({}, ctx);
      case 'get_profile_status': {
        const jids = [String(args?.recipient || args?.jid || '')];
        if (!jids[0]) return { ok: false, error: 'recipient is required.' };
        const r = await resolveContact(jids[0]);
        if (!r.ok || !r.jid) return { ok: false, error: r.error };
        const res = await s.fetchStatus(r.jid as any);
        const status = Array.isArray(res) ? res[0] : res;
        return { ok: true, jid: r.jid, name: r.name, status: (status as any)?.status || null };
      }
      case 'get_avatar': {
        const jids = [String(args?.recipient || args?.jid || '')];
        if (!jids[0]) return { ok: false, error: 'recipient is required.' };
        const r = await resolveContact(jids[0]);
        if (!r.ok || !r.jid) return { ok: false, error: r.error };
        const url = await s.profilePictureUrl(r.jid as any, 'image');
        return { ok: true, jid: r.jid, name: r.name, avatarUrl: url || null };
      }
      case 'get_business_profile': {
        const r = await resolveContact(String(args?.recipient || ''));
        if (!r.ok || !r.jid) return { ok: false, error: r.error };
        const bp = await s.getBusinessProfile(r.jid as any);
        return { ok: true, jid: r.jid, profile: bp || null };
      }
      case 'send_text':
        return await handleSendWhatsAppText({ recipient: args?.recipient, text: args?.text }, ctx);
      case 'send_image':
      case 'send_video':
      case 'send_audio':
      case 'send_sticker': {
        const kind = action.replace('send_', '');
        const r = await resolveContact(String(args?.recipient || ''));
        if (!r.ok || !r.jid) return { ok: false, error: r.error };
        let buffer: Buffer;
        if (args?.filePath) {
          const full = path.resolve(String(args.filePath));
          if (!fs.existsSync(full)) return { ok: false, error: `File not found: ${args.filePath}` };
          buffer = fs.readFileSync(full);
        } else if (args?.base64) {
          buffer = Buffer.from(String(args.base64), 'base64');
        } else {
          return { ok: false, error: 'Provide filePath or base64 media data.' };
        }
        const mime = args?.mimeType || (kind === 'image' ? 'image/jpeg' : kind === 'video' ? 'video/mp4' : 'audio/mpeg');
        return await withApproval(ctx, r.jid, action, async () => {
          const content: any = { [kind]: buffer, mimetype: mime, caption: args?.caption };
          if (kind === 'audio' && args?.asVoiceNote) content.ptt = true;
          await s.sendMessage(r.jid as any, content);
          return { ok: true, to: r.name };
        });
      }
      case 'send_document':
        return await handleSendWhatsAppDocument(args, ctx);
      case 'send_contact_card':
        return await handleSendWhatsAppContactCard({ recipient: args?.recipient, name: args?.name, phone: args?.phone }, ctx);
      case 'send_location': {
        const r = await resolveContact(String(args?.recipient || ''));
        if (!r.ok || !r.jid) return { ok: false, error: r.error };
        if (args?.lat == null || args?.lng == null) return { ok: false, error: 'lat and lng are required.' };
        return await withApproval(ctx, r.jid, 'send_location', async () => {
          await s.sendMessage(r.jid as any, {
            location: {
              degreesLatitude: Number(args.lat),
              degreesLongitude: Number(args.lng),
              name: args?.name,
              address: args?.address,
            },
          });
          return { ok: true, to: r.name };
        });
      }
      case 'send_poll': {
        const r = await resolveContact(String(args?.recipient || ''));
        if (!r.ok || !r.jid) return { ok: false, error: r.error };
        if (!args?.name || !Array.isArray(args?.values) || args.values.length === 0) {
          return { ok: false, error: 'name and values (array) are required.' };
        }
        return await withApproval(ctx, r.jid, 'send_poll', async () => {
          await s.sendMessage(r.jid as any, {
            poll: { name: String(args.name), values: args.values.map(String), selectableCount: Number(args.selectableCount) || 1 },
          });
          return { ok: true, to: r.name };
        });
      }
      case 'send_reaction': {
        const r = await resolveContact(String(args?.recipient || ''));
        if (!r.ok || !r.jid) return { ok: false, error: r.error };
        const msg = args?.messageId ? findMessage(r.jid, String(args.messageId)) : null;
        if (!msg?.key) return { ok: false, error: 'messageId is required to react.' };
        return await withApproval(ctx, r.jid, 'send_reaction', async () => {
          await s.sendMessage(r.jid as any, { react: { text: String(args?.emoji || '👍'), key: msgKey(msg) as any } });
          return { ok: true, to: r.name };
        });
      }
      case 'reply_message': {
        const r = await resolveContact(String(args?.recipient || ''));
        if (!r.ok || !r.jid) return { ok: false, error: r.error };
        const msg = args?.messageId ? findMessage(r.jid, String(args.messageId)) : null;
        if (!msg?.message) return { ok: false, error: 'messageId is required to reply.' };
        return await withApproval(ctx, r.jid, 'reply_message', async () => {
          const { getContentType } = await getBaileys();
          const quotedType = getContentType(msg.message);
          await s.sendMessage(r.jid as any, {
            text: String(args?.text || ''),
            contextInfo: {
              stanzaId: msg.key?.id,
              participant: msg.key?.participant,
              remoteJid: msg.key?.remoteJid,
              quotedMessage: { [quotedType as string]: (msg.message as any)[quotedType] },
            },
          });
          return { ok: true, to: r.name };
        });
      }
      case 'forward_message': {
        const to = await resolveContact(String(args?.to || ''));
        if (!to.ok || !to.jid) return { ok: false, error: to.error || 'to is required.' };
        const from = args?.fromChatId ? String(args.fromChatId) : (args?.messageId ? findMessageChat(String(args.messageId)) : null);
        const msg = from ? findMessage(from, String(args?.messageId || '')) : null;
        if (!msg?.key) return { ok: false, error: 'messageId is required to forward.' };
        return await withApproval(ctx, to.jid, 'forward_message', async () => {
          await s.sendMessage(to.jid as any, { forward: msg } as any);
          return { ok: true, to: to.name };
        });
      }
      case 'send_presence_typing': {
        const r = await resolveContact(String(args?.recipient || ''));
        if (!r.ok || !r.jid) return { ok: false, error: r.error };
        await s.sendPresenceUpdate('composing', r.jid as any);
        return { ok: true, typing: true };
      }
      case 'send_buttons': {
        const r = await resolveContact(String(args?.recipient || ''));
        if (!r.ok || !r.jid) return { ok: false, error: r.error };
        if (!args?.text || !Array.isArray(args?.buttons) || args.buttons.length === 0) {
          return { ok: false, error: 'text and buttons (array of labels) are required.' };
        }
        return await withApproval(ctx, r.jid, 'send_buttons', async () => {
          const { proto } = await getBaileys();
          const buttonsMessage = proto.Message.ButtonsMessage.create({
            text: String(args.text),
            buttons: args.buttons.map((b: string, i: number) => ({
              buttonId: `btn_${Date.now()}_${i}`,
              buttonText: { displayText: String(b) },
              type: 1,
            })),
            headerType: 1,
            footerText: args?.footer,
          });
          const msg = proto.Message.create({ buttonsMessage });
          await s.relayMessage(r.jid as any, msg as any, {});
          return { ok: true, to: r.name };
        });
      }
      case 'send_template': {
        const r = await resolveContact(String(args?.recipient || ''));
        if (!r.ok || !r.jid) return { ok: false, error: r.error };
        if (!args?.text || !Array.isArray(args?.buttons) || args.buttons.length === 0) {
          return { ok: false, error: 'text and buttons (array of labels) are required.' };
        }
        return await withApproval(ctx, r.jid, 'send_template', async () => {
          const { proto } = await getBaileys();
          const templateMessage = proto.Message.TemplateMessage.create({
            hydratedTemplate: {
              hydratedContentText: String(args.text),
              hydratedFooterText: args?.footer,
              hydratedButtons: args.buttons.map((b: string, i: number) => ({
                index: i,
                quickReplyButton: { displayText: String(b), id: `q_${Date.now()}_${i}` },
              })),
            },
          });
          const msg = proto.Message.create({ templateMessage });
          await s.relayMessage(r.jid as any, msg as any, {});
          return { ok: true, to: r.name };
        });
      }
      case 'mark_read':
      case 'mark_unread': {
        const chatId = String(args?.chatId || '');
        if (!chatId) return { ok: false, error: 'chatId is required.' };
        if (action === 'mark_read') {
          const list = waStore.messages.get(chatId) || [];
          const unread = list.filter((m) => !m.key?.fromMe).slice(-10);
          const keys = unread.map((m) => msgKey(m));
          if (keys.length) await s.readMessages(keys as any);
          const chat = waStore.chats.get(chatId);
          if (chat) chat.unreadCount = 0;
        } else {
          await s.chatModify({ markRead: false, lastMessages: [] } as any, chatId as any);
        }
        return { ok: true, chatId, chatName: displayNameFor(chatId) };
      }
      case 'star_message':
      case 'unstar_message': {
        const chatId = args?.chatId ? String(args.chatId) : findMessageChat(String(args?.messageId || ''));
        if (!chatId) return { ok: false, error: 'messageId (and chatId if possible) is required.' };
        await s.chatModify(
          { star: { messages: [{ id: String(args.messageId) }], star: action === 'star_message' } } as any,
          chatId as any
        );
        return { ok: true };
      }
      case 'delete_message':
      case 'delete_for_me': {
        const chatId = args?.chatId ? String(args.chatId) : findMessageChat(String(args?.messageId || ''));
        if (!chatId) return { ok: false, error: 'messageId (and chatId if possible) is required.' };
        const msg = findMessage(chatId, String(args?.messageId || ''));
        if (!msg?.key) return { ok: false, error: 'Message not found in stored history.' };
        if (action === 'delete_message') {
          await s.sendMessage(chatId as any, { delete: msgKey(msg) as any });
        } else {
          await s.chatModify(
            {
              deleteForMe: {
                deleteMedia: true,
                key: msgKey(msg),
                timestamp: Number(msg.messageTimestamp || Date.now() / 1000),
              },
            } as any,
            chatId as any
          );
        }
        return { ok: true };
      }
      case 'archive_chat':
      case 'unarchive_chat': {
        const chatId = String(args?.chatId || '');
        if (!chatId) return { ok: false, error: 'chatId is required.' };
        await s.chatModify({ archive: action === 'archive_chat', lastMessages: [] } as any, chatId as any);
        return { ok: true, chatId };
      }
      case 'mute_chat':
      case 'unmute_chat': {
        const chatId = String(args?.chatId || '');
        if (!chatId) return { ok: false, error: 'chatId is required.' };
        const duration = action === 'mute_chat' ? Number(args?.durationMinutes || 480) * 60_000 : null;
        await s.chatModify({ mute: duration } as any, chatId as any);
        const chat = waStore.chats.get(chatId);
        if (chat) chat.muteEndsAt = duration ? Date.now() + duration : null;
        return { ok: true, chatId, muted: action === 'mute_chat' };
      }
      case 'pin_chat':
      case 'unpin_chat': {
        const chatId = String(args?.chatId || '');
        if (!chatId) return { ok: false, error: 'chatId is required.' };
        await s.chatModify({ pin: action === 'pin_chat' } as any, chatId as any);
        const chat = waStore.chats.get(chatId);
        if (chat) chat.pinned = action === 'pin_chat';
        return { ok: true, chatId };
      }
      case 'clear_chat': {
        const chatId = String(args?.chatId || '');
        if (!chatId) return { ok: false, error: 'chatId is required.' };
        await s.chatModify({ clear: true, lastMessages: [] } as any, chatId as any);
        waStore.messages.delete(chatId);
        return { ok: true, chatId };
      }
      case 'delete_chat': {
        const chatId = String(args?.chatId || '');
        if (!chatId) return { ok: false, error: 'chatId is required.' };
        await s.chatModify({ delete: true, lastMessages: [] } as any, chatId as any);
        waStore.messages.delete(chatId);
        waStore.chats.delete(chatId);
        return { ok: true, chatId };
      }
      case 'create_group': {
        const subject = String(args?.subject || '');
        const participants = (await Promise.all((args?.participants || []).map(async (p: string) => (await resolveContact(p)).jid))).filter(Boolean);
        if (!subject) return { ok: false, error: 'subject is required.' };
        if (participants.length === 0) return { ok: false, error: 'At least one participant is required.' };
        const meta = await s.groupCreate(subject, participants as any);
        return { ok: true, jid: meta.id, subject: meta.subject };
      }
      case 'add_participant':
      case 'remove_participant':
      case 'promote_participant':
      case 'demote_participant': {
        const gid = String(args?.group || '');
        if (!gid) return { ok: false, error: 'group is required.' };
        const participants = (await Promise.all((args?.participants || [args?.participant]).map(async (p: string) => (await resolveContact(p)).jid))).filter(Boolean);
        if (participants.length === 0) return { ok: false, error: 'participant(s) are required.' };
        const actionMap: any = {
          add_participant: 'add',
          remove_participant: 'remove',
          promote_participant: 'promote',
          demote_participant: 'demote',
        };
        const res = await s.groupParticipantsUpdate(gid as any, participants as any, actionMap[action]);
        return { ok: true, result: res };
      }
      case 'change_group_subject': {
        const gid = String(args?.group || '');
        if (!gid || !args?.subject) return { ok: false, error: 'group and subject are required.' };
        await s.groupUpdateSubject(gid as any, String(args.subject));
        return { ok: true, group: gid, subject: args.subject };
      }
      case 'change_group_description': {
        const gid = String(args?.group || '');
        if (!gid) return { ok: false, error: 'group is required.' };
        await s.groupUpdateDescription(gid as any, args?.description ? String(args.description) : '');
        return { ok: true, group: gid };
      }
      case 'change_group_picture': {
        const gid = String(args?.group || '');
        if (!gid || (!args?.filePath && !args?.base64)) return { ok: false, error: 'group and filePath/base64 are required.' };
        const buffer = args.filePath ? fs.readFileSync(path.resolve(String(args.filePath))) : Buffer.from(String(args.base64), 'base64');
        await s.updateProfilePicture(gid as any, buffer);
        return { ok: true, group: gid };
      }
      case 'get_invite_code': {
        const gid = String(args?.group || '');
        if (!gid) return { ok: false, error: 'group is required.' };
        const code = await s.groupInviteCode(gid as any);
        return { ok: true, group: gid, inviteLink: code ? `https://chat.whatsapp.com/${code}` : null };
      }
      case 'revoke_invite_code': {
        const gid = String(args?.group || '');
        if (!gid) return { ok: false, error: 'group is required.' };
        const code = await s.groupRevokeInvite(gid as any);
        return { ok: true, group: gid, newInviteLink: code ? `https://chat.whatsapp.com/${code}` : null };
      }
      case 'join_group': {
        const code = String(args?.inviteCode || args?.code || '');
        if (!code) return { ok: false, error: 'inviteCode is required (the part after chat.whatsapp.com/).' };
        const jid = await s.groupAcceptInvite(code);
        return { ok: true, jid };
      }
      case 'leave_group': {
        const gid = String(args?.group || '');
        if (!gid) return { ok: false, error: 'group is required.' };
        await s.groupLeave(gid as any);
        return { ok: true, group: gid };
      }
      case 'group_setting_announce': {
        const gid = String(args?.group || '');
        if (!gid) return { ok: false, error: 'group is required.' };
        const on = args?.on === undefined ? true : !!args.on;
        await s.groupSettingUpdate(gid as any, on ? 'announcement' : 'not_announcement');
        return { ok: true, group: gid, announcementOnly: on };
      }
      case 'group_setting_restrict': {
        const gid = String(args?.group || '');
        if (!gid) return { ok: false, error: 'group is required.' };
        const on = args?.on === undefined ? true : !!args.on;
        await s.groupSettingUpdate(gid as any, on ? 'locked' : 'unlocked');
        return { ok: true, group: gid, restricted: on };
      }
      case 'toggle_disappearing': {
        const chatId = String(args?.chatId || args?.group || '');
        if (!chatId) return { ok: false, error: 'chatId is required.' };
        const duration = Number(args?.durationSeconds || 0);
        await s.groupToggleEphemeral(chatId as any, duration);
        return { ok: true, chatId, durationSeconds: duration };
      }
      case 'block_contact':
        return await handleBlockWhatsAppContact({ recipient: args?.recipient }, ctx);
      case 'unblock_contact':
        return await handleUnblockWhatsAppContact({ recipient: args?.recipient }, ctx);
      case 'set_profile_picture': {
        if (!args?.filePath && !args?.base64) return { ok: false, error: 'filePath or base64 is required.' };
        const buffer = args.filePath ? fs.readFileSync(path.resolve(String(args.filePath))) : Buffer.from(String(args.base64), 'base64');
        const { jidNormalizedUser } = await getBaileys();
        await s.updateProfilePicture(jidNormalizedUser(s.user?.id || ''), buffer);
        return { ok: true };
      }
      case 'set_profile_status': {
        if (!args?.status) return { ok: false, error: 'status text is required.' };
        await s.updateProfileStatus(String(args.status));
        return { ok: true, status: args.status };
      }
      case 'set_push_name': {
        if (!args?.name) return { ok: false, error: 'name is required.' };
        await s.chatModify({ pushNameSetting: String(args.name) } as any, 's.whatsapp.net');
        return { ok: true, name: args.name };
      }
      case 'set_presence_available':
      case 'set_presence_unavailable': {
        await s.sendPresenceUpdate(action === 'set_presence_available' ? 'available' : 'unavailable');
        return { ok: true };
      }
      case 'sync_contacts':
        await s.fetchStatus();
        return { ok: true, note: 'Contact sync requested.' };
      case 'request_history_sync':
        return { ok: true, note: 'History sync is automatic while linked. In-memory store already holds synced chats/messages.' };
      case 'get_privacy_settings': {
        const settings = await s.fetchPrivacySettings();
        return { ok: true, settings };
      }
      case 'get_block_list': {
        const blocklist = await s.fetchBlocklist();
        const contacts = (blocklist || [])
          .filter(Boolean)
          .map((jid: string) => ({ jid, name: displayNameFor(jid) }));
        return { ok: true, total: contacts.length, contacts };
      }
      case 'update_privacy_settings': {
        const updates: string[] = [];
        const allowed = ['all', 'contacts', 'contact_blacklist', 'none', 'match_last_seen', 'known'];
        const val = (v: unknown, fallback: string) => {
          const s2 = String(v ?? '').trim().toLowerCase();
          return allowed.includes(s2) ? s2 : fallback;
        };
        if (args?.lastSeen !== undefined) {
          await s.updateLastSeenPrivacy(val(args.lastSeen, 'all') as any);
          updates.push('lastSeen');
        }
        if (args?.profilePicture !== undefined) {
          await s.updateProfilePicturePrivacy(val(args.profilePicture, 'all') as any);
          updates.push('profilePicture');
        }
        if (args?.status !== undefined) {
          await s.updateStatusPrivacy(val(args.status, 'all') as any);
          updates.push('status');
        }
        if (args?.readReceipts !== undefined) {
          const v2 = String(args.readReceipts).toLowerCase();
          if (!['all', 'contacts'].includes(v2)) return { ok: false, error: 'readReceipts must be all or contacts.' };
          await s.updateMessagesPrivacy(v2 as any);
          updates.push('readReceipts');
        }
        if (updates.length === 0) {
          return {
            ok: false,
            error: 'Provide at least one of: lastSeen, profilePicture, status (all|contacts|contact_blacklist|none), readReceipts (all|contacts).',
          };
        }
        return { ok: true, updated: updates };
      }
      case 'logout':
        return await logoutWhatsApp();
      case 'reset':
        return await resetWhatsApp();
      case 'get_knowledge_base':
        return { ok: true, knowledgeBase: await getWhatsAppKnowledgeBase(true), bossMode: getBossMode() };
      case 'set_boss_mode': {
        if (connectionState !== 'connected') return { ok: false, error: 'WhatsApp is not connected.' };
        const enabled = args?.enabled === undefined ? !bossMode : !!args.enabled;
        const state = setBossMode(enabled);
        return { ok: true, bossMode: state };
      }
      default:
        return { ok: false, error: `Action "${action}" has no runner.` };
    }
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

function findMessageChat(messageId: string): string | null {
  for (const [jid, list] of waStore.messages) {
    if (list.some((m) => m.key?.id === messageId)) return jid;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Graceful shutdown flush
// ---------------------------------------------------------------------------

// persistStore is debounced 4s behind schedulePersist(); without this, a
// restart (systemd sends SIGTERM on `systemctl restart`) in the debounce
// window silently drops the newest messages/chats from the persisted store.
let shuttingDown = false;
async function flushStoreOnShutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopHeartbeat();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    await persistStore();
  } catch (err: any) {
    console.error('[WhatsApp] Shutdown persist failed:', err?.message || err);
  }
}

function handleShutdown(signal: string) {
  // Bound the flush (e.g. RTDB hanging) so shutdown never stalls forever.
  const guard = setTimeout(() => process.exit(0), 5000);
  guard.unref?.();
  flushStoreOnShutdown().finally(() => process.exit(0));
}
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

// auto-init on import (resumes existing session; does not block server boot).
// Tests set WHATSAPP_AUTO_INIT=0 so importing the module (via toolRegistry)
// doesn't start Baileys/RTDB connections and leave reconnect timers running.
if (process.env.WHATSAPP_AUTO_INIT !== '0') {
  initWhatsAppSession().catch((err: any) => {
    console.error('[WhatsApp] Auto-init failed:', err.message);
  });
}
