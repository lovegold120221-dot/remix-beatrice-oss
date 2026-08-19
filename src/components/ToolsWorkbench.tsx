import React, { useState } from 'react';
import { GoogleFormsTool } from './GoogleFormsTool';
import { GmailTool } from './GmailTool';
import { ContactsTool } from './ContactsTool';
import {
  AgentTask,
  BrowserStreamSession,
  CanvasContent,
  CliCommandRun,
  CodeSandboxRun,
  CodingAgentSession,
  ComputerStreamSession,
  QwenCloudTask,
  ToolCallLog,
  VideoGenerationTask,
} from '../types';
import {
  Bot,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Code2,
  Cpu,
  FileText,
  Film,
  Folder,
  Globe,
  Layout,
  Mail,
  Monitor,
  Play,
  Presentation,
  RotateCw,
  Table,
  Terminal,
  Users,
  Video,
  Wrench,
  Download,
  Loader2,
} from 'lucide-react';

// Human-friendly label for an in-flight video/media task status.
export const statusLabel = (status: string, kind?: string): string => {
  switch (status) {
    case 'submitting':
      return 'Submitting to render engine…';
    case 'queued':
      return 'Queued — waiting for a render slot…';
    case 'running':
    case 'processing':
    case 'pending':
      return kind === 'video' ? 'Rendering your video…' : 'Working…';
    case 'started':
      return 'Starting up…';
    case 'timeout':
      return 'Taking longer than expected…';
    default:
      return status;
  }
};

// Download the actual file (blob) instead of opening the URL in a tab.
// Falls back to opening the URL if the fetch is blocked by CORS.
export const downloadFile = async (url: string, filename: string) => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  } catch (err) {
    console.warn('Direct download failed, opening in new tab instead:', err);
    window.open(url, '_blank');
  }
};

// Animated 16:9 placeholder shown while a video is being generated.
export const VideoLoading: React.FC<{ status: string; progress: number; kind?: string }> = ({ status, progress }) => (
  <div className="relative aspect-video rounded-lg overflow-hidden border border-white/10 bg-gradient-to-br from-[#0a0a0c] via-[#121215] to-[#0a0a0c]">
    <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-[#00f2fe]/10 to-transparent" />
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
      <div className="relative flex items-center justify-center">
        <div className="absolute w-12 h-12 rounded-full bg-[#00f2fe]/25 blur-md animate-ping" />
        <Loader2 className="w-7 h-7 text-[#00f2fe] animate-spin relative" />
      </div>
      <span className="text-[10px] font-medium text-[#8e8e93]">{statusLabel(status, 'video')}</span>
      <span className="text-[10px] font-mono text-[#00f2fe]">{Math.min(100, Math.max(0, progress))}%</span>
    </div>
    <div className="absolute bottom-0 inset-x-0 h-1 bg-[#121215]">
      <div className="h-full bg-gradient-to-r from-[#00f2fe] to-[#4facfe] transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
    </div>
  </div>
);

// Responsive media frame: full width on phones, centered cap on larger screens.
export const MediaFrame: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={`mx-auto w-full max-w-full sm:max-w-2xl lg:max-w-3xl ${className || ''}`}>{children}</div>
);

interface ToolsWorkbenchProps {
  toolLogs: ToolCallLog[];
  sandboxRuns: CodeSandboxRun[];
  cliRuns: CliCommandRun[];
  agentTasks: AgentTask[];
  canvasData: CanvasContent | null;
  browserSessions: BrowserStreamSession[];
  computerSessions: ComputerStreamSession[];
  codingAgentSessions: CodingAgentSession[];
  videoTasks: VideoGenerationTask[];
  qwenTasks: QwenCloudTask[];
  onRunSandbox: (code: string, language: string) => void;
  onRunCli: (command: string) => void;
  onRunSandboxStream?: (code: string, language: string) => void;
  onRunCliStream?: (command: string, cwd?: string) => void;
  onRunBrowser?: (action: string, payload: Record<string, unknown>) => void;
  onRunComputer?: (action: string, payload: Record<string, unknown>) => void;
  onRunCodingAgent?: (task: string, cwd?: string) => void;
  onCancelCodingAgent?: (sessionId: string) => void;
  onGenerateVideo?: (params: { prompt: string; resolution?: string; ratio?: string; duration?: number }) => void;
  onQwenCloud?: (kind: string, params: Record<string, unknown>) => void;
  onDeployAgent?: (agentName: string, task: string) => void;
  onGetSystemInfo?: () => void;
  onUpdateCanvas?: (canvasType: 'diagram' | 'markdown' | 'chart' | 'code_snippet', title: string, content: string) => void;
  onGetWeather?: (location: string) => void;
  onWebSearch?: (query: string) => void;
}

