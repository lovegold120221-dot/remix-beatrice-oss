import React from 'react';
import { Cpu, Brain, Layers, RefreshCw, SlidersHorizontal, Sparkles } from 'lucide-react';
import { ContextWindowConfig, ConversationMemoryState } from '../types';

interface ContextWindowHUDProps {
  memoryState: ConversationMemoryState;
  config: ContextWindowConfig;
  onOpenInspector: () => void;
  onCompressContext: () => void;
  isCompressing?: boolean;
}

export const ContextWindowHUD: React.FC<ContextWindowHUDProps> = ({
  memoryState,
  config,
  onOpenInspector,
  onCompressContext,
  isCompressing = false,
}) => {
  const usageRatio = Math.min(
    1,
    memoryState.totalEstimatedTokens / (config.maxContextTokens || 128000)
  );
  const usagePercentage = (usageRatio * 100).toFixed(1);

  // Status color badge based on utilization
  const getStatusBadge = () => {
    if (usageRatio < 0.5) {
      return {
        label: 'Optimal Context',
        color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
        barColor: 'bg-emerald-500',
      };
    } else if (usageRatio < 0.8) {
      return {
        label: 'Moderate Load',
        color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
        barColor: 'bg-amber-500',
      };
    } else {
      return {
        label: 'Near Limit (Prune Advised)',
        color: 'text-red-400 bg-red-500/10 border-red-500/20',
        barColor: 'bg-red-500 animate-pulse',
      };
    }
  };

  const status = getStatusBadge();

  return (
    <div className="bg-[#1c1c1e]/80 border border-white/10 rounded-2xl p-3.5 backdrop-blur-xl shadow-lg flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs">
      {/* Left Info & Meter */}
      <div className="flex-1 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium text-zinc-200">
            <Brain className="w-4 h-4 text-[#00f2fe]" />
            <span>Session Context Window</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full border font-mono font-semibold ${status.color}`}
            >
              {status.label}
            </span>
          </div>

          <div className="text-[11px] font-mono text-zinc-400">
            <span className="text-zinc-200 font-semibold">
              {memoryState.totalEstimatedTokens.toLocaleString()}
            </span>
            <span className="text-zinc-500">
              {' '}
              / {(config.maxContextTokens || 128000).toLocaleString()} Tokens ({usagePercentage}%)
            </span>
          </div>
        </div>

        {/* Meter Progress Bar */}
        <div className="w-full h-2 rounded-full bg-black/50 border border-white/5 overflow-hidden p-0.5">
          <div
            className={`h-full rounded-full transition-all duration-500 ${status.barColor}`}
            style={{ width: `${Math.max(2, usageRatio * 100)}%` }}
          />
        </div>
      </div>

      {/* Right Actions & Metrics */}
      <div className="flex items-center justify-between md:justify-end gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-white/5">
        <div className="flex items-center gap-2 text-[11px] text-zinc-400 mr-1">
          <span className="flex items-center gap-1 bg-white/10 px-2 py-1 rounded-md border border-white/10">
            <Layers className="w-3 h-3 text-[#00f2fe]" />
            <span className="font-mono text-zinc-200">{memoryState.activeTurnsCount}</span> Turns
          </span>
          {memoryState.pruneCount > 0 && (
            <span className="flex items-center gap-1 bg-white/10 px-2 py-1 rounded-md border border-white/10">
              <Sparkles className="w-3 h-3 text-[#4facfe]" />
              <span className="font-mono text-zinc-200">{memoryState.pruneCount}</span> Compressed
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCompressContext}
            disabled={isCompressing || memoryState.activeTurnsCount < 2}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#00f2fe]/10 hover:bg-[#00f2fe]/20 text-[#00f2fe] border border-[#00f2fe]/30 font-medium transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
            title="Compress active conversation turns into session memory buffer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCompressing ? 'animate-spin' : ''}`} />
            <span>{isCompressing ? 'Compressing...' : 'Compress Context'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenInspector}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/10 border border-white/10 text-zinc-200 font-medium transition-all active:scale-95 cursor-pointer"
            title="Open Context & Memory Inspector"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
            <span>Memory Inspector</span>
          </button>
        </div>
      </div>
    </div>
  );
};
