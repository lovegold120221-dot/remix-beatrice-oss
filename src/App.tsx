import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AgentTask,
  AttachmentInfo,
  BeatriceConfig,
  BrowserStreamSession,
  CanvasContent,
  CliCommandRun,
  CodeSandboxRun,
  CodingAgentSession,
  ComputerStreamSession,
  ContextWindowConfig,
  ConversationMemoryState,
  QwenCloudTask,
  SessionStatus,
  ToolCallLog,
  TranscriptItem,
  VideoGenerationTask,
  WsServerMessage,
} from './types';
import { AudioController, VadConfig, VadStatus } from './lib/audioUtils';
import { VideoController, CameraFacingMode } from './lib/videoUtils';
import { MobileOrb } from './components/MobileOrb';
import { VideoFeed } from './components/VideoFeed';
import { TranscriptsView } from './components/TranscriptsView';
import { ToolsWorkbench } from './components/ToolsWorkbench';
import { SettingsModal } from './components/SettingsModal';
import { ProfileModal } from './components/ProfileModal';
import { ContextWindowHUD } from './components/ContextWindowHUD';
import { MemoryInspectorModal } from './components/MemoryInspectorModal';
import { VadControlWidget } from './components/VadControlWidget';
import { WhatsAppApprovalModal, WhatsAppApprovalState, WhatsAppPanelState } from './components/WhatsAppPanel';
import { useAuth } from './context/AuthContext';
import { AuthPage } from './components/AuthPage';
import { db, auth } from './lib/firebase';
import {
  buildConversationSummary,
  loadLocalConfig,
  loadLocalTranscripts,
  loadSessionMeta,
  saveLocalConfig,
  saveLocalTranscripts,
  saveSessionMeta,
} from './lib/sessionMemory';
import {
  ref,
  push,
  set,
  get,
  update,
  remove,
  query,
  orderByChild,
  equalTo,
  onValue,
  serverTimestamp,
} from 'firebase/database';
import {
  Settings,
  Mic,
  MicOff,
  MessageSquare,
  Video,
  Wrench,
  RefreshCw,
  X,
  User as UserIcon,
  Brain,
  Volume2,
} from 'lucide-react';

