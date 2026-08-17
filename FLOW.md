# Flow — Beatrice OSS (current runtime)

Mermaid diagrams traced from `server.ts`, `server/whatsapp-tools.ts`, `server/toolProxy.ts`, and `server/services/`. Complements `APP_LOGIC.md` with the memory tools and graceful-shutdown additions.

## 1. Server boot & component topology

```mermaid
flowchart TD
    BOOT[startServer] --> SVC[Start internal WS services]
    SVC --> P1[sandboxService :5556]
    SVC --> P2[cliService :5557]
    SVC --> P3[browserService :5558<br/>Playwright Chrome]
    SVC --> P4[computerService :5559]
    SVC --> P5[codingAgentService :5560<br/>spawns OpenCode CLI]

    BOOT --> HTTP[Express app :5555]
    HTTP --> WS[WS /live upgrade handler]
    HTTP --> REST[/api/health, /api/tools/*,<br/>/api/workspace/*, /api/whatsapp/*/]
    HTTP --> VITE[Vite middleware dev<br/>or dist/ static prod]

    BOOT --> WA[initWhatsAppSession auto-init]
    WA --> RTDB[loadStoreFromRTDB<br/>restore chats BEFORE connecting]
    RTDB --> BA[Baileys connectSocket]
    BA --> WA2[WhatsApp Web]

    BOOT --> MEM["MemoryCore gateway<br/>127.0.0.1:8420 (external service)"]
    WA --> FLUSH[SIGTERM/SIGINT -> flushStoreOnShutdown<br/>clear timers + persistStore, 5s bound]

    PROXY[server/toolProxy.ts sendToService] --> P1
    PROXY --> P2
    PROXY --> P3
    PROXY --> P4
    PROXY --> P5
    WS --> PROXY
```

## 2. Live session bootstrap (per client WS connection)

```mermaid
sequenceDiagram
    autonumber
    participant U as React SPA (browser)
    participant S as server.ts (WS /live)
    participant L as Gemini Live API
    participant M as MemoryCore :8420
    participant P as toolProxy (services 5556-5560)

    U->>S: WS /live upgrade
    S-->>U: status: connecting
    U->>S: {type: sessionBootstrap, language, voice, history, persona}
    S->>S: buildSessionInstruction()
    Note over S: system_prompt.md + knowledge_base.md<br/>+ SESSION CONTINUITY block (lang, summary, last 16 turns)<br/>+ WhatsApp recent context
    S->>L: ai.live.connect(gemini-3.1-flash-live-preview,<br/>voice=Aoede, tools=declarations)
    S-->>U: status: connected
    U->>S: audio / video / text / attachment
    S->>L: sendRealtimeInput
    L-->>S: modelTurn (audio parts + transcript)
    S-->>U: audio + transcript + status: speaking
    L-->>S: toolCall
    S-->>U: toolCall (id, name, args)
    S->>S: dispatch tool by name
    alt memory tool
        S->>M: remember_memory / recall_memory / get_core_memory
        M-->>S: result
    else service tool
        S->>P: forward to internal service
        P-->>S: streamed chunks + final result
    end
    S-->>U: toolResult (id, name, result)
    S->>L: sendToolResponse(functionResponses)
    L-->>S: modelTurn (spoken answer)
    S-->>U: audio + transcript
    L-->>S: turnComplete
    S-->>U: status: listening
```

## 3. Tool call dispatch (67 tools)

```mermaid
flowchart TD
    A[Gemini toolCall] --> B{name?}
    B -->|executeCodeSandbox| C[sandbox :5556]
    B -->|runCliCommand| D[cli :5557]
    B -->|runBrowserAutomation| E[browser :5558]
    B -->|runComputerControl| F[computer :5559]
    B -->|runCodingAgent / deployAgentTask| G[codingAgent :5560<br/>OpenCode CLI]
    B -->|18x whatsapp_* tools| H[whatsapp-tools.ts<br/>Baileys -> WhatsApp Web]
    B -->|33x google_* tools| I[googleWorkspace.ts<br/>Google APIs]
    B -->|qwen* / generateVideo| J[QwenCloud / DashScope<br/>only on explicit request]
    B -->|remember_memory / recall_memory / get_core_memory| K[MemoryCore :8420]
    B -->|webSearch / getWeather / getSystemInfo| L[lightweight handlers]
    B -->|updateCanvasVisual| M[canvas card -> SPA]
    B -->|unknown| N[error: Unknown tool name]
    C --> R[wrap result]
    D --> R
    E --> R
    F --> R
    G --> R
    H --> R
    I --> R
    J --> R
    K --> R
    L --> R
    M --> R
    N --> R
    R --> S[broadcast toolResult -> SPA]
    S --> T[liveSession.sendToolResponse<br/>Gemini turns result into speech]
```

## 4. Memory learning flow (MemoryCore)

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

## 5. WhatsApp lifecycle & reconnect

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

## 6. Boss Mode auto-reply (incoming DM)

```mermaid
sequenceDiagram
    autonumber
    participant WA as WhatsApp Web
    participant W as whatsapp-tools.ts
    participant M as Gemini (local, gemini-2.5-flash)
    participant KB as Knowledge base (5-min cache)

    WA-->>W: messages.upsert (incoming DM @s.whatsapp.net)
    W->>W: maybeAutoReply
    Note over W: skips own msgs, 3A-broadcasts, stub msgs<br/>checks bossMode ON + 60s cooldown per chat
    W->>KB: getWhatsAppKnowledgeBase<br/>contacts + style + recent conversations
    W->>M: prompt: mimic Boss's style, max 400 chars
    M-->>W: reply text
    W->>WA: sendMessage + mark read
    W->>W: schedulePersist (4s debounce)
```

