import React, { useMemo, useState } from 'react';
import { X, Loader2, Monitor } from 'lucide-react';
import { AgentTask, BrowserStreamSession, CliCommandRun, CodeSandboxRun, CodingAgentSession, ComputerStreamSession, VideoGenerationTask, QwenCloudTask } from '../types';
import { ExecutionViewport } from './ExecutionViewport';

interface TaskStatusInfo {
  id: string;
  title: string;
  kind: 'code' | 'cli' | 'agent' | 'video' | 'image' | 'tts' | 'chat';
  status: 'running' | 'pending' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  prompt: string;
  result?: string;
  error?: string;
  timestamp: number;
}

interface TasksPageProps {
  onClose: () => void;
  agentTasks: AgentTask[];
  codingAgentSessions: CodingAgentSession[];
  videoTasks: VideoGenerationTask[];
  qwenTasks: QwenCloudTask[];
  sandboxRuns: CodeSandboxRun[];
  cliRuns: CliCommandRun[];
  browserSessions: BrowserStreamSession[];
  computerSessions: ComputerStreamSession[];
  onRunSandbox?: (code: string, language: string) => void;
  onRunSandboxStream?: (code: string, language: string) => void;
  onRunCli?: (command: string) => void;
  onRunCliStream?: (command: string, cwd?: string) => void;
  onCancelCodingAgent?: (sessionId: string) => void;
}

const AGENT_STATUS: Record<string, TaskStatusInfo['status']> = {
  thinking: 'running',
  executing: 'running',
  completed: 'completed',
  failed: 'failed',
  idle: 'pending',
};

