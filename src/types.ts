export type VoiceName = 'Aoede' | 'Zephyr' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir';

export const VOICE_NAMES: VoiceName[] = ['Aoede', 'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir'];

export const VOICE_ALIASES: Record<VoiceName, string> = {
  Aoede: 'Athena',
  Zephyr: 'Artemis',
  Puck: 'Hermes',
  Charon: 'Hades',
  Kore: 'Persephone',
  Fenrir: 'Ares',
};

export const voiceAlias = (voice: VoiceName): string => VOICE_ALIASES[voice] || voice;

export type SessionStatus = 'disconnected' | 'connecting' | 'connected' | 'speaking' | 'listening' | 'error';

export type DeviceType = 'mobile' | 'desktop';

export interface TerminalInfo {
  host: string;
  port: number;
  user: string;
  sshUrl: string;
}

export interface AudioVisualizerData {
  inputVolume: number;
  outputVolume: number;
  inputFrequencies: Uint8Array;
  outputFrequencies: Uint8Array;
}

export interface AttachmentInfo {
  name: string;
  type: 'image' | 'file';
  mimeType: string;
  dataUrl?: string;
  base64?: string;
  text?: string;
}

export interface TranscriptItem {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
  isPartial?: boolean;
  attachments?: AttachmentInfo[];
}

export interface ToolCallLog {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: 'pending' | 'executing' | 'completed' | 'error';
  timestamp: number;
  durationMs?: number;
}

export interface CodeSandboxRun {
  id: string;
  language: string;
  code: string;
  output: string;
  error?: string;
  timestamp: number;
  stream?: string;
  done?: boolean;
  previewUrl?: string;
}

export interface CliCommandRun {
  id: string;
  command: string;
  cwd?: string;
  output: string;
  exitCode: number;
  timestamp: number;
  stream?: string;
  done?: boolean;
}

export interface AgentTask {
  id: string;
  agentName: string;
  task: string;
  status: 'idle' | 'thinking' | 'executing' | 'completed' | 'failed';
  progress: number; // 0-100
  logs: string[];
  result?: string;
  timestamp: number;
}

export interface CodingAgentSession {
  id: string;
  task: string;
  cwd: string;
  status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  log: string[];
  output: string;
  error?: string;
  timestamp: number;
}

export interface RealtimeEvent {
  event: string;
  data: Record<string, unknown>;
  timestamp: number;
  done?: boolean;
}

export interface BrowserStreamSession {
  id: string;
  url?: string;
  title?: string;
  log: string[];
  events: RealtimeEvent[];
  lastScreenshot?: string;
  timestamp: number;
}

export interface VideoGenerationTask {
  id: string;
  dashTaskId?: string;
  requestId?: string;
  prompt: string;
  status: string;
  progress: number;
  videoUrl?: string;
  error?: string;
  timestamp: number;
}

export interface QwenCloudTask {
  id: string;
  kind: 'chat' | 'image' | 'imageEdit' | 'video' | 'tts';
  dashTaskId?: string;
  requestId?: string;
  prompt: string;
  status: string;
  progress: number;
  urls?: string[];
  audioUrl?: string;
  result?: string;
  error?: string;
  timestamp: number;
}

export interface ComputerStreamSession {
  id: string;
  cwd: string;
  log: string[];
  events: RealtimeEvent[];
  screenshot?: string;
  screenshotMime?: string;
  apps?: string[];
  timestamp: number;
}

export interface CanvasContent {
  type: 'diagram' | 'markdown' | 'chart' | 'code_snippet';
  title: string;
  content: string; // Markdown text, mermaid graph, JSON data, or code
  updatedAt: number;
}

export interface BeatriceConfig {
  voiceName: VoiceName;
  systemInstruction: string;
  preferredLanguage: string; // BCP-47 / plain name, e.g. 'en', 'nl', 'fr', 'tl', 'auto'
  enableVideo: boolean;
  videoFps: number;
  enableSandboxTool: boolean;
  enableCliTool: boolean;
  enableAgentTool: boolean;
  enableWebSearchTool: boolean;
  enableWeatherTool: boolean;
  enableCanvasTool: boolean;
  enableBrowserTool: boolean;
  enableComputerTool: boolean;
  enableVideoTool?: boolean;
  enableQwenCloudTool?: boolean;
}

