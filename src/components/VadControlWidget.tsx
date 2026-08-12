import React from 'react';
import { Radio, Zap } from 'lucide-react';
import { VadConfig, VadStatus } from '../lib/audioUtils';

interface VadControlWidgetProps {
  vadConfig: VadConfig;
  vadStatus: VadStatus;
  onUpdateConfig: (newConfig: Partial<VadConfig>) => void;
  compact?: boolean;
}

const Switch: React.FC<{ on: boolean; onChange: () => void }> = ({ on, onChange }) => (
  <button
    type="button"
    onClick={onChange}
    className={`w-11 h-[26px] rounded-full p-[2px] transition-colors cursor-pointer ${
      on ? 'bg-[#00f2fe]' : 'bg-white/15'
    }`}
  >
    <div
      className={`w-[22px] h-[22px] rounded-full bg-white shadow-md transition-transform ${
        on ? 'translate-x-[18px]' : ''
      }`}
    />
  </button>
);

export const VadControlWidget: React.FC<VadControlWidgetProps> = ({
  vadConfig,
  vadStatus,
  onUpdateConfig,
  compact = false,
}) => {
  // Energy meter ratio
  const energyRatio = Math.min(1, vadStatus.rms / 0.08);
  const thresholdRatio = Math.min(1, vadConfig.threshold / 0.08);

  if (compact) {
    return (
      <div className="flex items-center gap-2 bg-[#1c1c1e]/90 border border-white/10 px-3 py-1.5 rounded-xl text-xs backdrop-blur">
        <div className="relative flex items-center justify-center">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              vadStatus.isSpeaking
                ? 'bg-emerald-400 animate-ping'
                : vadConfig.enabled
                  ? 'bg-[#00f2fe]'
                  : 'bg-zinc-600'
            }`}
          />
          <div
            className={`w-2.5 h-2.5 rounded-full absolute ${
              vadStatus.isSpeaking
                ? 'bg-emerald-500'
                : vadConfig.enabled
                  ? 'bg-[#00f2fe]'
                  : 'bg-zinc-500'
            }`}
          />
        </div>

        <span className="font-mono text-[11px] text-zinc-300">
          {vadStatus.isSpeaking ? (
            <span className="text-emerald-400 font-bold">VAD: Speaking</span>
          ) : vadConfig.enabled ? (
            <span className="text-zinc-400">VAD: Listening</span>
          ) : (
            <span className="text-zinc-500">VAD: Off</span>
          )}
        </span>

        {/* Small energy bar */}
        <div className="w-12 h-1.5 bg-black/60 rounded-full overflow-hidden border border-white/5 relative">
          <div
            className={`h-full transition-all duration-75 ${
              vadStatus.isSpeaking ? 'bg-emerald-400' : 'bg-[#00f2fe]/60'
            }`}
            style={{ width: `${Math.max(4, energyRatio * 100)}%` }}
          />
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10"
            style={{ left: `${thresholdRatio * 100}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[#121215] border border-white/10 overflow-hidden divide-y divide-white/[0.07]">
      {/* Status Row */}
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-2">
          <Radio
            className={`w-4 h-4 ${
              vadStatus.isSpeaking
                ? 'text-emerald-400 animate-pulse'
                : vadConfig.enabled
                  ? 'text-[#00f2fe]'
                  : 'text-[#8e8e93]'
            }`}
          />
          <span className="text-xs font-semibold text-white">Voice Detection</span>
        </div>
        <Switch on={vadConfig.enabled} onChange={() => onUpdateConfig({ enabled: !vadConfig.enabled })} />
      </div>

      {/* Live Energy Meter */}
      <div className="px-4 py-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[#8e8e93]">Microphone</span>
          <span className="text-[11px] font-mono text-zinc-200">
            {vadStatus.isSpeaking ? 'Speaking' : vadConfig.enabled ? 'Listening' : 'Off'}
          </span>
        </div>
        <div className="w-full h-1.5 bg-black/60 rounded-full overflow-hidden relative">
          <div
            className={`h-full transition-all duration-75 ${
              vadStatus.isSpeaking ? 'bg-emerald-400' : 'bg-[#00f2fe]/50'
            }`}
            style={{ width: `${Math.max(2, energyRatio * 100)}%` }}
          />
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10"
            style={{ left: `${thresholdRatio * 100}%` }}
          />
        </div>
      </div>

      {/* Sensitivity */}
      <div className="px-4 py-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white">Sensitivity</span>
          <span className="text-xs font-mono text-[#00f2fe]">
            {vadConfig.threshold.toFixed(3)}
          </span>
        </div>
        <input
          type="range"
          min="0.005"
          max="0.050"
          step="0.002"
          value={vadConfig.threshold}
          onChange={(e) => onUpdateConfig({ threshold: parseFloat(e.target.value) })}
          className="w-full accent-[#00f2fe] bg-white/10 rounded-lg cursor-pointer h-1.5"
        />
      </div>

      {/* Silence */}
      <div className="px-4 py-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white">Silence</span>
          <span className="text-xs font-mono text-[#00f2fe]">
            {vadConfig.silenceDurationMs}ms
          </span>
        </div>
        <input
          type="range"
          min="300"
          max="1500"
          step="50"
          value={vadConfig.silenceDurationMs}
          onChange={(e) => onUpdateConfig({ silenceDurationMs: parseInt(e.target.value, 10) })}
          className="w-full accent-[#00f2fe] bg-white/10 rounded-lg cursor-pointer h-1.5"
        />
      </div>

      {/* Auto Barge-In */}
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <span className="text-xs text-white">Barge-In</span>
        </div>
        <Switch
          on={vadConfig.autoBargeIn}
          onChange={() => onUpdateConfig({ autoBargeIn: !vadConfig.autoBargeIn })}
        />
      </div>
    </div>
  );
};