const CODING_STATUS: Record<string, TaskStatusInfo['status']> = {
  starting: 'running',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

const RUNNING_VIDEO_STATUSES = new Set(['pending', 'running', 'submitted', 'processing', 'queued']);

export const TasksPage: React.FC<TasksPageProps> = ({
  onClose,
  agentTasks,
  codingAgentSessions,
  videoTasks,
  qwenTasks,
  sandboxRuns,
  cliRuns,
  browserSessions,
  computerSessions,
  onRunSandbox,
  onRunSandboxStream,
  onRunCli,
  onRunCliStream,
  onCancelCodingAgent,
}) => {
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [pageTab, setPageTab] = useState<'processes' | 'viewport'>('processes');

  const activeTasks = useMemo<TaskStatusInfo[]>(() => {
    const tasks: TaskStatusInfo[] = [];

    for (const agent of agentTasks) {
      if (agent.status === 'idle') continue;
      tasks.push({
        id: agent.id,
        title: `Sub-Agent · ${agent.agentName}`,
        kind: 'agent',
        status: AGENT_STATUS[agent.status] || 'pending',
        progress: agent.progress,
        prompt: agent.task,
        result: agent.result,
        timestamp: agent.timestamp,
      });
    }

    for (const s of codingAgentSessions) {
      tasks.push({
        id: s.id,
        title: 'Coding Agent',
        kind: 'agent',
        status: CODING_STATUS[s.status] || 'pending',
        progress: s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled' ? 100 : 30,
        prompt: s.task,
        result: s.output || s.log.slice(-20).join('\n'),
        error: s.error,
        timestamp: s.timestamp,
      });
    }

    for (const t of videoTasks) {
      tasks.push({
        id: t.id,
        title: 'Video Generation',
        kind: 'video',
        status: t.status === 'completed' ? 'completed' : t.status === 'failed' ? 'failed' : 'running',
        progress: t.progress,
        prompt: t.prompt,
        result: t.videoUrl,
        error: t.error,
        timestamp: t.timestamp,
      });
    }

    for (const t of qwenTasks) {
      const kindMap: Record<string, TaskStatusInfo['kind']> = {
        image: 'image',
        imageEdit: 'image',
        video: 'video',
        tts: 'tts',
        chat: 'chat',
      };
      const titleMap: Record<string, string> = {
        image: 'Image Generation',
        imageEdit: 'Image Edit',
        video: 'Video Generation',
        tts: 'Text-to-Speech',
        chat: 'Qwen Chat',
      };
      let status: TaskStatusInfo['status'];
      if (t.status === 'completed') status = 'completed';
      else if (t.status === 'failed' || t.status === 'error') status = 'failed';
      else status = RUNNING_VIDEO_STATUSES.has(t.status) || t.status === 'running' ? 'running' : 'pending';
      tasks.push({
        id: t.id,
        title: titleMap[t.kind] || 'Qwen Cloud Task',
        kind: kindMap[t.kind] || 'chat',
        status,
        progress: t.progress,
        prompt: t.prompt,
        result: t.result || (t.urls && t.urls[0]) || t.audioUrl,
        error: t.error,
        timestamp: t.timestamp,
      });
    }

    return tasks.sort((a, b) => b.timestamp - a.timestamp);
  }, [agentTasks, codingAgentSessions, videoTasks, qwenTasks]);

  const handleCancelTask = (taskId: string) => {
    const session = codingAgentSessions.find((s) => s.id === taskId);
    if (session) onCancelCodingAgent?.(session.id);
  };

  // Format progress color
  const getProgressColor = (progress: number) => {
    if (progress >= 80) return 'bg-green-500';
    if (progress >= 50) return 'bg-yellow-500';
    if (progress >= 20) return 'bg-orange-500';
    return 'bg-red-500';
  };

  // Check if there are any active tasks
  const hasActiveTasks = activeTasks.length > 0;

  return (
    <div
      className="fixed inset-0 z-40 min-h-screen bg-[#050505] text-white overflow-hidden transition-opacity duration-300 flex flex-col"
      style={{ opacity: isPageVisible ? 1 : 0 }}
    >
      {/* Sticky Header with Task Title and Close Icon */}
      <header className="shrink-0 bg-[#050505]/90 backdrop-blur-xl border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight text-white">
            {pageTab === 'viewport' ? (
              <span className="text-[1.1rem]">Live Task Execution</span>
            ) : activeTasks.length === 1 ? (
              <span className="text-[1.1rem]">{activeTasks[0].title}</span>
            ) : (
              <span className="text-[1.1rem]">
                {activeTasks.length} Active {activeTasks.length === 1 ? 'Process' : 'Processes'}
              </span>
            )}
          </h1>
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors cursor-pointer"
            aria-label="Close task page"
            title="Close and return to main"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Progress indicator for single task */}
        {pageTab === 'processes' && activeTasks.length === 1 && activeTasks[0].status === 'running' && (
          <div className="flex items-center gap-2 text-xs">
            <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />
            <span className="text-[#8e8e93]">
              {Math.round(activeTasks[0].progress)}% complete
            </span>
          </div>
        )}
      </header>

      {/* Page Tabs: Processes | Live Viewport */}
      <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-white/10 bg-black/40">
        <button
          onClick={() => setPageTab('processes')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all cursor-pointer ${
            pageTab === 'processes'
              ? 'bg-[#00f2fe]/15 border-[#00f2fe]/40 text-[#00f2fe]'
              : 'bg-white/5 border-white/10 text-[#8e8e93] hover:text-white'
          }`}
        >
          <Loader2 className="w-3.5 h-3.5" />
          Processes
          {hasActiveTasks && (
            <span className="px-1.5 py-0.5 rounded-full bg-[#00f2fe]/25 text-[9px] font-bold text-[#00f2fe]">
              {activeTasks.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setPageTab('viewport')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all cursor-pointer ${
            pageTab === 'viewport'
              ? 'bg-[#00f2fe]/15 border-[#00f2fe]/40 text-[#00f2fe]'
              : 'bg-white/5 border-white/10 text-[#8e8e93] hover:text-white'
          }`}
        >
          <Monitor className="w-3.5 h-3.5" />
          Live Viewport
          {(browserSessions.length > 0 || computerSessions.length > 0 || sandboxRuns.length > 0 || cliRuns.length > 0) && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#00f2fe] animate-pulse" />
          )}
        </button>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {pageTab === 'viewport' ? (
          <ExecutionViewport
            sandboxRuns={sandboxRuns}
            cliRuns={cliRuns}
            browserSessions={browserSessions}
            computerSessions={computerSessions}
            onRunSandbox={onRunSandbox}
            onRunSandboxStream={onRunSandboxStream}
            onRunCli={onRunCli}
            onRunCliStream={onRunCliStream}
            onClose={onClose}
          />
        ) : hasActiveTasks ? (
          <div className="h-full overflow-y-auto px-4 pb-6 space-y-4">
            {activeTasks.map((task) => (
              <div
                key={task.id}
                className={`p-4 rounded-xl bg-black border border-white/10 transition-all duration-300 ${
                  task.status === 'running' ? 'border-[#00f2fe]/30' : 'border-[#8e8e93]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {task.title}
                    </p>
                    <p className="text-[10px] text-[#8e8e93] line-clamp-1">
                      {task.prompt.substring(0, 80)}{task.prompt.length > 80 ? '…' : ''}
                    </p>
                  </div>

                  <div className="flex-shrink-0">
                    {/* Status badge */}
                    <div
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        task.status === 'running'
                          ? 'bg-[#00f2fe]/20 border border-[#00f2fe]/40 text-[#00f2fe]'
                          : task.status === 'completed'
                            ? 'bg-green-500/20 border border-green-500/40 text-green-400'
                            : task.status === 'failed'
                              ? 'bg-rose-500/20 border border-rose-500/40 text-rose-400'
                              : 'bg-[#121215] border border-white/10 text-white'
                      }`}
                    >
                      {task.status}
                    </div>

                    {/* Progress bar */}
                    {task.status === 'running' && (
                      <div className="mt-2 h-1.5 rounded-full bg-[#121215] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${getProgressColor(
                            task.progress
                          )}`}
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                    )}

                    {/* Result preview (for completed tasks) */}
                    {task.status === 'completed' && task.result && (
                      <div className="mt-3 text-[10px] text-[#8e8e93] line-clamp-2 max-h-24">
                        {typeof task.result === 'string'
                          ? task.result.substring(0, 120) + (task.result.length > 120 ? '…' : '')
                          : 'Result generated'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Error state */}
                {task.status === 'failed' && (
                  <p className="mt-2 text-[10px] text-rose-400 line-clamp-1">
                    {task.error || 'Task failed'}
                  </p>
                )}

                {/* Cancel button for running coding agent sessions */}
                {task.status === 'running' && task.kind === 'agent' && codingAgentSessions.some((s) => s.id === task.id) && (
                  <button
                    onClick={() => handleCancelTask(task.id)}
                    className="mt-2 px-3 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[10px] font-semibold hover:bg-rose-500/20 transition-colors cursor-pointer"
                  >
                    Cancel Task
                  </button>
                )}

                {/* Timestamp */}
                <p className="text-[10px] text-zinc-500 mt-2">
                  {new Date(task.timestamp).toLocaleTimeString([], {
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-full min-h-[200px] flex flex-col items-center justify-center text-zinc-500 px-4">
            <Loader2 className="w-12 h-12 mx-auto text-[#8e8e93] mb-4 animate-spin" />
            <p>No active processes</p>
            <p className="text-xs mt-2">All tasks completed or cancelled</p>
          </div>
        )}
      </main>
    </div>
  );
};