export default function App() {
  const { user, signInWithGoogle } = useAuth();
  const [status, setStatus] = useState<SessionStatus>('disconnected');
  const [toolLogs, setToolLogs] = useState<ToolCallLog[]>([]);
  const [sandboxRuns, setSandboxRuns] = useState<CodeSandboxRun[]>([]);
  const [cliRuns, setCliRuns] = useState<CliCommandRun[]>([]);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [canvasData, setCanvasData] = useState<CanvasContent | null>(null);
  const [browserSessions, setBrowserSessions] = useState<BrowserStreamSession[]>([]);
  const [computerSessions, setComputerSessions] = useState<ComputerStreamSession[]>([]);
  const [codingAgentSessions, setCodingAgentSessions] = useState<CodingAgentSession[]>([]);
  const [videoTasks, setVideoTasks] = useState<VideoGenerationTask[]>([]);
  const [qwenTasks, setQwenTasks] = useState<QwenCloudTask[]>([]);
  const [waStatus, setWaStatus] = useState<WhatsAppPanelState>({
    status: 'disconnected',
    connected: false,
    pairingCode: null,
    qrDataUrl: null,
    error: null,
  });
  const [waApproval, setWaApproval] = useState<WhatsAppApprovalState | null>(null);

  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  const [showIntro, setShowIntro] = useState<boolean>(true);
  const [showIntroSkip, setShowIntroSkip] = useState<boolean>(false);
  const [introMuted, setIntroMuted] = useState<boolean>(true);
  const [introDone, setIntroDone] = useState<boolean>(false);
  const [skipAuth, setSkipAuth] = useState<boolean>(false);
  const [streamType, setStreamType] = useState<'camera' | 'screen' | 'off'>('off');
  const [facingMode, setFacingMode] = useState<CameraFacingMode>('user');
  const videoElemRef = useRef<HTMLVideoElement | null>(null);
  const introVideoRef = useRef<HTMLVideoElement | null>(null);

  const [inputVol, setInputVol] = useState<number>(0);
  const [outputVol, setOutputVol] = useState<number>(0);

  // Active Mobile Drawer: 'none' | 'chat' | 'video' | 'tools'
  const [activeDrawer, setActiveDrawer] = useState<'none' | 'chat' | 'video' | 'tools'>('none');

  const defaultConfig: BeatriceConfig = {
    voiceName: 'Aoede',
    systemInstruction: '',
    preferredLanguage: typeof navigator !== 'undefined' ? (navigator.language || 'auto') : 'auto',
    enableVideo: true,
    videoFps: 1,
    enableSandboxTool: true,
    enableCliTool: true,
    enableAgentTool: true,
    enableWebSearchTool: true,
    enableWeatherTool: true,
    enableCanvasTool: true,
    enableBrowserTool: true,
    enableComputerTool: true,
    enableVideoTool: true,
    enableQwenCloudTool: true,
  };
  const [config, setConfig] = useState<BeatriceConfig>(() => loadLocalConfig(defaultConfig));
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>(() => loadLocalTranscripts());

  // Conversation Memory & Context Window States
  const [contextConfig, setContextConfig] = useState<ContextWindowConfig>({
    maxContextTokens: 128000,
    autoPruneThreshold: 0.8,
    compressionMode: 'auto_summarize',
    memoryRetentionTurns: 20,
  });

  const [memoryState, setMemoryState] = useState<ConversationMemoryState>({
    totalEstimatedTokens: 0,
    activeTurnsCount: 0,
    compressedSummary: '',
    pruneCount: 0,
  });

  const [isMemoryInspectorOpen, setIsMemoryInspectorOpen] = useState<boolean>(false);
  const [isCompressingMemory, setIsCompressingMemory] = useState<boolean>(false);


  // Voice Activity Detection (VAD) States
  const [vadConfig, setVadConfigState] = useState<VadConfig>({
    enabled: true,
    threshold: 0.015,
    silenceDurationMs: 700,
    speechMinDurationMs: 150,
    autoBargeIn: true,
  });

  const [vadStatus, setVadStatus] = useState<VadStatus>({
    isSpeaking: false,
    rms: 0,
    db: -80,
    threshold: 0.015,
    speechDurationMs: 0,
    silenceDurationMs: 0,
  });

  const handleUpdateVadConfig = useCallback((newCfg: Partial<VadConfig>) => {
    setVadConfigState((prev) => {
      const updated = { ...prev, ...newCfg };
      audioCtrlRef.current.setVadConfig(updated);
      return updated;
    });
  }, []);

  // Sync VAD callbacks with AudioController
  useEffect(() => {
    audioCtrlRef.current.setVadConfig(vadConfig);
    audioCtrlRef.current.onVadStatus((s) => setVadStatus(s));
    audioCtrlRef.current.onSpeechStart(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && status === 'speaking') {
        if (vadConfig.autoBargeIn) {
          wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
        }
      }
    });
  }, [vadConfig, status]);

  // Real-time Token Calculation Effect for Context Window
  useEffect(() => {
    const dialogueTurns = transcripts.filter((t) => t.role !== 'system');
    const dialogueChars = dialogueTurns.reduce((acc, t) => acc + (t.text ? t.text.length : 0), 0);
    const sysChars = (config.systemInstruction || '').length;
    const canvasChars = canvasData ? (canvasData.content || '').length : 0;

    // ~3.8 chars per token
    const estimatedTokens = Math.max(1, Math.round((dialogueChars + sysChars + canvasChars) / 3.8));

    setMemoryState((prev) => ({
      ...prev,
      totalEstimatedTokens: estimatedTokens,
      activeTurnsCount: dialogueTurns.length,
    }));
  }, [transcripts, config.systemInstruction, canvasData]);

  // Compress Context Function
  const handleCompressContext = useCallback(async () => {
    setIsCompressingMemory(true);
    try {
      const dialogueTurns = transcripts.filter((t) => t.role !== 'system');
      if (dialogueTurns.length < 2) {
        setIsCompressingMemory(false);
        return;
      }

      const userTopics = dialogueTurns
        .filter((t) => t.role === 'user')
        .map((t) => t.text.slice(0, 60))
        .join('; ');

      const summaryText = `[Session Memory Pruned at ${new Date().toLocaleTimeString()}]: Condensed ${dialogueTurns.length} turns into memory buffer. Key topics discussed: "${userTopics || 'General session guidance'}". Active tools used: ${toolLogs.length}.`;

      setMemoryState((prev) => ({
        ...prev,
        compressedSummary: prev.compressedSummary
          ? `${prev.compressedSummary}\n${summaryText}`
          : summaryText,
        summaryLastUpdated: Date.now(),
        pruneCount: prev.pruneCount + 1,
      }));

      // Keep latest 6 turns in active transcript memory stack
      if (dialogueTurns.length > 6) {
        const systemItem = transcripts.find((t) => t.role === 'system');
        const recentTurns = dialogueTurns.slice(-6);
        setTranscripts(systemItem ? [systemItem, ...recentTurns] : recentTurns);
      }

      // Save compressed session snapshot to RTDB if user logged in
      if (user) {
        const sessionRef = push(ref(db, `saved_sessions/${user.uid}`));
        await set(sessionRef, {
          userId: user.uid,
          title: `Compressed Memory (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
          summary: summaryText,
          transcriptCount: dialogueTurns.length,
          transcriptsSummary: dialogueTurns.map((t) => `${t.role.toUpperCase()}: ${t.text.slice(0, 80)}`),
          canvasState: {
            title: canvasData?.title || 'Live Canvas Workspace',
            language: 'markdown',
            code: canvasData?.content || '',
            notes: 'Auto-pruned conversation context window.',
          },
          timestamp: serverTimestamp(),
        });
      }
    } catch (err) {
      console.warn('Memory compression error:', err);
    } finally {
      setIsCompressingMemory(false);
    }
  }, [transcripts, toolLogs.length, canvasData, user]);

  const handleClearMemory = useCallback(() => {
    setTranscripts([]);
    setMemoryState({
      totalEstimatedTokens: 0,
      activeTurnsCount: 0,
      compressedSummary: '',
      pruneCount: 0,
    });
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtrlRef = useRef<AudioController>(new AudioController());
  const videoCtrlRef = useRef<VideoController>(new VideoController());
  const reconnectAttemptRef = useRef<number>(0);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isManualDisconnectRef = useRef<boolean>(false);
  const userRef = useRef(user);
  userRef.current = user;
  const configRef = useRef(config);
  configRef.current = config;
  const transcriptsRef = useRef(transcripts);
  transcriptsRef.current = transcripts;

  // Persist config + transcripts locally so refresh/reconnect never wipes language or memory
  useEffect(() => {
    saveLocalConfig(config);
    saveSessionMeta({ preferredLanguage: config.preferredLanguage || 'auto' });
  }, [config]);

  useEffect(() => {
    saveLocalTranscripts(transcripts);
    const dialogue = transcripts.filter((t) => t.role === 'user' || t.role === 'model');
    if (dialogue.length > 0) {
      const last = dialogue[dialogue.length - 1];
      saveSessionMeta({
        lastInteractionAt: last.timestamp || Date.now(),
        conversationSummary: buildConversationSummary(transcripts),
        preferredLanguage: config.preferredLanguage || 'auto',
      });
    }
  }, [transcripts, config.preferredLanguage]);

  // RTDB Transcripts Listener for Authenticated User — merge, never wipe local memory
  useEffect(() => {
    if (!user || !auth.currentUser || auth.currentUser.uid !== user.uid) return;
    const transcriptsRef = ref(db, `transcripts/${user.uid}`);

    const unsubscribe = onValue(
      transcriptsRef,
      (snapshot) => {
        const loaded: TranscriptItem[] = [];
        snapshot.forEach((childSnap) => {
          const data = childSnap.val();
          loaded.push({
            id: childSnap.key!,
            role: data.role,
            text: data.text,
            timestamp: data.timestamp,
          });
        });
        loaded.sort((a, b) => a.timestamp - b.timestamp);
        if (loaded.length === 0) return;
        setTranscripts((prev) => {
          const byKey = new Map<string, TranscriptItem>();
          for (const t of prev) byKey.set(`${t.role}:${t.timestamp}:${(t.text || '').slice(0, 40)}`, t);
          for (const t of loaded) byKey.set(`${t.role}:${t.timestamp}:${(t.text || '').slice(0, 40)}`, t);
          return Array.from(byKey.values())
            .sort((a, b) => a.timestamp - b.timestamp)
            .slice(-80);
        });
      },
      (error) => {
        console.warn('RTDB transcripts error:', error);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // RTDB User Config Sync — language + voice persist to cloud when signed in
  useEffect(() => {
    if (!user || !auth.currentUser || auth.currentUser.uid !== user.uid) return;
    const syncUserConfig = async () => {
      try {
        const configRef = ref(db, `user_configs/${user.uid}`);
        const snap = await get(configRef);
        if (snap.exists()) {
          const data = snap.val();
          setConfig((prev) => {
            const next = {
              ...prev,
              voiceName: data.voiceName || prev.voiceName,
              systemInstruction: data.systemInstruction ?? prev.systemInstruction,
              preferredLanguage: data.preferredLanguage || prev.preferredLanguage || 'auto',
              videoFps: data.videoFps || prev.videoFps,
            };
            saveLocalConfig(next);
            return next;
          });
        } else {
          await set(configRef, {
            voiceName: config.voiceName,
            systemInstruction: config.systemInstruction,
            preferredLanguage: config.preferredLanguage || 'auto',
            videoFps: config.videoFps,
            userId: user.uid,
            updatedAt: Date.now(),
          });
        }
      } catch (err) {
        console.warn('RTDB user_configs error:', err);
      }
    };
    syncUserConfig();
  }, [user]);

  // Save Transcript to RTDB helper
  const saveTranscriptToRTDB = useCallback(async (item: TranscriptItem) => {
    const u = userRef.current;
    if (!u || !auth.currentUser || auth.currentUser.uid !== u.uid) return;
    try {
      const transcriptRef = push(ref(db, `transcripts/${u.uid}`));
      await set(transcriptRef, {
        role: item.role,
        text: item.text,
        timestamp: item.timestamp,
        userId: u.uid,
      });
    } catch (err) {
      console.warn('RTDB saveTranscript error:', err);
    }
  }, []);

  // Clear Transcripts helper
  const handleClearTranscripts = useCallback(async () => {
    setTranscripts([]);
    saveLocalTranscripts([]);
    saveSessionMeta({ conversationSummary: '', lastInteractionAt: 0 });
    const u = userRef.current;
    if (!u || !auth.currentUser || auth.currentUser.uid !== u.uid) return;
    try {
      await remove(ref(db, `transcripts/${u.uid}`));
    } catch (err) {
      console.warn('RTDB clearTranscripts error:', err);
    }
  }, []);

  // Save Tool Log to RTDB helper
  const saveToolLogToRTDB = useCallback(async (log: ToolCallLog) => {
    const u = userRef.current;
    if (!u || !auth.currentUser || auth.currentUser.uid !== u.uid) return;
    try {
      const logRef = push(ref(db, `tool_logs/${u.uid}`));
      await set(logRef, {
        name: log.name,
        args: JSON.stringify(log.args || {}),
        result: log.result || '',
        status: log.status,
        timestamp: log.timestamp,
        userId: u.uid,
      });
    } catch (err) {
      console.warn('RTDB saveToolLog error:', err);
    }
  }, []);

  // Connect to Beatrice OSS WebSocket server with Exponential Backoff Strategy
  const connectWebSocket = useCallback(() => {
    // Clear any active reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    isManualDisconnectRef.current = false;
    setStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/live`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = async () => {
      console.log('Connected to Beatrice Live WebSocket bridge.');
      // Successful connection: reset backoff counter
      reconnectAttemptRef.current = 0;
      setStatus('connecting');

      // Push language + conversation memory BEFORE Live starts (server waits ~1.5s)
      try {
        const meta = loadSessionMeta();
        const recent = (loadLocalTranscripts().length ? loadLocalTranscripts() : transcriptsRef.current || [])
          .filter((t) => t.role === 'user' || t.role === 'model')
          .slice(-16)
          .map((t) => ({ role: t.role, text: t.text, timestamp: t.timestamp }));
        const cfg = configRef.current;
        ws.send(
          JSON.stringify({
            type: 'sessionBootstrap',
            bootstrap: {
              preferredLanguage: cfg.preferredLanguage || meta.preferredLanguage || navigator.language || 'auto',
              voiceName: cfg.voiceName || 'Aoede',
              systemInstruction: cfg.systemInstruction || '',
              conversationSummary: meta.conversationSummary || buildConversationSummary(recent as TranscriptItem[]),
              recentTurns: recent,
              lastInteractionAt: meta.lastInteractionAt || 0,
              userDisplayName: userRef.current?.displayName || 'Boss',
            },
          })
        );
      } catch (err) {
        console.warn('sessionBootstrap send failed:', err);
      }

      // Start Microphone input capture
      try {
        await audioCtrlRef.current.startInput((base64Pcm16) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'audio', audio: base64Pcm16 }));
          }
        });
      } catch (err) {
        console.error('Microphone start error:', err);
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsServerMessage = JSON.parse(event.data);

        switch (msg.type) {
          case 'status':
            // Keep bridge healthy: never wipe chat on Live reconnect/connecting blips
            if (msg.status === 'disconnected') {
              // Only mark disconnected if socket is actually gone
              if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                setStatus('disconnected');
              } else {
                setStatus('connecting');
              }
            } else {
              setStatus(msg.status);
            }
            break;

          case 'audio':
            audioCtrlRef.current.playChunk(msg.audio);
            setStatus('speaking');
            break;

          case 'interrupted':
            audioCtrlRef.current.stopPlayback();
            setStatus('listening');
            break;

          case 'turnComplete':
            setStatus('listening');
            break;

          case 'transcript': {
            const newItem: TranscriptItem = {
              id: 'tr_' + Math.random().toString(36).substring(2, 9),
              role: msg.role,
              text: msg.text,
              timestamp: Date.now(),
            };
            setTranscripts((prev) => [...prev, newItem]);
            saveTranscriptToRTDB(newItem);
            break;
          }

          case 'toolCall':
            setToolLogs((prev) => [
              ...prev,
              {
                id: msg.id,
                name: msg.name,
                args: msg.args,
                status: 'executing',
                timestamp: Date.now(),
              },
            ]);
            break;

          case 'toolResult':
            setToolLogs((prev) =>
              prev.map((log) =>
                log.id === msg.id
                  ? { ...log, result: msg.result, status: 'completed' }
                  : log
              )
            );
            break;

          case 'whatsappStatus':
            setWaStatus({
              status: msg.status,
              connected: msg.connected,
              pairingCode: msg.pairingCode ?? null,
              qrDataUrl: msg.qrDataUrl ?? null,
              error: msg.error ?? null,
              reconnectAttempt: msg.reconnectAttempt ?? 0,
            });
            break;

          case 'whatsappApprovalRequest':
            setWaApproval({
              id: msg.id,
              recipient: msg.recipient,
              recipientName: msg.recipientName,
              purpose: msg.purpose,
            });
            break;

          case 'whatsappIncomingMessages':
            break;

          case 'sandboxOutput':
            setSandboxRuns((prev) => [msg.run, ...prev]);
            break;

          case 'cliOutput':
            setCliRuns((prev) => [msg.run, ...prev]);
            break;

          case 'sandboxStream': {
            setSandboxRuns((prev) => {
              const idx = prev.findIndex((r) => r.id === msg.runId);
              if (idx > -1) {
                const updated = [...prev];
                updated[idx] = { ...updated[idx], output: updated[idx].output + msg.chunk, stream: msg.chunk, done: msg.done, error: msg.error };
                return updated;
              }
              return [
                {
                  id: msg.runId,
                  language: 'stream',
                  code: '',
                  output: msg.chunk,
                  stream: msg.chunk,
                  done: msg.done,
                  error: msg.error,
                  timestamp: Date.now(),
                },
                ...prev,
              ];
            });
            break;
          }

          case 'cliStream': {
            setCliRuns((prev) => {
              const idx = prev.findIndex((r) => r.id === msg.sessionId);
              if (idx > -1) {
                const updated = [...prev];
                updated[idx] = { ...updated[idx], output: updated[idx].output + msg.chunk, stream: msg.chunk, done: msg.done, exitCode: msg.exitCode ?? updated[idx].exitCode };
                return updated;
              }
              return [
                {
                  id: msg.sessionId,
                  command: 'live session',
                  output: msg.chunk,
                  stream: msg.chunk,
                  exitCode: msg.exitCode ?? 0,
                  done: msg.done,
                  timestamp: Date.now(),
                },
                ...prev,
              ];
            });
            break;
          }

          case 'browserUpdate': {
            setBrowserSessions((prev) => {
              const idx = prev.findIndex((s) => s.id === msg.sessionId);
              const entry = idx > -1 ? prev[idx] : { id: msg.sessionId, log: [], timestamp: Date.now() };
              const updatedEntry: BrowserStreamSession = {
                ...entry,
                id: msg.sessionId,
                url: (msg.url as string) || entry.url,
                title: (msg.title as string) || entry.title,
                lastScreenshot: (msg.screenshot as string) || entry.lastScreenshot,
                log: msg.event ? [...entry.log, `[${msg.event}] ${JSON.stringify(msg)}`] : entry.log,
                timestamp: Date.now(),
              };
              if (idx > -1) {
                const updated = [...prev];
                updated[idx] = updatedEntry;
                return updated;
              }
              return [updatedEntry, ...prev];
            });
            break;
          }

          case 'computerUpdate': {
            setComputerSessions((prev) => {
              const idx = prev.findIndex((s) => s.id === msg.sessionId);
              const entry = idx > -1 ? prev[idx] : { id: msg.sessionId, cwd: '/', log: [], timestamp: Date.now() };
              const updatedEntry: ComputerStreamSession = {
                ...entry,
                id: msg.sessionId,
                cwd: (msg.cwd as string) || entry.cwd,
                log: msg.event ? [...entry.log, `[${msg.event}] ${JSON.stringify(msg)}`] : entry.log,
                timestamp: Date.now(),
              };
              if (idx > -1) {
                const updated = [...prev];
                updated[idx] = updatedEntry;
                return updated;
              }
              return [updatedEntry, ...prev];
            });
            break;
          }

          case 'codingAgentUpdate':
            setCodingAgentSessions((prev) => {
              const idx = prev.findIndex((s) => s.id === msg.session.id);
              if (idx > -1) {
                const updated = [...prev];
                updated[idx] = msg.session;
                return updated;
              }
              return [msg.session, ...prev];
            });
            break;

          case 'codingAgentStream': {
            setCodingAgentSessions((prev) => {
              const idx = prev.findIndex((s) => s.id === msg.sessionId);
              if (idx > -1) {
                const updated = [...prev];
                updated[idx] = {
                  ...updated[idx],
                  output: updated[idx].output + (msg.chunk || ''),
                  log: msg.chunk ? [...updated[idx].log, msg.chunk.trim()] : updated[idx].log,
                  status: msg.done ? (msg.error ? 'failed' : 'completed') : updated[idx].status,
                  error: msg.error || updated[idx].error,
                };
                return updated;
              }
              return prev;
            });
            break;
          }

          case 'agentUpdate':
            setAgentTasks((prev) => {
              const idx = prev.findIndex((a) => a.id === msg.agent.id);
              if (idx > -1) {
                const updated = [...prev];
                updated[idx] = msg.agent;
                return updated;
              }
              return [msg.agent, ...prev];
            });
            break;

          case 'canvasUpdate':
            setCanvasData(msg.canvas);
            break;

          case 'videoGenerationUpdate': {
            setVideoTasks((prev) => {
              const idx = prev.findIndex((t) => t.id === msg.task.id);
              if (idx > -1) {
                const updated = [...prev];
                updated[idx] = msg.task;
                return updated;
              }
              return [msg.task, ...prev];
            });
            break;
          }

          case 'qwencloudUpdate': {
            setQwenTasks((prev) => {
              const idx = prev.findIndex((t) => t.id === msg.task.id);
              if (idx > -1) {
                const updated = [...prev];
                updated[idx] = msg.task;
                return updated;
              }
              return [msg.task, ...prev];
            });
            break;
          }

          case 'error':
            console.error('Beatrice Server error:', msg.message);
            setTranscripts((prev) => [
              ...prev,
              {
                id: 'err_' + Date.now(),
                role: 'system',
                text: 'Error: ' + msg.message,
                timestamp: Date.now(),
              },
            ]);
            setStatus('error');
            break;
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    ws.onerror = (event) => {
      console.warn('WebSocket connection status update:', event);
      setStatus('error');
    };

    ws.onclose = () => {
      console.log('WebSocket connection closed.');
      setStatus('disconnected');

      // Exponential backoff automatic reconnect if unexpected disconnect
      const MAX_RECONNECT_ATTEMPTS = 10;
      const INITIAL_RECONNECT_DELAY_MS = 1000;
      const MAX_RECONNECT_DELAY_MS = 30000;

      if (!isManualDisconnectRef.current) {
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptRef.current += 1;
          const attempt = reconnectAttemptRef.current;
          // Exponential backoff formula: min(MAX, INITIAL * 2^(attempt-1)) + jitter
          const baseDelay = INITIAL_RECONNECT_DELAY_MS * Math.pow(2, attempt - 1);
          const cappedDelay = Math.min(MAX_RECONNECT_DELAY_MS, baseDelay);
          const jitter = Math.floor(Math.random() * 500);
          const delay = cappedDelay + jitter;

          console.log(`[Backoff] Scheduling reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS} in ${(delay / 1000).toFixed(1)}s...`);

          setTranscripts((prev) => {
            const noticeText = `Connection lost. Automatically reconnecting in ${(delay / 1000).toFixed(1)}s (Attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS})...`;
            const last = prev[prev.length - 1];
            if (last && last.role === 'system' && last.text.startsWith('Connection lost.')) {
              return prev.slice(0, -1).concat({
                id: 'reconnect_' + Date.now(),
                role: 'system',
                text: noticeText,
                timestamp: Date.now(),
              });
            }
            return [
              ...prev,
              {
                id: 'reconnect_' + Date.now(),
                role: 'system',
                text: noticeText,
                timestamp: Date.now(),
              },
            ];
          });

          reconnectTimerRef.current = setTimeout(() => {
            connectWebSocket();
          }, delay);
        } else {
          console.warn(`[Backoff] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached.`);
          setTranscripts((prev) => [
            ...prev,
            {
              id: 'reconnect_failed_' + Date.now(),
              role: 'system',
              text: 'Reconnection attempts exhausted. Click "Reconnect Beatrice" below to manually reconnect.',
              timestamp: Date.now(),
            },
          ]);
        }
      }
    };
  }, []);

  // Poll audio volume levels for Orb visualizer animation
  useEffect(() => {
    const timer = setInterval(() => {
      const levels = audioCtrlRef.current.getLevels();
      setInputVol(levels.input);
      setOutputVol(levels.output);
    }, 50);

    return () => clearInterval(timer);
  }, []);

  const gatePassed = introDone && (!!user || skipAuth);

  // Block pinch/double-tap/ctrl-wheel zoom (vertical scrolling stays untouched)
  useEffect(() => {
    const preventMultiTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    const preventWheelZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const preventGesture = (e: Event) => e.preventDefault();
    document.addEventListener('touchmove', preventMultiTouch, { passive: false });
    document.addEventListener('wheel', preventWheelZoom, { passive: false });
    document.addEventListener('gesturestart', preventGesture);
    document.addEventListener('dblclick', preventGesture);
    return () => {
      document.removeEventListener('touchmove', preventMultiTouch);
      document.removeEventListener('wheel', preventWheelZoom);
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('dblclick', preventGesture);
    };
  }, []);

  const finishIntro = useCallback(() => {
    setShowIntro(false);
    setIntroDone(true);
  }, []);

  const handleIntroLoaded = useCallback(() => {
    setShowIntroSkip(false);
    setTimeout(() => setShowIntroSkip(true), 3000);
    const v = introVideoRef.current;
    if (!v) return;
    v.muted = false;
    const p = v.play();
    if (p) p.catch(() => setIntroMuted(true));
  }, []);

  const handleIntroUnmute = useCallback(() => {
    setIntroMuted(false);
    const v = introVideoRef.current;
    if (v) {
      v.muted = false;
      const p = v.play();
      if (p) p.catch(() => setIntroMuted(true));
    }
  }, []);

  // Auto-connect on mount once the user has passed the intro/auth gate
  useEffect(() => {
    if (!gatePassed) return;
    connectWebSocket();
    return () => {
      isManualDisconnectRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      audioCtrlRef.current.stopAll();
      videoCtrlRef.current.stop();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatePassed]);

  const handleManualReconnect = useCallback(() => {
    isManualDisconnectRef.current = false;
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // Prefer soft Live restart (keeps language + memory) if bridge is still open
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const meta = loadSessionMeta();
      const cfg = configRef.current;
      wsRef.current.send(
        JSON.stringify({
          type: 'restartLive',
          bootstrap: {
            preferredLanguage: cfg.preferredLanguage || meta.preferredLanguage || 'auto',
            voiceName: cfg.voiceName || 'Aoede',
            systemInstruction: cfg.systemInstruction || '',
            conversationSummary: meta.conversationSummary || buildConversationSummary(transcriptsRef.current),
            recentTurns: transcriptsRef.current
              .filter((t) => t.role === 'user' || t.role === 'model')
              .slice(-16)
              .map((t) => ({ role: t.role, text: t.text, timestamp: t.timestamp })),
            lastInteractionAt: meta.lastInteractionAt || 0,
            userDisplayName: userRef.current?.displayName || 'Boss',
          },
        })
      );
      setStatus('connecting');
      return;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {
        // ignore
      }
      wsRef.current = null;
    }
    connectWebSocket();
  }, [connectWebSocket]);

  // Video Streaming Handlers
  const handleStartCamera = async (videoElem: HTMLVideoElement, overrideFacingMode?: CameraFacingMode) => {
    try {
      videoElemRef.current = videoElem;
      const mode = overrideFacingMode || facingMode;
      await videoCtrlRef.current.startCamera(
        videoElem,
        (base64Jpeg) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'video', video: base64Jpeg }));
          }
        },
        config.videoFps,
        mode
      );
      setStreamType('camera');
    } catch (err) {
      console.error('Camera start error:', err);
    }
  };

  const handleToggleFacingMode = async () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    triggerHaptic([10, 15]);
    if (streamType === 'camera' && videoElemRef.current) {
      await handleStartCamera(videoElemRef.current, nextMode);
    }
  };

  const handleStartScreen = async (videoElem: HTMLVideoElement) => {
    try {
      await videoCtrlRef.current.startScreenShare(
        videoElem,
        (base64Jpeg) => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'video', video: base64Jpeg }));
          }
        },
        config.videoFps
      );
      setStreamType('screen');
    } catch (err) {
      console.error('Screen share error:', err);
    }
  };

  const handleStopVideo = () => {
    videoCtrlRef.current.stop();
    setStreamType('off');
  };

  const triggerHaptic = (pattern: number | number[] = 10) => {
    if (window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(pattern);
    }
  };

  const handleToggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    audioCtrlRef.current.setMute(newMuted);
    
    // Tactile feedback for mute toggle
    if (newMuted) {
      triggerHaptic(10); // Light tap for turning off
    } else {
      triggerHaptic([15, 30, 15]); // Distinct double tap for turning on
    }
  };

  const handleInterrupt = () => {
    triggerHaptic([20, 20]);
    audioCtrlRef.current.stopPlayback();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
    setStatus('listening');
  };

  const handleSendTextMessage = (text: string, attachment?: AttachmentInfo) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const userItem: TranscriptItem = {
        id: 'user_txt_' + Date.now(),
        role: 'user',
        text,
        timestamp: Date.now(),
        attachments: attachment ? [attachment] : undefined,
      };
      setTranscripts((prev) => [...prev, userItem]);
      saveTranscriptToRTDB(userItem);
      wsRef.current.send(JSON.stringify({ type: 'text', text, attachment }));
    }
  };

  const handleRunSandbox = async (code: string, language: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'runSandbox', code, language }));
    } else {
      // Fallback via HTTP REST endpoint when WS is offline
      try {
        const res = await fetch('/api/tools/execute-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, language }),
        });
        const data = await res.json();
        setSandboxRuns((prev) => [
          {
            id: 'sb_' + Date.now(),
            code,
            language,
            output: data.output || data.error || 'Execution completed',
            error: data.error,
            status: data.error ? 'failed' : 'success',
            executionTimeMs: data.executionTimeMs || 0,
            timestamp: Date.now(),
          },
          ...prev,
        ]);
      } catch (err: any) {
        console.error('REST sandbox execution error:', err);
      }
    }
  };

  const handleRunCli = async (command: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'runCli', command }));
    } else {
      // Fallback via HTTP REST endpoint when WS is offline
      try {
        const res = await fetch('/api/tools/cli', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command }),
        });
        const data = await res.json();
        setCliRuns((prev) => [
          {
            id: 'cli_' + Date.now(),
            command,
            output: data.output || data.error || 'Command finished',
            exitCode: data.exitCode ?? (data.error ? 1 : 0),
            timestamp: Date.now(),
          },
          ...prev,
        ]);
      } catch (err: any) {
        console.error('REST CLI execution error:', err);
      }
    }
  };

  const handleDeployAgent = async (agentName: string, task: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'deployAgent', agentName, task }));
    } else {
      try {
        const res = await fetch('/api/tools/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentName, task }),
        });
        const data = await res.json();
        setAgentTasks((prev) => [
          {
            id: data.agentId || 'ag_' + Date.now(),
            agentName,
            task,
            status: 'completed',
            progress: 100,
            logs: ['Task completed via REST trigger.'],
            result: data.result,
            timestamp: Date.now(),
          },
          ...prev,
        ]);
      } catch (err) {
        console.error('REST agent deploy error:', err);
      }
    }
  };

  const handleGetSystemInfo = async () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'getSystemInfo' }));
    } else {
      try {
        const res = await fetch('/api/tools/system-info');
        const data = await res.json();
        const callId = 'manual_sys_' + Date.now();
        const log: ToolCallLog = {
          id: callId,
          name: 'getSystemInfo',
          args: {},
          result: data,
          status: 'completed',
          timestamp: Date.now(),
        };
        setToolLogs((prev) => [log, ...prev]);
        saveToolLogToRTDB(log);
      } catch (err) {
        console.error('REST system info error:', err);
      }
    }
  };

  const handleUpdateCanvas = async (canvasType: 'diagram' | 'markdown' | 'chart' | 'code_snippet', title: string, content: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'updateCanvas', canvasType, title, content }));
    } else {
      try {
        await fetch('/api/tools/canvas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canvasType, title, content }),
        });
        setCanvasData({ type: canvasType, title, content, updatedAt: Date.now() });
      } catch (err) {
        console.error('REST canvas update error:', err);
      }
    }
  };

  const handleGetWeather = async (location: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'getWeather', location }));
    } else {
      try {
        const res = await fetch('/api/tools/weather', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ location }),
        });
        const data = await res.json();
        const callId = 'manual_weather_' + Date.now();
        const log: ToolCallLog = {
          id: callId,
          name: 'getWeather',
          args: { location },
          result: data,
          status: 'completed',
          timestamp: Date.now(),
        };
        setToolLogs((prev) => [log, ...prev]);
        saveToolLogToRTDB(log);
      } catch (err) {
        console.error('REST weather error:', err);
      }
    }
  };

  const handleRunSandboxStream = async (code: string, language: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'runSandboxStream', code, language }));
    }
  };

  const handleRunCliStream = async (command: string, cwd?: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const start = cliRuns.length === 0;
      wsRef.current.send(JSON.stringify({ type: 'runCliStream', startSession: start, command, cwd }));
    }
  };

  const handleRunBrowser = async (action: string, payload: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'runBrowser', action, payload }));
    }
  };

  const handleRunComputer = async (action: string, payload: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'runComputer', action, payload }));
    }
  };

  const handleRunCodingAgent = async (task: string, cwd?: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'runCodingAgent', task, cwd }));
    }
  };

  const handleCancelCodingAgent = async (sessionId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cancelCodingAgent', sessionId }));
    }
  };

  const handleGenerateVideo = async (params: { prompt: string; resolution?: string; ratio?: string; duration?: number }) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'generateVideo', ...params }));
    }
  };

  const handleQwenCloud = async (kind: string, params: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: `qwen${kind.charAt(0).toUpperCase() + kind.slice(1)}`, ...params }));
    }
  };

  const handleWebSearch = async (query: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'webSearch', query }));
    } else {
      try {
        const res = await fetch('/api/tools/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        });
        const data = await res.json();
        const callId = 'manual_search_' + Date.now();
        const log: ToolCallLog = {
          id: callId,
          name: 'webSearch',
          args: { query },
          result: data,
          status: 'completed',
          timestamp: Date.now(),
        };
        setToolLogs((prev) => [log, ...prev]);
        saveToolLogToRTDB(log);
      } catch (err) {
        console.error('REST search error:', err);
      }
    }
  };

  const respondWhatsAppApproval = (approve: boolean) => {
    if (waApproval && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'whatsappApproval', id: waApproval.id, approve }));
    }
    setWaApproval(null);
  };

  const handlePairWhatsApp = async (phone: string) => {
    setWaStatus((s) => ({ ...s, error: null, status: 'connecting' }));
    try {
      const res = await fetch('/api/whatsapp/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!data.ok) {
        setWaStatus((s) => ({ ...s, status: 'disconnected', error: data.error || 'Pairing failed.' }));
        return;
      }
      setWaStatus((s) => ({
        ...s,
        status: 'pairing',
        pairingCode: data.pairingCode || null,
        qrDataUrl: null,
        error: null,
      }));
    } catch (err: any) {
      setWaStatus((s) => ({ ...s, status: 'disconnected', error: err.message || 'Pairing failed.' }));
    }
  };

  const handleQrPairWhatsApp = async () => {
    setWaStatus((s) => ({ ...s, error: null, status: 'connecting', qrDataUrl: null, pairingCode: null }));
    try {
      const res = await fetch('/api/whatsapp/pair-qr', { method: 'POST' });
      const data = await res.json();
      if (!data.ok) {
        setWaStatus((s) => ({ ...s, status: 'disconnected', error: data.error || 'QR pairing failed.' }));
      }
    } catch (err: any) {
      setWaStatus((s) => ({ ...s, status: 'disconnected', error: err.message || 'QR pairing failed.' }));
    }
  };

  const handleCancelWhatsAppPairing = async () => {
    try {
      await fetch('/api/whatsapp/cancel', { method: 'POST' });
    } catch {
      // ignore
    }
    setWaStatus((s) => ({ ...s, status: 'disconnected', pairingCode: null, qrDataUrl: null, error: null }));
  };

  const handleLogoutWhatsApp = async () => {
    try {
      await fetch('/api/whatsapp/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setWaStatus({
      status: 'logged_out',
      connected: false,
      pairingCode: null,
      qrDataUrl: null,
      error: null,
    });
  };

  const handleUpdateConfig = (newCfg: Partial<BeatriceConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...newCfg };
      saveLocalConfig(next);
      // Push language/voice to Live without tearing down browser WS
      if (
        wsRef.current &&
        wsRef.current.readyState === WebSocket.OPEN &&
        (newCfg.preferredLanguage !== undefined || newCfg.voiceName !== undefined || newCfg.systemInstruction !== undefined)
      ) {
        const meta = loadSessionMeta();
        wsRef.current.send(
          JSON.stringify({
            type: 'updateSessionPrefs',
            preferredLanguage: next.preferredLanguage,
            voiceName: next.voiceName,
            systemInstruction: next.systemInstruction,
            bootstrap: {
              preferredLanguage: next.preferredLanguage,
              voiceName: next.voiceName,
              systemInstruction: next.systemInstruction,
              conversationSummary: meta.conversationSummary,
              recentTurns: transcriptsRef.current
                .filter((t) => t.role === 'user' || t.role === 'model')
                .slice(-16)
                .map((t) => ({ role: t.role, text: t.text, timestamp: t.timestamp })),
              lastInteractionAt: meta.lastInteractionAt,
              userDisplayName: userRef.current?.displayName || 'Boss',
            },
          })
        );
      }
      // Persist language to RTDB when signed in
      const u = userRef.current;
      if (u) {
        update(ref(db, `user_configs/${u.uid}`), {
          voiceName: next.voiceName,
          systemInstruction: next.systemInstruction,
          preferredLanguage: next.preferredLanguage,
          videoFps: next.videoFps,
          userId: u.uid,
          updatedAt: Date.now(),
        }).catch(() => {});
      }
      return next;
    });
  };

  return (
    <div className="w-screen h-screen h-dvh bg-[#050505] text-white flex justify-center items-center overflow-x-hidden overflow-y-auto font-sans selection:bg-[#4facfe]/30 select-none">
      {gatePassed && (
        <>
      {/* App Container Frame */}
      <div className="w-full max-w-[430px] h-full sm:h-[90vh] sm:rounded-[44px] sm:border-[6px] sm:border-[#1c1c1e] bg-black flex flex-col justify-between relative sm:shadow-[0_0_60px_rgba(0,0,0,0.8),inset_0_0_0_2px_#2c2c2e] overflow-hidden">
        
        {/* Ambient background glow */}
        <div className="absolute top-[20%] left-[10%] right-[10%] bottom-[20%] bg-[radial-gradient(circle,rgba(0,242,254,0.15)_0%,transparent_70%)] z-0 pointer-events-none" />

        {/* Glassmorphism Header */}
        <header className="px-6 pt-6 pb-4 sm:pt-[max(24px,env(safe-area-inset-top))] flex items-center justify-between z-20 bg-gradient-to-b from-black/80 to-transparent sticky top-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                triggerHaptic(10);
                setIsSettingsOpen(true);
              }}
              className="w-10 h-10 rounded-full bg-white/5 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white transition-all duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] active:scale-90 active:bg-white/15 cursor-pointer"
              aria-label="Settings"
              title="Open Settings"
            >
              <Settings className="w-5 h-5" strokeWidth={2.5} />
            </button>
          </div>

          <div className="text-center flex flex-col gap-1">
            <h1 className="text-[1.15rem] font-bold tracking-[0.2px] text-white">
              Beatrice
            </h1>
            <p className="text-[0.65rem] font-semibold tracking-[0.15em] text-[#8e8e93] uppercase">
              EBURON AI
            </p>
          </div>

          {user ? (
            <img
              src={user.photoURL || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=100&q=80'}
              alt={user.displayName || 'User Profile'}
              onClick={() => {
                triggerHaptic(10);
                setIsProfileOpen(true);
              }}
              className="w-11 h-11 rounded-full object-cover border-2 border-white/10 cursor-pointer transition-transform duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] active:scale-90"
              draggable={false}
              title="View User Profile"
            />
          ) : (
            <button
              onClick={() => {
                triggerHaptic(10);
                setIsProfileOpen(true);
              }}
              className="w-11 h-11 rounded-full bg-white/5 backdrop-blur-xl border border-white/10 hover:bg-white/10 flex items-center justify-center text-[#8e8e93] transition-all active:scale-90 cursor-pointer"
              aria-label="User Profile"
              title="View User Profile"
            >
              <UserIcon className="w-5 h-5" />
            </button>
          )}
        </header>

        {/* Main AI Orb Visualization */}
        <main className="flex-1 flex flex-col justify-center items-center relative z-10 overflow-hidden px-4">
          <MobileOrb
            status={status}
            inputVolume={inputVol}
            outputVolume={outputVol}
            onInterrupt={handleInterrupt}
          />

          {status === 'disconnected' || status === 'error' ? (
            <button
              onClick={handleManualReconnect}
              className="absolute bottom-6 px-5 py-2.5 rounded-full bg-gradient-to-r from-[#00f2fe] to-[#4facfe] text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-[#00f2fe]/20 transition-all active:scale-95 z-20 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Reconnect Beatrice
            </button>
          ) : null}
        </main>

{/* Bottom Native Footer Controls */}
        <footer className="px-6 pb-12 pt-0 bg-gradient-to-t from-black 20% to-transparent flex items-end justify-between z-20 relative">
          {/* Chat Button */}
          <button
            onClick={() => {
              triggerHaptic(10);
              setActiveDrawer(activeDrawer === 'chat' ? 'none' : 'chat');
            }}
            className={`w-16 flex flex-col items-center gap-2 text-[#8e8e93] hover:text-white transition-all duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] active:scale-90 cursor-pointer bg-transparent border-none ${
              activeDrawer === 'chat' ? 'text-white' : ''
            }`}
          >
            <MessageSquare className="w-7 h-7" strokeWidth={2} />
            <span className="text-[0.7rem] font-semibold tracking-[0.2px]">Chat</span>
          </button>

          {/* Interactive Mic Dock */}
          <div className="flex items-center gap-6 relative -top-4">
            {/* Left Equalizer */}
            <div className="flex items-center gap-1 h-6">
              {[0, 0.2, 0.4].map((delay, i) => (
                <div 
                  key={`l-${i}`} 
                  className={`w-1 rounded-full transition-all duration-300 ${!isMuted && status !== 'disconnected' ? 'bg-[#4facfe]' : 'bg-[#8e8e93]'} ${(!isMuted && (status === 'speaking' || status === 'listening' || inputVol > 0.05 || outputVol > 0.05)) ? 'animate-[eq-bounce_0.6s_infinite_ease-in-out_alternate]' : 'h-1'}`} 
                  style={{ animationDelay: `${delay}s` }} 
                />
              ))}
            </div>

            {/* Main FAB */}
            <button
              onClick={handleToggleMute}
              className={`w-[80px] h-[80px] rounded-full bg-gradient-to-br from-[#00f2fe] to-[#4facfe] flex items-center justify-center text-white shadow-[0_16px_32px_-8px_rgba(79,172,254,0.5),inset_0_2px_4px_rgba(255,255,255,0.4)] transition-all duration-200 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] active:scale-[0.92] relative border-none cursor-pointer ${
                !isMuted && status !== 'disconnected' ? 'animate-[breathe-btn_2s_infinite_alternate]' : ''
              } ${isMuted ? 'grayscale opacity-75' : ''}`}
              aria-label="Toggle Voice Assistant"
            >
              {!isMuted && status !== 'disconnected' && (
                <div className="absolute inset-[-2px] rounded-full bg-inherit blur-[12px] opacity-80 animate-[pulse-ring_1.5s_infinite] -z-10" />
              )}
              {isMuted ? <MicOff className="w-[34px] h-[34px]" strokeWidth={2.5} /> : <Mic className="w-[34px] h-[34px]" strokeWidth={2.5} />}
            </button>

            {/* Right Equalizer */}
            <div className="flex items-center gap-1 h-6">
              {[0.1, 0.3, 0.2].map((delay, i) => (
                <div 
                  key={`r-${i}`} 
                  className={`w-1 rounded-full transition-all duration-300 ${!isMuted && status !== 'disconnected' ? 'bg-[#4facfe]' : 'bg-[#8e8e93]'} ${(!isMuted && (status === 'speaking' || status === 'listening' || inputVol > 0.05 || outputVol > 0.05)) ? 'animate-[eq-bounce_0.6s_infinite_ease-in-out_alternate]' : 'h-1'}`} 
                  style={{ animationDelay: `${delay}s` }} 
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                triggerHaptic(10);
                setActiveDrawer(activeDrawer === 'video' ? 'none' : 'video');
              }}
              className={`w-14 flex flex-col items-center gap-2 text-[#8e8e93] hover:text-white transition-all duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] active:scale-90 cursor-pointer bg-transparent border-none ${
                activeDrawer === 'video' ? 'text-white' : ''
              }`}
            >
              <Video className="w-6 h-6" strokeWidth={2} />
              <span className="text-[0.6rem] font-semibold tracking-[0.2px]">Video</span>
            </button>
          </div>
        </footer>

        {/* Native iOS Home Indicator */}
        <div className="home-indicator" />

        {/* Sliding Mobile Drawer Overlay */}
        {activeDrawer !== 'none' && (
          <div className="absolute inset-0 z-30 bg-black/60 backdrop-blur-[30px] flex flex-col transition-all animate-in fade-in duration-300">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-black/40">
              <span className="text-xs font-bold uppercase tracking-wider text-[#8e8e93]">
                {activeDrawer === 'chat'
                  ? 'Realtime Chat Transcript'
                  : activeDrawer === 'video'
                  ? 'Live Video Stream'
                  : 'Beatrice Function Tools'}
              </span>
              <button
                onClick={() => setActiveDrawer('none')}
                className="p-2 rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-90 transition-all"
              >
                <X className="w-5 h-5" strokeWidth={2.5} />
              </button>
            </div>

            <div className="flex-1 overflow-hidden p-3">
              {activeDrawer === 'chat' && (
                <TranscriptsView
                  transcripts={transcripts}
                  onSendTextMessage={handleSendTextMessage}
                  onClearTranscripts={handleClearTranscripts}
                  isConnected={status !== 'disconnected' && status !== 'error'}
                />
              )}

              {activeDrawer === 'video' && (
                <VideoFeed
                  onStartCamera={handleStartCamera}
                  onStartScreen={handleStartScreen}
                  onStopVideo={handleStopVideo}
                  streamType={streamType}
                  facingMode={facingMode}
                  onToggleFacingMode={handleToggleFacingMode}
                  fps={config.videoFps}
                  status={status}
                  inputVolume={inputVol}
                  outputVolume={outputVol}
                  isMuted={isMuted}
                  onToggleMute={handleToggleMute}
                  onCloseVideo={() => setActiveDrawer('none')}
                />
              )}

              {activeDrawer === 'tools' && (
                <ToolsWorkbench
                  toolLogs={toolLogs}
                  sandboxRuns={sandboxRuns}
                  cliRuns={cliRuns}
                  agentTasks={agentTasks}
                  canvasData={canvasData}
                  browserSessions={browserSessions}
                  computerSessions={computerSessions}
                  codingAgentSessions={codingAgentSessions}
                  videoTasks={videoTasks}
                  qwenTasks={qwenTasks}
                  onRunSandbox={handleRunSandbox}
                  onRunCli={handleRunCli}
                  onRunSandboxStream={handleRunSandboxStream}
                  onRunCliStream={handleRunCliStream}
                  onRunBrowser={handleRunBrowser}
                  onRunComputer={handleRunComputer}
                  onRunCodingAgent={handleRunCodingAgent}
                  onCancelCodingAgent={handleCancelCodingAgent}
                  onGenerateVideo={handleGenerateVideo}
                  onQwenCloud={handleQwenCloud}
                  onDeployAgent={handleDeployAgent}
                  onGetSystemInfo={handleGetSystemInfo}
                  onUpdateCanvas={handleUpdateCanvas}
                  onGetWeather={handleGetWeather}
                  onWebSearch={handleWebSearch}
                />
              )}
            </div>
          </div>
        )}

        <WhatsAppApprovalModal approval={waApproval} onApprove={respondWhatsAppApproval} />
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onSaveConfig={handleUpdateConfig}
        vadConfig={vadConfig}
        vadStatus={vadStatus}
        onSaveVadConfig={handleUpdateVadConfig}
        waStatus={waStatus}
        onPairWhatsApp={handlePairWhatsApp}
        onQrPairWhatsApp={handleQrPairWhatsApp}
        onCancelWhatsAppPairing={handleCancelWhatsAppPairing}
        onLogoutWhatsApp={handleLogoutWhatsApp}
        onOpenProfile={() => {
          setIsSettingsOpen(false);
          setIsProfileOpen(true);
        }}
      />

      {/* User Profile Modal */}
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        status={status}
        config={config}
        transcriptsCount={transcripts.length}
      />

      {/* Conversation Memory & Context Window Inspector Modal */}
      <MemoryInspectorModal
        isOpen={isMemoryInspectorOpen}
        onClose={() => setIsMemoryInspectorOpen(false)}
        transcripts={transcripts}
        memoryState={memoryState}
        config={contextConfig}
        onUpdateConfig={(newCfg) => setContextConfig((prev) => ({ ...prev, ...newCfg }))}
        onCompressContext={handleCompressContext}
        onClearMemory={handleClearMemory}
        isCompressing={isCompressingMemory}
      />

        </>
      )}

      {/* Auth Gate Page */}
      {!showIntro && !gatePassed && <AuthPage onSkip={() => setSkipAuth(true)} />}

      {/* Tasks/Processes Page - shows ongoing automation processes */}

      {/* Autoplay Intro Video Overlay */}
      {showIntro && (
        <div className="absolute inset-0 z-50 bg-black flex items-center justify-center">
          <video
            ref={introVideoRef}
            src="https://eburon.ai/onboard/beatrice-core.mp4"
            autoPlay
            playsInline
            muted={introMuted}
            onEnded={finishIntro}
            onLoadedData={handleIntroLoaded}
            className="w-full h-full object-cover"
          />
          {introMuted && (
            <button
              type="button"
              onClick={handleIntroUnmute}
              className="absolute top-6 right-6 w-11 h-11 rounded-full bg-white/10 backdrop-blur-xl border border-white/20 text-white hover:bg-white/20 active:scale-95 transition-all cursor-pointer shadow-lg flex items-center justify-center"
              title="Enable Sound"
            >
              <Volume2 className="w-5 h-5" />
            </button>
          )}
          {showIntroSkip && (
            <button
              type="button"
              onClick={finishIntro}
              className="absolute bottom-6 right-6 px-5 py-2.5 rounded-full bg-white/10 backdrop-blur-xl border border-white/20 text-white text-sm font-semibold hover:bg-white/20 active:scale-95 transition-all cursor-pointer shadow-lg"
            >
              Skip
            </button>
          )}
        </div>
      )}
    </div>
  );
}

