import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertOctagon,
  AppWindow,
  ArrowRight,
  Code2,
  Eye,
  Globe,
  Keyboard,
  LayoutGrid,
  Monitor,
  MousePointer2,
  MousePointerClick,
  Play,
  Power,
  Radio,
  ScanLine,
  Square,
  Terminal,
  Type,
  X,
} from 'lucide-react';
import {
  BrowserStreamSession,
  CliCommandRun,
  CodeSandboxRun,
  ComputerStreamSession,
} from '../types';

type ViewportTab = 'computer' | 'browser' | 'sandbox' | 'terminal';

interface ExecutionViewportProps {
  sandboxRuns: CodeSandboxRun[];
  cliRuns: CliCommandRun[];
  browserSessions: BrowserStreamSession[];
  computerSessions: ComputerStreamSession[];
  onRunSandbox?: (code: string, language: string) => void;
  onRunSandboxStream?: (code: string, language: string) => void;
  onRunCli?: (command: string) => void;
  onRunCliStream?: (command: string, cwd?: string) => void;
  onClose: () => void;
}

/* ---------- tiny helpers ---------- */

function fmtTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function useAutoScroll<T>(dep: T) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}

interface EventMeta {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: string;
}

const COMPUTER_EVENT_META: Record<string, EventMeta> = {
  sessionStarted: { icon: Power, color: 'text-cyan-400', label: 'Session started' },
  shellStart: { icon: Play, color: 'text-emerald-400', label: 'Running command' },
  shellOutput: { icon: Terminal, color: 'text-emerald-300', label: 'Command output' },
  shellError: { icon: AlertCircle, color: 'text-rose-400', label: 'Command error' },
  mouseMove: { icon: MousePointer2, color: 'text-amber-300', label: 'Mouse move' },
  mouseClick: { icon: MousePointerClick, color: 'text-amber-300', label: 'Mouse click' },
  keyPress: { icon: Keyboard, color: 'text-violet-300', label: 'Key press' },
  typeText: { icon: Type, color: 'text-violet-300', label: 'Typed text' },
  appOpened: { icon: AppWindow, color: 'text-blue-300', label: 'App opened' },
  appList: { icon: LayoutGrid, color: 'text-blue-300', label: 'Apps listed' },
  sessionClosed: { icon: Square, color: 'text-zinc-400', label: 'Session closed' },
  error: { icon: AlertOctagon, color: 'text-rose-400', label: 'Error' },
};

const BROWSER_EVENT_META: Record<string, EventMeta> = {
  sessionStarted: { icon: Power, color: 'text-cyan-400', label: 'Session started' },
  navigated: { icon: Globe, color: 'text-cyan-300', label: 'Navigated' },
  clicked: { icon: MousePointerClick, color: 'text-amber-300', label: 'Clicked' },
  typed: { icon: Keyboard, color: 'text-violet-300', label: 'Typed' },
  scrolled: { icon: ArrowRight, color: 'text-blue-300', label: 'Scrolled' },
  pageText: { icon: Eye, color: 'text-emerald-300', label: 'Read page' },
  console: { icon: Terminal, color: 'text-zinc-300', label: 'Console' },
  error: { icon: AlertOctagon, color: 'text-rose-400', label: 'Page error' },
  sessionClosed: { icon: Square, color: 'text-zinc-400', label: 'Session closed' },
};

function describeComputerEvent(event: string, data: Record<string, unknown>): string {
  switch (event) {
    case 'shellStart':
      return `$ ${String(data.command ?? '')}`;
    case 'shellOutput':
    case 'shellError':
      return truncate(String(data.output ?? data.error ?? '').trim(), 160);
    case 'mouseMove':
      return `(${data.x}, ${data.y})`;
    case 'mouseClick':
      return `button ${String(data.button ?? '1')}`;
    case 'keyPress':
      return String(data.key ?? '');
    case 'typeText':
      return `"${String(data.text ?? '')}"`;
    case 'appOpened':
      return String(data.app ?? '');
    case 'appList':
      return `${Array.isArray(data.apps) ? data.apps.length : 0} applications running`;
    case 'sessionStarted':
      return data.cwd ? `cwd: ${String(data.cwd)}` : '';
    default:
      return '';
  }
}

