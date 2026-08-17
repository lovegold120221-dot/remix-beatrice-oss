# App Logic — Beatrice OSS

How the system actually works at runtime. All flows below are traced from `server.ts`, `server/tools.ts`, `server/toolProxy.ts` and `server/services/`.

## Runtime topology

```mermaid
flowchart LR
    subgraph Client
      UI[React SPA<br/>src/main.tsx]
    end
    UI -- "WS /live (binary + JSON)" --> SRV[server.ts<br/>port 5555]
    UI -- "REST /api/*" --> SRV
    SRV -- "HTTP JSON" --> VITE[Vite middleware dev<br/>or dist/ static prod]
    SRV -- "WS streams" --> PROXY[server/toolProxy.ts<br/>sendToService]
    PROXY --> P1[sandboxService :5556]
    PROXY --> P2[cliService :5557]
    PROXY --> P3[browserService :5558<br/>Playwright Chrome]
    PROXY --> P4[computerService :5559]
    PROXY --> P5[codingAgentService :5560<br/>spawns OpenCode CLI]
    SRV -- "WebSocket" --> W[whatsapp-tools.ts<br/>Baileys -> WhatsApp]
    SRV -- "REST" --> G[googleWorkspace.ts<br/>Google APIs]
    SRV -- "Gemini Live API" --> L[gemini-3.1-flash-live-preview]
    SRV -- "REST" --> Q[QwenCloud / DashScope]
```

## 1. Live voice conversation (end-to-end)

```mermaid
sequenceDiagram
    autonumber
    participant U as Browser (React SPA)
    participant S as server.ts
    participant L as Gemini Live API
    participant T as Tool handlers
    participant SV as Internal WS services

    U->>S: WS /live upgrade
    S-->>U: status: connecting
    U->>S: {type: sessionBootstrap, language, voice, history}
    S->>L: ai.live.connect(model, systemInstruction=system_prompt.md + KB, tools=67 declarations)
    S-->>U: status: connected
    U->>S: {type: audio, base64 pcm16k} / video / text / attachment
    S->>L: sendRealtimeInput(audio|video|text)
    L-->>S: modelTurn: audio parts + transcriptions
    S-->>U: audio (base64) + transcript + status: speaking
    L-->>S: toolCall (functionCalls)
    S-->>U: toolCall (id, name, args)
    S->>T: dispatch by name (67-way if/else)
    T->>SV: forwardToService (sandbox/cli/browser/computer/codingAgent)
    SV-->>T: streamed chunks + final result
    T-->>S: toolResult
    S-->>U: toolResult (id, name, result)
    S->>L: sendToolResponse(functionResponses)
    L-->>S: modelTurn: spoken answer
    S-->>U: audio + transcript
    L-->>S: turnComplete
    S-->>U: status: listening
```

Notes:
- The browser WS is the **only** connection to the browser — one socket carries audio in both directions, transcripts, tool calls/results, and streamed service output.
- Language/voice/persona come from the bootstrap and can be updated live via `updateSessionPrefs` (soft-restarts the Live session only).
- A `bootstrap` delay of 1.5s guards against starting Live before the client sends prefs.

## 2. Tool call dispatch

```mermaid
flowchart TD
    A[Gemini Live toolCall] --> B{name?}
    B -->|executeCodeSandbox| C[handleExecuteCodeSandbox]
    B -->|runCliCommand| D[handleRunCliCommand]
    B -->|deployAgentTask / runCodingAgent| E[spawn sub-agent / OpenCode CLI]
    B -->|getWeather / webSearch / getSystemInfo| F[lightweight handlers]
    B -->|qwen* / generateVideo| G["QwenCloud + DashScope REST<br/>only on explicit request"]
    B -->|runBrowserAutomation / runComputerControl| H[browser :5558 / computer :5559]
    B -->|33x Google tools| I[googleWorkspace.ts]
    B -->|18x whatsapp_* tools| J[whatsapp-tools.ts Baileys]
    B -->|remember_memory / recall_memory / get_core_memory| K2[MemoryCore gateway :8420]
    B -->|updateCanvasVisual| K[canvas card to SPA]
    B -->|unknown| L[error: Unknown tool name]
    C --> M[wrap result + sendToolResponse back to Live]
    D --> M
    E --> M
    F --> M
    G --> M
    H --> M
    I --> M
    J --> M
    K2 --> M
    K --> M
    L --> M
```

Every path: broadcast `toolCall` → run handler → broadcast `toolResult` → `liveSession.sendToolResponse({functionResponses})` so Gemini turns the result into speech.

## 3. WhatsApp flow (send + pairing)