export const ToolsWorkbench: React.FC<ToolsWorkbenchProps> = ({
  toolLogs,
  sandboxRuns,
  cliRuns,
  agentTasks,
  canvasData,
  browserSessions,
  computerSessions,
  codingAgentSessions,
  videoTasks,
  qwenTasks,
  onRunSandbox,
  onRunCli,
  onRunSandboxStream,
  onRunCliStream,
  onRunBrowser,
  onRunComputer,
  onRunCodingAgent,
  onCancelCodingAgent,
  onGenerateVideo,
  onQwenCloud,
  onDeployAgent,
  onGetSystemInfo,
  onUpdateCanvas,
  onGetWeather,
  onWebSearch,
}) => {
  const [activeTab, setActiveTab] = useState<
    'tools' | 'workspace' | 'gmail' | 'contacts' | 'forms' | 'sandbox' | 'cli' | 'agents' | 'canvas' | 'browser' | 'computer' | 'codingAgent' | 'video' | 'qwencloud'
  >('tools');

  // Google Workspace form state
  const [meetTitle, setMeetTitle] = useState<string>('Eburon AI Strategy & Google Meet Sync');
  const [meetLink, setMeetLink] = useState<string>('');
  const [meetCreating, setMeetCreating] = useState(false);
  const [meetError, setMeetError] = useState<string | null>(null);

  const createGoogleMeet = async () => {
    setMeetCreating(true);
    setMeetError(null);
    try {
      // Create a REAL Google Meet via the server → Google Calendar API. Never
      // fabricate a meet.google.com URL locally.
      const res = await fetch('/api/workspace/meet/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: meetTitle || 'Beatrice AI Strategy Session' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error || !data?.meetingUri) {
        setMeetError(data?.error || `Could not create meeting (HTTP ${res.status})`);
        setMeetLink('');
        return;
      }
      setMeetLink(data.meetingUri);
    } catch (err: any) {
      setMeetError(err?.message || 'Could not create the meeting — Google Calendar is unavailable.');
      setMeetLink('');
    } finally {
      setMeetCreating(false);
    }
  };
  const [gmailTo, setGmailTo] = useState<string>('team@eburon.ai');
  const [gmailSub, setGmailSub] = useState<string>('Beatrice OSS System Update');
  const [gmailBody, setGmailBody] = useState<string>('Hello,\n\nBeatrice AI Voice Assistant has integrated Google Workspace & Meet services.\n\nBest regards,\nBeatrice AI');
  const [docTitle, setDocTitle] = useState<string>('Beatrice Google Workspace Notes');
  const [docContent, setDocContent] = useState<string>('Executive Summary:\nGoogle Meet and Workspace integration active with OAuth 2.0.');

  // Custom sandbox editor states
  const [sandboxCode, setSandboxCode] = useState<string>(
    `// Beatrice OSS Interactive Code Sandbox\nfunction calculateFibonacci(n) {\n  let a = 0, b = 1;\n  const seq = [a];\n  for (let i = 1; i < n; i++) {\n    seq.push(b);\n    let temp = a + b;\n    a = b;\n    b = temp;\n  }\n  return seq;\n}\n\nconsole.log("Fibonacci Sequence:", calculateFibonacci(10));`
  );
  const [sandboxLang, setSandboxLang] = useState<string>('javascript');

  // Custom CLI command state
  const [cliCmd, setCliCmd] = useState<string>('git status');

  // Agent Form State
  const [customAgentName, setCustomAgentName] = useState<string>('Code Auditor');
  const [customAgentTask, setCustomAgentTask] = useState<string>('Inspect backend endpoints and verify system health.');

  // Canvas Form State
  const [customCanvasTitle, setCustomCanvasTitle] = useState<string>('Beatrice OSS System Architecture');
  const [customCanvasType, setCustomCanvasType] = useState<'diagram' | 'markdown' | 'chart' | 'code_snippet'>('diagram');
  const [customCanvasContent, setCustomCanvasContent] = useState<string>('graph TD;\n A[User Voice/Video Feed] -->|WebSocket| B[Beatrice Express Server];\n B -->|Live Audio Stream| C[Eburon Live];\n B -->|Function Calls| D[Sandbox / Terminal / Tools];\n B -->|Sync Logs| E[Realtime Database];');

  // Search/Weather Quick States
  const [searchQuery, setSearchQuery] = useState<string>('Eburon Live API features');
  const [weatherLocation, setWeatherLocation] = useState<string>('San Francisco');

  // Coding Agent form state
  const [codingAgentTask, setCodingAgentTask] = useState<string>('Add a dark mode toggle to the SettingsModal component');
  const [codingAgentCwd, setCodingAgentCwd] = useState<string>('');

  // Browser automation state
  const [browserUrl, setBrowserUrl] = useState<string>('https://oss.eburon.ai');
  const [browserSelector, setBrowserSelector] = useState<string>('body');
  const [browserTypeText, setBrowserTypeText] = useState<string>('Beatrice');

  // Computer control state
  const [computerCommand, setComputerCommand] = useState<string>('ls -la');
  const [computerCwd, setComputerCwd] = useState<string>('/root/remix-beatrice-oss');

  // Video generation state
  const [videoPrompt, setVideoPrompt] = useState<string>(
    'A thrilling detective chase story with cinematic storytelling. Shot 1 [0–3 s]: Wide shot of a rainy New York street at night, neon lights flickering, a detective in a black trench coat walking briskly. Shot 2 [3–6 s]: Medium shot of the detective entering an old building, rain soaking his coat, the door closing slowly behind him.'
  );
  const [videoResolution, setVideoResolution] = useState<string>('720P');
  const [videoRatio, setVideoRatio] = useState<string>('16:9');
  const [videoDuration, setVideoDuration] = useState<number>(15);

  // QwenCloud state
  const [qwenTab, setQwenTab] = useState<'chat' | 'image' | 'imageEdit' | 'video' | 'tts'>('image');
  const [qwenPrompt, setQwenPrompt] = useState<string>('A futuristic city at sunset with neon lights');
  const [qwenSystem, setQwenSystem] = useState<string>('');
  const [qwenModel, setQwenModel] = useState<string>('qwen3.7-plus');
  const [qwenSize, setQwenSize] = useState<string>('2K');
  const [qwenResolution, setQwenResolution] = useState<string>('720P');
  const [qwenRatio, setQwenRatio] = useState<string>('16:9');
  const [qwenDuration, setQwenDuration] = useState<number>(15);
  const [qwenImages, setQwenImages] = useState<string>('');
  const [qwenVoice, setQwenVoice] = useState<string>('Cherry');

  return (
    <div className="flex flex-col h-full b-panel">
      {/* Workbench Header Tabs */}
      <div className="flex items-center gap-2 p-3 bg-black/50 border-b border-white/10 overflow-x-auto scrollbar-hide">
        <button
          onClick={() => setActiveTab('tools')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border ${
            activeTab === 'tools'
              ? 'bg-[#4facfe]/15 text-[#00f2fe] border-[#4facfe]/40'
              : 'text-zinc-400 hover:text-zinc-200 border-transparent hover:bg-white/5'
          }`}
        >
          <Wrench className="w-3.5 h-3.5" />
          <span>Function Calls</span>
          {toolLogs.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[#00f2fe]/25 text-[10px] text-[#00f2fe] font-bold">
              {toolLogs.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('workspace')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'workspace'
              ? 'bg-[#4facfe]/15 text-[#4facfe] border border-[#4facfe]/40'
              : 'text-[#8e8e93] hover:text-zinc-200 hover:bg-[#121215]'
          }`}
        >
          <Video className="w-3.5 h-3.5 text-emerald-400" />
          <span>Google Workspace & Meet</span>
        </button>

        <button
          onClick={() => setActiveTab('gmail')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'gmail'
              ? 'bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/40'
              : 'text-[#8e8e93] hover:text-zinc-200 hover:bg-[#121215]'
          }`}
        >
          <Mail className="w-3.5 h-3.5 text-[#00f2fe]" />
          <span>Gmail</span>
        </button>

        <button
          onClick={() => setActiveTab('contacts')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'contacts'
              ? 'bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/40'
              : 'text-[#8e8e93] hover:text-zinc-200 hover:bg-[#121215]'
          }`}
        >
          <Users className="w-3.5 h-3.5 text-[#00f2fe]" />
          <span>Contacts</span>
        </button>

        <button
          onClick={() => setActiveTab('forms')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'forms'
              ? 'bg-[#4facfe]/15 text-[#4facfe] border border-[#4facfe]/40'
              : 'text-[#8e8e93] hover:text-zinc-200 hover:bg-[#121215]'
          }`}
        >
          <FileText className="w-3.5 h-3.5 text-[#4facfe]" />
          <span>Google Forms</span>
        </button>

        <button
          onClick={() => setActiveTab('sandbox')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'sandbox'
              ? 'bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/40'
              : 'text-[#8e8e93] hover:text-zinc-200 hover:bg-[#121215]'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>Code Sandbox</span>
          {sandboxRuns.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[#00f2fe]/25 text-[10px] text-[#00f2fe] font-bold">
              {sandboxRuns.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('cli')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'cli'
              ? 'bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/40'
              : 'text-[#8e8e93] hover:text-zinc-200 hover:bg-[#121215]'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Terminal CLI</span>
          {cliRuns.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[#00f2fe]/25 text-[10px] text-[#00f2fe] font-bold">
              {cliRuns.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('agents')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'agents'
              ? 'bg-[#4facfe]/15 text-[#4facfe] border border-[#4facfe]/40'
              : 'text-[#8e8e93] hover:text-zinc-200 hover:bg-[#121215]'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>Sub-Agents</span>
          {agentTasks.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[#4facfe]/25 text-[10px] text-[#4facfe] font-bold">
              {agentTasks.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('canvas')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'canvas'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              : 'text-[#8e8e93] hover:text-zinc-200 hover:bg-[#121215]'
          }`}
        >
          <Layout className="w-3.5 h-3.5" />
          <span>Canvas View</span>
          {canvasData && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('browser')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'browser'
              ? 'bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/40'
              : 'text-[#8e8e93] hover:text-zinc-200 hover:bg-[#121215]'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Web Use</span>
          {browserSessions.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[#00f2fe]/25 text-[10px] text-[#00f2fe] font-bold">
              {browserSessions.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('computer')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'computer'
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
              : 'text-[#8e8e93] hover:text-zinc-200 hover:bg-[#121215]'
          }`}
        >
          <Monitor className="w-3.5 h-3.5" />
          <span>Computer Use</span>
          {computerSessions.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-rose-500/30 text-[10px] text-rose-200 font-bold">
              {computerSessions.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('codingAgent')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'codingAgent'
              ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40'
              : 'text-[#8e8e93] hover:text-zinc-200 hover:bg-[#121215]'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>Coding Agent</span>
          {codingAgentSessions.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-violet-500/30 text-[10px] text-violet-200 font-bold">
              {codingAgentSessions.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('video')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'video'
              ? 'bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/40'
              : 'text-[#8e8e93] hover:text-zinc-200 hover:bg-[#121215]'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          <span>Video</span>
          {videoTasks.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[#4facfe]/25 text-[10px] text-[#00f2fe] font-bold">
              {videoTasks.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('qwencloud')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
            activeTab === 'qwencloud'
              ? 'bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/40'
              : 'text-[#8e8e93] hover:text-zinc-200 hover:bg-[#121215]'
          }`}
        >
          <Cloud className="w-3.5 h-3.5" />
          <span>Media Studio</span>
          {qwenTasks.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[#00f2fe]/25 text-[10px] text-[#00f2fe] font-bold">
              {qwenTasks.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab Content Panels */}
      <div className="flex-1 p-4 overflow-y-auto font-sans">
        {/* TAB 1: FUNCTION CALL STREAM */}
        {activeTab === 'tools' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-[#8e8e93] pb-2 border-b border-white/10">
              <span className="font-medium">Live Tool Invocations</span>
              <span>Eburon Function Calling Engine</span>
            </div>

            {/* Quick Manual Tool Execution Toolbar */}
            <div className="p-3 rounded-xl bg-black/80 border border-white/10 space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8e8e93] block">
                Quick Manual Tool Triggers:
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onGetSystemInfo?.()}
                  className="px-2.5 py-1.5 rounded-lg bg-[#00f2fe]/10 hover:bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/30 flex items-center gap-1.5 text-xs font-medium transition-all"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Get System Info</span>
                </button>

                <button
                  onClick={() => onGetWeather?.(weatherLocation)}
                  className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-[#00f2fe]/30 flex items-center gap-1.5 text-xs font-medium transition-all"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Get Weather</span>
                </button>

                <button
                  onClick={() => onWebSearch?.(searchQuery)}
                  className="px-2.5 py-1.5 rounded-lg bg-[#00f2fe]/10 hover:bg-[#00f2fe]/20 text-[#00f2fe] border border-[#00f2fe]/30 flex items-center gap-1.5 text-xs font-medium transition-all"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Live Web Search</span>
                </button>

                <button
                  onClick={() => onUpdateCanvas?.('diagram', 'Architecture Flow', 'graph TD;\n A[Voice Feed] --> B[Eburon Live];\n B --> C[Function Tools];')}
                  className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1.5 text-xs font-medium transition-all"
                >
                  <Layout className="w-3.5 h-3.5" />
                  <span>Update Canvas</span>
                </button>
              </div>
            </div>

            {toolLogs.length === 0 ? (
              <div className="py-8 flex flex-col items-center justify-center text-center text-[#8e8e93]">
                <Wrench className="w-8 h-8 text-zinc-700 mb-2" />
                <p className="text-xs font-medium text-[#8e8e93]">No Tool Invocations Yet</p>
                <p className="text-[11px] text-zinc-600 max-w-xs mt-1">
                  Ask Beatrice to execute code, run shell commands, deploy an agent, or search the web — or use the trigger buttons above!
                </p>
              </div>
            ) : (
              toolLogs.map((log) => (
                <div
                  key={log.id}
                  className="bg-black/70 rounded-xl border border-white/10 p-3.5 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-[#00f2fe]/15 text-[#00f2fe] font-mono font-bold text-[11px] border border-[#00f2fe]/30">
                        {log.name}
                      </span>
                      <span className="text-[#8e8e93] text-[10px]">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        log.status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-[#00f2fe]/30'
                          : log.status === 'executing'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse'
                          : 'bg-white/10 text-[#8e8e93]'
                      }`}
                    >
                      {log.status}
                    </span>
                  </div>

                  {/* Arguments */}
                  <div>
                    <span className="text-[10px] text-[#8e8e93] uppercase font-semibold">Arguments Payload:</span>
                    <pre className="mt-1 p-2 rounded-lg bg-[#121215] border border-white/10 text-[11px] text-zinc-300 font-mono overflow-x-auto">
                      {JSON.stringify(log.args, null, 2)}
                    </pre>
                  </div>

                  {/* Result */}
                  {log.result !== undefined && (
                    <div>
                      <span className="text-[10px] text-[#8e8e93] uppercase font-semibold">Execution Output:</span>
                      <pre className="mt-1 p-2 rounded-lg bg-[#121215]/95 border border-white/10 text-[11px] text-[#00f2fe] font-mono overflow-x-auto max-h-36">
                        {typeof log.result === 'object' ? JSON.stringify(log.result, null, 2) : String(log.result)}
                      </pre>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB: GOOGLE WORKSPACE & MEET */}
        {activeTab === 'workspace' && (
          <div className="space-y-4 text-xs">
            {/* Google Meet Primary Card */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-[#00f2fe]/15 via-[#4facfe]/10 to-black border border-[#00f2fe]/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-300">
                    <Video className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">Google Meet Conference Hub</h3>
                    <p className="text-[10px] text-[#8e8e93]">Create & launch Google Meet video spaces</p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-[#00f2fe] font-mono text-[10px] font-semibold border border-[#00f2fe]/30">
                  OAuth Active
                </span>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-medium text-zinc-300">Meeting Topic / Summary:</label>
                <input
                  type="text"
                  value={meetTitle}
                  onChange={(e) => setMeetTitle(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-200 focus:outline-none focus:border-[#00f2fe]/50"
                  placeholder="e.g. Beatrice AI Voice Strategy Session"
                />

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={createGoogleMeet}
                    disabled={meetCreating}
                    className="flex-1 py-2 px-3 rounded-lg bg-gradient-to-r from-[#00f2fe] to-[#4facfe] hover:from-[#4facfe] hover:to-[#00f2fe] disabled:opacity-50 text-black font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-[#00f2fe]/20 cursor-pointer"
                  >
                    <Video className="w-3.5 h-3.5" />
                    <span>{meetCreating ? 'Creating meeting…' : 'Create Google Meet Space'}</span>
                  </button>
                </div>

                {meetError && (
                  <div className="mt-2 p-3 rounded-lg bg-rose-950/30 border border-rose-500/30 text-rose-300 text-[11px]">
                    {meetError}
                  </div>
                )}

                {meetLink && !meetError && (
                  <div className="mt-2 p-3 rounded-lg bg-black border border-[#00f2fe]/40 space-y-2 animate-fadeIn">
                    <span className="text-[10px] font-semibold uppercase text-[#00f2fe] tracking-wider block">
                      ✓ Google Meet Room Generated:
                    </span>
                    <a
                      href={meetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-2 rounded bg-[#121215] border border-white/10 text-[#00f2fe] font-mono text-[11px] truncate hover:underline"
                    >
                      {meetLink}
                    </a>
                    <a
                      href={meetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 text-[11px] font-semibold border border-[#00f2fe]/40 hover:bg-emerald-500/30"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Join Google Meet Call Now</span>
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Gmail & Drive Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Gmail Dispatcher */}
              <div className="p-3.5 rounded-xl bg-black/70 border border-white/10 space-y-2.5">
                <div className="flex items-center gap-2 text-[#00f2fe] font-semibold text-[11px]">
                  <Mail className="w-3.5 h-3.5" />
                  <span>Gmail Dispatcher</span>
                </div>
                <input
                  type="text"
                  value={gmailTo}
                  onChange={(e) => setGmailTo(e.target.value)}
                  placeholder="Recipient email"
                  className="w-full px-2.5 py-1 rounded-lg bg-[#121215] border border-white/10 text-zinc-200 text-[11px] focus:outline-none"
                />
                <input
                  type="text"
                  value={gmailSub}
                  onChange={(e) => setGmailSub(e.target.value)}
                  placeholder="Subject line"
                  className="w-full px-2.5 py-1 rounded-lg bg-[#121215] border border-white/10 text-zinc-200 text-[11px] focus:outline-none"
                />
                <textarea
                  value={gmailBody}
                  onChange={(e) => setGmailBody(e.target.value)}
                  rows={2}
                  className="w-full px-2.5 py-1 rounded-lg bg-[#121215] border border-white/10 text-zinc-200 text-[11px] focus:outline-none resize-none"
                />
                <button
                  onClick={() => setActiveTab('gmail')}
                  className="w-full py-1.5 rounded-lg bg-[#00f2fe]/15 hover:bg-[#00f2fe]/30 text-[#00f2fe] border border-[#00f2fe]/40 font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Mail className="w-3 h-3 text-[#00f2fe]" />
                  <span>Open Gmail Manager</span>
                </button>
              </div>

              {/* Drive & Docs */}
              <div className="p-3.5 rounded-xl bg-black/70 border border-white/10 space-y-2.5">
                <div className="flex items-center gap-2 text-amber-300 font-semibold text-[11px]">
                  <Folder className="w-3.5 h-3.5" />
                  <span>Drive Docs & Sheets</span>
                </div>
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="Document title"
                  className="w-full px-2.5 py-1 rounded-lg bg-[#121215] border border-white/10 text-zinc-200 text-[11px] focus:outline-none"
                />
                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  <button
                    onClick={() => alert(`Created Google Doc "${docTitle}"`)}
                    className="p-2 rounded-lg bg-[#4facfe]/10 hover:bg-[#4facfe]/20 text-[#4facfe] border border-[#4facfe]/30 flex flex-col items-center gap-1 text-[10px] cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Doc</span>
                  </button>
                  <button
                    onClick={() => alert(`Created Google Sheet "${docTitle}"`)}
                    className="p-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-[#00f2fe]/30 flex flex-col items-center gap-1 text-[10px] cursor-pointer"
                  >
                    <Table className="w-3.5 h-3.5" />
                    <span>Sheet</span>
                  </button>
                  <button
                    onClick={() => alert(`Created Google Slide "${docTitle}"`)}
                    className="p-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 flex flex-col items-center gap-1 text-[10px] cursor-pointer"
                  >
                    <Presentation className="w-3.5 h-3.5" />
                    <span>Slide</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('forms')}
                    className="p-2 rounded-lg bg-[#4facfe]/10 hover:bg-[#4facfe]/15 text-[#4facfe] border border-[#4facfe]/30 flex flex-col items-center gap-1 text-[10px] cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#4facfe]" />
                    <span>Form</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: GMAIL */}
        {activeTab === 'gmail' && (
          <div className="p-1">
            <GmailTool />
          </div>
        )}

        {/* TAB: CONTACTS */}
        {activeTab === 'contacts' && (
          <div className="p-1">
            <ContactsTool />
          </div>
        )}

        {/* TAB: GOOGLE FORMS */}
        {activeTab === 'forms' && (
          <div className="p-1">
            <GoogleFormsTool />
          </div>
        )}

        {/* TAB 2: CODE SANDBOX */}
        {activeTab === 'sandbox' && (
          <div className="space-y-4">
            {/* Editor Input Controls */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-[#00f2fe]" />
                  Code Sandbox Execution Engine
                </label>
                <select
                  value={sandboxLang}
                  onChange={(e) => setSandboxLang(e.target.value)}
                  className="bg-black border border-white/10 text-xs text-[#00f2fe] rounded-lg px-2.5 py-1 focus:outline-none"
                >
                  <option value="javascript">JavaScript (Node VM)</option>
                  <option value="typescript">TypeScript</option>
                  <option value="python">Python 3</option>
                  <option value="html">HTML Widget</option>
                </select>
              </div>

              <textarea
                value={sandboxCode}
                onChange={(e) => setSandboxCode(e.target.value)}
                rows={6}
                className="w-full bg-black border border-white/10 focus:border-[#00f2fe]/60 rounded-xl p-3 font-mono text-xs text-zinc-200 focus:outline-none resize-none"
              />

              <div className="flex justify-end">
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => onRunSandbox(sandboxCode, sandboxLang)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#00f2fe] to-[#4facfe] hover:opacity-90 text-white text-xs font-semibold transition-all shadow-md shadow-[#00f2fe]/20"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Execute
                </button>
                <button
                  onClick={() => onRunSandboxStream?.(sandboxCode, sandboxLang)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#00f2fe]/15 hover:bg-[#00f2fe]/30 text-[#00f2fe] border border-[#00f2fe]/40 text-xs font-semibold transition-all"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Stream Execute
                </button>
              </div>
              </div>
            </div>

            {/* Sandbox History Runs */}
            <div className="space-y-2.5 pt-2 border-t border-white/10">
              <h4 className="text-xs font-medium text-[#8e8e93]">Sandbox Output Log</h4>
              {sandboxRuns.length === 0 ? (
                <div className="p-4 rounded-xl bg-black border border-white/10 text-xs text-[#8e8e93] text-center">
                  No code runs executed yet. Write code above or ask Beatrice to solve a problem.
                </div>
              ) : (
                sandboxRuns.map((run) => (
                  <div
                    key={run.id}
                    className="p-3 bg-black rounded-xl border border-white/10 font-mono text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[11px] text-[#8e8e93]">
                      <span className="text-[#00f2fe] font-semibold">{run.language.toUpperCase()}</span>
                      <span>{new Date(run.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <pre className="p-2 rounded bg-[#121215] border border-white/10 text-zinc-300 text-[11px] max-h-36 overflow-y-auto whitespace-pre-wrap">
                      {run.output}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: TERMINAL CLI */}
        {activeTab === 'cli' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                Workspace Terminal CLI
              </label>

              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center bg-black border border-white/10 rounded-xl px-3 py-2 text-xs font-mono">
                  <span className="text-[#00f2fe] font-bold mr-2">$</span>
                  <input
                    type="text"
                    value={cliCmd}
                    onChange={(e) => setCliCmd(e.target.value)}
                    placeholder="e.g. ls -la, python3 --version, git status..."
                    className="flex-1 bg-transparent text-zinc-200 focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onRunCli(cliCmd);
                    }}
                  />
                </div>
                <button
                  onClick={() => onRunCli(cliCmd)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#00f2fe] to-[#4facfe] hover:opacity-90 text-white text-xs font-semibold transition-all shrink-0"
                >
                  Run
                </button>
                <button
                  onClick={() => onRunCliStream?.(cliCmd)}
                  className="px-4 py-2 rounded-xl bg-[#00f2fe]/15 hover:bg-[#00f2fe]/30 text-[#00f2fe] border border-[#00f2fe]/40 text-xs font-semibold transition-all shrink-0"
                >
                  Stream
                </button>
              </div>
            </div>

            {/* CLI Execution Output Stream */}
            <div className="space-y-2.5 pt-2 border-t border-white/10">
              <h4 className="text-xs font-medium text-[#8e8e93]">CLI Command Logs</h4>
              {cliRuns.length === 0 ? (
                <div className="p-4 rounded-xl bg-black border border-white/10 text-xs text-[#8e8e93] text-center font-mono">
                  No CLI commands executed yet.
                </div>
              ) : (
                cliRuns.map((run) => (
                  <div
                    key={run.id}
                    className="p-3 bg-black rounded-xl border border-white/10 font-mono text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between text-zinc-300 border-b border-white/5 pb-1.5">
                      <span className="text-[#00f2fe] font-bold">$ {run.command}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          run.exitCode === 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        Exit Code: {run.exitCode}
                      </span>
                    </div>
                    <pre className="p-2 rounded bg-[#121215] text-zinc-300 text-[11px] overflow-x-auto whitespace-pre-wrap max-h-40">
                      {run.output}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 4: SUB-AGENTS */}
        {activeTab === 'agents' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-[#8e8e93] pb-2 border-b border-white/10">
              <span className="font-medium">Beatrice Agent Framework</span>
              <span>Autonomous Multi-Agent Workers</span>
            </div>

            {/* Dispatch Custom Sub-Agent Form */}
            <div className="p-3 bg-black rounded-xl border border-white/10 space-y-2">
              <div className="flex items-center justify-between text-xs text-[#4facfe] font-semibold">
                <span className="flex items-center gap-1.5"><Bot className="w-3.5 h-3.5" /> Dispatch Autonomous Sub-Agent</span>
              </div>
              <div className="space-y-2 text-xs">
                <input
                  type="text"
                  value={customAgentName}
                  onChange={(e) => setCustomAgentName(e.target.value)}
                  placeholder="Agent Name (e.g. Code Reviewer, Vision Inspector)"
                  className="w-full bg-[#121215] border border-white/10 rounded-lg px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-[#4facfe]/50"
                />
                <textarea
                  value={customAgentTask}
                  onChange={(e) => setCustomAgentTask(e.target.value)}
                  rows={2}
                  placeholder="Task prompt..."
                  className="w-full bg-[#121215] border border-white/10 rounded-lg p-2.5 text-zinc-200 focus:outline-none focus:border-[#4facfe]/50 resize-none font-mono text-[11px]"
                />
                <button
                  onClick={() => onDeployAgent?.(customAgentName, customAgentTask)}
                  className="w-full py-2 bg-gradient-to-r from-[#00f2fe] to-[#4facfe] hover:opacity-90 text-white rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5 fill-current" /> Deploy Sub-Agent
                </button>
              </div>
            </div>

            {agentTasks.length === 0 ? (
              <div className="py-8 flex flex-col items-center justify-center text-center text-[#8e8e93]">
                <Bot className="w-8 h-8 text-[#4facfe]/40 mb-2" />
                <p className="text-xs font-medium text-[#8e8e93]">No Sub-Agents Dispatched</p>
                <p className="text-[11px] text-zinc-600 max-w-xs mt-1">
                  Ask Beatrice to deploy a Code Reviewer, Vision Agent, or Research Agent — or deploy one above!
                </p>
              </div>
            ) : (
              agentTasks.map((agent) => (
                <div
                  key={agent.id}
                  className="p-3.5 bg-black rounded-xl border border-white/10 space-y-2.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4 text-[#4facfe]" />
                      <span className="font-bold text-zinc-200">{agent.agentName}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        agent.status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-[#00f2fe]/30'
                          : 'bg-[#4facfe]/15 text-[#4facfe] border border-[#4facfe]/30 animate-pulse'
                      }`}
                    >
                      {agent.status}
                    </span>
                  </div>

                  <p className="text-zinc-300 text-[11px] bg-[#121215]/90 p-2 rounded-lg border border-white/10">
                    <strong className="text-[#8e8e93]">Task:</strong> {agent.task}
                  </p>

                  {/* Progress Bar */}
                  <div className="w-full bg-[#121215] h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-[#00f2fe] to-[#4facfe] h-full transition-all duration-500"
                      style={{ width: `${agent.progress}%` }}
                    />
                  </div>

                  {/* Agent Output Result */}
                  {agent.result && (
                    <div className="p-2.5 rounded-lg bg-[#4facfe]/10 border border-[#4facfe]/20 text-[#4facfe] text-[11px] leading-relaxed whitespace-pre-wrap">
                      <div className="font-semibold text-[#4facfe] mb-1 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#4facfe]" />
                        Agent Findings:
                      </div>
                      {agent.result}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 6: WEB / BROWSER USE */}
        {activeTab === 'browser' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-[#00f2fe]/10 border border-[#00f2fe]/30 space-y-2">
              <div className="flex items-center gap-2 text-[#00f2fe] font-semibold text-xs">
                <Globe className="w-4 h-4" />
                <span>Browser Automation Service</span>
              </div>
              <input
                type="text"
                value={browserUrl}
                onChange={(e) => setBrowserUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs focus:outline-none focus:border-[#00f2fe]/50"
              />
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => onRunBrowser?.('goto', { url: browserUrl })}
                  className="px-2 py-1.5 rounded-lg bg-[#00f2fe]/15 hover:bg-[#00f2fe]/30 text-[#00f2fe] border border-[#00f2fe]/30 text-xs font-semibold"
                >
                  Navigate
                </button>
                <button
                  onClick={() => onRunBrowser?.('read', {})}
                  className="px-2 py-1.5 rounded-lg bg-[#00f2fe]/15 hover:bg-[#00f2fe]/30 text-[#00f2fe] border border-[#00f2fe]/30 text-xs font-semibold"
                >
                  Read Page
                </button>
                <button
                  onClick={() => onRunBrowser?.('scroll', {})}
                  className="px-2 py-1.5 rounded-lg bg-[#00f2fe]/15 hover:bg-[#00f2fe]/30 text-[#00f2fe] border border-[#00f2fe]/30 text-xs font-semibold"
                >
                  Scroll
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={browserSelector}
                  onChange={(e) => setBrowserSelector(e.target.value)}
                  placeholder="Selector"
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs focus:outline-none"
                />
                <button
                  onClick={() => onRunBrowser?.('click', { selector: browserSelector })}
                  className="px-3 py-1.5 rounded-lg bg-[#00f2fe]/15 hover:bg-[#00f2fe]/30 text-[#00f2fe] border border-[#00f2fe]/30 text-xs font-semibold"
                >
                  Click
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={browserTypeText}
                  onChange={(e) => setBrowserTypeText(e.target.value)}
                  placeholder="Text to type"
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs focus:outline-none"
                />
                <button
                  onClick={() => onRunBrowser?.('type', { selector: browserSelector, text: browserTypeText })}
                  className="px-3 py-1.5 rounded-lg bg-[#00f2fe]/15 hover:bg-[#00f2fe]/30 text-[#00f2fe] border border-[#00f2fe]/30 text-xs font-semibold"
                >
                  Type
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              <h4 className="text-xs font-medium text-[#8e8e93]">Live Browser Sessions</h4>
              {browserSessions.length === 0 ? (
                <div className="p-4 rounded-xl bg-black border border-white/10 text-xs text-[#8e8e93] text-center">
                  No active browser sessions. Start one above.
                </div>
              ) : (
                browserSessions.map((s) => (
                  <div key={s.id} className="p-3 rounded-xl bg-black border border-white/10 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-[#00f2fe]">{s.id}</span>
                      <span className="text-[#8e8e93]">{new Date(s.timestamp).toLocaleTimeString()}</span>
                    </div>
                    {s.url && <div className="text-[11px] text-zinc-300 truncate">{s.url}</div>}
                    {s.title && <div className="text-[11px] text-[#8e8e93]">{s.title}</div>}
                    {s.lastScreenshot && (
                      <img
                        src={`data:image/jpeg;base64,${s.lastScreenshot}`}
                        alt="browser screenshot"
                        className="rounded-lg border border-white/10 w-full"
                      />
                    )}
                    <pre className="p-2 rounded bg-[#121215] border border-white/10 text-[10px] text-[#8e8e93] max-h-32 overflow-y-auto">
                      {s.log.slice(-20).join('\n')}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 7: COMPUTER / DESKTOP USE */}
        {activeTab === 'computer' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/30 space-y-2">
              <div className="flex items-center gap-2 text-rose-300 font-semibold text-xs">
                <Monitor className="w-4 h-4" />
                <span>Computer Control Service</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={computerCommand}
                  onChange={(e) => setComputerCommand(e.target.value)}
                  placeholder="Shell command"
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs focus:outline-none"
                  onKeyDown={(e) => { if (e.key === 'Enter') onRunComputer?.('shell', { command: computerCommand, cwd: computerCwd }); }}
                />
                <button
                  onClick={() => onRunComputer?.('shell', { command: computerCommand, cwd: computerCwd })}
                  className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold"
                >
                  Run
                </button>
              </div>
              <input
                type="text"
                value={computerCwd}
                onChange={(e) => setComputerCwd(e.target.value)}
                placeholder="Working directory"
                className="w-full px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onRunComputer?.('listApps', {})}
                  className="px-2 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold"
                >
                  List Apps
                </button>
<button
                  onClick={() => onRunComputer?.('openApp', { app: 'xterm' })}
                  className="px-2 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold"
                >
                  Open xterm
                </button>
                <button
                  onClick={() => onRunComputer?.('mouseMove', { x: 100, y: 100 })}
                  className="px-2 py-1.5 rounded-lg bg-[#00f2fe]/20 hover:bg-[#00f2fe]/30 text-[#00f2fe] border border-[#00f2fe]/30 text-xs font-semibold"
                >
                  Move Mouse
                </button>
                <button
                  onClick={() => onRunComputer?.('mouseClick', { button: 1 })}
                  className="px-2 py-1.5 rounded-lg bg-[#00f2fe]/20 hover:bg-[#00f2fe]/30 text-[#00f2fe] border border-[#00f2fe]/30 text-xs font-semibold"
                >
                  Click
                </button>
                <button
                  onClick={() => onRunComputer?.('typeText', { text: 'Hello Beatrice' })}
                  className="px-2 py-1.5 rounded-lg bg-[#00f2fe]/20 hover:bg-[#00f2fe]/30 text-[#00f2fe] border border-[#00f2fe]/30 text-xs font-semibold"
                >
                  Type Text
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              <h4 className="text-xs font-medium text-[#8e8e93]">Live Computer Sessions</h4>
              {computerSessions.length === 0 ? (
                <div className="p-4 rounded-xl bg-black border border-white/10 text-xs text-[#8e8e93] text-center">
                  No active computer sessions. Start one above.
                </div>
              ) : (
                computerSessions.map((s) => (
                  <div key={s.id} className="p-3 rounded-xl bg-black border border-white/10 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-rose-400">{s.id}</span>
                      <span className="text-[#8e8e93]">{new Date(s.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-[11px] text-[#8e8e93]">cwd: {s.cwd}</div>
                    <pre className="p-2 rounded bg-[#121215] border border-white/10 text-[10px] text-[#8e8e93] max-h-40 overflow-y-auto">
                      {s.log.slice(-30).join('\n')}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB: CODING AGENT */}
        {activeTab === 'codingAgent' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/30 space-y-2">
              <div className="flex items-center gap-2 text-violet-300 font-semibold text-xs">
                <Bot className="w-4 h-4" />
                <span>OpenCode CLI Coding Agent</span>
              </div>
              <p className="text-[10px] text-[#8e8e93] leading-snug">
                The coding agent has full filesystem access to the workspace. It can read, write, edit files, run shell commands, install dependencies, and execute tests. Use for multi-file coding tasks.
              </p>
              <textarea
                value={codingAgentTask}
                onChange={(e) => setCodingAgentTask(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs focus:outline-none focus:border-violet-500/50 resize-none"
                placeholder="Describe the coding task (e.g. 'Add a dark mode toggle to SettingsModal.tsx')"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={codingAgentCwd}
                  onChange={(e) => setCodingAgentCwd(e.target.value)}
                  placeholder="Working directory (default: project root)"
                  className="flex-1 px-3 py-1.5 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs focus:outline-none focus:border-violet-500/50"
                />
              </div>
              <button
                onClick={() => {
                  if (codingAgentTask.trim()) {
                    onRunCodingAgent?.(codingAgentTask.trim(), codingAgentCwd || undefined);
                  }
                }}
                className="w-full py-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 hover:opacity-90 text-white text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
              >
                <Bot className="w-3.5 h-3.5" />
                Deploy Coding Agent
              </button>
            </div>

            <div className="space-y-2.5">
              <h4 className="text-xs font-medium text-[#8e8e93]">Coding Agent Sessions</h4>
              {codingAgentSessions.length === 0 ? (
                <div className="p-4 rounded-xl bg-black border border-white/10 text-xs text-[#8e8e93] text-center">
                  No coding agent sessions yet. Ask Beatrice to build, fix, or refactor code.
                </div>
              ) : (
                codingAgentSessions.map((s) => (
                  <div key={s.id} className="p-3 rounded-xl bg-black border border-white/10 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-violet-400">{s.id}</span>
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          s.status === 'running' ? 'bg-blue-500/20 text-blue-300' :
                          s.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300' :
                          s.status === 'failed' ? 'bg-rose-500/20 text-rose-300' :
                          s.status === 'cancelled' ? 'bg-amber-500/20 text-amber-300' :
                          'bg-zinc-500/20 text-zinc-300'
                        }`}>
                          {s.status}
                        </span>
                        <span className="text-[#8e8e93]">{new Date(s.timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-[#8e8e93]">Task: {s.task ? s.task.slice(0, 120) : '—'}</div>
                    <div className="text-[10px] text-[#8e8e93]">cwd: {s.cwd}</div>
                    {s.error && (
                      <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-[10px] text-rose-400">
                        {s.error}
                      </div>
                    )}
                    <pre className="p-2 rounded bg-[#121215] border border-white/10 text-[10px] text-[#8e8e93] max-h-60 overflow-y-auto font-mono leading-relaxed">
                      {s.output || (s.log || []).slice(-40).join('\n') || 'Waiting for output...'}
                    </pre>
                    {s.status === 'running' && (
                      <button
                        onClick={() => onCancelCodingAgent?.(s.id)}
                        className="w-full py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[10px] font-semibold hover:bg-rose-500/20 transition-colors"
                      >
                        Cancel Agent
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 8: VIDEO GENERATION */}
        {activeTab === 'video' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-[#00f2fe]/10 border border-[#00f2fe]/30 space-y-2">
              <div className="flex items-center gap-2 text-[#00f2fe] font-semibold text-xs">
                <Film className="w-4 h-4" />
                <span>Video Generation</span>
              </div>
              <textarea
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs focus:outline-none focus:border-[#00f2fe]/50 resize-none"
                placeholder="Describe the video scene or multi-shot story..."
              />
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={videoResolution}
                  onChange={(e) => setVideoResolution(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-[#00f2fe] text-xs focus:outline-none"
                >
                  <option value="720P">720P</option>
                  <option value="480P">480P</option>
                </select>
                <select
                  value={videoRatio}
                  onChange={(e) => setVideoRatio(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-[#00f2fe] text-xs focus:outline-none"
                >
                  <option value="16:9">16:9</option>
                  <option value="9:16">9:16</option>
                  <option value="1:1">1:1</option>
                </select>
                <select
                  value={videoDuration}
                  onChange={(e) => setVideoDuration(Number(e.target.value))}
                  className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-[#00f2fe] text-xs focus:outline-none"
                >
                  <option value={5}>5s</option>
                  <option value={10}>10s</option>
                  <option value={15}>15s</option>
                </select>
              </div>
              <button
                onClick={() =>
                  onGenerateVideo?.({
                    prompt: videoPrompt,
                    resolution: videoResolution,
                    ratio: videoRatio,
                    duration: videoDuration,
                  })
                }
                className="w-full py-2 rounded-lg bg-[#00f2fe]/15 hover:bg-[#00f2fe]/25 text-[#00f2fe] border border-[#00f2fe]/30 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Generate Video
              </button>
            </div>

            <div className="space-y-2.5">
              <h4 className="text-xs font-medium text-[#8e8e93]">Live Video Tasks</h4>
              {videoTasks.length === 0 ? (
                <div className="p-4 rounded-xl bg-black border border-white/10 text-xs text-[#8e8e93] text-center">
                  No video tasks yet. Start one above or ask Beatrice to create a video.
                </div>
              ) : (
                videoTasks.map((task) => {
                  const progress = typeof task.progress === 'number' ? task.progress : 0;
                  const isDone = task.status === 'completed' || task.status === 'done';
                  const isFailed = task.status === 'failed';
                  const videoUrl = typeof task.videoUrl === 'string' && task.videoUrl ? task.videoUrl : '';
                  const dlUrl = typeof task.downloadUrl === 'string' && task.downloadUrl ? task.downloadUrl : videoUrl;
                  return (
                    <div key={task.id} className="p-3 rounded-xl bg-black border border-white/10 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-[#00f2fe] truncate">{task.id}</span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${isDone ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : isFailed ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/30 animate-pulse'}`}>
                            {task.status}
                          </span>
                          {typeof task.timestamp === 'number' && (
                            <span className="text-[#8e8e93]">{new Date(task.timestamp).toLocaleTimeString()}</span>
                          )}
                        </div>
                      </div>
                      {typeof task.prompt === 'string' && task.prompt && (
                        <p className="text-[11px] text-[#8e8e93] line-clamp-2">{task.prompt}</p>
                      )}
                      {!isDone && !isFailed && <VideoLoading status={task.status} progress={progress} />}
                      {videoUrl && (
                        <MediaFrame>
                          <video src={videoUrl} controls playsInline webkitPlaysInline className="w-full aspect-video object-contain bg-black rounded-lg border border-white/10" />
                          <a
                            href={dlUrl}
                            onClick={(e) => {
                              e.preventDefault();
                              void downloadFile(dlUrl, `${task.id}.mp4`);
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#00f2fe]/15 border border-[#00f2fe]/40 text-[#00f2fe] text-[11px] font-semibold hover:bg-[#00f2fe]/25 transition-colors"
                          >
                            <Download className="w-3 h-3" />
                            Download
                          </a>
                        </MediaFrame>
                      )}
                      {typeof task.error === 'string' && task.error && <div className="text-[11px] text-rose-400">{task.error}</div>}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 9: QWENCLOUD */}
        {activeTab === 'qwencloud' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-[#00f2fe]/10 border border-[#00f2fe]/30 space-y-2">
              <div className="flex items-center gap-2 text-[#00f2fe] font-semibold text-xs">
                <Cloud className="w-4 h-4" />
                <span>Media Studio</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {(['chat', 'image', 'imageEdit', 'video', 'tts'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setQwenTab(t)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap border ${
                      qwenTab === t
                        ? 'bg-[#00f2fe]/25 text-[#00f2fe] border-[#00f2fe]/40'
                        : 'bg-black border-white/10 text-[#8e8e93] hover:text-zinc-200'
                    }`}
                  >
                    {t === 'imageEdit' ? 'Image Edit' : t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {qwenTab === 'chat' && (
                <div className="space-y-2">
                  <textarea
                    value={qwenSystem}
                    onChange={(e) => setQwenSystem(e.target.value)}
                    rows={2}
                    placeholder="Optional system message"
                    className="w-full px-3 py-2 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs resize-none focus:outline-none"
                  />
                  <textarea
                    value={qwenPrompt}
                    onChange={(e) => setQwenPrompt(e.target.value)}
                    rows={3}
                    placeholder="Prompt for text generation..."
                    className="w-full px-3 py-2 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs resize-none focus:outline-none"
                  />
                  <select
                    value={qwenModel}
                    onChange={(e) => setQwenModel(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-[#00f2fe] text-xs focus:outline-none"
                  >
                    <option value="qwen3.8-max">qwen3.8-max</option>
                    <option value="qwen3.7-plus">qwen3.7-plus</option>
                    <option value="qwen3.7-flash">qwen3.7-flash</option>
                  </select>
                  <button
                    onClick={() => onQwenCloud?.('chat', { prompt: qwenPrompt, model: qwenModel, system: qwenSystem })}
                    className="w-full py-2 rounded-lg bg-[#00f2fe]/15 hover:bg-[#00f2fe]/25 text-[#00f2fe] border border-[#00f2fe]/30 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" /> Send Chat
                  </button>
                </div>
              )}

              {(qwenTab === 'image' || qwenTab === 'imageEdit') && (
                <div className="space-y-2">
                  <textarea
                    value={qwenPrompt}
                    onChange={(e) => setQwenPrompt(e.target.value)}
                    rows={3}
                    placeholder={qwenTab === 'image' ? 'Image generation prompt...' : 'Edit instruction...'}
                    className="w-full px-3 py-2 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs resize-none focus:outline-none"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={qwenSize}
                      onChange={(e) => setQwenSize(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-[#00f2fe] text-xs focus:outline-none"
                    >
                      <option value="1K">1K</option>
                      <option value="2K">2K</option>
                      <option value="4K">4K</option>
                    </select>
                    <input
                      type="number"
                      min={1}
                      max={4}
                      value={1}
                      disabled
                      className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-[#8e8e93] text-xs"
                      title="n=1 for now"
                    />
                  </div>
                  {qwenTab === 'imageEdit' && (
                    <textarea
                      value={qwenImages}
                      onChange={(e) => setQwenImages(e.target.value)}
                      rows={2}
                      placeholder="Image URLs, base64, or file paths (one per line)"
                      className="w-full px-3 py-2 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs resize-none focus:outline-none"
                    />
                  )}
                  <button
                    onClick={() =>
                      onQwenCloud?.(qwenTab === 'image' ? 'imageGenerate' : 'imageEdit', {
                        prompt: qwenPrompt,
                        instruction: qwenPrompt,
                        images: qwenImages.split('\n').map((s) => s.trim()).filter(Boolean),
                        size: qwenSize,
                      })
                    }
                    className="w-full py-2 rounded-lg bg-[#00f2fe]/15 hover:bg-[#00f2fe]/25 text-[#00f2fe] border border-[#00f2fe]/30 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    {qwenTab === 'image' ? 'Generate Image' : 'Edit Images'}
                  </button>
                </div>
              )}

              {qwenTab === 'video' && (
                <div className="space-y-2">
                  <textarea
                    value={qwenPrompt}
                    onChange={(e) => setQwenPrompt(e.target.value)}
                    rows={4}
                    placeholder="Video prompt with optional shot timestamps..."
                    className="w-full px-3 py-2 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs resize-none focus:outline-none"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={qwenResolution}
                      onChange={(e) => setQwenResolution(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-[#00f2fe] text-xs focus:outline-none"
                    >
                      <option value="720P">720P</option>
                      <option value="1080P">1080P</option>
                    </select>
                    <select
                      value={qwenRatio}
                      onChange={(e) => setQwenRatio(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-[#00f2fe] text-xs focus:outline-none"
                    >
                      <option value="16:9">16:9</option>
                      <option value="9:16">9:16</option>
                      <option value="1:1">1:1</option>
                    </select>
                    <select
                      value={qwenDuration}
                      onChange={(e) => setQwenDuration(Number(e.target.value))}
                      className="px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-[#00f2fe] text-xs focus:outline-none"
                    >
                      <option value={5}>5s</option>
                      <option value={10}>10s</option>
                      <option value={15}>15s</option>
                    </select>
                  </div>
                  <button
                    onClick={() =>
                      onQwenCloud?.('videoGenerate', {
                        prompt: qwenPrompt,
                        resolution: qwenResolution,
                        ratio: qwenRatio,
                        duration: qwenDuration,
                      })
                    }
                    className="w-full py-2 rounded-lg bg-[#00f2fe]/15 hover:bg-[#00f2fe]/25 text-[#00f2fe] border border-[#00f2fe]/30 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" /> Generate Video
                  </button>
                </div>
              )}

              {qwenTab === 'tts' && (
                <div className="space-y-2">
                  <textarea
                    value={qwenPrompt}
                    onChange={(e) => setQwenPrompt(e.target.value)}
                    rows={3}
                    placeholder="Text to synthesize..."
                    className="w-full px-3 py-2 rounded-lg bg-black border border-white/10 text-zinc-200 text-xs resize-none focus:outline-none"
                  />
                  <input
                    type="text"
                    value={qwenVoice}
                    onChange={(e) => setQwenVoice(e.target.value)}
                    placeholder="Voice e.g. Cherry"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-black border border-white/10 text-[#00f2fe] text-xs focus:outline-none"
                  />
                  <button
                    onClick={() => onQwenCloud?.('tts', { text: qwenPrompt, voice: qwenVoice })}
                    className="w-full py-2 rounded-lg bg-[#00f2fe]/15 hover:bg-[#00f2fe]/25 text-[#00f2fe] border border-[#00f2fe]/30 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" /> Synthesize Speech
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-2.5">
              <h4 className="text-xs font-medium text-[#8e8e93]">Live Media Tasks</h4>
              {qwenTasks.length === 0 ? (
                <div className="p-4 rounded-xl bg-black border border-white/10 text-xs text-[#8e8e93] text-center">
                  No media tasks yet. Ask Beatrice to create an image, video, or speech.
                </div>
              ) : (
                qwenTasks.map((task) => {
                  const progress = typeof task.progress === 'number' ? task.progress : 0;
                  const isDone = task.status === 'completed' || task.status === 'done';
                  const isFailed = task.status === 'failed';
                  const isVideoKind = task.kind === 'video';
                  const isImageKind = task.kind === 'image' || task.kind === 'imageEdit';
                  const urls = ((task.urls as string[] | undefined) ?? []).filter((u): u is string => typeof u === 'string' && u.length > 0);
                  const firebaseUrls = ((task.firebaseUrls as string[] | undefined) ?? []).filter((u): u is string => typeof u === 'string' && u.length > 0);
                  const audioUrl = typeof task.audioUrl === 'string' && task.audioUrl ? task.audioUrl : '';
                  const firebaseAudioUrl = typeof task.firebaseAudioUrl === 'string' && task.firebaseAudioUrl ? task.firebaseAudioUrl : '';
                  return (
                    <div key={task.id} className="p-3 rounded-xl bg-black border border-white/10 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-[#00f2fe] truncate">{task.id}</span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="text-[10px] px-2 py-0.5 rounded bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/30">{task.kind}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${isDone ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : isFailed ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/30 animate-pulse'}`}>
                            {task.status}
                          </span>
                          {typeof task.timestamp === 'number' && (
                            <span className="text-[#8e8e93]">{new Date(task.timestamp).toLocaleTimeString()}</span>
                          )}
                        </div>
                      </div>
                      {typeof task.prompt === 'string' && task.prompt && (
                        <p className="text-[11px] text-[#8e8e93] line-clamp-2">{task.prompt}</p>
                      )}
                      {!isDone && !isFailed && (
                        isVideoKind ? (
                          <VideoLoading status={task.status} progress={progress} kind="video" />
                        ) : (
                          <div className="w-full bg-[#121215] h-1.5 rounded-full overflow-hidden">
                            <div className="bg-[#00f2fe] h-full transition-all duration-500" style={{ width: `${progress}%` }} />
                          </div>
                        )
                      )}
                      {urls.map((url, i) => {
                        const ext = String(url).split('.').pop()?.split('?')[0] || '';
                        const urlType = ext.toLowerCase();
                        const firebaseUrl = firebaseUrls[i] || '';
                        const dlUrl = typeof task.downloadUrls?.[i] === 'string' && task.downloadUrls[i]
                          ? task.downloadUrls[i]
                          : firebaseUrl || url;
                        // Prefer the persistent Firebase Storage copy (DashScope URLs expire).
                        const src = ((isVideoKind || isImageKind || /\.(mp4|mov|webm|avi|mkv)$/i.test(urlType) || /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(urlType)) && firebaseUrl) ? firebaseUrl : url;
                        const mediaCls = 'w-full aspect-video object-contain bg-black rounded-lg border border-white/10';
                        return (
                          <MediaFrame key={i} className="space-y-1">
                            {isImageKind || /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(urlType) ? (
                              <img src={src} alt="media output" className="w-full rounded-lg border border-white/10 object-contain bg-black" />
                            ) : isVideoKind || /\.(mp4|mov|webm|avi|mkv)$/i.test(urlType) ? (
                              <video src={src} controls playsInline webkitPlaysInline className={mediaCls} />
                            ) : null}
                            <a
                              href={dlUrl}
                              onClick={(e) => {
                                e.preventDefault();
                                void downloadFile(dlUrl, `${task.id}-${i + 1}${ext ? '.' + ext : '.bin'}`);
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#00f2fe]/15 border border-[#00f2fe]/40 text-[#00f2fe] text-[11px] font-semibold hover:bg-[#00f2fe]/25 transition-colors"
                            >
                              <Download className="w-3 h-3" />
                              Download
                            </a>
                          </MediaFrame>
                        );
                      })}
                      {audioUrl && (
                        <div className="space-y-1">
                          <audio src={audioUrl} controls className="w-full rounded-lg border border-white/10" />
                          <a
                            href={firebaseAudioUrl || audioUrl}
                            download={firebaseAudioUrl ? undefined : `${task.id}.mp3`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#00f2fe]/15 border border-[#00f2fe]/40 text-[#00f2fe] text-[11px] font-semibold hover:bg-[#00f2fe]/25 transition-colors"
                          >
                            <Download className="w-3 h-3" />
                            Download
                          </a>
                        </div>
                      )}
                      {typeof task.result === 'string' && task.result && (
                        <div className="p-2 rounded bg-[#121215] border border-white/10 text-[10px] text-zinc-300 max-h-32 overflow-y-auto">
                          <div className="whitespace-pre-wrap">{task.result}</div>
                        </div>
                      )}
                      {typeof task.error === 'string' && task.error && <div className="text-[11px] text-rose-400">{task.error}</div>}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 5: CANVAS VIEW */}
        {activeTab === 'canvas' && (
          <div className="space-y-3">
            {/* Custom Canvas Renderer Form */}
            <div className="p-3 bg-black rounded-xl border border-white/10 space-y-2">
              <div className="flex items-center justify-between text-xs text-amber-300 font-semibold">
                <span className="flex items-center gap-1.5"><Layout className="w-3.5 h-3.5" /> Render Visual to Canvas</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={customCanvasTitle}
                    onChange={(e) => setCustomCanvasTitle(e.target.value)}
                    placeholder="Canvas Title"
                    className="bg-[#121215] border border-white/10 rounded-lg px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-amber-500/50"
                  />
                  <select
                    value={customCanvasType}
                    onChange={(e) => setCustomCanvasType(e.target.value as any)}
                    className="bg-[#121215] border border-white/10 rounded-lg px-2.5 py-1.5 text-amber-300 focus:outline-none"
                  >
                    <option value="diagram">Diagram (Mermaid)</option>
                    <option value="markdown">Markdown Document</option>
                    <option value="chart">Chart Data</option>
                    <option value="code_snippet">Code Snippet</option>
                  </select>
                </div>
                <textarea
                  value={customCanvasContent}
                  onChange={(e) => setCustomCanvasContent(e.target.value)}
                  rows={3}
                  className="w-full bg-[#121215] border border-white/10 rounded-lg p-2.5 text-zinc-200 focus:outline-none focus:border-amber-500/50 resize-none font-mono text-[11px]"
                />
                <button
                  onClick={() => onUpdateCanvas?.(customCanvasType, customCanvasTitle, customCanvasContent)}
                  className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-semibold transition-all flex items-center justify-center gap-1.5"
                >
                  <Layout className="w-3.5 h-3.5" /> Render Visual
                </button>
              </div>
            </div>

            {!canvasData ? (
              <div className="py-8 flex flex-col items-center justify-center text-center text-[#8e8e93]">
                <Layout className="w-8 h-8 text-amber-500/40 mb-2" />
                <p className="text-xs font-medium text-[#8e8e93]">Canvas Empty</p>
                <p className="text-[11px] text-zinc-600 max-w-xs mt-1">
                  Ask Beatrice to render a diagram, chart, or markdown document — or render one using the form above.
                </p>
              </div>
            ) : (
              <div className="p-4 bg-black rounded-xl border border-white/10 space-y-3">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                    <Layout className="w-4 h-4 text-amber-400" />
                    {canvasData.title}
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                    {canvasData.type.toUpperCase()}
                  </span>
                </div>

                <div className="bg-[#121215] p-3.5 rounded-lg border border-white/10 text-xs text-zinc-200 font-mono whitespace-pre-wrap overflow-x-auto leading-relaxed">
                  {canvasData.content}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
