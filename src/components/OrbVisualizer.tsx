import React, { useEffect, useRef } from 'react';
import { SessionStatus } from '../types';

interface OrbVisualizerProps {
  status: SessionStatus;
  inputVolume: number;
  outputVolume: number;
  onInterrupt?: () => void;
}

export const OrbVisualizer: React.FC<OrbVisualizerProps> = ({
  status,
  inputVolume,
  outputVolume,
  onInterrupt,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let phase = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Determine active scale based on volumes
      const isSpeaking = status === 'speaking' || outputVolume > 0.05;
      const isListening = status === 'listening' || inputVolume > 0.05;

      const activeVolume = isSpeaking ? outputVolume : inputVolume;
      const baseRadius = 65 + activeVolume * 45;

      phase += isSpeaking ? 0.08 : 0.03;

      // Draw Outer Radiant Glow Rings
      const ringCount = 3;
      for (let i = 0; i < ringCount; i++) {
        const ringRadius = baseRadius + i * 20 + Math.sin(phase + i) * 8;
        const opacity = Math.max(0.05, 0.25 - i * 0.08);

        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);

        if (isSpeaking) {
          ctx.strokeStyle = `rgba(6, 182, 212, ${opacity})`; // Cyan glow
        } else if (isListening) {
          ctx.strokeStyle = `rgba(99, 102, 241, ${opacity})`; // Indigo glow
        } else {
          ctx.strokeStyle = `rgba(148, 163, 184, ${opacity * 0.5})`; // Neutral gray glow
        }

        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Draw Wave/Deformed Fluid Sphere
      const points = 60;
      ctx.beginPath();

      for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const wave = Math.sin(angle * 6 + phase) * (8 + activeVolume * 25);
        const r = baseRadius + wave;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.closePath();

      // Create Radial Gradient Core
      const gradient = ctx.createRadialGradient(
        centerX,
        centerY,
        10,
        centerX,
        centerY,
        baseRadius + 20
      );

      if (isSpeaking) {
        gradient.addColorStop(0, '#38bdf8'); // Bright cyan
        gradient.addColorStop(0.5, '#00f2fe'); // Theme cyan
        gradient.addColorStop(1, 'rgba(15, 23, 42, 0.8)');
      } else if (isListening) {
        gradient.addColorStop(0, '#818cf8'); // Indigo
        gradient.addColorStop(0.5, '#a855f7'); // Purple
        gradient.addColorStop(1, 'rgba(15, 23, 42, 0.8)');
      } else {
        gradient.addColorStop(0, '#475569'); // Slate
        gradient.addColorStop(0.5, '#1e293b');
        gradient.addColorStop(1, 'rgba(15, 23, 42, 0.8)');
      }

      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.lineWidth = 2;
      ctx.strokeStyle = isSpeaking ? '#7dd3fc' : isListening ? '#c084fc' : '#64748b';
      ctx.stroke();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [status, inputVolume, outputVolume]);

  return (
    <div className="relative flex flex-col items-center justify-center p-6 bg-[#121215]/80 rounded-3xl border border-white/10 backdrop-blur-xl overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-b from-[#00f2fe]/5 via-[#4facfe]/5 to-transparent pointer-events-none" />

      <canvas
        ref={canvasRef}
        width={260}
        height={260}
        className="cursor-pointer transition-transform duration-300 group-hover:scale-105"
        onClick={onInterrupt}
        title="Click to interrupt Beatrice"
      />

      <div className="mt-2 text-center z-10">
        <div className="text-sm font-semibold text-white flex items-center justify-center gap-2">
          {status === 'speaking' ? (
            <span className="text-[#00f2fe] font-bold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#00f2fe] animate-ping" />
              Beatrice Speaking
            </span>
          ) : status === 'listening' ? (
            <span className="text-[#4facfe] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#4facfe] animate-pulse" />
              Listening...
            </span>
          ) : (
            <span className="text-[#8e8e93]">Beatrice Active</span>
          )}
        </div>
        <p className="text-xs text-[#8e8e93] mt-0.5">
          {status === 'speaking' ? 'Click orb to interrupt' : 'Speak into mic or show camera'}
        </p>
      </div>
    </div>
  );
};