## 7. WS message contract (client ⇄ server, `/live`)

| Direction | type | Payload / effect |
|---|---|---|
| client→server | `sessionBootstrap` | bootstrap: language, voice, history, persona → starts Live (1.5s bootstrap timer fallback) |
| client→server | `restartLive` | re-start Live session (soft restart) |
| client→server | `updateSessionPrefs` | update language/voice/persona → soft-restart Live |
| client→server | `audio` / `video` / `text` / `attachment` | base64 pcm16k audio, jpeg frames, text, files → sendRealtimeInput |
| client→server | `whatsappApproval` | id + approve + recipient → approveWhatsAppSend |
| client→server | `runSandbox` / `runCli` / `deployAgent` / `getSystemInfo` / `updateCanvas` / `getWeather` / `webSearch` | manual tool triggers (no Gemini), broadcast as toolCall/toolResult |
| client→server | `runSandboxStream` / `runCliStream` / `runBrowser` / `runComputer` / `runCodingAgent` / `cancelCodingAgent` | direct dispatch to internal service via toolProxy |
| server→client | `audio` | base64 Gemini audio |
| server→client | `transcript` | role user/model/system + text (partial flag while streaming) |
| server→client | `toolCall` / `toolResult` | id + name + args/result |
| server→client | `status` | connecting / connected / speaking / listening / error |
| server→client | `interrupted`, `turnComplete` | turn lifecycle |
| server→client | `sandboxOutput`, `cliOutput`, `browserUpdate`, `computerUpdate`, `codingAgentUpdate`, `canvasUpdate`, `videoGenerationUpdate`, `qwencloudUpdate`, `whatsappStatus` | streamed tool output |

## 8. REST endpoints

| Route | Purpose |
|---|---|
| `GET /api/health` | status, app, live model, API-key configured |
| `GET /api/services` | internal service ports + ws stream URLs (5556–5559) |
| `POST /api/tools/execute-code` · `/api/tools/cli` · `/api/tools/agent` · `/api/tools/canvas` · `/api/tools/weather` · `/api/tools/search` | direct tool invocations (no WS needed) |
| `GET /api/workspace/gmail/messages` · `/api/workspace/contacts` · `POST /api/workspace/gmail/send` · `/api/workspace/forms/create` · `GET /api/workspace/forms/list` | Google Workspace over REST |
| `GET /api/whatsapp/status` · `/api/whatsapp/capabilities` | WhatsApp health + internal action catalog |
| `POST /api/whatsapp/pair` (phone) · `/api/whatsapp/pair-qr` · `/api/whatsapp/cancel` · `/api/whatsapp/logout` · `/api/whatsapp/approve` | WhatsApp lifecycle + send approval |
| `GET /api/sandbox/preview/:file` | proxy sandbox HTML previews (frontend iframe) |
| `GET /privacy` · `/terms` | public static pages (no auth) |
| `GET *` (prod) | SPA fallback → `dist/index.html` |

## 9. Manual tool triggers (no voice)

```mermaid
flowchart TD
    A[SPA sends WS message] --> B{type?}
    B -->|runSandbox| C[executeCodeSandbox handler]
    B -->|runCli| D[runCliCommand handler]
    B -->|deployAgent| E[deployAgentTask handler]
    B -->|getSystemInfo| F[getSystemInfo handler]
    B -->|updateCanvas| G[updateCanvasVisual handler]
    B -->|getWeather| H[getWeather handler]
    B -->|webSearch| I[webSearch handler]
    B -->|runSandboxStream| J[sendToService sandbox :5556]
    B -->|runCliStream| K[sendToService cli :5557]
    B -->|runBrowser| L[sendToService browser :5558]
    B -->|runComputer| M[sendToService computer :5559]
    B -->|runCodingAgent / cancelCodingAgent| N[sendToService codingAgent :5560]
    C --> O[broadcast toolCall + toolResult<br/>UI stays consistent with voice path]
    D --> O
    E --> O
    F --> O
    G --> O
    H --> O
    I --> O
    J --> O
    K --> O
    L --> O
    M --> O
    N --> O
```

Each manual trigger reuses the exact same handler as the voice path, so state is identical regardless of entry point.

## 10. Deployment flow (build → serve → proxy)

```mermaid
flowchart TD
    A[npm install] --> B[npm run build<br/>vite build + esbuild -> dist/server.cjs]
    B --> C{install-server.sh?}
    C -->|full| D[apt toolchain: build-essential python3 ffmpeg<br/>libxtst-dev libpng-dev for node-pty + robotjs]
    C -->|skip-deps| E[npm install + build only]
    D --> F[Playwright Chromium :5558 + OpenCode CLI :5560]
    F --> G[.env.local from .env.example<br/>GEMINI_API_KEY required, not MY_GEMINI_API_KEY]
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

Deployment notes:
- Never run two app instances per host — internal services bind fixed ports 5556–5560 and clash on boot.
- The proxy **must** forward `Upgrade`/`Connection` headers or the `/live` WebSocket silently fails.
- After install: WhatsApp pairing (Settings), Google connect, `opencode auth login` are interactive one-time steps.
- `SIGTERM` (systemctl restart) triggers `flushStoreOnShutdown` in whatsapp-tools.ts — clears timers and persists the WhatsApp store before exit (5s bound), so no messages are lost on restart.
