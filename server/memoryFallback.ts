import fs from 'fs';
import path from 'path';

interface FallbackMessage {
  role: string;
  content: string;
  timestamp?: string;
}

interface FallbackEntry {
  id: string;
  session_id: string;
  messages: FallbackMessage[];
  ts: number;
}

interface FallbackStore {
  entries: FallbackEntry[];
  lastProfile: unknown | null;
}

export interface FallbackRecallResult {
  id: string;
  session_id: string;
  ts: number;
  score: number;
  snippet: string;
  messages: FallbackMessage[];
}

const EMPTY_STORE: FallbackStore = { entries: [], lastProfile: null };

let cachedStore: FallbackStore | null = null;

function storeFile(): string {
  return process.env.MEMORY_FALLBACK_FILE || path.join(process.cwd(), 'data', 'memory-fallback.json');
}

function loadStore(): FallbackStore {
  if (cachedStore) return cachedStore;
  try {
    const raw = fs.readFileSync(storeFile(), 'utf8');
    cachedStore = { ...EMPTY_STORE, ...JSON.parse(raw) };
  } catch {
    cachedStore = { ...EMPTY_STORE };
  }
  return cachedStore;
}

function saveStore(): void {
  const file = storeFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(loadStore(), null, 2));
  } catch (err: any) {
    process.emitWarning(`memory fallback store write failed: ${err?.message || err}`);
  }
}

function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00e0-\u00ff\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function docTokens(entry: FallbackEntry): string[] {
  return entry.messages.flatMap((m) => tokenize(m.content));
}

function entrySnippet(entry: FallbackEntry): string {
  return entry.messages
    .map((m) => `${m.role}: ${(m.content || '').slice(0, 200)}`)
    .join(' | ')
    .slice(0, 500);
}

export function fallbackRemember(session_id: string | undefined, messages: FallbackMessage[] | undefined): string {
  const store = loadStore();
  const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  store.entries.push({
    id,
    session_id: session_id || 'default',
    messages: Array.isArray(messages) ? messages : [],
    ts: Date.now(),
  });
  if (store.entries.length > 1000) store.entries.splice(0, store.entries.length - 1000);
  saveStore();
  return id;
}

export function fallbackRecall(query: string | undefined, limit = 5, session_id?: string): FallbackRecallResult[] {
  const store = loadStore();
  const qTokens = tokenize(query || '');
  if (qTokens.length === 0) return [];
  const docs = store.entries
    .filter((e) => !session_id || e.session_id === session_id)
    .map((e) => ({ entry: e, tokens: docTokens(e) }));
  if (docs.length === 0) return [];

  const docFreq = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(d.tokens)) docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }
  const N = docs.length;
  const avgDl = docs.reduce((s, d) => s + d.tokens.length, 0) / N || 1;
  const K1 = 1.5;
  const B = 0.75;

  const scored = docs
    .map((d) => {
      const tf = new Map<string, number>();
      for (const t of d.tokens) tf.set(t, (tf.get(t) || 0) + 1);
      const dl = d.tokens.length;
      let score = 0;
      for (const t of qTokens) {
        const df = docFreq.get(t) || 0;
        if (df === 0) continue;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const f = tf.get(t) || 0;
        score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * dl) / avgDl)));
      }
      return { entry: d.entry, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((r) => ({
    id: r.entry.id,
    session_id: r.entry.session_id,
    ts: r.entry.ts,
    score: Number(r.score.toFixed(4)),
    snippet: entrySnippet(r.entry),
    messages: r.entry.messages,
  }));
}

export function cacheCoreMemory(profile: unknown): void {
  const store = loadStore();
  store.lastProfile = profile;
  saveStore();
}

export function fallbackCoreRead(): { cached: unknown | null; note: string } {
  const store = loadStore();
  if (store.lastProfile !== null && store.lastProfile !== undefined) {
    return { cached: store.lastProfile, note: 'served from local cache (gateway unreachable)' };
  }
  return { cached: null, note: 'no cached core memory profile available yet' };
}

export function memoryFallbackStats(): { entries: number; file: string } {
  return { entries: loadStore().entries.length, file: storeFile() };
}

export function resetMemoryFallbackCache(): void {
  cachedStore = null;
}