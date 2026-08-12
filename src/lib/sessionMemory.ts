import { BeatriceConfig, TranscriptItem } from '../types';

const CONFIG_KEY = 'beatrice_oss_config_v1';
const TRANSCRIPTS_KEY = 'beatrice_oss_transcripts_v1';
const META_KEY = 'beatrice_oss_session_meta_v1';
const MAX_LOCAL_TURNS = 40;

export interface SessionMeta {
  lastInteractionAt: number;
  conversationSummary: string;
  preferredLanguage: string;
}

export function loadLocalConfig(defaults: BeatriceConfig): BeatriceConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<BeatriceConfig>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function saveLocalConfig(config: BeatriceConfig) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // ignore quota
  }
}

export function loadLocalTranscripts(): TranscriptItem[] {
  try {
    const raw = localStorage.getItem(TRANSCRIPTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TranscriptItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && t.role && t.text)
      .slice(-MAX_LOCAL_TURNS);
  } catch {
    return [];
  }
}

export function saveLocalTranscripts(items: TranscriptItem[]) {
  try {
    const cleaned = items
      .filter((t) => t.role !== 'system' || !String(t.text || '').startsWith('Connection lost'))
      .filter((t) => t.role !== 'system' || !String(t.text || '').includes('Automatically reconnecting'))
      .slice(-MAX_LOCAL_TURNS);
    localStorage.setItem(TRANSCRIPTS_KEY, JSON.stringify(cleaned));
  } catch {
    // ignore
  }
}

export function loadSessionMeta(): SessionMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) {
      return { lastInteractionAt: 0, conversationSummary: '', preferredLanguage: 'auto' };
    }
    return JSON.parse(raw) as SessionMeta;
  } catch {
    return { lastInteractionAt: 0, conversationSummary: '', preferredLanguage: 'auto' };
  }
}

export function saveSessionMeta(meta: Partial<SessionMeta>) {
  try {
    const prev = loadSessionMeta();
    localStorage.setItem(META_KEY, JSON.stringify({ ...prev, ...meta }));
  } catch {
    // ignore
  }
}

export function buildConversationSummary(transcripts: TranscriptItem[]): string {
  const dialogue = transcripts.filter((t) => t.role === 'user' || t.role === 'model');
  if (dialogue.length === 0) return '';
  const recent = dialogue.slice(-12);
  return recent
    .map((t) => `${t.role === 'user' ? 'USER' : 'BEATRICE'}: ${String(t.text || '').slice(0, 180)}`)
    .join('\n');
}

export function formatElapsed(msAgo: number): string {
  if (!msAgo || msAgo <= 0) return 'no previous conversation';
  const mins = Math.floor(msAgo / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
