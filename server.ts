import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { logger } from './server/logger.js';
import {
  registerStandardMetrics,
  registerSkillMetrics,
  renderMetrics,
  incCounter,
  observeHistogram,
} from './server/metrics.js';
import { requireAuth, verifyIdToken, authEnabled } from './server/auth.js';
import { registerAllTools, dispatchTool } from './server/toolRegistry.js';
import { getFunctionDeclarations, validateToolCoverage } from './server/toolDeclarations.js';
import { handleFunctionCallWithSkills } from './server/toolRoutingMiddleware.js';
import { createConversationContext, updateContextFromToolCall, updateContextFromSkillSelection } from './server/conversationContext.js';
import type { ActiveContext } from './server/skills/types.js';
import {
  createTask,
  deleteTask,
  getTask,
  initTaskStore,
  listTasks,
  upsertTaskFromBroadcast,
  updateTask,
} from './server/taskStore.js';
import { WebSocket, WebSocketServer } from 'ws';
import {
  handleDeployAgentTask,
  handleExecuteCodeSandbox,
  handleGenerateVideo,
  handleGetSystemInfo,
  handleGetWeather,
  handleOpenLocalTerminal,
  handleQwenChat,
  handleQwenImageEdit,
  handleQwenImageGenerate,
  handleQwenTts,
  handleQwenVideoGenerate,
  handleRunBrowserAutomation,
  handleRunCliCommand,
  handleRunCodingAgent,
  handleRunComputerControl,
  handleUpdateCanvasVisual,
  handleWebSearch,
} from './server/tools.js';
import {
  startSandboxService,
  startCliService,
  startBrowserService,
  startComputerService,
  startCodingAgentService,
} from './server/services/index.js';
import { sendToService } from './server/toolProxy.js';
import { createTerminalWss } from './server/terminalBridge.js';
import {
  handleCreateGoogleMeet,
  handleListGmailMessages,
  handleSendGmailMessage,
  handleListCalendarEvents,
  handleCreateCalendarEvent,
  handleListDriveFiles,
  handleCreateGoogleDoc,
  handleCreateGoogleSheet,
  handleCreateGoogleSlide,
  handleCreateGoogleForm,
  handleListGoogleForms,
  handleListGoogleTasks,
  handleCreateGoogleTask,
  handleListGoogleContacts,
  handleGetGmailMessage,
  handleTrashGmailMessage,
  handleDeleteGmailMessage,
  handleModifyGmailMessage,
  handleCreateGmailDraft,
  handleUpdateCalendarEvent,
  handleDeleteCalendarEvent,
  handleUpdateGoogleTask,
  handleDeleteGoogleTask,
  handleSearchDriveFiles,
  handleGetDriveFile,
  handleCreateDriveFile,
  handleUpdateDriveFileContent,
  handleDeleteDriveFile,
  handleCreateGoogleContact,
  handleUpdateGoogleContact,
  handleDeleteGoogleContact,
  handleSearchYoutube,
  handleConnectGoogleAccount,
} from './server/googleWorkspace.js';
import {
  handleResolveWhatsAppContact,
  handleRequestWhatsAppSend,
  handleSendWhatsAppText,
  handleSendWhatsAppContactCard,
  handleSendWhatsAppMessage,
  handleSendWhatsAppGroupMessage,
  handleReadWhatsAppChats,
  handleGetWhatsAppContacts,
  handleGetWhatsAppGroups,
  handleGetWhatsAppMessageHistory,
  handleGetWhatsAppCalls,
  handleBlockWhatsAppContact,
  handleUnblockWhatsAppContact,
  handleReadWhatsAppAttachment,
  handleTranscribeWhatsAppAudio,
  handleSendWhatsAppDocument,
  handleSyncWhatsAppHistory,
  handleWhatsAppCall,
  getWhatsAppStatus,
  getWhatsAppCapabilities,
  getWhatsAppRecentContext,
  pairWhatsApp,
  pairWhatsAppWithQr,
  cancelWhatsAppPairing,
  logoutWhatsApp,
  resetWhatsApp,
  setWhatsAppUser,
  setBossMode,
  getBossMode,
  approveWhatsAppSend,
  setWhatsAppBroadcaster,
  removeWhatsAppBroadcaster,
} from './server/whatsapp-tools.js';

const PORT = parseInt(process.env.PORT || '5555', 10);
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const SERVICE_PORTS = {
  sandbox: parseInt(process.env.SANDBOX_SERVICE_PORT || '5556', 10),
  cli: parseInt(process.env.CLI_SERVICE_PORT || '5557', 10),
  browser: parseInt(process.env.BROWSER_SERVICE_PORT || '5558', 10),
  computer: parseInt(process.env.COMPUTER_SERVICE_PORT || '5559', 10),
};

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    console.warn('⚠️ GEMINI_API_KEY is not configured or using placeholder value.');
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}


