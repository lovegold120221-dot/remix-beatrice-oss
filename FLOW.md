# Flow — Beatrice OSS (current runtime)

Mermaid diagrams traced from `server.ts`, `server/whatsapp-tools.ts`, `server/toolProxy.ts`, and `server/services/`. Complements `APP_LOGIC.md` with the memory tools and graceful-shutdown additions. Auth (Firebase ID-token verification), the tool registry, and the skill-routing layer (queryRouter → skillRouter → skillExecutor → toolCatalog → toolRoutingMiddleware) are the newest layers — see AGENTS.md for their module layout.

## 0. Authentication gate (all API + WS entry points)

```mermaid
flowchart TD
    REQ[HTTP request or WS upgrade] --> APIS{path?}
    APIS -->|GET /api/health| PUB1[public]
    APIS -->|GET /api/terminal/info| PUB2[public]
    APIS -->|GET /api/sandbox/preview/*| PUB3[public iframe proxy]
    APIS -->|GET /metrics| PUB4[public, internal scraping]
    APIS -->|/privacy /terms| PUB5[public static pages]
    APIS -->|everything else /api/*| AUTH{Authorization: Bearer<br/>Firebase ID token}
    APIS -->|/live or /terminal upgrade| WSAUTH{?token= query param}
    AUTH -->|missing/invalid| 401[401 Unauthorized]
    AUTH -->|verified| OK1[res.locals.authUser.uid -> downstream]
    WSAUTH -->|missing/invalid| WS401[upgrade rejected 401, socket destroyed]
    WSAUTH -->|verified| OK2[connection accepted]
    PUB1 --> DONE[Done]
    PUB2 --> DONE
    PUB3 --> DONE
    PUB4 --> DONE
    PUB5 --> DONE
    OK1 --> DONE
    OK2 --> DONE
    style AUTH fill:#fdd
    style WSAUTH fill:#fdd
```

Token verification uses `jose` (JWKS + RS256) in `server/auth.ts` — do **not** switch back to `firebase-admin`'s `verifyIdToken()`. `AUTH_DISABLED=1` turns the gate off for local dev (then the legacy `x-wa-uid`/`x-wa-email` headers are honored for WhatsApp). Verified uid is used for per-user WhatsApp sessions, the task store, and Google OAuth token lookups (`google_tokens/{uid}` in RTDB).

## 1. Server boot & component topology