```mermaid
sequenceDiagram
    autonumber
    participant U as Boss
    participant B as Beatrice (Live)
    participant W as whatsapp-tools.ts
    participant WAPP as WhatsApp Web

    U->>B: "send X to John"
    B->>W: sync_whatsapp_history (resync first)
    B->>W: resolve_whatsapp_contact(John)
    W-->>B: JID 32xxxxxx@s.whatsapp.net
    B->>W: request_whatsapp_send(recipient, action)
    alt auto-approve on (WHATSAPP_SEND_AUTO_APPROVE=true)
        W-->>B: auto-approved
    else human approval required
        W-->>B: pending -> SPA shows approval prompt
        U->>W: whatsappApproval WS / POST /api/whatsapp/approve
    end
    B->>W: send_whatsapp_text(JID, X)
    W->>WAPP: Baileys sendMessage
    W-->>B: delivered confirmation
    B-->>U: confirmation spoken

    U->>B: "pair WhatsApp"
    B->>W: pairWhatsAppWithQr / pairWhatsApp(phone)
    W-->>U: QR code / pairing code in UI
    U->>WAPP: scan QR (Settings > Linked Devices)
    WAPP-->>W: linked, auth state -> data/whatsapp-auth/
```

## 4. Coding agent delegation

```mermaid
flowchart TD
    A[Boss asks to build/fix code] --> B[runCodingAgent tool]
    B --> C[handleRunCodingAgent -> toolProxy]
    C --> D[codingAgentService :5560]
    D --> E{OPENCODE_BIN exists?}
    E -->|no| F[return error: install opencode]
    E -->|yes| G[spawn 'opencode <task>' in workdir]
    G --> H[stdout/stderr -> codingAgentStream chunks]
    H --> I[persist session to data/coding-agent-logs/<id>.json]
    G --> J[close: completed / failed / cancelled]
    J --> K[final chunk with done:true]
    K --> L[Beatrice reports result to Boss]
```

The coding agent's default model comes from `~/.config/opencode/opencode.jsonc` (Zen free model `opencode/deepseek-v4-flash-free`); it inherits the server's env (keys in `.env.local`).

## 5. Reconnection & resilience

```mermaid
flowchart TD
    A[Browser WS connected] --> B[Gemini Live connected]
    B -->|onerror| C[log, status listening, quiet transcript]
    C --> D{client WS alive?}
    D -->|yes| E[retry startLiveSession auto-retry<br/>max 5]
    E -->|retries exhausted| F[error toast: tap Reconnect Beatrice<br/>language + memory preserved]
    E -->|ok| B
    B -->|"onclose intentional (prefs update)"| G[no retry, session replaced]
    B -->|onclose unexpected| D
    D -->|no client WS closed| H[cleanup: close Live, remove broadcasters]
```

## 6. Manual tool triggers (no voice)

The same handlers are reachable without Gemini: the SPA sends `runSandbox`, `runCli`, `deployAgent`, `getSystemInfo`, `updateCanvas`, `getWeather`, `webSearch`, `runSandboxStream`, `runCliStream`, `runBrowser`, `runComputer`, `runCodingAgent`, `cancelCodingAgent` WS messages — each is dispatched to the same real handler as the voice path and broadcast as `toolCall`/`toolResult` (so the UI stays consistent).

## 7. Message contract (client ⇄ server, WS `/live`)

| Direction | type | Payload |
|---|---|---|
| client→server | `sessionBootstrap`, `restartLive`, `updateSessionPrefs` | bootstrap: language/voice/history/custom persona |
| client→server | `audio` / `video` / `text` / `attachment` | base64 pcm16k audio, jpeg frames, text, file attachments |
| client→server | `whatsappApproval` | id + approve + recipient |
| server→client | `audio` | base64 Gemini audio |
| server→client | `transcript` | role user/model/system + text (partial flag while streaming) |
| server→client | `toolCall` / `toolResult` | id + name + args/result |
| server→client | `status` | connecting / connected / speaking / listening / error |
| server→client | `interrupted`, `turnComplete` | turn lifecycle |
| server→client | `sandboxOutput`, `cliOutput`, `browserUpdate`, `computerUpdate`, `codingAgentUpdate`, `canvasUpdate`, `videoGenerationUpdate`, `qwencloudUpdate`, `whatsappStatus` | streamed tool output |

## 8. REST endpoints

| Route | Purpose |
|---|---|
| `GET /api/health` | status + model + key configured |
| `GET /api/services` | tool service ports 5556–5560 |
| `POST /api/tools/execute-code` · `/api/tools/cli` · `/api/tools/agent` · `/api/tools/canvas` · `/api/tools/weather` · `/api/tools/search` | direct tool invocations |
| `GET /api/workspace/gmail/messages` · `/api/workspace/contacts` · `POST /api/workspace/gmail/send` · `/api/workspace/forms/create` · `GET /api/workspace/forms/list` | Google Workspace over REST |
| `GET /api/whatsapp/status` · `/capabilities` | WhatsApp health |
| `POST /api/whatsapp/pair` · `/pair-qr` · `/cancel` · `/logout` · `/approve` | WhatsApp lifecycle |
| `GET /api/sandbox/preview/:file` | proxy sandbox HTML previews (frontend iframe) |
| `GET /privacy` · `/terms` | public static pages (no auth) |