async function startServer() {
  // Register tool dispatch + standard metrics once at boot.
  registerAllTools();
  registerStandardMetrics();
  registerSkillMetrics();
  const coverageProblems = validateToolCoverage();
  if (coverageProblems.length > 0) {
    logger.error({ problems: coverageProblems }, 'tool coverage drift detected');
    throw new Error(`Tool coverage drift: ${coverageProblems.join('; ')}`);
  }
  initTaskStore().catch((err: any) =>
    console.error('[TaskStore] init failed (in-memory only):', err?.message || err)
  );

  // Start internal tool services on separate ports
  startSandboxService();
  startCliService();
  startBrowserService();
  startComputerService();
  startCodingAgentService();

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Request logging + metrics middleware (applies to all HTTP routes).
  app.use((req, res, next) => {
    const start = Date.now();
    incCounter('beatrice_http_requests_total');
    res.on('finish', () => {
      observeHistogram('beatrice_http_duration_seconds', (Date.now() - start) / 1000);
    });
    next();
  });

  // Prometheus metrics endpoint (no auth — intended for internal scraping).
  app.get('/metrics', (_req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(renderMetrics());
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const terminalWss = createTerminalWss();

  server.on('upgrade', async (request, socket, head) => {
    try {
      const proto = (request.headers['x-forwarded-proto'] as string) || 'http';
      const host = request.headers.host || 'localhost';
      const url = new URL(request.url || '', `${proto}://${host}`);

      // Authenticate WebSocket connections. The browser WebSocket API cannot
      // set custom headers, so the client passes its Firebase ID token as a
      // `?token=` query parameter (see src/App.tsx). We verify it here before
      // accepting the upgrade, so unauthenticated clients cannot reach /live
      // or /terminal.
      if (authEnabled()) {
        const token = url.searchParams.get('token');
        const user = await verifyIdToken(token);
        if (!user) {
          incCounter('beatrice_ws_connections_rejected_total');
          logger.warn({ path: url.pathname }, 'rejected unauthenticated WebSocket upgrade');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        // Attach the verified user to the request for downstream handlers.
        (request as any).authUser = user;
      }

      if (url.pathname === '/live' || url.pathname === '/live/') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          incCounter('beatrice_ws_connections_total');
          wss.emit('connection', ws, request);
        });
      } else if (url.pathname === '/terminal' || url.pathname === '/terminal/') {
        terminalWss.handleUpgrade(request, socket, head, (ws) => {
          terminalWss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    } catch (err) {
      logger.error({ err: String(err) }, 'Error handling upgrade');
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
  });

  // REST API Routes
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      app: 'Beatrice OSS',
      liveModel: 'gemini-3.1-flash-live-preview',
      apiKeyConfigured: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
    });
  });

  app.get('/api/terminal/info', (req, res) => {
    const host =
      process.env.SSH_HOST ||
      (process.env.APP_URL
        ? new URL(process.env.APP_URL).hostname
        : (req.headers.host || 'localhost').split(':')[0]);
    const port = parseInt(process.env.SSH_PORT || '22', 10);
    const user = process.env.SSH_USER || 'root';
    res.json({ host, port, user, sshUrl: `ssh://${user}@${host}:${port}` });
  });

  // Global auth guard for all /api/* routes except the public health/info
  // endpoints and the sandbox preview proxy (served to an iframe that cannot
  // attach auth headers). Everything else — tool execution, Google Workspace,
  // WhatsApp lifecycle — requires a verified Firebase ID token.
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/terminal/info' || req.path.startsWith('/sandbox/preview')) {
      return next();
    }
    return requireAuth(req, res, next);
  });

  // ── Generation task history ──────────────────────────────────────────────
  // Tasks are keyed by the VERIFIED session uid (res.locals.authUser) — a
  // client can never read or write another user's tasks.
  const taskUid = (res: any): string | null => res.locals?.authUser?.uid || null;

  app.get('/api/tasks', async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
      const tasks = await listTasks(taskUid(res), limit);
      res.json({ ok: true, tasks });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Failed to list tasks' });
    }
  });

  app.post('/api/tasks', async (req, res) => {
    try {
      const body = req.body || {};
      const task = await createTask(taskUid(res), {
        id: typeof body.id === 'string' ? body.id : undefined,
        type: body.type,
        provider: body.provider,
        model: body.model,
        prompt: body.prompt,
        status: body.status,
        stage: body.stage,
        progress: body.progress,
        output: body.output,
        previewUrl: body.previewUrl,
        error: body.error,
      });
      if (!task) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
      res.json({ ok: true, task });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Failed to create task' });
    }
  });

  app.get('/api/tasks/:id', async (req, res) => {
    try {
      const task = await getTask(taskUid(res), req.params.id);
      if (!task) {
        res.status(404).json({ ok: false, error: 'Task not found' });
        return;
      }
      res.json({ ok: true, task });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Failed to load task' });
    }
  });

  app.patch('/api/tasks/:id', async (req, res) => {
    try {
      const body = req.body || {};
      const task = await updateTask(taskUid(res), req.params.id, {
        type: body.type,
        provider: body.provider,
        model: body.model,
        prompt: body.prompt,
        status: body.status,
        stage: body.stage,
        progress: body.progress,
        output: body.output,
        previewUrl: body.previewUrl,
        error: body.error,
      });
      if (!task) {
        res.status(404).json({ ok: false, error: 'Task not found' });
        return;
      }
      res.json({ ok: true, task });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Failed to update task' });
    }
  });

  app.delete('/api/tasks/:id', async (req, res) => {
    try {
      await deleteTask(taskUid(res), req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Failed to delete task' });
    }
  });

  app.post('/api/tools/execute-code', async (req, res) => {
    try {
      const { code, language, description } = req.body;
      const ai = getGeminiClient();
      const result = await handleExecuteCodeSandbox({ code, language, description }, {
        ai: ai || undefined,
        broadcast: () => {},
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tools/cli', async (req, res) => {
    try {
      const { command, cwd } = req.body;
      const result = await handleRunCliCommand({ command, cwd }, { broadcast: () => {} });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tools/agent', async (req, res) => {
    try {
      const { agentName, task } = req.body;
      const ai = getGeminiClient();
      const result = await handleDeployAgentTask(
        { agentName: agentName || 'Assistant Agent', task },
        { ai: ai || undefined, broadcast: () => {} }
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspace/meet/create', async (req, res) => {
    try {
      const { summary, description, attendees } = req.body || {};
      const result: any = await handleCreateGoogleMeet(
        { summary, description, attendees },
        { broadcast: () => {}, uid: res.locals?.authUser?.uid }
      );
      if (result?.error) {
        res.status(400).json({ success: false, error: result.error });
        return;
      }
      res.json({ success: true, meetingUri: result.meetingUri, meeting: result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/workspace/gmail/messages', async (req, res) => {
    try {
      const query = (req.query.q as string) || 'in:inbox';
      const result = await handleListGmailMessages(
        { query },
        { broadcast: () => {}, uid: res.locals?.authUser?.uid }
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspace/contacts', async (req, res) => {
    try {
      const query = (req.query.q as string) || '';
      const result: any = await handleListGoogleContacts(
        { query },
        { broadcast: () => {}, uid: res.locals?.authUser?.uid }
      );
      if (result?.error) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspace/gmail/send', async (req, res) => {
    try {
      const { to, subject, body } = req.body;
      const result = await handleSendGmailMessage(
        { to, subject, body },
        { broadcast: () => {}, uid: res.locals?.authUser?.uid }
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspace/forms/create', async (req, res) => {
    try {
      const { title, description, questions } = req.body;
      const r: any = await handleCreateGoogleForm(
        { title, description, questions },
        { broadcast: () => {}, uid: res.locals?.authUser?.uid }
      );
      if (r?.error) {
        res.status(400).json({ success: false, error: r.error });
        return;
      }
      res.json({
        success: true,
        form: {
          id: r.formId,
          title: r.title,
          description: r.description,
          webViewLink: r.webViewLink,
          questions: r.questions,
          responsesCount: 0,
          createdAt: r.timestamp,
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspace/forms/list', async (req, res) => {
    try {
      const query = (req.query.q as string) || '';
      const result = await handleListGoogleForms(
        { query },
        { broadcast: () => {}, uid: res.locals?.authUser?.uid }
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Extract the signed-in Firebase user from WhatsApp API calls. The verified
  // user is attached by requireAuth (res.locals.authUser); we fall back to the
  // legacy x-wa-uid/x-wa-email headers only when auth is disabled (dev mode),
  // so the WhatsApp session is always bound to a real authenticated account.
  const waUserFromReq = (req: any) => {
    const verified = req.authUser || req.res?.locals?.authUser;
    if (verified?.uid) {
      return { uid: String(verified.uid), email: verified.email || null };
    }
    const uid = String(req.headers['x-wa-uid'] || req.query?.uid || '').trim();
    const email = String(req.headers['x-wa-email'] || req.query?.email || '').trim() || null;
    return { uid, email };
  };

  app.get('/api/whatsapp/status', async (req, res) => {
    try {
      const { uid, email } = waUserFromReq(req);
      if (uid) await setWhatsAppUser(uid, email);
      res.json(getWhatsAppStatus());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/whatsapp/capabilities', async (req, res) => {
    try {
      const { uid } = waUserFromReq(req);
      if (uid) await setWhatsAppUser(uid);
      res.json(getWhatsAppCapabilities());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/pair', async (req, res) => {
    try {
      const { uid, email } = waUserFromReq(req);
      if (uid) await setWhatsAppUser(uid, email);
      const { phone } = req.body || {};
      const result = await pairWhatsApp(String(phone || ''));
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/pair-qr', async (req, res) => {
    try {
      const { uid, email } = waUserFromReq(req);
      if (uid) await setWhatsAppUser(uid, email);
      res.json(await pairWhatsAppWithQr());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/cancel', async (req, res) => {
    try {
      const { uid } = waUserFromReq(req);
      if (uid) await setWhatsAppUser(uid);
      res.json(await cancelWhatsAppPairing());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/logout', async (req, res) => {
    try {
      const { uid, email } = waUserFromReq(req);
      if (uid) await setWhatsAppUser(uid, email);
      res.json(await logoutWhatsApp());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Hard reset: removes ALL WhatsApp auth state + persisted store so a fresh
  // integration can be added. Works even when the session is stuck (e.g. a
  // 403-banned socket that never opens), which logout cannot recover from.
  app.post('/api/whatsapp/reset', async (req, res) => {
    try {
      const { uid, email } = waUserFromReq(req);
      if (uid) await setWhatsAppUser(uid, email);
      res.json(await resetWhatsApp());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/approve', async (req, res) => {
    try {
      const { uid } = waUserFromReq(req);
      if (uid) await setWhatsAppUser(uid);
      const { id, approve, recipient } = req.body || {};
      const done = approveWhatsAppSend(id ? String(id) : null, !!approve, recipient ? String(recipient) : undefined);
      if (!done) {
        res.status(404).json({ ok: false, error: 'No matching pending approval or recipient.' });
        return;
      }
      res.json({ ok: true, approved: !!approve });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/whatsapp/boss-mode', async (req, res) => {
    try {
      const { uid, email } = waUserFromReq(req);
      if (uid) await setWhatsAppUser(uid, email);
      res.json({ bossMode: getBossMode() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/boss-mode', async (req, res) => {
    try {
      const { uid, email } = waUserFromReq(req);
      if (uid) await setWhatsAppUser(uid, email);
      const enabled = !!(req.body || {}).enabled;
      res.json({ bossMode: setBossMode(enabled) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tools/canvas', async (req, res) => {
    try {
      const { canvasType, title, content } = req.body;
      const result = await handleUpdateCanvasVisual(
        { canvasType, title, content },
        { broadcast: () => {} }
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tools/weather', async (req, res) => {
    try {
      const { location } = req.body;
      const result = await handleGetWeather({ location });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tools/search', async (req, res) => {
    try {
      const { query } = req.body;
      const ai = getGeminiClient();
      const result = await handleWebSearch(
        { query },
        { ai: ai || undefined, broadcast: () => {} }
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  function loadGlobalSystemPrompt(): string {
    try {
      const promptPath = path.join(process.cwd(), 'system_prompt.md');
      const kbPath = path.join(process.cwd(), 'knowledge_base.md');
      const parts: string[] = [];
      if (fs.existsSync(promptPath)) parts.push(fs.readFileSync(promptPath, 'utf8'));
      if (fs.existsSync(kbPath)) {
        parts.push('\n\n--- COMPACT GLOBAL KB (ALWAYS ON) ---\n' + fs.readFileSync(kbPath, 'utf8'));
      }
      if (parts.length === 0) {
        return 'You are Beatrice of Eburon AI. Stay in character. Never reveal you are AI. Only call tools when the Boss explicitly asks.';
      }
      return parts.join('\n');
    } catch (err) {
      console.error('Failed to load global knowledge base / system prompt:', err);
      return 'You are Beatrice of Eburon AI. Stay in character. Never reveal you are AI. Only call tools when the Boss explicitly asks.';
    }
  }

  async function buildSessionInstruction(bootstrap?: {
    preferredLanguage?: string;
    voiceName?: string;
    systemInstruction?: string;
    conversationSummary?: string;
    recentTurns?: { role: string; text: string; timestamp?: number }[];
    lastInteractionAt?: number;
    userDisplayName?: string;
  }): Promise<string> {
    const base = loadGlobalSystemPrompt();
    const lang = (bootstrap?.preferredLanguage || 'auto').trim() || 'auto';
    const lastAt = bootstrap?.lastInteractionAt || 0;
    const elapsedMs = lastAt ? Date.now() - lastAt : 0;
    const elapsedLabel =
      !lastAt
        ? 'no previous conversation'
        : elapsedMs < 60_000
        ? 'just now'
        : elapsedMs < 3_600_000
        ? `${Math.floor(elapsedMs / 60_000)} minutes ago`
        : elapsedMs < 86_400_000
        ? `${Math.floor(elapsedMs / 3_600_000)} hours ago`
        : `${Math.floor(elapsedMs / 86_400_000)} days ago`;

    const recent =
      bootstrap?.recentTurns
        ?.filter((t) => t && (t.role === 'user' || t.role === 'model') && t.text)
        .slice(-16)
        .map((t) => `${t.role === 'user' ? 'USER' : 'BEATRICE'}: ${String(t.text).slice(0, 220)}`)
        .join('\n') || '';

    const summary = (bootstrap?.conversationSummary || '').slice(0, 4000);
    const extraPersona = (bootstrap?.systemInstruction || '').trim();
    const userName = bootstrap?.userDisplayName || 'Boss';

    const continuity = `
### SESSION CONTINUITY (MANDATORY — DO NOT RESET LANGUAGE OR MEMORY)
- Preferred language code/name: ${lang}
- CRITICAL LANGUAGE RULE: Always respond in the user's preferred language (${lang === 'auto' ? 'detect from user speech and match it' : lang}) for ALL replies. Never switch back to English unless the user is speaking English or explicitly requests English.
- User display name / title: ${userName}
- last_interaction_at: ${lastAt ? new Date(lastAt).toISOString() : 'none'}
- time_elapsed_since_last_interaction: ${elapsedLabel}
- If time_elapsed is under 1 hour: do NOT greet as a new session. Continue the previous topic naturally.
- If 1-24 hours: brief warm continuity acknowledgment, then continue.
- If over 24 hours or no history: time-based greeting is OK, then offer natural continuity if history exists.
- NEVER say you forgot the conversation if history below is present.
- NEVER reset to English if preferred language is not English.
- NEVER introduce yourself as a fresh assistant after a reconnect.

### RECENT CONVERSATION MEMORY
${summary || recent ? `${summary ? `SUMMARY:\n${summary}\n` : ''}${recent ? `RECENT TURNS:\n${recent}` : ''}` : '(No prior turns yet — this may be a new user.)'}

${extraPersona ? `### USER CUSTOM PERSONA NOTES\n${extraPersona.slice(0, 2000)}` : ''}
`.trim();

    const waContext = await getWhatsAppRecentContext();
    const waBlock = waContext
      ? `\n\n${waContext}\n- If the Boss asks about WhatsApp, you have live context above plus read_whatsapp_chats / get_whatsapp_message_history. Resolve contacts before sending; never invent JIDs.`
      : '';

    return `${base}\n\n${continuity}${waBlock}`;
  }

  // WebSocket Live Connection Handler
  wss.on('connection', async (clientWs: WebSocket) => {
    console.log('Client connected to Beatrice OSS WebSocket live endpoint.');

    const ai = getGeminiClient();
    if (!ai) {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          message:
            'Eburon API Key is missing or invalid. Please configure your API key in the Settings > Secrets panel.',
        })
      );
      clientWs.send(JSON.stringify({ type: 'status', status: 'error' }));
      return;
    }

    let liveSession: any = null;
    let isConnected = false;
    let sessionBootstrap: any = null;
    let liveStarting = false;
    let clientClosed = false;
    let liveRetryCount = 0;
    // Never give up on the Live session: retry forever with capped backoff so
    // the voice link self-heals instead of stopping and asking for a manual tap.
    let intentionalLiveClose = false;
    // Skill routing: per-connection conversation context
    let conversationContext: ActiveContext = createConversationContext();

    const broadcastToClient = (msg: unknown) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(msg));
      }
      // Persist every generation broadcast as a per-user task (uid comes from
      // the verified session, never the client). Runs even when the socket is
      // closed so background generations survive refresh/navigation/restart.
      const uid = sessionBootstrap?.uid || null;
      if (uid) {
        void upsertTaskFromBroadcast(uid, msg).catch(() => {
          // persistence is best-effort; never let it break the live loop
        });
      }
    };

    setWhatsAppBroadcaster(null, broadcastToClient);

    clientWs.send(JSON.stringify({ type: 'status', status: 'connecting' }));

    const startLiveSession = async (reason: string) => {
      if (clientClosed || liveStarting) return;
      if (liveSession && isConnected) return;
      if (reason.startsWith('auto-retry')) liveRetryCount += 1;
      else liveRetryCount = 0;
      liveStarting = true;
      try {
        // Close previous Live quietly if any (do not trigger auto-retry loop)
        if (liveSession) {
          intentionalLiveClose = true;
          try {
            liveSession.close();
          } catch {
            // ignore
          }
          liveSession = null;
          isConnected = false;
        }

        const voiceName = sessionBootstrap?.voiceName || 'Aoede';
        const instruction = await buildSessionInstruction(sessionBootstrap || undefined);
        console.log(`[Live] Starting session (${reason}) lang=${sessionBootstrap?.preferredLanguage || 'auto'} promptChars=${instruction.length}`);

        liveSession = await ai.live.connect({
          model: 'gemini-3.1-flash-live-preview',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            },
            systemInstruction: instruction,
            tools: getFunctionDeclarations(),
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
          callbacks: {
            onmessage: async (message: LiveServerMessage) => {
            // 1. Audio parts
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              for (const part of parts) {
                if (part.inlineData?.data) {
                  broadcastToClient({ type: 'audio', audio: part.inlineData.data });
                  broadcastToClient({ type: 'status', status: 'speaking' });
                }
                if (part.text) {
                  broadcastToClient({
                    type: 'transcript',
                    role: 'model',
                    text: part.text,
                    isPartial: true,
                  });
                }
              }
            }

            // 2. Transcriptions
            if (message.serverContent?.outputTranscription?.text) {
              broadcastToClient({
                type: 'transcript',
                role: 'model',
                text: message.serverContent.outputTranscription.text,
              });
            }
            if (message.serverContent?.inputTranscription?.text) {
              broadcastToClient({
                type: 'transcript',
                role: 'user',
                text: message.serverContent.inputTranscription.text,
              });
            }

            // 3. Interrupted
            if (message.serverContent?.interrupted) {
              broadcastToClient({ type: 'interrupted' });
              broadcastToClient({ type: 'status', status: 'listening' });
            }

            // 4. Turn Complete
            if (message.serverContent?.turnComplete) {
              broadcastToClient({ type: 'turnComplete' });
              broadcastToClient({ type: 'status', status: 'listening' });
            }

            // 5. Tool Calls / Function Calls
            // ONE FUNCTION AT A TIME: if the model emits multiple function
            // calls in a single turn, only the first is executed. The rest are
            // answered with a "wait" response instead of running — the model
            // must proceed one confirmed call per turn.
            if (message.toolCall?.functionCalls) {
              for (let i = 0; i < message.toolCall.functionCalls.length; i++) {
                const call = message.toolCall.functionCalls[i];
                const callId = call.id;
                const name = call.name;
                const args = (call.args || {}) as Record<string, unknown>;

                if (i > 0) {
                  const skipped = { output: 'Skipped — one function at a time. Do not run multiple calls; ask the user to confirm and call only one function per turn.' };
                  broadcastToClient({ type: 'toolCall', id: callId, name, args });
                  broadcastToClient({ type: 'toolResult', id: callId, name, result: skipped });
                  try {
                    await liveSession.sendToolResponse({
                      functionResponses: [{ name, response: skipped, id: callId }],
                    });
                  } catch (sendErr: any) {
                    console.error('Error sending skipped tool response:', sendErr);
                  }
                  continue;
                }

                broadcastToClient({
                  type: 'toolCall',
                  id: callId,
                  name,
                  args,
                });

                let toolResult: unknown = null;
                const toolCtx = {
                  ai,
                  broadcast: broadcastToClient,
                  deviceType: sessionBootstrap?.deviceType || 'desktop',
                  uid: sessionBootstrap?.uid || undefined,
                };

                try {
                  // WhatsApp tools act on the session currently bound to this
                  // module — re-bind it to THIS connection's user first so an
                  // unrelated request (e.g. another user's status poll) can
                  // never redirect a tool call onto a different account's
                  // socket/store.
                  if (name.includes('whatsapp')) {
                    const waUid = (sessionBootstrap?.uid || '').trim();
                    const waEmail = sessionBootstrap?.email || null;
                    if (waUid) await setWhatsAppUser(waUid, waEmail);
                  }

                  // Route through skill system: Gemini function calls become
                  // proposals; the skill router validates, selects a skill
                  // route, and executes through the predefined flow.
                  const skillResponse = await handleFunctionCallWithSkills(
                    name,
                    args,
                    conversationContext.activeSkill,
                    conversationContext,
                    toolCtx,
                    broadcastToClient,
                  );

                  // Update conversation context with this tool call
                  conversationContext = updateContextFromToolCall(
                    conversationContext,
                    name,
                    args,
                    skillResponse,
                  );

                  toolResult = skillResponse;
                } catch (err: any) {
                  toolResult = { error: err.message || 'Tool execution failed' };
                }

                broadcastToClient({
                  type: 'toolResult',
                  id: callId,
                  name,
                  result: toolResult,
                });

                // Send tool response back to Eburon Live API
                try {
                  const safeResponse = (typeof toolResult === 'object' && toolResult !== null && !Array.isArray(toolResult)) 
                    ? toolResult 
                    : { output: toolResult };
                    
                  await liveSession.sendToolResponse({
                    functionResponses: [
                      {
                        name: name,
                        response: safeResponse as Record<string, unknown>,
                        id: callId,
                      },
                    ],
                  });
                } catch (sendErr: any) {
                  console.error('Error sending tool response to Eburon Live:', sendErr);
                }
              }
            }
          },
          onerror: (err: any) => {
            console.error('Eburon Live session error:', err?.message || err);
            isConnected = false;
            if (!clientClosed && clientWs.readyState === WebSocket.OPEN) {
              broadcastToClient({ type: 'status', status: 'listening' });
              broadcastToClient({
                type: 'transcript',
                role: 'system',
                text: 'Voice link hiccup — keeping your language and chat memory. Reconnecting Live quietly…',
              });
              setTimeout(() => {
                if (!clientClosed) startLiveSession('auto-retry-onerror');
              }, 1200);
            }
          },
          onclose: (ev?: any) => {
            console.log('Eburon Live session closed', ev?.reason || ev?.code || '');
            isConnected = false;
            liveSession = null;
            if (intentionalLiveClose) {
              intentionalLiveClose = false;
              return;
            }
            // Keep browser WS. Auto-restart Live with same bootstrap (language + memory).
            if (!clientClosed && clientWs.readyState === WebSocket.OPEN) {
              broadcastToClient({ type: 'status', status: 'connecting' });
              setTimeout(() => {
                if (!clientClosed) startLiveSession('auto-retry-onclose');
              }, 800);
            }
          },
        },
      });

        isConnected = true;
        liveRetryCount = 0;
        broadcastToClient({ type: 'status', status: 'connected' });
        const hasHistory = !!(sessionBootstrap?.recentTurns?.length || sessionBootstrap?.conversationSummary);
        const lang = sessionBootstrap?.preferredLanguage || 'auto';
        // Only announce continuity once per successful connect; avoid spam on rapid retries
        if (!reason.startsWith('auto-retry') || hasHistory) {
          broadcastToClient({
            type: 'transcript',
            role: 'system',
            text: hasHistory
              ? `Back with you — language locked to ${lang}. I still have our last conversation.`
              : `Listening. Language: ${lang}.`,
          });
        }
      } catch (err: any) {
        console.error('Failed to establish Eburon Live connection:', err?.message || err);
        broadcastToClient({
          type: 'error',
          message: err?.message || 'Failed to connect to Eburon Live API.',
        });
        broadcastToClient({ type: 'status', status: 'error' });
      } finally {
        liveStarting = false;
      }
    };

    // Wait briefly for client bootstrap (language + memory) before starting Live
    const bootstrapTimer = setTimeout(() => {
      if (!liveSession && !liveStarting) startLiveSession('bootstrap-timeout');
    }, 1500);

    // Handle incoming WebSocket messages from the browser client
    clientWs.on('message', async (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'sessionBootstrap') {
          sessionBootstrap = msg.bootstrap || msg;
          clearTimeout(bootstrapTimer);
          // Bind the WhatsApp session to this connection's Firebase user so
          // each account sees only its own pairing/state/store.
          const waUid = (msg.bootstrap?.uid || msg.uid || '').trim();
          const waEmail = msg.bootstrap?.email || msg.email || null;
          if (waUid) {
            await setWhatsAppUser(waUid, waEmail);
            setWhatsAppBroadcaster(waUid, broadcastToClient);
          }
          await startLiveSession('client-bootstrap');
          return;
        }

        if (msg.type === 'restartLive') {
          clearTimeout(bootstrapTimer);
          if (msg.bootstrap) sessionBootstrap = { ...sessionBootstrap, ...msg.bootstrap };
          await startLiveSession('client-restart');
          return;
        }

        if (msg.type === 'whatsappApproval') {
          approveWhatsAppSend(
            msg.id ? String(msg.id) : null,
            !!msg.approve,
            msg.recipient ? String(msg.recipient) : undefined
          );
          return;
        }

        if (msg.type === 'updateSessionPrefs') {
          sessionBootstrap = {
            ...(sessionBootstrap || {}),
            ...(msg.bootstrap || {}),
            preferredLanguage:
              msg.preferredLanguage ?? msg.bootstrap?.preferredLanguage ?? sessionBootstrap?.preferredLanguage,
            voiceName: msg.voiceName ?? msg.bootstrap?.voiceName ?? sessionBootstrap?.voiceName,
            systemInstruction:
              msg.systemInstruction ?? msg.bootstrap?.systemInstruction ?? sessionBootstrap?.systemInstruction,
          };
          // Soft restart Live so language/voice stick without dropping browser WS
          await startLiveSession('prefs-updated');
          return;
        }

        if (msg.type === 'audio' && msg.audio && liveSession && isConnected) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'video' && msg.video && liveSession && isConnected) {
          liveSession.sendRealtimeInput({
            video: { data: msg.video, mimeType: 'image/jpeg' },
          });
        } else if (msg.type === 'text' && liveSession && isConnected) {
          if (msg.attachment) {
            const att = msg.attachment;
            if (att.mimeType?.startsWith('image/') && att.base64) {
              // Send image as multimodal frame to Eburon Gemini Live API
              liveSession.sendRealtimeInput({
                video: { data: att.base64, mimeType: att.mimeType || 'image/jpeg' },
              });
            }
            if (att.text) {
              const textWithFile = `[Attached Document: ${att.name}]\n\`\`\`\n${att.text}\n\`\`\`\n\n${msg.text || ''}`;
              liveSession.sendRealtimeInput({ text: textWithFile });
            } else if (msg.text) {
              liveSession.sendRealtimeInput({ text: msg.text });
            }
          } else if (msg.text) {
            liveSession.sendRealtimeInput({ text: msg.text });
          }
        } else if (msg.type === 'attachment' && liveSession && isConnected) {
          if (msg.mimeType?.startsWith('image/') && msg.data) {
            liveSession.sendRealtimeInput({
              video: { data: msg.data, mimeType: msg.mimeType },
            });
          }
          if (msg.text) {
            liveSession.sendRealtimeInput({ text: `[Attached File: ${msg.fileName || 'document'}]\n${msg.text}` });
          }
        } else if (msg.type === 'runSandbox') {
          const callId = 'manual_sb_' + Date.now();
          broadcastToClient({ type: 'toolCall', id: callId, name: 'executeCodeSandbox', args: { code: msg.code, language: msg.language } });
          const res = await handleExecuteCodeSandbox(
            { code: msg.code, language: msg.language || 'javascript' },
            { ai, broadcast: broadcastToClient }
          );
          broadcastToClient({ type: 'toolResult', id: callId, name: 'executeCodeSandbox', result: res });
          broadcastToClient({ type: 'sandboxResult', result: res });
        } else if (msg.type === 'runCli') {
          const callId = 'manual_cli_' + Date.now();
          broadcastToClient({ type: 'toolCall', id: callId, name: 'runCliCommand', args: { command: msg.command } });
          const res = await handleRunCliCommand({ command: msg.command }, { broadcast: broadcastToClient });
          broadcastToClient({ type: 'toolResult', id: callId, name: 'runCliCommand', result: res });
          broadcastToClient({ type: 'cliResult', result: res });
        } else if (msg.type === 'deployAgent') {
          const callId = 'manual_agent_' + Date.now();
          broadcastToClient({ type: 'toolCall', id: callId, name: 'deployAgentTask', args: { agentName: msg.agentName, task: msg.task } });
          const res = await handleDeployAgentTask(
            { agentName: msg.agentName || 'Sub-Agent', task: msg.task },
            { ai, broadcast: broadcastToClient }
          );
          broadcastToClient({ type: 'toolResult', id: callId, name: 'deployAgentTask', result: res });
        } else if (msg.type === 'getSystemInfo') {
          const callId = 'manual_sys_' + Date.now();
          broadcastToClient({ type: 'toolCall', id: callId, name: 'getSystemInfo', args: {} });
          const res = await handleGetSystemInfo({ ai, broadcast: broadcastToClient });
          broadcastToClient({ type: 'toolResult', id: callId, name: 'getSystemInfo', result: res });
        } else if (msg.type === 'updateCanvas') {
          const callId = 'manual_canvas_' + Date.now();
          broadcastToClient({ type: 'toolCall', id: callId, name: 'updateCanvasVisual', args: { canvasType: msg.canvasType, title: msg.title, content: msg.content } });
          const res = await handleUpdateCanvasVisual(
            { canvasType: msg.canvasType, title: msg.title, content: msg.content },
            { ai, broadcast: broadcastToClient }
          );
          broadcastToClient({ type: 'toolResult', id: callId, name: 'updateCanvasVisual', result: res });
        } else if (msg.type === 'getWeather') {
          const callId = 'manual_weather_' + Date.now();
          broadcastToClient({ type: 'toolCall', id: callId, name: 'getWeather', args: { location: msg.location } });
          const res = await handleGetWeather({ location: msg.location });
          broadcastToClient({ type: 'toolResult', id: callId, name: 'getWeather', result: res });
        } else if (msg.type === 'webSearch') {
          const callId = 'manual_search_' + Date.now();
          broadcastToClient({ type: 'toolCall', id: callId, name: 'webSearch', args: { query: msg.query } });
          const res = await handleWebSearch({ query: msg.query }, { ai, broadcast: broadcastToClient });
          broadcastToClient({ type: 'toolResult', id: callId, name: 'webSearch', result: res });
        } else if (msg.type === 'runSandboxStream') {
          const runId = msg.runId || `sb_${Date.now()}`;
          await sendToService('sandbox', { type: 'runSandbox', runId, code: msg.code, language: msg.language }, broadcastToClient);
        } else if (msg.type === 'runCliStream') {
          const sessionId = msg.sessionId || `cli_${Date.now()}`;
          if (msg.startSession) {
            await sendToService('cli', { type: 'startSession', sessionId, cwd: msg.cwd }, broadcastToClient);
          }
          await sendToService('cli', { type: 'runCommand', sessionId, command: msg.command, cwd: msg.cwd }, broadcastToClient);
        } else if (msg.type === 'runBrowser') {
          const sessionId = msg.sessionId || `web_${Date.now()}`;
          await sendToService('browser', { type: msg.action, sessionId, ...msg.payload }, broadcastToClient);
        } else if (msg.type === 'runComputer') {
          const sessionId = msg.sessionId || `comp_${Date.now()}`;
          await sendToService('computer', { type: msg.action, sessionId, ...msg.payload }, broadcastToClient);
        } else if (msg.type === 'runCodingAgent') {
          const sessionId = msg.sessionId || `ca_${Date.now()}`;
          broadcastToClient({
            type: 'codingAgentUpdate',
            session: {
              id: sessionId,
              task: msg.task,
              cwd: msg.cwd || process.cwd(),
              status: 'starting',
              log: [
                `[${new Date().toLocaleTimeString()}] Coding Agent initializing...`,
                `[${new Date().toLocaleTimeString()}] Task: ${msg.task}`,
              ],
              output: '',
              timestamp: Date.now(),
            },
          });
          await sendToService('codingAgent', { type: 'runCodingAgent', sessionId, task: msg.task, cwd: msg.cwd }, broadcastToClient);
        } else if (msg.type === 'generateVideo') {
          // Manual video generation from the Tools workbench. The handler
          // broadcasts progress in the background; if it fails before any
          // broadcast (missing API key / generation lock busy), surface a
          // failed task so the UI never goes blank or silently does nothing.
          const callId = 'manual_video_' + Date.now();
          broadcastToClient({ type: 'toolCall', id: callId, name: 'generateVideo', args: { prompt: msg.prompt } });
          const res: any = await handleGenerateVideo(
            { prompt: msg.prompt, size: msg.resolution || msg.size, duration: msg.duration },
            { ai, broadcast: broadcastToClient }
          );
          if (res?.error && !res?.taskId) {
            broadcastToClient({
              type: 'videoGenerationUpdate',
              task: {
                id: `vid_${Date.now()}`,
                model: 'happyhorse-1.1-t2v',
                prompt: msg.prompt,
                status: 'failed',
                progress: 0,
                error: String(res.error),
                timestamp: Date.now(),
              },
            });
          }
          broadcastToClient({ type: 'toolResult', id: callId, name: 'generateVideo', result: res });
        } else if (msg.type === 'qwenChat') {
          const callId = 'manual_qwen_chat_' + Date.now();
          broadcastToClient({ type: 'toolCall', id: callId, name: 'qwenChat', args: { prompt: msg.prompt } });
          const res: any = await handleQwenChat(
            { prompt: msg.prompt, model: msg.model, system: msg.system },
            { ai, broadcast: broadcastToClient }
          );
          broadcastToClient({ type: 'toolResult', id: callId, name: 'qwenChat', result: res });
        } else if (msg.type === 'qwenImageGenerate' || msg.type === 'qwenImageEdit') {
          const callId = 'manual_qwen_img_' + Date.now();
          broadcastToClient({ type: 'toolCall', id: callId, name: msg.type, args: { prompt: msg.prompt, instruction: msg.instruction } });
          const res: any =
            msg.type === 'qwenImageEdit'
              ? await handleQwenImageEdit(
                  { instruction: msg.instruction, images: msg.images, size: msg.size, watermark: msg.watermark },
                  { ai, broadcast: broadcastToClient }
                )
              : await handleQwenImageGenerate(
                  { prompt: msg.prompt, size: msg.size, watermark: msg.watermark },
                  { ai, broadcast: broadcastToClient }
                );
          if (res?.error) {
            broadcastToClient({
              type: 'qwencloudUpdate',
              task: {
                id: `qwen_img_${Date.now()}`,
                kind: msg.type === 'qwenImageEdit' ? 'imageEdit' : 'image',
                prompt: msg.prompt || msg.instruction,
                status: 'failed',
                progress: 0,
                error: String(res.error),
                timestamp: Date.now(),
              },
            });
          }
          broadcastToClient({ type: 'toolResult', id: callId, name: msg.type, result: res });
        } else if (msg.type === 'qwenVideoGenerate') {
          const callId = 'manual_qwen_vid_' + Date.now();
          broadcastToClient({ type: 'toolCall', id: callId, name: 'qwenVideoGenerate', args: { prompt: msg.prompt } });
          const res: any = await handleQwenVideoGenerate(
            { prompt: msg.prompt, resolution: msg.resolution, ratio: msg.ratio, duration: msg.duration },
            { ai, broadcast: broadcastToClient }
          );
          if (res?.error && !res?.taskId) {
            broadcastToClient({
              type: 'qwencloudUpdate',
              task: {
                id: `qwen_vid_${Date.now()}`,
                kind: 'video',
                prompt: msg.prompt,
                status: 'failed',
                progress: 0,
                error: String(res.error),
                timestamp: Date.now(),
              },
            });
          }
          broadcastToClient({ type: 'toolResult', id: callId, name: 'qwenVideoGenerate', result: res });
        } else if (msg.type === 'qwenTts') {
          const callId = 'manual_qwen_tts_' + Date.now();
          broadcastToClient({ type: 'toolCall', id: callId, name: 'qwenTts', args: { text: msg.text } });
          const res: any = await handleQwenTts(
            { text: msg.text, voice: msg.voice },
            { ai, broadcast: broadcastToClient }
          );
          if (res?.error) {
            broadcastToClient({
              type: 'qwencloudUpdate',
              task: {
                id: `qwen_tts_${Date.now()}`,
                kind: 'tts',
                prompt: msg.text,
                status: 'failed',
                progress: 0,
                error: String(res.error),
                timestamp: Date.now(),
              },
            });
          }
          broadcastToClient({ type: 'toolResult', id: callId, name: 'qwenTts', result: res });
        } else if (msg.type === 'cancelCodingAgent') {
          await sendToService('codingAgent', { type: 'cancelCodingAgent', sessionId: msg.sessionId }, broadcastToClient);
        }
      } catch (err: any) {
        console.error('Error processing client WS message:', err);
      }
    });

    clientWs.on('close', () => {
      console.log('Client WebSocket closed.');
      clientClosed = true;
      clearTimeout(bootstrapTimer);
      removeWhatsAppBroadcaster(sessionBootstrap?.uid || null, broadcastToClient);
      removeWhatsAppBroadcaster(null, broadcastToClient);
      if (liveSession) {
        intentionalLiveClose = true;
        try {
          liveSession.close();
        } catch (e) {
          // ignore cleanup errors
        }
        liveSession = null;
      }
    });
  });

  // Tool service health/status endpoints
  app.get('/api/services', (req, res) => {
    res.json({
      app: 'Beatrice OSS Tool Services',
      services: {
        sandbox: { port: SERVICE_PORTS.sandbox, url: `ws://127.0.0.1:${SERVICE_PORTS.sandbox}/stream` },
        cli: { port: SERVICE_PORTS.cli, url: `ws://127.0.0.1:${SERVICE_PORTS.cli}/stream` },
        browser: { port: SERVICE_PORTS.browser, url: `ws://127.0.0.1:${SERVICE_PORTS.browser}/stream` },
        computer: { port: SERVICE_PORTS.computer, url: `ws://127.0.0.1:${SERVICE_PORTS.computer}/stream` },
      },
    });
  });

  // Sandbox HTML previews are served by the sandbox service on its internal
  // port; proxy them through the main server so the frontend iframe works.
  app.get('/api/sandbox/preview/:file', (req, res) => {
    const file = String(req.params.file || '').replace(/[^a-zA-Z0-9._-]/g, '');
    const upstream = `http://127.0.0.1:${SERVICE_PORTS.sandbox}/api/sandbox/preview/${file}`;
    http
      .get(upstream, (upRes) => {
        if (upRes.statusCode && upRes.statusCode >= 400) {
          res.status(upRes.statusCode).send('Sandbox preview not found');
          return;
        }
        res.setHeader('Content-Type', upRes.headers['content-type'] || 'text/html; charset=utf-8');
        upRes.pipe(res);
      })
      .on('error', () => {
        res.status(502).send('Sandbox preview server unavailable');
      });
  });

  // Public pages — no authentication required
  app.get('/privacy', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'privacy.html'));
  });
  app.get('/terms', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'terms.html'));
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    // Hashed build assets (dist/assets/*) are immutable — cache them hard.
    app.use(
      '/assets',
      express.static(path.join(distPath, 'assets'), {
        immutable: true,
        maxAge: '365d',
      })
    );
    app.use(
      express.static(distPath, {
        // index.html must never be cached: it references hashed assets, so a
        // stale copy makes clients load the old bundle after every deploy.
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          }
        },
      })
    );
    app.get('*', (req, res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Fatal bind errors (e.g. EADDRINUSE from a second instance) must kill the
  // process so supervisors (systemd) can converge to a single healthy instance.
  server.on('error', (err: any) => {
    console.error('[server] Fatal listen error:', err?.message || err);
    process.exit(1);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Beatrice OSS server listening on 0.0.0.0:${PORT}`);
    console.log(`Public URL: ${APP_URL}`);
    console.log(`Tool services:`);
    console.log(`  Sandbox  : 127.0.0.1:${SERVICE_PORTS.sandbox}`);
    console.log(`  CLI      : 127.0.0.1:${SERVICE_PORTS.cli}`);
    console.log(`  Browser  : 127.0.0.1:${SERVICE_PORTS.browser}`);
    console.log(`  Computer : 127.0.0.1:${SERVICE_PORTS.computer}`);
  });
}

process.on('uncaughtException', (err) => {
  logger.error({ err: err?.stack || String(err) }, 'uncaughtException');
  // Fatal bind conflicts (EADDRINUSE from a competing instance) must kill the
  // process so the supervisor can restart it cleanly.
  const msg = err?.message || String(err);
  if (msg.includes('EADDRINUSE') || msg.includes('address already in use')) {
    process.exit(1);
  }
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'unhandledRejection');
});

startServer().catch((err) => {
  logger.error({ err: err?.message || String(err) }, 'Fatal startServer error');
  process.exit(1);
});
