import React, { useState, useEffect, useCallback } from 'react';
import { X, CheckCircle, Clock, Loader2 } from 'lucide-react';
import { CodeSandboxRun, CliCommandRun, AgentTask, VideoGenerationTask, QwenCloudTask } from '../types';
import { useAuth } from '../context/AuthContext';

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
  autoCancelAfter?: number;
}

interface TasksPageProps {
  onClose: () => void;
}

export const TasksPage: React.FC<TasksPageProps> = ({ onClose }) => {
  const { user } = useAuth();

  // Task state from the app
  const [activeTasks, setActiveTasks] = useState<TaskStatusInfo[]>([]);
  const [isPageVisible, setIsPageVisible] = useState(true);

  // Auto-update tasks every 3 seconds
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        // Collect all active tasks from the app state
        const tasks: TaskStatusInfo[] = [];

        // Video generation tasks
        // @ts-ignore - videoTasks is available in App scope
        // We'll read from the global state through a different mechanism

        // For now, we'll use the local state that gets updated via WebSocket
        // In a full implementation, this would read from the WebSocket store
        // or Firebase, but for now we use the tasks already in component state

        setActiveTasks(tasks.filter((t) => t.status === 'running' || t.status === 'pending'));
      } catch (err) {
        console.error('Failed to fetch tasks:', err);
      }
    };

    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  // Handle task cancellation
  const handleCancelTask = useCallback((taskId: string) => {
    // In a full implementation, this would send a cancellation signal
    // to the server/WebSocket to cancel the running task
    console.log('Cancelling task:', taskId);
    onClose();
  }, [onClose]);

  // Format task kind to display name
  const getTaskKindName = (kind: string): string => {
    const map: Record<string, string> = {
      'code': 'Code Generation',
      'cli': 'CLI Command',
      'agent': 'Coding Agent',
      'video': 'Video Generation',
      'image': 'Image Generation',
      'tts': 'Text-to-Speech',
      'chat': 'Chat Response',
    };
    return map[kind] || 'Task';
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
      className="min-h-screen bg-[#050505] text-white overflow-hidden transition-opacity duration-300"
      style={{ opacity: isPageVisible ? 1 : 0 }}
    >
      {/* Sticky Header with Task Title and Close Icon */}
      <header
        className="sticky top-0 z-40 bg-[#050505]/90 backdrop-blur-xl border-b border-white/10 px-4 py-3 flex items-center justify-between max-w-[430px] mx-auto"
      >
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold tracking-tight text-white">
            {activeTasks.length === 1 ? (
              <span className="text-[1.1rem]">
                {activeTasks[0].title}
              </span>
            ) : (
              <span className="text-[1.1rem]">
                {activeTasks.length} Active Processes
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
        {activeTasks.length === 1 && activeTasks[0].status === 'running' && (
          <div className="flex items-center gap-2 text-xs">
            <Loader2 className="w-3 h-3 text-yellow-400 animate-spin" />
            <span className="text-[#8e8e93]">
              {Math.round(activeTasks[0].progress)}% complete
            </span>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 min-h-[200px] px-4 pb-6 overflow-y-auto">
        {hasActiveTasks ? (
          <div className="space-y-4">
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

                {/* Timestamp */}
                <p className="text-[10px] text-zinc-500 mt-2">
                  {new Date(task.timestamp).toLocaleTimeString([], {
                    minute: '2-digit',
                    second: '2-digit',
                  })} ago
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="min-h-[200px] flex flex-col items-center justify-center text-zinc-500">
            <Loader2 className="w-12 h-12 mx-auto text-[#8e8e93] mb-4 animate-spin" />
            <p>No active processes</p>
            <p className="text-xs mt-2">All tasks completed or cancelled</p>
          </div>
        )}
      </main>
    </div>
  );
};