export interface SessionBootstrap {
  preferredLanguage: string;
  voiceName: VoiceName;
  systemInstruction?: string;
  conversationSummary?: string;
  recentTurns?: { role: 'user' | 'model' | 'system'; text: string; timestamp: number }[];
  lastInteractionAt?: number;
  userDisplayName?: string;
  deviceType?: DeviceType;
}

export type WsClientMessage =
  | { type: 'audio'; audio: string } // Base64 16kHz PCM Little Endian
  | { type: 'video'; video: string } // Base64 JPEG frame
  | { type: 'text'; text: string; attachment?: AttachmentInfo }
  | { type: 'attachment'; data: string; mimeType: string; fileName?: string; text?: string }
  | { type: 'interrupt' }
  | { type: 'config'; config: Partial<BeatriceConfig> }
  | { type: 'toolResponse'; id: string; name: string; response: unknown }
  | { type: 'runSandbox'; code: string; language: string }
  | { type: 'runCli'; command: string }
  | { type: 'runSandboxStream'; runId?: string; code: string; language: string }
  | { type: 'runCliStream'; sessionId?: string; startSession?: boolean; command: string; cwd?: string }
  | { type: 'runBrowser'; sessionId?: string; action: string; payload: Record<string, unknown> }
  | { type: 'runComputer'; sessionId?: string; action: string; payload: Record<string, unknown> }
  | { type: 'runCodingAgent'; sessionId?: string; task: string; cwd?: string }
  | { type: 'cancelCodingAgent'; sessionId: string }
  | { type: 'sessionBootstrap'; bootstrap: SessionBootstrap }
  | { type: 'restartLive' }
  | { type: 'updateSessionPrefs'; preferredLanguage?: string; voiceName?: VoiceName };

export type WsServerMessage =
  | { type: 'status'; status: SessionStatus; message?: string }
  | { type: 'audio'; audio: string } // Base64 24kHz PCM Little Endian
  | { type: 'interrupted' }
  | { type: 'turnComplete' }
  | { type: 'transcript'; role: 'user' | 'model'; text: string; isPartial?: boolean }
  | { type: 'toolCall'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'toolResult'; id: string; name: string; result: unknown }
  | { type: 'sandboxOutput'; run: CodeSandboxRun }
  | { type: 'cliOutput'; run: CliCommandRun }
  | { type: 'agentUpdate'; agent: AgentTask }
  | { type: 'canvasUpdate'; canvas: CanvasContent }
  | { type: 'videoGenerationUpdate'; task: VideoGenerationTask }
  | { type: 'qwencloudUpdate'; task: QwenCloudTask }
  | { type: 'sandboxStream'; runId: string; chunk: string; done: boolean; error?: string; previewUrl?: string }
  | { type: 'cliStream'; sessionId: string; chunk: string; done: boolean; exitCode?: number; error?: string }
  | { type: 'browserUpdate'; sessionId: string; event: string; done: boolean; [key: string]: unknown }
  | { type: 'computerUpdate'; sessionId: string; event: string; done: boolean; [key: string]: unknown }
  | { type: 'codingAgentUpdate'; session: CodingAgentSession }
  | { type: 'codingAgentStream'; sessionId: string; chunk: string; done: boolean; error?: string }
  | { type: 'whatsappStatus'; status: string; connected: boolean; pairingCode?: string | null; qrDataUrl?: string | null; error?: string | null; reconnectAttempt?: number; profile?: { name: string | null; phone: string | null; avatarUrl: string | null } | null; bossMode?: boolean }
  | { type: 'whatsappApprovalRequest'; id: string; recipient: string; recipientName?: string; purpose?: string }
  | { type: 'whatsappIncomingMessages'; messages: { id?: string; chatJid?: string; chatName?: string; fromMe?: boolean; sender?: string; timestamp?: number | null; type?: string; text?: string }[] }
  | { type: 'terminalOpen'; deviceType: DeviceType; mode: 'browser' | 'termius'; sshUrl?: string; host?: string; port?: number; user?: string; command?: string }
  | { type: 'error'; message: string };

export interface ContextWindowConfig {
  maxContextTokens: number; // e.g. 128000
  autoPruneThreshold: number; // e.g. 0.8 (80%)
  compressionMode: 'auto_summarize' | 'sliding_window' | 'manual';
  memoryRetentionTurns: number; // e.g. 20
}

export interface ConversationMemoryState {
  totalEstimatedTokens: number;
  activeTurnsCount: number;
  compressedSummary: string;
  summaryLastUpdated?: number;
  pruneCount: number;
}
