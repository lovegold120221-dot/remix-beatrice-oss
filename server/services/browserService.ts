import express from 'express';
import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = parseInt(process.env.BROWSER_SERVICE_PORT || '5558', 10);

type Browser = any;
type Page = any;

interface BrowserSession {
  id: string;
  browser?: Browser;
  page?: Page;
  log: string[];
  lastScreenshot?: string;
}

async function loadChromium() {
  try {
    const pw = await import('playwright');
    return pw.chromium;
  } catch (err: any) {
    throw new Error(`Playwright unavailable: ${err?.message || err}`);
  }
}

const sessions = new Map<string, BrowserSession>();
const clients = new Set<WebSocket>();

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function sendEvent(sessionId: string, event: string, data: Record<string, unknown>, done = false) {
  broadcast({
    type: 'browserUpdate',
    sessionId,
    event,
    done,
    timestamp: Date.now(),
    ...data,
  });
}

async function screenshot(session: BrowserSession): Promise<string | undefined> {
  if (!session.page) return undefined;
  try {
    const buffer = await session.page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
    const b64 = buffer.toString('base64');
    session.lastScreenshot = b64;
    return b64;
  } catch (err) {
    return undefined;
  }
}

async function createSession(sessionId: string): Promise<BrowserSession> {
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  const session: BrowserSession = { id: sessionId, browser, page, log: [] };

  page.on('console', (msg) => {
    const line = `[console.${msg.type()}] ${msg.text()}`;
    session.log.push(line);
    sendEvent(sessionId, 'console', { text: line });
  });

  page.on('pageerror', (err) => {
    const line = `[pageerror] ${err.message}`;
    session.log.push(line);
    sendEvent(sessionId, 'error', { text: line });
  });

  page.on('request', (req) => {
    const line = `[request] ${req.method()} ${req.url()}`;
    session.log.push(line);
    // do not stream every request to avoid noise; keep in log
  });

  sessions.set(sessionId, session);
  return session;
}

export function startBrowserService() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/stream' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'status', service: 'browser', status: 'connected' }));

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const sessionId = msg.sessionId || `web_${Date.now()}`;

        if (msg.type === 'startSession') {
          const session = await createSession(sessionId);
          sendEvent(sessionId, 'sessionStarted', { message: `Browser session ${sessionId} started` });
        } else if (msg.type === 'goto') {
          const session = sessions.get(sessionId) || await createSession(sessionId);
          if (!session.page) throw new Error('no page');
          await session.page.goto(msg.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          const url = session.page.url();
          const title = await session.page.title().catch(() => '');
          const shot = await screenshot(session);
          sendEvent(sessionId, 'navigated', { url, title, screenshot: shot });
        } else if (msg.type === 'click') {
          const session = sessions.get(sessionId);
          if (!session?.page) throw new Error('no session');
          await session.page.click(msg.selector);
          const shot = await screenshot(session);
          sendEvent(sessionId, 'clicked', { selector: msg.selector, screenshot: shot });
        } else if (msg.type === 'type') {
          const session = sessions.get(sessionId);
          if (!session?.page) throw new Error('no session');
          await session.page.fill(msg.selector, msg.text);
          const shot = await screenshot(session);
          sendEvent(sessionId, 'typed', { selector: msg.selector, text: msg.text, screenshot: shot });
        } else if (msg.type === 'scroll') {
          const session = sessions.get(sessionId);
          if (!session?.page) throw new Error('no session');
          await session.page.evaluate(() => window.scrollBy(0, window.innerHeight / 2));
          const shot = await screenshot(session);
          sendEvent(sessionId, 'scrolled', { screenshot: shot });
        } else if (msg.type === 'read') {
          const session = sessions.get(sessionId);
          if (!session?.page) throw new Error('no session');
          const title = await session.page.title().catch(() => '');
          const url = session.page.url();
          const text = await session.page.evaluate(() => document.body.innerText.slice(0, 4000));
          const shot = await screenshot(session);
          sendEvent(sessionId, 'pageText', { title, url, text, screenshot: shot });
        } else if (msg.type === 'closeSession') {
          const session = sessions.get(sessionId);
          if (session?.browser) {
            await session.browser.close();
          }
          sessions.delete(sessionId);
          sendEvent(sessionId, 'sessionClosed', {}, true);
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (err: any) {
        console.error('[BrowserService] message error:', err);
        broadcast({ type: 'browserUpdate', sessionId: 'unknown', event: 'error', error: err.message, done: false, timestamp: Date.now() });
      }
    });

    ws.on('close', () => clients.delete(ws));
  });

  app.post('/run', async (req, res) => {
    const { sessionId, steps } = req.body;
    const id = sessionId || `web_${Date.now()}`;
    for (const step of steps || []) {
      const ws = Array.from(clients)[0];
      if (ws) ws.send(JSON.stringify({ type: step.type, sessionId: id, ...step }));
    }
    res.json({ sessionId: id, status: 'started' });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[BrowserService] listening on 127.0.0.1:${PORT}`);
  });

  return server;
}
