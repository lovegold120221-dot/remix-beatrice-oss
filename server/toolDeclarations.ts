// Gemini Live function declarations — the exact schemas handed to the model.
// Single source for the tool surface; moved out of server.ts so the block is
// reviewable/testable in isolation. Model allowlists must match the Token Plan
// allowlists in server/tools.ts (QWEN_IMAGE_MODELS / QWEN_VIDEO_MODELS /
// QWEN_TTS_MODELS) — validateToolCoverage() and test/tool-declarations.test.ts
// keep declarations, catalog, and registry in sync.

import { Type } from '@google/genai';
import { getAllToolNames } from './toolCatalog.js';
import { toolNames } from './toolRegistry.js';

export function getFunctionDeclarations() {
  return [
    {
      functionDeclarations: [
        {
          name: 'executeCodeSandbox',
          description:
            'Executes code in an isolated JavaScript/Python/TypeScript sandbox. Use this when asked to write, test, debug, or evaluate code, formulas, algorithms, or visual HTML components.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              code: { type: Type.STRING, description: 'The source code string to execute' },
              language: { type: Type.STRING, description: 'Language: javascript, typescript, python, html' },
              description: { type: Type.STRING, description: 'Short summary of the task' },
            },
            required: ['code', 'language'],
          },
        },
        {
          name: 'runCliCommand',
          description:
            'Executes shell/CLI terminal commands (e.g. ls, git status, node -v, python3 -c, curl, grep, npm test).',
          parameters: {
            type: Type.OBJECT,
            properties: {
              command: { type: Type.STRING, description: 'The CLI shell command line to run' },
              cwd: { type: Type.STRING, description: 'Optional relative directory path' },
            },
            required: ['command'],
          },
        },
        {
          name: 'openLocalTerminal',
          description:
            'Opens a terminal for the user. On desktop, opens the in-browser terminal; on mobile, opens Termius (SSH) to the server so the user can run commands from their phone.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              command: { type: Type.STRING, description: 'Optional command to pre-fill in the terminal' },
            },
          },
        },
        {
          name: 'deployAgentTask',
          description:
            'Spawns an autonomous sub-agent (e.g., Code Reviewer, Vision Inspector, Data Analyst, Web Research Agent) to execute complex multi-step reasoning tasks.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              agentName: { type: Type.STRING, description: 'Name or role of sub-agent' },
              task: { type: Type.STRING, description: 'Detailed instruction prompt' },
            },
            required: ['agentName', 'task'],
          },
        },
        {
          name: 'runCodingAgent',
          description:
            'Spawns the OpenCode CLI coding agent to autonomously write, edit, debug, refactor, or build code in the project workspace. Use this when the user asks to create a new feature, fix a bug, refactor code, build a project, or perform any multi-file coding task that requires reading/writing files, running tests, or installing dependencies. The coding agent has full filesystem access to the workspace and can execute shell commands.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              task: { type: Type.STRING, description: 'Detailed coding task description for the OpenCode agent. Be specific about what to build, fix, or refactor. Include file paths, requirements, and expected behavior.' },
              cwd: { type: Type.STRING, description: 'Optional working directory for the coding agent. Defaults to the project root.' },
            },
            required: ['task'],
          },
        },
        {
          name: 'getSystemInfo',
          description:
            'Gets system environment information, node version, memory stats, uptime, and active process metrics.',
          parameters: {
            type: Type.OBJECT,
            properties: {},
          },
        },
        {
          name: 'updateCanvasVisual',
          description:
            'Renders or updates interactive visual content on the Beatrice canvas screen (diagrams, markdown reports, interactive charts, code cards).',
          parameters: {
            type: Type.OBJECT,
            properties: {
              canvasType: { type: Type.STRING, description: 'One of: diagram, markdown, chart, code_snippet' },
              title: { type: Type.STRING, description: 'Card title' },
              content: { type: Type.STRING, description: 'Mermaid graph, markdown text, json data, or code' },
            },
            required: ['canvasType', 'title', 'content'],
          },
        },
        {
          name: 'getWeather',
          description: 'Gets current weather and forecast for any location.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              location: { type: Type.STRING, description: 'City name or region' },
            },
            required: ['location'],
          },
        },
        {
          name: 'webSearch',
          description: 'Performs live web search for documentation, news, facts, or technical references.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING, description: 'Search term' },
            },
            required: ['query'],
          },
        },
        {
          name: 'qwenChat',
          description:
            'Generate text with QwenCloud chat models (default qwen3.7-plus). ONLY use if the user explicitly asks to use QwenCloud for text generation.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              prompt: { type: Type.STRING, description: 'User prompt' },
              model: { type: Type.STRING, description: 'Model name, e.g. qwen3.7-plus' },
              system: { type: Type.STRING, description: 'Optional system message' },
              temperature: { type: Type.NUMBER, description: 'Sampling temperature' },
              max_tokens: { type: Type.NUMBER, description: 'Max tokens' },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'qwenImageGenerate',
          description:
            'Generate images with QwenCloud (qwen-image-2.0-pro-2026-06-22 on the international endpoint, falling back to qwen-image-2.0-pro then z-image-turbo then Wan 2.7). ONLY use if the user explicitly asks to generate or create an image. This signals authorization.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              prompt: { type: Type.STRING, description: 'Image description' },
              model: { type: Type.STRING, description: 'qwen-image-2.0-pro-2026-06-22 (default) or qwen-image-2.0-pro / qwen-image-2.0 / z-image-turbo / wan2.6-t2i / qwen-image-3.0-pro / wan2.7-image-pro / wan2.7-image' },
              size: { type: Type.STRING, description: '1K, 2K, 4K, or width*height' },
              n: { type: Type.NUMBER, description: 'Number of images' },
              watermark: { type: Type.BOOLEAN, description: 'Add AI Generated watermark' },
              thinking_mode: { type: Type.BOOLEAN, description: 'Enable thinking mode for quality' },
              enable_sequential: { type: Type.BOOLEAN, description: 'Generate image set' },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'qwenImageEdit',
          description:
            'Edit images with QwenCloud (qwen-image-2.0-pro-2026-06-22 on the international endpoint, falling back to qwen-image-2.0-pro then z-image-turbo then Wan 2.7) using text instructions and one or more source images. ONLY use if the user explicitly asks to edit an image.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              instruction: { type: Type.STRING, description: 'What to do with the images' },
              images: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Public image URLs, base64, or file paths' },
              model: { type: Type.STRING, description: 'qwen-image-2.0-pro-2026-06-22 (default) or qwen-image-2.0-pro / qwen-image-2.0 / z-image-turbo / wan2.6-t2i / qwen-image-3.0-pro / wan2.7-image-pro / wan2.7-image' },
              size: { type: Type.STRING, description: '1K, 2K, or width*height' },
              n: { type: Type.NUMBER, description: 'Number of outputs' },
              watermark: { type: Type.BOOLEAN, description: 'Add watermark' },
              bbox_list: {
                type: Type.ARRAY,
                description: 'Bounding boxes per image for interactive editing; each entry is a list of [x1,y1,x2,y2] boxes',
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.ARRAY,
                    items: { type: Type.NUMBER },
                  },
                },
              },
            },
            required: ['instruction', 'images'],
          },
        },
        {
          name: 'qwenVideoGenerate',
          description:
            'Generate premium AI videos with QwenCloud. Models: happyhorse-1.1-t2v (international endpoint, default), falling back to wan3.0-video. ONLY use if the user explicitly asks to generate or create a video.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              prompt: { type: Type.STRING, description: 'Video description with optional shot timestamps' },
              model: { type: Type.STRING, description: 'Optional: happyhorse-1.1-t2v (default) or wan3.0-video' },
              resolution: { type: Type.STRING, description: '480P, 720P or 1080P' },
              ratio: { type: Type.STRING, description: '16:9, 9:16, or 1:1' },
              duration: { type: Type.NUMBER, description: 'Duration in seconds (model-dependent, typically 2-15s)' },
              prompt_extend: { type: Type.BOOLEAN, description: 'Auto-extend prompt (Wan models)' },
              watermark: { type: Type.BOOLEAN, description: 'Add watermark (Wan models)' },
              audio_url: { type: Type.STRING, description: 'Optional audio URL for lip-sync / audio-driven generation' },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'qwenTts',
          description:
            'Synthesize speech with QwenCloud TTS (qwen-audio-3.0-tts-plus). ONLY use if the user explicitly asks for text-to-speech or narration.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING, description: 'Text to speak' },
              voice: { type: Type.STRING, description: 'Voice name, e.g. Cherry, Ethan' },
              model: { type: Type.STRING, description: 'qwen-audio-3.0-tts-plus' },
              language_type: { type: Type.STRING, description: 'Auto, Chinese, English, etc.' },
            },
            required: ['text'],
          },
        },
        {
          name: 'generateVideo',
          description:
            'Generate a short AI video clip from a text prompt using DashScope. Models: happyhorse-1.1-t2v (default) with wan3.0-video fallback. Use when the user asks to create a video, generate a clip, animate a scene, or produce cinematic footage.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              prompt: {
                type: Type.STRING,
                description:
                  'Detailed text prompt describing the video. Can include multi-shot story beats with timestamps.',
              },
              size: {
                type: Type.STRING,
                description: 'Video size in pixels, e.g. 1280*720',
              },
              duration: {
                type: Type.NUMBER,
                description: 'Duration in seconds, e.g. 5, 10, 15',
              },
              audio: {
                type: Type.BOOLEAN,
                description: 'Whether to generate audio with the video',
              },
              shot_type: {
                type: Type.STRING,
                description: 'Shot composition: single or multi',
              },
              prompt_extend: {
                type: Type.BOOLEAN,
                description: 'Whether DashScope should auto-extend the prompt for better quality',
              },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'runBrowserAutomation',
          description:
            'Control a headless web browser to navigate, read, click, type, or scroll on web pages. Use this when asked to browse a website, fill a form, click a button, read an article, or search the web visually.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              action: {
                type: Type.STRING,
                description: 'One of: startSession, goto, click, type, scroll, read, closeSession',
              },
              url: { type: Type.STRING, description: 'URL to navigate to (for goto)' },
              selector: { type: Type.STRING, description: 'CSS selector to target (for click/type)' },
              text: { type: Type.STRING, description: 'Text to type (for type)' },
            },
            required: ['action'],
          },
        },
        {
          name: 'runComputerControl',
          description:
            'Control the local computer desktop: run shell commands, list/open applications, move/click the mouse, type keys, or open apps. Use this when asked to open an app, run a system command, click something on the desktop, or interact with native GUI.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              action: {
                type: Type.STRING,
                description: 'One of: shell, listApps, openApp, mouseMove, mouseClick, key, type, closeSession',
              },
              command: { type: Type.STRING, description: 'Shell command to run (for shell)' },
              cwd: { type: Type.STRING, description: 'Working directory for shell command' },
              app: { type: Type.STRING, description: 'Application name to open (for openApp)' },
              x: { type: Type.NUMBER, description: 'X coordinate (for mouseMove)' },
              y: { type: Type.NUMBER, description: 'Y coordinate (for mouseMove)' },
              key: { type: Type.STRING, description: 'Key to press (for key), e.g. Return, Escape, ctrl+a' },
              text: { type: Type.STRING, description: 'Text to type (for type)' },
            },
            required: ['action'],
          },
        },
        {
          name: 'createGoogleMeet',
          description: 'Creates a Google Meet video conference link / meeting space with summary and scheduled start time.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING, description: 'Meeting title or topic' },
              startTime: { type: Type.STRING, description: 'ISO date time or relative time' },
              description: { type: Type.STRING, description: 'Meeting agenda or details' },
            },
            required: ['summary'],
          },
        },
        {
          name: 'listGmailMessages',
          description: 'Lists or searches emails in Gmail inbox.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING, description: 'Search filter or query string' },
            },
          },
        },
        {
          name: 'sendGmailMessage',
          description: 'Sends an email via Gmail.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              to: { type: Type.STRING, description: 'Recipient email address' },
              subject: { type: Type.STRING, description: 'Email subject line' },
              body: { type: Type.STRING, description: 'Email content body' },
            },
            required: ['to', 'subject', 'body'],
          },
        },
        {
          name: 'listCalendarEvents',
          description: 'Lists upcoming Google Calendar events and schedules.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              timeMin: { type: Type.STRING, description: 'Start time filter ISO string' },
            },
          },
        },
        {
          name: 'createCalendarEvent',
          description: 'Schedules a new event on Google Calendar with optional Google Meet link.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING, description: 'Event title' },
              startTime: { type: Type.STRING, description: 'Event start time' },
              durationMinutes: { type: Type.NUMBER, description: 'Duration in minutes' },
              addGoogleMeet: { type: Type.BOOLEAN, description: 'Whether to attach a Google Meet link' },
            },
            required: ['summary', 'startTime'],
          },
        },
        {
          name: 'listDriveFiles',
          description: 'Lists or searches files in Google Drive (Google Docs, Google Sheets, Google Slides, etc.).',
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING, description: 'File name search query' },
            },
          },
        },
        {
          name: 'createGoogleDoc',
          description: 'Creates a new Google Doc document.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Document title' },
              content: { type: Type.STRING, description: 'Initial text content' },
            },
            required: ['title', 'content'],
          },
        },
        {
          name: 'createGoogleSheet',
          description: 'Creates a new Google Sheet spreadsheet.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Spreadsheet title' },
              headers: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Column header titles' },
            },
            required: ['title'],
          },
        },
        {
          name: 'createGoogleSlide',
          description: 'Creates a new Google Slide presentation.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Presentation title' },
              slideTitles: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Titles for initial slides' },
            },
            required: ['title'],
          },
        },
        {
          name: 'createGoogleForm',
          description: 'Creates a new Google Form.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Form title' },
              description: { type: Type.STRING, description: 'Form description' },
            },
            required: ['title'],
          },
        },
        {
          name: 'listGoogleForms',
          description: 'Lists Google Forms.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING, description: 'Optional search query' },
            },
          },
        },
        {
          name: 'listGoogleTasks',
          description: 'Lists Google Tasks.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              tasklist: { type: Type.STRING, description: 'Optional tasklist ID' },
            },
          },
        },
        {
          name: 'createGoogleTask',
          description: 'Creates a new Google Task.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Task title' },
              notes: { type: Type.STRING, description: 'Task notes' },
              due: { type: Type.STRING, description: 'Due date ISO string' },
            },
            required: ['title'],
          },
        },
        {
          name: 'listGoogleContacts',
          description: 'Lists or searches Google Contacts.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING, description: 'Search query for contacts' },
            },
          },
        },
        {
          name: 'getGmailMessage',
          description: 'Gets the full content of a single Gmail message by ID.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: 'Gmail message ID' },
            },
            required: ['id'],
          },
        },
        {
          name: 'trashGmailMessage',
          description: 'Moves a Gmail message to the trash.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: 'Gmail message ID' },
            },
            required: ['id'],
          },
        },
        {
          name: 'deleteGmailMessage',
          description: 'Permanently deletes a Gmail message.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: 'Gmail message ID' },
            },
            required: ['id'],
          },
        },
        {
          name: 'modifyGmailMessage',
          description: 'Modifies Gmail message labels (e.g. mark as read, add/remove labels).',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: 'Gmail message ID' },
              addLabels: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Labels to add, e.g. IMPORTANT, UNREAD' },
              removeLabels: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Labels to remove' },
            },
            required: ['id'],
          },
        },
        {
          name: 'createGmailDraft',
          description: 'Creates a Gmail draft without sending it.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              to: { type: Type.STRING, description: 'Recipient email address' },
              subject: { type: Type.STRING, description: 'Email subject line' },
              body: { type: Type.STRING, description: 'Email content body' },
            },
            required: ['to', 'subject', 'body'],
          },
        },
        {
          name: 'updateCalendarEvent',
          description: 'Updates an existing Google Calendar event.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: 'Calendar event ID' },
              summary: { type: Type.STRING, description: 'New event title' },
              startTime: { type: Type.STRING, description: 'New start time ISO string' },
              durationMinutes: { type: Type.NUMBER, description: 'Duration in minutes' },
              addGoogleMeet: { type: Type.BOOLEAN, description: 'Whether to attach a Google Meet link' },
            },
            required: ['id'],
          },
        },
        {
          name: 'deleteCalendarEvent',
          description: 'Deletes a Google Calendar event.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: 'Calendar event ID' },
            },
            required: ['id'],
          },
        },
        {
          name: 'updateGoogleTask',
          description: 'Updates an existing Google Task (title, notes, due date or status).',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: 'Task ID' },
              title: { type: Type.STRING, description: 'Task title' },
              notes: { type: Type.STRING, description: 'Task notes' },
              due: { type: Type.STRING, description: 'Due date ISO string' },
              status: { type: Type.STRING, description: 'Task status: needsAction or completed' },
            },
            required: ['id'],
          },
        },
        {
          name: 'deleteGoogleTask',
          description: 'Deletes a Google Task.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: 'Task ID' },
            },
            required: ['id'],
          },
        },
        {
          name: 'searchDriveFiles',
          description: 'Searches Google Drive files by name.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING, description: 'File name search query' },
              maxResults: { type: Type.NUMBER, description: 'Maximum number of results' },
            },
            required: ['query'],
          },
        },
        {
          name: 'getDriveFile',
          description: 'Gets the content and metadata of a Google Drive file by ID.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: 'Drive file ID' },
            },
            required: ['id'],
          },
        },
        {
          name: 'createDriveFile',
          description: 'Creates a new file in Google Drive.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: 'File name' },
              mimeType: { type: Type.STRING, description: 'MIME type, e.g. text/plain' },
              content: { type: Type.STRING, description: 'Initial file content' },
            },
            required: ['name'],
          },
        },
        {
          name: 'updateDriveFileContent',
          description: 'Replaces the content of an existing Google Drive file.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: 'Drive file ID' },
              content: { type: Type.STRING, description: 'New file content' },
            },
            required: ['id', 'content'],
          },
        },
        {
          name: 'deleteDriveFile',
          description: 'Moves a Google Drive file to the trash.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: 'Drive file ID' },
            },
            required: ['id'],
          },
        },
        {
          name: 'createGoogleContact',
          description: 'Creates a new Google Contact.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: 'Contact full name' },
              email: { type: Type.STRING, description: 'Contact email address' },
              phone: { type: Type.STRING, description: 'Contact phone number' },
              organization: { type: Type.STRING, description: 'Company or organization' },
            },
            required: ['name', 'email'],
          },
        },
        {
          name: 'updateGoogleContact',
          description: 'Updates an existing Google Contact.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: 'Contact ID' },
              name: { type: Type.STRING, description: 'Contact full name' },
              email: { type: Type.STRING, description: 'Contact email address' },
              phone: { type: Type.STRING, description: 'Contact phone number' },
              organization: { type: Type.STRING, description: 'Company or organization' },
            },
            required: ['id'],
          },
        },
        {
          name: 'deleteGoogleContact',
          description: 'Deletes a Google Contact.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: 'Contact ID' },
            },
            required: ['id'],
          },
        },
        {
          name: 'searchYoutube',
          description: 'Searches YouTube videos by query.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING, description: 'Search query' },
              maxResults: { type: Type.NUMBER, description: 'Maximum number of results' },
            },
            required: ['query'],
          },
        },
        {
          name: 'connectGoogleAccount',
          description: 'Connects or checks the Google account connection for workspace tools (Gmail, Calendar, Drive, Tasks, Contacts, Meet, Forms).',
          parameters: {
            type: Type.OBJECT,
            properties: {
              scopes: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Optional list of services to connect' },
            },
          },
        },
        {
          name: 'resolve_whatsapp_contact',
          description: 'Resolves a WhatsApp recipient (name, phone number, or JID) into a concrete WhatsApp JID. ALWAYS call this before sending to a contact you did not already resolve, so you never invent a JID.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING, description: 'Contact name, phone number with country code, or JID' },
            },
            required: ['query'],
          },
        },
        {
          name: 'request_whatsapp_send',
          description: 'Requests send permission for a WhatsApp recipient before sending. Reports whether the send is auto-approved or requires human approval. Call this first when about to send a message.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              recipient: { type: Type.STRING, description: 'Contact name, phone number, or JID' },
              action: { type: Type.STRING, description: 'What will be sent, e.g. send_text, send_document' },
              message: { type: Type.STRING, description: 'Brief content preview' },
              channel: { type: Type.STRING, description: 'e.g. dm, group' },
            },
            required: ['recipient'],
          },
        },
        {
          name: 'send_whatsapp_text',
          description: 'Sends a plain text WhatsApp message to a resolved recipient.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              recipient: { type: Type.STRING, description: 'Contact name, phone number, or JID' },
              text: { type: Type.STRING, description: 'Message text' },
            },
            required: ['recipient', 'text'],
          },
        },
        {
          name: 'send_whatsapp_contact_card',
          description: 'Sends a vCard contact card to a WhatsApp recipient.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              recipient: { type: Type.STRING, description: 'Contact name, phone number, or JID' },
              name: { type: Type.STRING, description: 'Name shown on the card' },
              phone: { type: Type.STRING, description: 'Phone number with country code for the card' },
            },
            required: ['recipient', 'name', 'phone'],
          },
        },
        {
          name: 'send_whatsapp_message',
          description: 'Sends a WhatsApp message, optionally quoting an existing message via quoteMessageId.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              recipient: { type: Type.STRING, description: 'Contact name, phone number, or JID' },
              message: { type: Type.STRING, description: 'Message text' },
              quoteMessageId: { type: Type.STRING, description: 'Optional id of a message to quote' },
            },
            required: ['recipient', 'message'],
          },
        },
        {
          name: 'send_whatsapp_group_message',
          description: 'Sends a text message to a WhatsApp group (by group name or group JID).',
          parameters: {
            type: Type.OBJECT,
            properties: {
              group: { type: Type.STRING, description: 'Group name or group JID' },
              text: { type: Type.STRING, description: 'Message text' },
            },
            required: ['group', 'text'],
          },
        },
        {
          name: 'read_whatsapp_chats',
          description: 'Lists recent WhatsApp chats with unread counts, names, and last activity.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              limit: { type: Type.NUMBER, description: 'Max chats (default 20)' },
            },
          },
        },
        {
          name: 'get_whatsapp_contacts',
          description: 'Lists known WhatsApp contacts, optionally filtered by query.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING, description: 'Optional filter by name or number' },
            },
          },
        },
        {
          name: 'get_whatsapp_groups',
          description: 'Lists joined WhatsApp groups.',
          parameters: { type: Type.OBJECT, properties: {} },
        },
        {
          name: 'get_whatsapp_message_history',
          description: 'Reads recent message history of a WhatsApp chat.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              chatId: { type: Type.STRING, description: 'Chat JID from read_whatsapp_chats' },
              limit: { type: Type.NUMBER, description: 'Max messages (default 20)' },
            },
            required: ['chatId'],
          },
        },
        {
          name: 'get_whatsapp_calls',
          description: 'Lists recent WhatsApp call records.',
          parameters: { type: Type.OBJECT, properties: {} },
        },
        {
          name: 'block_whatsapp_contact',
          description: 'Blocks a WhatsApp contact.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              recipient: { type: Type.STRING, description: 'Contact name, phone number, or JID' },
            },
            required: ['recipient'],
          },
        },
        {
          name: 'unblock_whatsapp_contact',
          description: 'Unblocks a WhatsApp contact.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              recipient: { type: Type.STRING, description: 'Contact name, phone number, or JID' },
            },
            required: ['recipient'],
          },
        },
        {
          name: 'read_whatsapp_attachment',
          description: 'Downloads a WhatsApp media attachment (image, video, audio, document) to the server and returns its path.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              messageId: { type: Type.STRING, description: 'Message id of the attachment' },
              chatId: { type: Type.STRING, description: 'Chat JID (helps locate the message)' },
            },
            required: ['messageId'],
          },
        },
        {
          name: 'transcribe_whatsapp_audio',
          description: 'Transcribes a WhatsApp voice note/audio message using Gemini and returns the transcript.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              messageId: { type: Type.STRING, description: 'Message id of the voice note' },
              chatId: { type: Type.STRING, description: 'Chat JID (helps locate the message)' },
            },
            required: ['messageId'],
          },
        },
        {
          name: 'send_whatsapp_document',
          description: 'Sends a document file over WhatsApp (server file path or base64 data).',
          parameters: {
            type: Type.OBJECT,
            properties: {
              recipient: { type: Type.STRING, description: 'Contact name, phone number, or JID' },
              filePath: { type: Type.STRING, description: 'Path to an existing file on the server' },
              base64: { type: Type.STRING, description: 'Base64-encoded file content' },
              fileName: { type: Type.STRING, description: 'File name' },
              mimeType: { type: Type.STRING, description: 'MIME type of the file' },
              caption: { type: Type.STRING, description: 'Optional caption' },
            },
            required: ['recipient'],
          },
        },
        {
          name: 'sync_whatsapp_history',
          description: 'Reports the current WhatsApp in-memory store (chats/contacts/messages) and confirms automatic history sync.',
          parameters: { type: Type.OBJECT, properties: {} },
        },
{
          name: 'whatsapp_call',
          description: 'Initiates a WhatsApp voice call. NOTE: not supported by the WhatsApp Web protocol used by this session — informs the user to call from the phone instead.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              recipient: { type: Type.STRING, description: 'Contact name, phone number, or JID' },
            },
            required: ['recipient'],
          },
        },
        {
          name: 'remember_memory',
          description: 'Saves a conversation turn or fact to Beatrice\'s long-term memory (MemoryCore L0). The memory is stored under the current session and can later be recalled via search or query. Use when the Boss says something important that should not be forgotten.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              session_id: { type: Type.STRING, description: 'Optional session ID; auto-generated if omitted.' },
              messages: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    role: { type: Type.STRING, enum: ['user', 'assistant'], description: 'Message sender role' },
                    content: { type: Type.STRING, description: 'Message text content' },
                    timestamp: { type: Type.STRING, description: 'ISO-8601 timestamp optional' },
                  },
                  required: ['role', 'content'],
                },
                description: 'Array of message objects to persist.',
              },
            },
            required: ['messages'],
          },
        },
        {
          name: 'recall_memory',
          description: 'Searches Beatrice\'s long-term memory for conversations matching a keyword query. Uses BM25 keyword search across stored L0 conversations. Returns matching messages with relevance scores.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              query: { type: Type.STRING, description: 'Keyword or phrase to search for in conversation content.' },
              limit: { type: Type.NUMBER, description: 'Maximum number of results to return (default 5).' },
              session_id: { type: Type.STRING, description: 'Optional filter to limit search to a specific session.' },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_core_memory',
          description: 'Reads Beatrice\'s current L3 persona/core memory. Returns the concise profile summary that captures the Boss\'s traits, style, and context. This is injected into the system prompt on WS connect.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              version: { type: Type.STRING, description: 'Optional; returns historical version if specified, otherwise current latest.' },
            },
          },
        },
      ],
    },
  ];
}

/**
 * Boot-time drift check between the Gemini declarations, the tool catalog and
 * the tool registry. Returns a list of problems; empty means everything is in
 * sync. Called at server boot and covered by test/tool-declarations.test.ts.
 */
export function validateToolCoverage(): string[] {
  const declared = new Set(getFunctionDeclarations()[0].functionDeclarations.map((d) => d.name));
  const catalog = new Set(getAllToolNames());
  const registered = new Set(toolNames());
  const problems: string[] = [];
  for (const name of catalog) {
    if (!declared.has(name)) problems.push(`tool '${name}' has a catalog entry but no Gemini declaration`);
    if (!registered.has(name)) problems.push(`tool '${name}' has a catalog entry but is not registered`);
  }
  for (const name of declared) {
    if (!catalog.has(name)) problems.push(`Gemini declaration '${name}' has no catalog entry`);
  }
  for (const name of registered) {
    if (!catalog.has(name)) problems.push(`registered tool '${name}' has no catalog entry`);
  }
  return problems;
}
