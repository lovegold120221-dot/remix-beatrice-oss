import React from 'react';
import { SessionStatus } from '../types';

interface MobileOrbProps {
  status: SessionStatus;
  inputVolume: number;
  outputVolume: number;
  onInterrupt?: () => void;
}

export const MobileOrb: React.FC<MobileOrbProps> = ({
  status,
  inputVolume,
  outputVolume,
  onInterrupt,
}) => {
  const isListening = status === 'listening' || status === 'speaking' || inputVolume > 0.05 || outputVolume > 0.05;

  return (
    <div className="relative flex flex-col items-center justify-center my-auto select-none z-10 w-[280px] h-[280px]" onClick={onInterrupt}>
      <div className="relative w-[280px] h-[280px] flex justify-center items-center">
        {/* Blob 1 */}
        <div 
          className={`absolute plasma-blob opacity-70 transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] ${isListening ? 'bg-[#00f2fe] blur-[30px] w-[260px] h-[260px]' : 'bg-ai-1 blur-[25px] w-[240px] h-[240px]'}`}
          style={{ animationDirection: 'alternate, normal', animationDuration: isListening ? '3s, 5s' : '8s, 12s' }}
        />
        
        {/* Blob 2 */}
        <div 
          className={`absolute plasma-blob opacity-70 transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] ${isListening ? 'bg-[#4facfe] blur-[20px] w-[220px] h-[220px]' : 'bg-ai-2 blur-[25px] w-[220px] h-[220px]'}`}
          style={{ animation: 'morph 6s ease-in-out infinite alternate, spin-reverse 15s linear infinite', animationDuration: isListening ? '3s, 5s' : '6s, 15s' }}
        />

        {/* Blob 3 */}
        <div 
          className={`absolute plasma-blob opacity-90 transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] ${isListening ? 'bg-[#ffffff] blur-[10px] w-[180px] h-[180px]' : 'bg-ai-3 blur-[15px] w-[180px] h-[180px]'}`}
          style={{ animation: 'morph 5s ease-in-out infinite alternate-reverse, spin 9s linear infinite', animationDuration: isListening ? '3s, 5s' : '5s, 9s' }}
        />

        {/* Core Center */}
        <div 
          className="absolute w-[100px] h-[100px] bg-white rounded-full blur-[20px] shadow-[0_0_60px_20px_rgba(0,242,254,0.35)] pointer-events-none"
          style={{ animation: 'pulse-core 4s infinite alternate' }}
        />
      </div>
      
      <div className="absolute -bottom-12 text-center z-10 w-full">
        <div className="text-xs font-semibold tracking-wider uppercase text-zinc-400">
          {status === 'speaking' ? (
            <span className="text-emerald-400 font-bold flex items-center justify-center gap-1.5 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              Beatrice Speaking
            </span>
          ) : status === 'listening' ? (
            <span className="text-[#00f2fe] flex items-center justify-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#00f2fe] animate-ping" />
              Listening...
            </span>
          ) : (
            <span className="text-zinc-500 font-medium">Tap orb or speak to activate</span>
          )}
        </div>
      </div>
    </div>
  );
};

