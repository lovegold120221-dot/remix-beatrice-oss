import type { ToolContext } from './tools.js';
export type { ToolContext } from './tools.js';
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
} from './tools.js';
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
} from './googleWorkspace.js';
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
} from './whatsapp-tools.js';
import { logger } from './logger.js';
import { incCounter, observeHistogram } from './metrics.js';

export type ToolHandler = (args: any, ctx: ToolContext) => Promise<unknown> | unknown;

// Central registry mapping tool name -> handler. Replaces the 67-way if/else
// dispatch in server.ts. New tools are added by calling registerTool() once;
// the dispatch path, metrics, and error handling are shared automatically.
const registry = new Map<string, ToolHandler>();

export function registerTool(name: string, handler: ToolHandler): void {
  if (registry.has(name)) {
    logger.warn({ name }, 'tool name registered more than once');
  }
  registry.set(name, handler);
}

export function getTool(name: string): ToolHandler | undefined {
  return registry.get(name);
}

export function toolNames(): string[] {
  return [...registry.keys()];
}

// Dispatch a tool call by name. Wraps every invocation with timing metrics and
// a uniform error shape so callers (voice path and manual path) stay consistent.
export async function dispatchTool(
  name: string,
  args: any,
  ctx: ToolContext
): Promise<unknown> {
  const handler = registry.get(name);
  if (!handler) {
    incCounter('beatrice_tool_errors_total');
    return { error: `Unknown tool name: ${name}` };
  }
  const start = Date.now();
  incCounter('beatrice_tool_calls_total');
  try {
    const result = await handler(args, ctx);
    observeHistogram('beatrice_tool_duration_seconds', (Date.now() - start) / 1000);
    return result;
  } catch (err: any) {
    incCounter('beatrice_tool_errors_total');
    observeHistogram('beatrice_tool_duration_seconds', (Date.now() - start) / 1000);
    logger.error({ name, err: err?.message || String(err) }, 'tool execution failed');
    return { error: err?.message || 'Tool execution failed' };
  }
}

// ---- MemoryCore gateway handlers (moved out of server.ts) ----