```mermaid
flowchart TD
    BOOT[startServer] --> VAL[validateToolCoverage<br/>declarations == catalog == registry]
    VAL --> SVC[Start internal WS services]
    SVC --> P1[sandboxService :5556]
    SVC --> P2[cliService :5557]
    SVC --> P3[browserService :5558<br/>Playwright Chrome]
    SVC --> P4[computerService :5559]
    SVC --> P5[codingAgentService :5560<br/>spawns OpenCode CLI]

    BOOT --> HTTP[Express app :PORT (default 5555)]
    HTTP --> WS[WS /live + /terminal upgrade handler]
    HTTP --> REST[/api/health, /api/tools/*, /api/workspace/*,<br/>/api/whatsapp/*, /api/tasks]
    HTTP --> VITE[Vite middleware dev<br/>or dist/ static prod]

    BOOT --> TSK[initTaskStore<br/>in-memory + RTDB tasks/{uid}]
    BOOT --> MEM["MemoryCore gateway<br/>127.0.0.1:8420 (external service)<br/>with local JSON fallback"]
    WA[whatsapp-tools.ts module load] --> WA2[initWhatsAppSession unless WHATSAPP_AUTO_INIT=0]
    WA2 --> BA[Baileys connectSocket -> WhatsApp Web]
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

## 3. Tool call dispatch (71 tools, via registry + skill routing)

Every Gemini function call enters `handleFunctionCallWithSkills` (`server/toolRoutingMiddleware.ts`) and is decided ALLOW / REROUTE / CLARIFY / BLOCK before dispatch:

```mermaid
flowchart TD
    A[Gemini toolCall] --> B[resolveToolCall<br/>toolRoutingMiddleware.ts]
    B --> CAT{in toolCatalog?}
    CAT -->|no| BLK[BLOCK: I don't know how to use this tool]
    CAT -->|yes| Q{skill route resolves?}
    Q -->|no| RER[REROUTE / CLARIFY: ask what the user meant]
    Q -->|yes, skill intent matches| ALLOW[ALLOW -> skillExecutor]
    ALLOW --> S[run skill steps in order:<br/>validate -> resolve -> confirm -> tool -> respond]
    S --> DISP[dispatchTool -> toolRegistry]
    DISP -->|executeCodeSandbox| C[sandbox :5556]
    DISP -->|runCliCommand| D[cli :5557]
    DISP -->|runBrowserAutomation| E[browser :5558]
    DISP -->|runComputerControl| F[computer :5559]
    DISP -->|runCodingAgent / deployAgentTask| G[codingAgent :5560<br/>OpenCode CLI]
    DISP -->|18x whatsapp_* tools| H[whatsapp-tools.ts<br/>Baileys -> WhatsApp Web]
    DISP -->|33x google_* tools| I[googleWorkspace.ts<br/>Google APIs]
    DISP -->|qwen* / generateVideo| J[QwenCloud / DashScope<br/>only on explicit request<br/>per-user FIFO queue]
    DISP -->|remember_memory / recall_memory / get_core_memory| K[MemoryCore :8420<br/>local fallback if down]
    DISP -->|webSearch / getWeather / getSystemInfo| L[lightweight handlers]
    DISP -->|updateCanvasVisual| M[canvas card -> SPA]
    DISP -->|unknown| N[error: Unknown tool name]
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
    R --> S2[broadcast toolResult -> SPA<br/>persist via upsertTaskFromBroadcast]
    S2 --> T[liveSession.sendToolResponse<br/>Gemini turns result into speech]
```

Declarations live in `server/toolDeclarations.ts` (moved out of server.ts). Boot-time `validateToolCoverage()` and `validateSkillCoverage()` fail fast if the declarations, the catalog (`server/toolCatalog.ts`), the registry, or the skill routes drift out of sync. Media tools hit two DashScope hosts with per-model routing (`imageEndpointFor()`/`videoEndpointFor()` in `server/tools.ts`): image `qwen-image-2.0-pro` → `z-image-turbo` (intl) → `wan2.7-image-pro`/`wan2.7-image` (Token Plan); video `happyhorse-1.1-t2v` (intl) → `wan3.0-video` (intl); TTS `qwen-audio-3.0-tts-plus` (Token Plan).

## 4. Memory learning flow (MemoryCore, with local fallback)

```mermaid
flowchart LR
    U[Boss says something important] --> R[remember_memory tool]
    R --> GW{gateway reachable?}
    GW -->|yes| ADD[POST /v2/conversation/add]
    GW -->|no| FB1[local JSON store append]
    ADD --> L0[(L0 conversation store)]
    Q[Boss asks about the past] --> RC[recall_memory tool]
    RC --> GW2{gateway reachable?}
    GW2 -->|yes| SRCH[POST /v2/conversation/search<br/>BM25 keyword search]
    GW2 -->|no| FB2[local BM25 search over fallback store]
    SRCH --> L0
    SRCH --> HITS[ranked matches + relevance scores]
    FB1 --> FBF[(data/memory-fallback.json)]
    FB2 --> FBF
    HITS --> SPOKEN[Beatrice answers grounded in memory]
    CORE[Boss context] --> C[get_core_memory tool]
    C --> GW3{gateway reachable?}
    GW3 -->|yes| CR[POST /v2/core/read<br/>L3 persona/core profile]
    CR --> CACHE[cache latest profile locally]
    GW3 -->|no| CACHED[return cached profile]
    CR --> INJ[injected into system prompt on WS connect]
```

Fallback store is a capped (1000-entry) JSON file at `data/memory-fallback.json` (`MEMORY_FALLBACK_FILE` override for tests); successful gateway reads refresh the cached core profile so `get_core_memory` keeps working while the gateway is down.

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
| server→client | `sandboxOutput`, `cliOutput`, `browserUpdate`, `computerUpdate`, `agentUpdate`, `codingAgentUpdate`, `canvasUpdate`, `videoGenerationUpdate`, `qwencloudUpdate`, `whatsappStatus`, `skillExecutionUpdate` | streamed tool output (skillExecutionUpdate tracks skill step progress) |

## 8. REST endpoints

| Route | Purpose |
|---|---|
| `GET /api/health` | status, app, live model, API-key configured (public) |
| `GET /api/terminal/info` | SSH host/port/user for the browser terminal (public) |
| `GET /api/services` | internal service ports + ws stream URLs (5556–5560) |
| `GET /api/tasks` · `POST /api/tasks` · `GET/PATCH/DELETE /api/tasks/:id` | per-user generation task history (RTDB-backed, requires verified uid) |
| `POST /api/tools/execute-code` · `/api/tools/cli` · `/api/tools/agent` · `/api/tools/canvas` · `/api/tools/weather` · `/api/tools/search` | direct tool invocations (no WS needed) |
| `GET /api/workspace/gmail/messages` · `/api/workspace/contacts` · `POST /api/workspace/gmail/send` · `/api/workspace/forms/create` · `GET /api/workspace/forms/list` | Google Workspace over REST |
| `GET /api/whatsapp/status` · `/api/whatsapp/capabilities` | WhatsApp health + internal action catalog |
| `POST /api/whatsapp/pair` (phone) · `/api/whatsapp/pair-qr` · `/api/whatsapp/cancel` · `/api/whatsapp/logout` · `/api/whatsapp/approve` | WhatsApp lifecycle + send approval |
| `GET /api/whatsapp/boss-mode` · `POST /api/whatsapp/boss-mode` | read/set Boss Mode toggle |
| `POST /api/whatsapp/reset` | hard-reset a stuck WhatsApp session (403-banned socket) |
| `GET /api/sandbox/preview/:file` | proxy sandbox HTML previews (frontend iframe, public) |
| `GET /privacy` · `/terms` | public static pages (no auth) |
| `GET *` (prod) | SPA fallback → `dist/index.html` |

Video generation (`generateVideo` / `qwenVideoGenerate`) is enqueued in a per-user FIFO queue (`server/tools.ts`): one render runs server-wide at a time, each user may hold at most one running + one queued job, and queued jobs broadcast a `queued` status with their position. Memory tool results are returned with `source: 'local-fallback'` when the MemoryCore gateway is unreachable.

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
