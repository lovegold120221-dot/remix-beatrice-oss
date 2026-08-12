import React from 'react';
import {
  X,
  Brain,
  Layers,
  Sparkles,
  RefreshCw,
  Trash2,
  SlidersHorizontal,
  CheckCircle2,
  Database,
  ArrowRight,
  FileText,
} from 'lucide-react';
import { ContextWindowConfig, ConversationMemoryState, TranscriptItem } from '../types';

interface MemoryInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  transcripts: TranscriptItem[];
  memoryState: ConversationMemoryState;
  config: ContextWindowConfig;
  onUpdateConfig: (newConfig: Partial<ContextWindowConfig>) => void;
  onCompressContext: () => void;
  onClearMemory: () => void;
  isCompressing?: boolean;
}

export const MemoryInspectorModal: React.FC<MemoryInspectorModalProps> = ({
  isOpen,
  onClose,
  transcripts,
  memoryState,
  config,
  onUpdateConfig,
  onCompressContext,
  onClearMemory,
  isCompressing = false,
}) => {
  if (!isOpen) return null;

  const usageRatio = Math.min(
    1,
    memoryState.totalEstimatedTokens / (config.maxContextTokens || 128000)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-3xl bg-[#1c1c1e] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-black/40 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#00f2fe]/20 to-[#4facfe]/20 border border-[#00f2fe]/30 flex items-center justify-center">
              <Brain className="w-5 h-5 text-[#00f2fe]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">
                Conversation Memory & Context Window Manager
              </h2>
              <p className="text-[11px] text-zinc-400">
                Inspect active turns, token allocations, and session context retention
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 scrollbar-hide text-xs">
          {/* Top Token Capacity & Progress Bar */}
          <div className="p-4 rounded-2xl bg-black/50 border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-200 flex items-center gap-2">
                <Database className="w-4 h-4 text-[#00f2fe]" />
                Active Context Window Utilization
              </span>
              <span className="font-mono text-zinc-300">
                {memoryState.totalEstimatedTokens.toLocaleString()} /{' '}
                {(config.maxContextTokens || 128000).toLocaleString()} Tokens (
                {(usageRatio * 100).toFixed(1)}%)
              </span>
            </div>

            <div className="w-full h-2.5 rounded-full bg-white/10 overflow-hidden p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  usageRatio < 0.5
                    ? 'bg-emerald-500'
                    : usageRatio < 0.8
                      ? 'bg-amber-500'
                      : 'bg-red-500 animate-pulse'
                }`}
                style={{ width: `${Math.max(2, usageRatio * 100)}%` }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 text-center pt-1">
              <div className="p-2 rounded-xl bg-white/5 border border-white/10">
                <div className="text-[10px] text-zinc-400 uppercase tracking-wider">Active Turns</div>
                <div className="text-sm font-bold text-white font-mono mt-0.5">
                  {memoryState.activeTurnsCount}
                </div>
              </div>
              <div className="p-2 rounded-xl bg-white/5 border border-white/10">
                <div className="text-[10px] text-zinc-400 uppercase tracking-wider">Compressed Sessions</div>
                <div className="text-sm font-bold text-[#00f2fe] font-mono mt-0.5">
                  {memoryState.pruneCount}
                </div>
              </div>
              <div className="p-2 rounded-xl bg-white/5 border border-white/10">
                <div className="text-[10px] text-zinc-400 uppercase tracking-wider">Auto-Prune Limit</div>
                <div className="text-sm font-bold text-[#4facfe] font-mono mt-0.5">
                  {Math.round((config.autoPruneThreshold || 0.8) * 100)}%
                </div>
              </div>
            </div>
          </div>

          {/* Context Window Capacity Configuration */}
          <div className="p-4 rounded-2xl bg-black/40 border border-white/5 space-y-3">
            <h3 className="font-semibold text-zinc-200 flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[#4facfe]" />
              Context Window Settings
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              {/* Max Capacity selector */}
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1.5 font-medium">
                  Maximum Context Capacity
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[32000, 128000, 1000000].map((tokens) => (
                    <button
                      key={tokens}
                      type="button"
                      onClick={() => onUpdateConfig({ maxContextTokens: tokens })}
                      className={`py-1.5 px-2 rounded-xl border text-center font-mono font-medium transition-all active:scale-95 cursor-pointer ${
                        config.maxContextTokens === tokens
                          ? 'bg-[#00f2fe]/20 border-[#00f2fe] text-[#00f2fe]'
                          : 'bg-white/5 border-white/10 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {tokens >= 1000000 ? '1M' : `${tokens / 1000}K`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Memory Mode selector */}
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1.5 font-medium">
                  Memory Retention Strategy
                </label>
                <select
                  value={config.compressionMode}
                  onChange={(e) =>
                    onUpdateConfig({
                      compressionMode: e.target.value as ContextWindowConfig['compressionMode'],
                    })
                  }
                  className="w-full bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-zinc-200 focus:outline-none focus:border-[#00f2fe] font-medium"
                >
                  <option value="auto_summarize">Auto-Summarize (Recommended)</option>
                  <option value="sliding_window">Sliding Window (Keep Latest N Turns)</option>
                  <option value="manual">Manual Prune Only</option>
                </select>
              </div>
            </div>
          </div>

          {/* Consolidated Summary Buffer */}
          {memoryState.compressedSummary && (
            <div className="p-4 rounded-2xl bg-[#4facfe]/10 border border-[#4facfe]/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#4facfe] flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#4facfe]" />
                  Consolidated Session Memory Buffer
                </span>
                <span className="text-[10px] text-[#4facfe]/80 font-mono">
                  {memoryState.summaryLastUpdated
                    ? new Date(memoryState.summaryLastUpdated).toLocaleTimeString()
                    : 'Active'}
                </span>
              </div>
              <p className="text-zinc-300 leading-relaxed bg-black/40 p-3 rounded-xl border border-[#4facfe]/20 font-mono text-[11px]">
                {memoryState.compressedSummary}
              </p>
            </div>
          )}

          {/* Turn-by-Turn Memory Stack */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-zinc-200 flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#00f2fe]" />
                Active Conversation Memory Stack ({transcripts.filter((t) => t.role !== 'system').length} turns)
              </h3>
              <span className="text-[11px] text-zinc-500">Oldest to Newest</span>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {transcripts.filter((t) => t.role !== 'system').length === 0 ? (
                <div className="p-4 text-center text-zinc-500 bg-[#121215]/50 rounded-xl border border-white/10">
                  No active conversation turns in memory stack.
                </div>
              ) : (
                transcripts
                  .filter((t) => t.role !== 'system')
                  .map((turn) => {
                    const estTokens = Math.max(1, Math.round(turn.text.length / 3.8));
                    return (
                      <div
                        key={turn.id}
                        className="p-3 rounded-xl bg-[#121215]/70 border border-white/10 flex items-start justify-between gap-3"
                      >
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                turn.role === 'user'
                                  ? 'bg-[#4facfe]/15 text-[#4facfe] border border-[#4facfe]/30'
                                  : 'bg-[#4facfe]/20 text-[#4facfe] border border-[#4facfe]/30'
                              }`}
                            >
                              {turn.role}
                            </span>
                            <span className="text-[10px] text-zinc-500">
                              {new Date(turn.timestamp).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              })}
                            </span>
                          </div>
                          <p className="text-zinc-300 truncate text-[11px] font-sans">{turn.text}</p>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-400 bg-white/10 px-2 py-1 rounded border border-white/10 shrink-0">
                          ~{estTokens} tokens
                        </span>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-4 bg-black/60 border-t border-white/10 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClearMemory}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-medium transition-all active:scale-95 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Reset Memory Stack</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCompressContext}
              disabled={isCompressing || memoryState.activeTurnsCount < 2}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#00f2fe]/20 hover:bg-[#00f2fe]/30 text-[#00f2fe] border border-[#00f2fe]/40 font-semibold transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCompressing ? 'animate-spin' : ''}`} />
              <span>{isCompressing ? 'Compressing...' : 'Prune & Compress Context'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/10 text-zinc-200 font-semibold transition-all active:scale-95 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