function describeBrowserEvent(event: string, data: Record<string, unknown>): string {
  switch (event) {
    case 'navigated':
      return String(data.url ?? '');
    case 'clicked':
      return `selector: ${String(data.selector ?? '')}`;
    case 'typed':
      return `"${String(data.text ?? '')}" → ${String(data.selector ?? '')}`;
    case 'scrolled':
      return 'scrolled half viewport';
    case 'pageText':
      return String(data.title ?? data.url ?? '');
    case 'console':
    case 'error':
      return truncate(String(data.text ?? data.error ?? ''), 140);
    default:
      return '';
  }
}

const SANDBOX_SAMPLES = [
  {
    label: 'Fibonacci (JS)',
    language: 'javascript',
    code: 'function fib(n){let a=0,b=1,s=[a];for(let i=1;i<n;i++){s.push(b);[a,b]=[b,a+b];}return s;}\nconsole.log("Fibonacci:", fib(10).join(", "));',
  },
  {
    label: 'Factorials (Python)',
    language: 'python',
    code: 'import math\nfor n in range(1, 8):\n    print(f"{n}! = {math.factorial(n)}")',
  },
  {
    label: 'HTML widget',
    language: 'html',
    code: '<div style="font-family:system-ui;text-align:center;padding:28px;border-radius:16px;background:linear-gradient(135deg,#00f2fe,#4facfe);color:#000;font-weight:700">Beatrice Sandbox<br/>HTML preview works!</div>',
  },
];

/* ---------- main component ---------- */

