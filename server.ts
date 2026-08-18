import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { logger } from './server/logger.js';
import {
  registerStandardMetrics,
  renderMetrics,
  incCounter,
  observeHistogram,
} from './server/metrics.js';
import { requireAuth, verifyIdToken, authEnabled } from './server/auth.js';
import { registerAllTools, dispatchTool } from './server/toolRegistry.js';
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

function getFunctionDeclarations() {
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
            'Generate text with QwenCloud chat models (qwen3.8-max, qwen3.7-plus, qwen3.7-flash). ONLY use if the user explicitly asks to use QwenCloud for text generation.',
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
            'Generate images with QwenCloud Wan 2.7 image models. ONLY use if the user explicitly asks to generate or create an image. This signals authorization.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              prompt: { type: Type.STRING, description: 'Image description' },
              model: { type: Type.STRING, description: 'wan2.7-image-pro or wan2.7-image' },
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
            'Edit images with QwenCloud Wan 2.7 image models using text instructions and one or more source images. ONLY use if the user explicitly asks to edit an image.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              instruction: { type: Type.STRING, description: 'What to do with the images' },
              images: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Public image URLs, base64, or file paths' },
              model: { type: Type.STRING, description: 'wan2.7-image-pro or wan2.7-image' },
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
            'Generate premium AI videos with QwenCloud. Primary: happyhorse-1.1-t2v (1080P, 3-15s, audio). Server fallback chain: happyhorse-1.1-t2v → wan3.0-video → wan2.7-t2v → wan2.6-t2v. ONLY use if the user explicitly asks to generate or create a video.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              prompt: { type: Type.STRING, description: 'Video description with optional shot timestamps' },
              model: { type: Type.STRING, description: 'Optional: happyhorse-1.1-t2v, wan3.0-video, wan2.7-t2v, wan2.6-t2v' },
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
            'Synthesize speech with QwenCloud TTS (qwen3-tts-flash). ONLY use if the user explicitly asks for text-to-speech or narration.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING, description: 'Text to speak' },
              voice: { type: Type.STRING, description: 'Voice name, e.g. Cherry, Ethan' },
              model: { type: Type.STRING, description: 'qwen3-tts-flash' },
              language_type: { type: Type.STRING, description: 'Auto, Chinese, English, etc.' },
            },
            required: ['text'],
          },
        },
        {
          name: 'generateVideo',
          description:
            'Generate a short AI video clip from a text prompt using DashScope. Model chain: happyhorse-1.1-t2v → wan3.0-video → wan2.7-t2v → wan2.6-t2v. Use when the user asks to create a video, generate a clip, animate a scene, or produce cinematic footage.',
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

async function startServer() {
  // Register tool dispatch + standard metrics once at boot.
  registerAllTools();
  registerStandardMetrics();

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

  app.get('/api/workspace/gmail/messages', async (req, res) => {
    try {
      const query = (req.query.q as string) || 'in:inbox';
      const result = await handleListGmailMessages({ query }, { broadcast: () => {} });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspace/contacts', async (req, res) => {
    try {
      const query = (req.query.q as string) || '';
      const result = await handleListGoogleContacts({ query }, { broadcast: () => {} });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspace/gmail/send', async (req, res) => {
    try {
      const { to, subject, body } = req.body;
      const result = await handleSendGmailMessage({ to, subject, body }, { broadcast: () => {} });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/workspace/forms/create', async (req, res) => {
    try {
      const { title, description, questions } = req.body;
      const result = await handleCreateGoogleForm(
        { title, description, questions },
        { broadcast: () => {} }
      );
      res.json({
        success: true,
        form: {
          id: result.formId,
          title: result.title,
          description: result.description,
          webViewLink: result.webViewLink,
          questions: result.questions,
          responsesCount: 0,
          createdAt: result.timestamp,
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/workspace/forms/list', async (req, res) => {
    try {
      const query = (req.query.q as string) || '';
      const result = await handleListGoogleForms({ query }, { broadcast: () => {} });
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

    const broadcastToClient = (msg: unknown) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(msg));
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
            if (message.toolCall?.functionCalls) {
              for (const call of message.toolCall.functionCalls) {
                const callId = call.id;
                const name = call.name;
                const args = (call.args || {}) as Record<string, unknown>;

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
                  toolResult = await dispatchTool(name, args, toolCtx);
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
