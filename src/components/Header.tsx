import React from 'react';
import {
  Activity,
  Cpu,
  Mic,
  MicOff,
  Radio,
  Settings,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { BeatriceConfig, SessionStatus, VOICE_NAMES, voiceAlias } from '../types';

interface HeaderProps {
  status: SessionStatus;
  config: BeatriceConfig;
  onUpdateConfig: (newConfig: Partial<BeatriceConfig>) => void;
  onOpenSettings: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  latencyMs?: number;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  config,
  onUpdateConfig,
  onOpenSettings,
  isMuted,
  onToggleMute,
  latencyMs = 45,
}) => {
  const getStatusBadge = () => {
    switch (status) {
      case 'connected':
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-[#00f2fe]/30 text-emerald-400 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Live Connected
          </div>
        );
      case 'speaking':
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#00f2fe]/15 border border-[#00f2fe]/40 text-[#00f2fe] text-xs font-semibold animate-pulse">
            <Volume2 className="w-3.5 h-3.5 animate-bounce" />
            Beatrice Speaking...
          </div>
        );
      case 'listening':
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#4facfe]/10 border border-[#4facfe]/30 text-[#4facfe] text-xs font-medium">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            Listening...
          </div>
        );
      case 'connecting':
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            Initializing Live API...
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            Connection Offline
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[#8e8e93] text-xs font-medium">
            Disconnected
          </div>
        );
    }
  };

  const voices = VOICE_NAMES;

  return (
    <header className="h-16 border-b border-white/10 bg-black/80 backdrop-blur-xl px-4 sm:px-6 flex items-center justify-between z-20 sticky top-0">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#00f2fe] via-[#4facfe] to-[#8e44ad] p-0.5 shadow-lg shadow-[#00f2fe]/20">
          <div className="w-full h-full bg-black rounded-full flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-[#00f2fe]" />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-1.5">
              Beatrice{' '}
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/30">
                OSS
              </span>
            </h1>
            {getStatusBadge()}
          </div>
          <p className="text-xs text-[#8e8e93] hidden sm:block">
            Eburon Live API • Voice, Live Video & Function Execution
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <div className="hidden md:flex items-center gap-2 text-xs text-[#8e8e93] bg-[#121215] px-3 py-1.5 rounded-full border border-white/10">
          <Activity className="w-3.5 h-3.5 text-[#00f2fe]" />
          <span>
            Latency: <strong className="text-white">{latencyMs}ms</strong>
          </span>
          <span className="text-white/20">|</span>
          <Cpu className="w-3.5 h-3.5 text-[#8e44ad]" />
          <span>
            Model: <strong className="text-white">eburon-3.1-flash-live</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5 bg-[#121215] border border-white/10 rounded-full px-3 py-1.5">
          <span className="text-xs text-[#8e8e93] hidden sm:inline">Voice:</span>
          <select
            value={config.voiceName}
            onChange={(e) => onUpdateConfig({ voiceName: e.target.value as BeatriceConfig['voiceName'] })}
            className="bg-transparent text-xs text-[#00f2fe] font-medium focus:outline-none cursor-pointer"
          >
            {voices.map((v) => (
              <option key={v} value={v} className="bg-[#0a0a0c] text-white">
                {voiceAlias(v)}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={onToggleMute}
          title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
          className={`b-icon-btn ${
            isMuted ? '!bg-rose-500/20 !border-rose-500/40 !text-rose-400' : ''
          }`}
        >
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-emerald-400" />}
        </button>

        <button onClick={onOpenSettings} title="Open Settings" className="b-icon-btn">
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