export const ExecutionViewport: React.FC<ExecutionViewportProps> = ({
  sandboxRuns,
  cliRuns,
  browserSessions,
  computerSessions,
  onRunSandbox,
  onRunSandboxStream,
  onRunCli,
  onRunCliStream,
  onClose,
}) => {
  const [tab, setTab] = useState<ViewportTab>('computer');
  const [selComputerId, setSelComputerId] = useState<string | null>(null);
  const [selBrowserId, setSelBrowserId] = useState<string | null>(null);
  const [selSandboxId, setSelSandboxId] = useState<string | null>(null);
  const [selCliId, setSelCliId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [cliCmd, setCliCmd] = useState('ls -la');

  // Stable-ID selection: fall back to the newest item when the selected one
  // disappears (so new prepended runs never yank the view away from what the
  // user is watching).
  const computer =
    computerSessions.find((s) => s.id === selComputerId) ?? computerSessions[0] ?? null;
  const browser =
    browserSessions.find((s) => s.id === selBrowserId) ?? browserSessions[0] ?? null;
  const sandbox = sandboxRuns.find((r) => r.id === selSandboxId) ?? sandboxRuns[0] ?? null;
  const cli = cliRuns.find((r) => r.id === selCliId) ?? cliRuns[0] ?? null;

  const anyLive = useMemo(
    () =>
      (computerSessions[0]?.events[computerSessions[0].events.length - 1]?.done === false) ||
      (browserSessions[0]?.events[browserSessions[0].events.length - 1]?.done === false) ||
      (sandboxRuns[0]?.done === false) ||
      (cliRuns[0]?.done === false),
    [computerSessions, browserSessions, sandboxRuns, cliRuns]
  );

  const TABS: { id: ViewportTab; label: string; icon: React.ComponentType<{ className?: string }>; live: boolean }[] = [
    { id: 'computer', label: 'Computer Use', icon: Monitor, live: computerSessions[0]?.events[computerSessions[0].events.length - 1]?.done === false },
    { id: 'browser', label: 'Web / Browser', icon: Globe, live: browserSessions[0]?.events[browserSessions[0].events.length - 1]?.done === false },
    { id: 'sandbox', label: 'Sandbox', icon: Code2, live: sandboxRuns[0]?.done === false },
    { id: 'terminal', label: 'Terminal CLI', icon: Terminal, live: cliRuns[0]?.done === false },
  ];

  return (
    <div className="flex flex-col h-full bg-[#050505] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-white/10 bg-black/60">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className="w-2.5 h-2.5 rounded-full bg-[#00f2fe] animate-pulse shadow-[0_0_12px_#00f2fe]" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight">Live Execution</h2>
            <p className="text-[9px] uppercase tracking-[0.18em] text-[#8e8e93] font-semibold">
              {anyLive ? 'Streaming now' : 'Realtime viewport'}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all active:scale-90 cursor-pointer"
          aria-label="Close viewport"
        >
          <X className="w-4.5 h-4.5 text-white" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-white/10 bg-black/30 overflow-x-auto scrollbar-hide shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap border transition-all cursor-pointer ${
              tab === t.id
                ? 'bg-[#00f2fe]/15 border-[#00f2fe]/40 text-[#00f2fe]'
                : 'bg-white/5 border-white/10 text-[#8e8e93] hover:text-white'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            <span>{t.label}</span>
            {t.live && <span className="w-1.5 h-1.5 rounded-full bg-[#00f2fe] animate-pulse" />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
        {tab === 'computer' && <ComputerViewport session={computer} sessions={computerSessions} selectedId={selComputerId} onSelect={setSelComputerId} />}
        {tab === 'browser' && <BrowserViewport session={browser} sessions={browserSessions} selectedId={selBrowserId} onSelect={setSelBrowserId} />}
        {tab === 'sandbox' && (
          <SandboxViewport
            run={sandbox}
            runs={sandboxRuns}
            selectedId={selSandboxId}
            onSelect={setSelSandboxId}
            previewOpen={previewOpen}
            onTogglePreview={() => setPreviewOpen((v) => !v)}
            sampleIdx={sampleIdx}
            onSampleIdx={setSampleIdx}
            onRunSandbox={onRunSandbox}
            onRunSandboxStream={onRunSandboxStream}
          />
        )}
        {tab === 'terminal' && (
          <TerminalViewport
            run={cli}
            runs={cliRuns}
            selectedId={selCliId}
            onSelect={setSelCliId}
            cmd={cliCmd}
            onCmd={setCliCmd}
            onRunCli={onRunCli}
            onRunCliStream={onRunCliStream}
          />
        )}
      </div>
    </div>
  );
};

/* ---------- session pills ---------- */

function SessionPills({
  ids,
  selectedId,
  onSelect,
}: {
  ids: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (ids.length <= 1) return null;
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
      {ids.map((id) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          className={`px-2 py-1 rounded-full text-[9px] font-mono border transition-all cursor-pointer whitespace-nowrap ${
            id === selectedId
              ? 'bg-[#00f2fe]/15 border-[#00f2fe]/40 text-[#00f2fe]'
              : 'bg-white/5 border-white/10 text-[#8e8e93] hover:text-white'
          }`}
        >
          {truncate(id, 22)}
        </button>
      ))}
    </div>
  );
}

/* ---------- COMPUTER USE ---------- */

function ComputerViewport({
  session,
  sessions,
  selectedId,
  onSelect,
}: {
  session: ComputerStreamSession | null;
  sessions: ComputerStreamSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const lastEv = session?.events[session.events.length - 1];
  const feedRef = useAutoScroll(lastEv ? `${lastEv.event}:${lastEv.timestamp}` : '');

  if (!session) {
    return <EmptyState icon={Monitor} title="No computer session yet" hint="Ask Beatrice to run a shell command, open an app, or move the mouse — it will appear here in realtime." />;
  }

  // Last shell activity for the on-screen terminal window
  const lastShell = [...session.events].reverse().find((e) => e.event === 'shellStart' || e.event === 'shellOutput' || e.event === 'shellError');
  const lastShellOutput = [...session.events].reverse().find((e) => e.event === 'shellOutput' || e.event === 'shellError');
  // Last mouse position for the AI cursor (normalized from a 1920x1080 desktop)
  const lastMouse = [...session.events].reverse().find((e) => e.event === 'mouseMove');
  const mx = typeof lastMouse?.data.x === 'number' ? Math.min(100, Math.max(0, (lastMouse.data.x / 1920) * 100)) : 50;
  const my = typeof lastMouse?.data.y === 'number' ? Math.min(100, Math.max(0, (lastMouse.data.y / 1080) * 100)) : 40;
  const screenshotSrc = session.screenshot
    ? `data:${session.screenshotMime || 'image/png'};base64,${session.screenshot}`
    : null;

  return (
    <div className="space-y-3">
      <SessionPills ids={sessions.map((s) => s.id)} selectedId={selectedId} onSelect={onSelect} />

      {/* Desktop screen */}
      <div className="relative w-full h-56 rounded-xl overflow-hidden border border-white/10 bg-[#0a0a0c] shadow-[inset_0_0_40px_rgba(0,0,0,0.8)]">
        {screenshotSrc ? (
          <img src={screenshotSrc} alt="computer screen" className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0">
            {/* desktop wallpaper */}
            <div
              className="absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 20% 20%, rgba(0,242,254,0.18), transparent 45%), radial-gradient(circle at 80% 70%, rgba(79,172,254,0.14), transparent 45%), linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
                backgroundSize: 'auto, auto, 22px 22px, 22px 22px',
              }}
            />
            {/* taskbar */}
            <div className="absolute bottom-0 inset-x-0 h-7 bg-black/50 backdrop-blur border-t border-white/10 flex items-center px-2 gap-1.5">
              <span className="text-[9px] font-bold text-[#00f2fe] tracking-wider">EBURON OS</span>
              <span className="flex-1" />
              <span className="text-[8px] text-[#8e8e93] font-mono">{fmtTime(Date.now())}</span>
            </div>
            {/* on-screen terminal window */}
            <div className="absolute left-3 top-3 right-3 bottom-10 rounded-lg border border-white/10 bg-black/85 backdrop-blur overflow-hidden shadow-xl">
              <div className="h-6 bg-white/5 border-b border-white/10 flex items-center px-2.5 gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#ff5f56]" />
                <span className="w-2 h-2 rounded-full bg-[#ffbd2e]" />
                <span className="w-2 h-2 rounded-full bg-[#27c93f]" />
                <span className="ml-1.5 text-[8px] font-mono text-[#8e8e93]">beatrice@desktop: {truncate(session.cwd, 30)}</span>
              </div>
              <div className="p-2.5 font-mono text-[10px] leading-relaxed text-emerald-300/90 overflow-hidden">
                {lastShellOutput ? (
                  <>
                    <span className="text-[#00f2fe]">$ {String(lastShell?.data.command ?? '')}</span>
                    <pre className="whitespace-pre-wrap text-zinc-300">{truncate(String(lastShellOutput.data.output ?? ''), 220)}</pre>
                  </>
                ) : (
                  <>
                    <span className="text-[#00f2fe]">$ </span>
                    <span className="text-zinc-500">waiting for commands…</span>
                  </>
                )}
                {lastShellOutput?.event === 'shellError' && (
                  <span className="text-rose-400 block">❌ {truncate(String(lastShellOutput.data.error ?? ''), 120)}</span>
                )}
              </div>
            </div>
            {/* AI cursor */}
            {lastMouse && (
              <div
                className="absolute z-10 transition-all duration-700 ease-[cubic-bezier(0.25,1,0.5,1)]"
                style={{ left: `calc(${mx}% - 9px)`, top: `calc(${my}% - 9px)` }}
              >
                <MousePointer2 className="w-4.5 h-4.5 text-[#00f2fe] drop-shadow-[0_0_6px_rgba(0,242,254,0.9)]" />
              </div>
            )}
          </div>
        )}
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur border border-[#00f2fe]/30">
          <Radio className="w-2.5 h-2.5 text-[#00f2fe] animate-pulse" />
          <span className="text-[8px] font-bold text-[#00f2fe] tracking-widest">LIVE</span>
        </div>
      </div>

      {/* Status chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-[9px] font-mono text-[#8e8e93]">
          cwd: {truncate(session.cwd || '/', 34)}
        </span>
        {session.apps && session.apps.length > 0 && (
          <span className="px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-[9px] font-mono text-blue-300">
            {session.apps.length} apps
          </span>
        )}
        <span className="px-2 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[9px] font-mono text-rose-300">
          {session.events.length} events
        </span>
      </div>

      {/* Action feed */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8e8e93]">Live action feed</span>
          <span className="text-[9px] text-[#52525b]">what Beatrice is doing on the machine</span>
        </div>
        <div ref={feedRef} className="max-h-44 overflow-y-auto rounded-xl bg-black/50 border border-white/10 divide-y divide-white/5 scrollbar-hide">
          {session.events.length === 0 ? (
            <div className="p-4 text-center text-[10px] text-[#8e8e93]">No actions yet.</div>
          ) : (
            [...session.events].reverse().map((ev, i) => {
              const meta = COMPUTER_EVENT_META[ev.event] || { icon: Activity, color: 'text-zinc-400', label: ev.event };
              const Icon = meta.icon;
              return (
                <div key={`${ev.timestamp}-${i}`} className="flex items-start gap-2 px-2.5 py-1.5">
                  <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${meta.color}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-white">{meta.label}</span>
                      <span className="text-[8px] text-[#52525b] font-mono shrink-0">{fmtTime(ev.timestamp)}</span>
                    </div>
                    {describeComputerEvent(ev.event, ev.data) && (
                      <p className={`text-[9px] font-mono truncate ${ev.event === 'shellError' ? 'text-rose-400' : 'text-[#8e8e93]'}`}>
                        {describeComputerEvent(ev.event, ev.data)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- WEB / BROWSER ---------- */

function BrowserViewport({
  session,
  sessions,
  selectedId,
  onSelect,
}: {
  session: BrowserStreamSession | null;
  sessions: BrowserStreamSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const lastEv = session?.events[session.events.length - 1];
  const feedRef = useAutoScroll(lastEv ? `${lastEv.event}:${lastEv.timestamp}` : '');

  if (!session) {
    return <EmptyState icon={Globe} title="No browser session yet" hint="Ask Beatrice to open a website, click, type, or read a page — the browser viewport will mirror it here in realtime." />;
  }

  const lastEvent = session.events[session.events.length - 1];
  const isLive = lastEvent ? lastEvent.done === false : false;

  return (
    <div className="space-y-3">
      <SessionPills ids={sessions.map((s) => s.id)} selectedId={selectedId} onSelect={onSelect} />

      {/* Browser window */}
      <div className="rounded-xl overflow-hidden border border-white/10 bg-white shadow-2xl">
        {/* Chrome bar */}
        <div className="h-9 bg-[#1c1c1e] flex items-center px-2.5 gap-2 border-b border-white/10">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
          </div>
          <div className="flex-1 flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-md h-5 px-2">
            <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-emerald-400 shrink-0" fill="currentColor">
              <path d="M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5zm-3 8V6a3 3 0 1 1 6 0v3H9z" />
            </svg>
            <span className="text-[9px] font-mono text-[#8e8e93] truncate flex-1">{session.url || 'about:blank'}</span>
            {isLive && <span className="text-[7px] font-bold text-[#00f2fe] animate-pulse shrink-0">LIVE</span>}
          </div>
        </div>
        {/* Page viewport */}
        <div className="relative aspect-video bg-white overflow-hidden">
          {session.lastScreenshot ? (
            <>
              <img
                src={`data:image/jpeg;base64,${session.lastScreenshot}`}
                alt="browser screenshot"
                className="w-full h-full object-cover"
              />
              {isLive && (
                <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-[#00f2fe] to-transparent animate-pulse" />
              )}
            </>
          ) : (
            <div className="absolute inset-0 p-4">
              <div className="w-full h-5 bg-[#f1f5f9] rounded mb-3" />
              <div className="w-3/4 h-3 bg-[#e2e8f0] rounded mb-2" />
              <div className="w-1/2 h-3 bg-[#e2e8f0] rounded mb-4" />
              <div className="w-full h-16 bg-[#cbd5e1] rounded mb-3" />
              <div className="w-2/3 h-3 bg-[#e2e8f0] rounded mb-2" />
              <div className="w-1/3 h-3 bg-[#e2e8f0] rounded" />
              <div className="absolute bottom-2 inset-x-4 text-center text-[9px] font-mono text-[#94a3b8]">
                waiting for page render…
              </div>
            </div>
          )}
        </div>
      </div>

      {/* URL + title chips */}
      {(session.url || session.title) && (
        <div className="flex items-center gap-2 flex-wrap">
          {session.title && (
            <span className="px-2 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-[9px] font-medium text-cyan-200">
              {truncate(session.title, 40)}
            </span>
          )}
          <span className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-[9px] font-mono text-[#8e8e93]">
            {session.events.length} events
          </span>
        </div>
      )}

      {/* Event feed */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8e8e93]">Live browser log</span>
          <span className="text-[9px] text-[#52525b]">navigation · clicks · typing · console</span>
        </div>
        <div ref={feedRef} className="max-h-44 overflow-y-auto rounded-xl bg-black/50 border border-white/10 divide-y divide-white/5 scrollbar-hide">
          {session.events.length === 0 ? (
            <div className="p-4 text-center text-[10px] text-[#8e8e93]">No events yet.</div>
          ) : (
            [...session.events].reverse().map((ev, i) => {
              const meta = BROWSER_EVENT_META[ev.event] || { icon: Activity, color: 'text-zinc-400', label: ev.event };
              const Icon = meta.icon;
              return (
                <div key={`${ev.timestamp}-${i}`} className="flex items-start gap-2 px-2.5 py-1.5">
                  <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${meta.color}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-white">{meta.label}</span>
                      <span className="text-[8px] text-[#52525b] font-mono shrink-0">{fmtTime(ev.timestamp)}</span>
                    </div>
                    {describeBrowserEvent(ev.event, ev.data) && (
                      <p className={`text-[9px] font-mono truncate ${ev.event === 'error' ? 'text-rose-400' : 'text-[#8e8e93]'}`}>
                        {describeBrowserEvent(ev.event, ev.data)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- SANDBOX ---------- */

function SandboxViewport({
  run,
  runs,
  selectedId,
  onSelect,
  previewOpen,
  onTogglePreview,
  sampleIdx,
  onSampleIdx,
  onRunSandbox,
  onRunSandboxStream,
}: {
  run: CodeSandboxRun | null;
  runs: CodeSandboxRun[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  previewOpen: boolean;
  onTogglePreview: () => void;
  sampleIdx: number;
  onSampleIdx: (i: number) => void;
  onRunSandbox?: (code: string, language: string) => void;
  onRunSandboxStream?: (code: string, language: string) => void;
}) {
  const outRef = useAutoScroll(run?.output ?? '');

  if (!run) {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={Code2}
          title="No sandbox runs yet"
          hint="Pick a sample below and hit Run — or ask Beatrice to write code. Output streams here live."
        />
        <SandboxRunner sampleIdx={sampleIdx} onSampleIdx={onSampleIdx} onRunSandbox={onRunSandbox} onRunSandboxStream={onRunSandboxStream} />
      </div>
    );
  }

  const isLive = run.done === false;
  const statusColor =
    run.error ? 'text-rose-400 border-rose-500/40 bg-rose-500/10'
    : isLive ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
    : 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10';

  return (
    <div className="space-y-3">
      <SessionPills ids={runs.map((r) => r.id)} selectedId={selectedId} onSelect={onSelect} />

      {/* Output terminal */}
      <div className="rounded-xl overflow-hidden border border-white/10 bg-[#070709] shadow-[inset_0_0_30px_rgba(0,0,0,0.9)]">
        <div className="h-8 bg-white/5 border-b border-white/10 flex items-center px-2.5 gap-2">
          <Code2 className="w-3.5 h-3.5 text-[#00f2fe]" />
          <span className="text-[10px] font-mono text-[#8e8e93] truncate flex-1">{run.id}</span>
          <span className={`px-2 py-0.5 rounded-full border text-[8px] font-bold uppercase tracking-wider ${statusColor}`}>
            {run.error ? 'error' : isLive ? 'running' : 'done'}
          </span>
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white/5 bg-black/40">
          <span className="px-1.5 py-0.5 rounded bg-[#00f2fe]/15 text-[#00f2fe] text-[8px] font-bold uppercase tracking-wider border border-[#00f2fe]/30">
            {run.language || 'js'}
          </span>
          <span className="text-[8px] text-[#52525b] font-mono">{fmtTime(run.timestamp)}</span>
          {run.previewUrl && (
            <button
              onClick={onTogglePreview}
              className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[9px] font-semibold hover:bg-emerald-500/25 transition-colors cursor-pointer"
            >
              {previewOpen ? <Eye className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
              {previewOpen ? 'Hide preview' : 'Open preview'}
            </button>
          )}
        </div>
        <div ref={outRef} className="p-3 font-mono text-[10px] leading-relaxed text-zinc-300 max-h-52 overflow-y-auto whitespace-pre-wrap scrollbar-hide">
          {run.output || (
            <span className="text-[#8e8e93] animate-pulse">{isLive ? 'executing…' : 'no output'}</span>
          )}
          {isLive && <span className="inline-block w-1.5 h-3 bg-[#00f2fe] align-middle ml-1 animate-pulse" />}
        </div>
      </div>

      {/* HTML preview */}
      {run.previewUrl && previewOpen && (
        <div className="rounded-xl overflow-hidden border border-emerald-500/30 bg-white">
          <div className="h-7 bg-[#1c1c1e] flex items-center px-2.5 gap-2 border-b border-white/10">
            <span className="w-2 h-2 rounded-full bg-[#ff5f56]" />
            <span className="w-2 h-2 rounded-full bg-[#ffbd2e]" />
            <span className="w-2 h-2 rounded-full bg-[#27c93f]" />
            <span className="text-[8px] font-mono text-[#8e8e93] ml-1 truncate">{run.previewUrl}</span>
          </div>
          <iframe
            src={run.previewUrl}
            title="sandbox preview"
            className="w-full aspect-video bg-white"
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      )}

      {/* Runner */}
      <SandboxRunner sampleIdx={sampleIdx} onSampleIdx={onSampleIdx} onRunSandbox={onRunSandbox} onRunSandboxStream={onRunSandboxStream} />
    </div>
  );
}

function SandboxRunner({
  sampleIdx,
  onSampleIdx,
  onRunSandbox,
  onRunSandboxStream,
}: {
  sampleIdx: number;
  onSampleIdx: (i: number) => void;
  onRunSandbox?: (code: string, language: string) => void;
  onRunSandboxStream?: (code: string, language: string) => void;
}) {
  const sample = SANDBOX_SAMPLES[Math.min(sampleIdx, SANDBOX_SAMPLES.length - 1)];
  const run = () => {
    if (!sample) return;
    if (onRunSandboxStream) onRunSandboxStream(sample.code, sample.language);
    else onRunSandbox?.(sample.code, sample.language);
  };
  return (
    <div className="rounded-xl bg-black/50 border border-white/10 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8e8e93]">Try it</span>
        <div className="flex gap-1.5 flex-1 overflow-x-auto scrollbar-hide">
          {SANDBOX_SAMPLES.map((s, i) => (
            <button
              key={s.label}
              onClick={() => onSampleIdx(i)}
              className={`px-2 py-1 rounded-full text-[9px] font-semibold border whitespace-nowrap transition-all cursor-pointer ${
                i === sampleIdx
                  ? 'bg-[#00f2fe]/15 border-[#00f2fe]/40 text-[#00f2fe]'
                  : 'bg-white/5 border-white/10 text-[#8e8e93] hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={run}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-gradient-to-r from-[#00f2fe] to-[#4facfe] text-white text-[10px] font-bold transition-all active:scale-95 shadow-md shadow-[#00f2fe]/20 cursor-pointer shrink-0"
        >
          <Play className="w-3 h-3 fill-current" />
          Run
        </button>
      </div>
      <pre className="p-2 rounded-lg bg-[#070709] border border-white/5 text-[9px] font-mono text-zinc-400 max-h-24 overflow-auto scrollbar-hide">
        {sample.code}
      </pre>
    </div>
  );
}

/* ---------- TERMINAL CLI ---------- */

function TerminalViewport({
  run,
  runs,
  selectedId,
  onSelect,
  cmd,
  onCmd,
  onRunCli,
  onRunCliStream,
}: {
  run: CliCommandRun | null;
  runs: CliCommandRun[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  cmd: string;
  onCmd: (s: string) => void;
  onRunCli?: (command: string) => void;
  onRunCliStream?: (command: string, cwd?: string) => void;
}) {
  const outRef = useAutoScroll(run?.output ?? '');

  const runCmd = () => {
    if (!cmd.trim()) return;
    if (onRunCliStream) onRunCliStream(cmd.trim());
    else onRunCli?.(cmd.trim());
  };

  return (
    <div className="space-y-3">
      <SessionPills ids={runs.map((r) => r.id)} selectedId={selectedId} onSelect={onSelect} />

      {/* Terminal window */}
      <div className="rounded-xl overflow-hidden border border-white/10 bg-[#050507] shadow-[inset_0_0_30px_rgba(0,0,0,0.9)]">
        <div className="h-8 bg-white/5 border-b border-white/10 flex items-center px-2.5 gap-2">
          <Terminal className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[10px] font-mono text-[#8e8e93] truncate flex-1">
            {run ? run.id : 'beatrice — bash'}
          </span>
          {run && (
            <span
              className={`px-2 py-0.5 rounded-full border text-[8px] font-bold ${
                run.exitCode === 0
                  ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                  : run.exitCode === undefined && run.done === false
                  ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                  : 'text-rose-300 border-rose-500/40 bg-rose-500/10'
              }`}
            >
              {run.exitCode === undefined && run.done === false ? 'running' : `exit ${run.exitCode ?? '?'}`}
            </span>
          )}
        </div>
        <div ref={outRef} className="p-3 font-mono text-[10px] leading-relaxed max-h-64 overflow-y-auto scrollbar-hide">
          {run ? (
            <>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-emerald-400 font-bold">❯</span>
                <span className="text-[#00f2fe] font-semibold">{run.command || 'live session'}</span>
              </div>
              <pre className="whitespace-pre-wrap text-zinc-300">{run.output || ''}</pre>
              {run.done === false && <span className="inline-block w-2 h-3.5 bg-[#00f2fe] align-middle animate-pulse" />}
            </>
          ) : (
            <span className="text-[#8e8e93]">No commands yet — type below and press Enter.</span>
          )}
        </div>
      </div>

      {/* Command input */}
      <div className="flex items-center gap-2 rounded-xl bg-black/60 border border-white/10 px-3 py-2">
        <span className="text-emerald-400 font-bold font-mono text-sm">❯</span>
        <input
          type="text"
          value={cmd}
          onChange={(e) => onCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runCmd();
          }}
          placeholder="e.g. ls -la, node --version, curl example.com"
          className="flex-1 bg-transparent text-[11px] font-mono text-zinc-200 focus:outline-none placeholder:text-[#52525b]"
        />
        <button
          onClick={runCmd}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-500 text-black text-[10px] font-bold transition-all active:scale-95 cursor-pointer shrink-0"
        >
          <Play className="w-3 h-3 fill-current" />
          Run
        </button>
      </div>
      <p className="text-[9px] text-[#52525b] px-1">
        Commands execute on the workspace machine — watch stdout stream in live.
      </p>
    </div>
  );
}

/* ---------- empty state ---------- */

function EmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6 rounded-xl border border-dashed border-white/10 bg-black/30">
      <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-[#8e8e93]" />
      </div>
      <p className="text-xs font-semibold text-white">{title}</p>
      <p className="text-[10px] text-[#8e8e93] max-w-[260px] mt-1.5 leading-relaxed">{hint}</p>
      <div className="mt-4 flex items-center gap-1.5 text-[9px] text-[#00f2fe]/70">
        <ScanLine className="w-3 h-3 animate-pulse" />
        listening on the live WebSocket stream…
      </div>
    </div>
  );
}