async function fetchMemoryAdd(body: any, _ctx: ToolContext): Promise<any> {
  const apiKey = process.env.TDAI_LLM_API_KEY || 'beatrice-llm-proxy';
  const serviceId = process.env.TDAI_LLM_SERVICE_ID || 'beatrice-memory';
  const payload = { session_id: body?.session_id, messages: body?.messages };
  const res = await fetch('http://127.0.0.1:8420/v2/conversation/add', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'x-tdai-service-id': serviceId,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
  return { ok: true, data };
}

async function fetchMemorySearch(body: any, _ctx: ToolContext): Promise<any> {
  const apiKey = process.env.TDAI_LLM_API_KEY || 'beatrice-llm-proxy';
  const serviceId = process.env.TDAI_LLM_SERVICE_ID || 'beatrice-memory';
  const payload = { query: body?.query, limit: body?.limit ?? 5, session_id: body?.session_id };
  const res = await fetch('http://127.0.0.1:8420/v2/conversation/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'x-tdai-service-id': serviceId,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
  return { ok: true, data };
}

async function fetchCoreRead(body: any, _ctx: ToolContext): Promise<any> {
  const apiKey = process.env.TDAI_LLM_API_KEY || 'beatrice-llm-proxy';
  const serviceId = process.env.TDAI_LLM_SERVICE_ID || 'beatrice-memory';
  const payload = { version: body?.version };
  const res = await fetch('http://127.0.0.1:8420/v2/core/read', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'x-tdai-service-id': serviceId,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
  return { ok: true, data };
}

// ---- Registration (single source of truth for dispatch) ----

export function registerAllTools(): void {
  // Code & computing
  registerTool('executeCodeSandbox', handleExecuteCodeSandbox);
  registerTool('runCliCommand', handleRunCliCommand);
  registerTool('openLocalTerminal', handleOpenLocalTerminal);
  registerTool('deployAgentTask', handleDeployAgentTask);
  registerTool('runCodingAgent', handleRunCodingAgent);
  registerTool('getSystemInfo', (_args, ctx) => handleGetSystemInfo(ctx));
  registerTool('updateCanvasVisual', handleUpdateCanvasVisual);
  registerTool('getWeather', (args) => handleGetWeather(args as { location: string }));
  registerTool('webSearch', handleWebSearch);
  registerTool('runBrowserAutomation', handleRunBrowserAutomation);
  registerTool('runComputerControl', handleRunComputerControl);

  // Creative media (QwenCloud / DashScope)
  registerTool('qwenChat', handleQwenChat);
  registerTool('qwenImageGenerate', handleQwenImageGenerate);
  registerTool('qwenImageEdit', handleQwenImageEdit);
  registerTool('qwenVideoGenerate', handleQwenVideoGenerate);
  registerTool('qwenTts', handleQwenTts);
  registerTool('generateVideo', handleGenerateVideo);

  // Google Workspace
  registerTool('createGoogleMeet', handleCreateGoogleMeet);
  registerTool('listGmailMessages', handleListGmailMessages);
  registerTool('sendGmailMessage', handleSendGmailMessage);
  registerTool('listCalendarEvents', handleListCalendarEvents);
  registerTool('createCalendarEvent', handleCreateCalendarEvent);
  registerTool('listDriveFiles', handleListDriveFiles);
  registerTool('createGoogleDoc', handleCreateGoogleDoc);
  registerTool('createGoogleSheet', handleCreateGoogleSheet);
  registerTool('createGoogleSlide', handleCreateGoogleSlide);
  registerTool('createGoogleForm', handleCreateGoogleForm);
  registerTool('listGoogleForms', handleListGoogleForms);
  registerTool('listGoogleTasks', handleListGoogleTasks);
  registerTool('createGoogleTask', handleCreateGoogleTask);
  registerTool('listGoogleContacts', handleListGoogleContacts);
  registerTool('getGmailMessage', handleGetGmailMessage);
  registerTool('trashGmailMessage', handleTrashGmailMessage);
  registerTool('deleteGmailMessage', handleDeleteGmailMessage);
  registerTool('modifyGmailMessage', handleModifyGmailMessage);
  registerTool('createGmailDraft', handleCreateGmailDraft);
  registerTool('updateCalendarEvent', handleUpdateCalendarEvent);
  registerTool('deleteCalendarEvent', handleDeleteCalendarEvent);
  registerTool('updateGoogleTask', handleUpdateGoogleTask);
  registerTool('deleteGoogleTask', handleDeleteGoogleTask);
  registerTool('searchDriveFiles', handleSearchDriveFiles);
  registerTool('getDriveFile', handleGetDriveFile);
  registerTool('createDriveFile', handleCreateDriveFile);
  registerTool('updateDriveFileContent', handleUpdateDriveFileContent);
  registerTool('deleteDriveFile', handleDeleteDriveFile);
  registerTool('createGoogleContact', handleCreateGoogleContact);
  registerTool('updateGoogleContact', handleUpdateGoogleContact);
  registerTool('deleteGoogleContact', handleDeleteGoogleContact);
  registerTool('searchYoutube', handleSearchYoutube);
  registerTool('connectGoogleAccount', handleConnectGoogleAccount);

  // WhatsApp
  registerTool('resolve_whatsapp_contact', handleResolveWhatsAppContact);
  registerTool('request_whatsapp_send', handleRequestWhatsAppSend);
  registerTool('send_whatsapp_text', handleSendWhatsAppText);
  registerTool('send_whatsapp_contact_card', handleSendWhatsAppContactCard);
  registerTool('send_whatsapp_message', handleSendWhatsAppMessage);
  registerTool('send_whatsapp_group_message', handleSendWhatsAppGroupMessage);
  registerTool('read_whatsapp_chats', handleReadWhatsAppChats);
  registerTool('get_whatsapp_contacts', handleGetWhatsAppContacts);
  registerTool('get_whatsapp_groups', handleGetWhatsAppGroups);
  registerTool('get_whatsapp_message_history', handleGetWhatsAppMessageHistory);
  registerTool('get_whatsapp_calls', handleGetWhatsAppCalls);
  registerTool('block_whatsapp_contact', handleBlockWhatsAppContact);
  registerTool('unblock_whatsapp_contact', handleUnblockWhatsAppContact);
  registerTool('read_whatsapp_attachment', handleReadWhatsAppAttachment);
  registerTool('transcribe_whatsapp_audio', handleTranscribeWhatsAppAudio);
  registerTool('send_whatsapp_document', handleSendWhatsAppDocument);
  registerTool('sync_whatsapp_history', handleSyncWhatsAppHistory);
  registerTool('whatsapp_call', handleWhatsAppCall);

  // Memory
  registerTool('remember_memory', fetchMemoryAdd);
  registerTool('recall_memory', fetchMemorySearch);
  registerTool('get_core_memory', fetchCoreRead);
}