## 9. Memory learning (MemoryCore)

Beatrice saves and recalls conversations via the local MemoryCore gateway (`127.0.0.1:8420`, auth via `TDAI_LLM_API_KEY` / `TDAI_LLM_SERVICE_ID`).

```mermaid
flowchart LR
    U[Boss says something important] --> R[remember_memory tool]
    R --> ADD[POST /v2/conversation/add]
    ADD --> L0[(L0 conversation store)]
    Q[Boss asks about the past] --> RC[recall_memory tool]
    RC --> SRCH[POST /v2/conversation/search<br/>BM25 keyword search]
    SRCH --> L0
    SRCH --> HITS[ranked matches + relevance scores]
    HITS --> SPOKEN[Beatrice answers grounded in memory]
    CORE[Boss context] --> C[get_core_memory tool]
    C --> CR[POST /v2/core/read<br/>L3 persona/core profile]
    CR --> INJ[injected into system prompt on WS connect]
```

## 10. WhatsApp lifecycle, Boss Mode & shutdown

```mermaid
flowchart TD
    A[initWhatsAppSession] --> B[loadStoreFromRTDB<br/>restore persisted chats/messages]
    B --> C{creds.json exists?}
    C -->|no| D[pairing flow<br/>waitForSocketOpen -> requestPairingCode]
    D --> E[QR / pairing code to Boss]
    C -->|yes| F[connectSocket]
    F --> G{connection.upsert}
    G -->|open| H[linked + streaming events]
    H --> I[schedulePersist debounced 4s<br/>RTDB + local file]
    H --> J[maybeAutoReply when Boss Mode ON<br/>gemini-2.5-flash, 400 chars, 60s cooldown]
    G -->|close unexpected| K["sock = null (drop dead ref)"]
    K --> L[reconnect timer backoff<br/>BASE * 2^attempt + jitter, capped]
    L --> F
    F -->|pairing timeout 20s| M[state failed -> try again]
    H --> N[SIGTERM/SIGINT]
    N --> O["flushStoreOnShutdown<br/>persistStore then exit (5s bound)"]
```

Boss Mode details: when ON, `maybeAutoReply` auto-replies to incoming DMs (`@s.whatsapp.net`, skips own/`3A`-broadcast/stub msgs) using Gemini `gemini-2.5-flash` (`getLocalGemini` lazy import), mimicking the Boss's style from `getWhatsAppKnowledgeBase(force)` (contacts + style + recent conversations, 5-min cache). Max 400 chars, 60s cooldown per chat, marks read. Toggle via `set_whatsapp_boss_mode` tool or `GET/POST /api/whatsapp/boss-mode`; persisted in `data/whatsapp-auth/.meta.json`.

Shutdown: `SIGTERM`/`SIGINT` → `flushStoreOnShutdown` clears reconnect/heartbeat/persist timers and calls `persistStore()` before exit (5s bound), so the newest messages aren't dropped by the 4s debounce during restarts.

## 11. Deployment flow

```mermaid
flowchart TD
    A[npm install] --> B[npm run build<br/>vite build + esbuild -> dist/server.cjs]
    B --> C{install-server.sh?}
    C -->|full| D[apt toolchain: build-essential python3 ffmpeg<br/>libxtst-dev libpng-dev for node-pty + robotjs]
    C -->|skip-deps| E[npm install + build only]
    D --> F[Playwright Chromium :5558 + OpenCode CLI :5560]
    F --> G[".env.local from .env.example<br/>GEMINI_API_KEY required, not MY_GEMINI_API_KEY"]
    G --> H[data dirs: whatsapp-auth, whatsapp-media,<br/>sandbox-previews, coding-agent-logs]
    E --> H
    D --> H
    H --> I{INSTALL_SYSTEMD=1?}
    I -->|yes| J[beatrice-oss.service systemd unit<br/>/usr/bin/node dist/server.cjs, Restart=always]
    I -->|no| K[run manually: NODE_ENV=production PORT=5555<br/>APP_URL=https://oss.eburon.ai node dist/server.cjs]
    J --> L[daemon-reload + systemctl restart]
    K --> L
    L --> M[Node :5555 plain HTTP]
    M --> N[Caddy reverse_proxy 127.0.0.1:5555<br/>auto Let's Encrypt on :443]
    M --> O[Nginx + certbot alternative<br/>X-Forwarded-Proto + Upgrade/Connection headers]
    N --> P[HTTPS clients + /live WebSocket]
    O --> P
    P --> Q[Verify: /api/health, /api/services,<br/>speak to see status: connected -> speaking]
```

Deployment notes: never run two instances per host (fixed ports 5556–5560 clash); the proxy must forward `Upgrade`/`Connection` headers or `/live` fails; WhatsApp pairing, Google connect, and `opencode auth login` are interactive one-time steps. See `DEPLOYMENT.md` for the full guide.