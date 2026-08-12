import React, { useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Eye,
  Mic,
  MicOff,
  Monitor,
  PhoneOff,
  Scan,
  Sparkles,
  SwitchCamera,
} from 'lucide-react';
import { CameraFacingMode } from '../lib/videoUtils';
import { MobileOrb } from './MobileOrb';
import { SessionStatus } from '../types';

interface VideoFeedProps {
  onStartCamera: (videoElem: HTMLVideoElement, facingMode?: CameraFacingMode) => Promise<void>;
  onStartScreen: (videoElem: HTMLVideoElement) => Promise<void>;
  onStopVideo: () => void;
  streamType: 'camera' | 'screen' | 'off';
  facingMode: CameraFacingMode;
  onToggleFacingMode: () => void;
  fps?: number;
  status: SessionStatus;
  inputVolume: number;
  outputVolume: number;
  isMuted: boolean;
  onToggleMute: () => void;
  onCloseVideo?: () => void;
}

export const VideoFeed: React.FC<VideoFeedProps> = ({
  onStartCamera,
  onStartScreen,
  onStopVideo,
  streamType,
  facingMode,
  onToggleFacingMode,
  fps = 1,
  status,
  inputVolume,
  outputVolume,
  isMuted,
  onToggleMute,
  onCloseVideo,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const handleCameraToggle = async () => {
    if (streamType === 'camera') {
      onStopVideo();
    } else if (videoRef.current) {
      await onStartCamera(videoRef.current, facingMode);
    }
  };

  const handleScreenToggle = async () => {
    if (streamType === 'screen') {
      onStopVideo();
    } else if (videoRef.current) {
      await onStartScreen(videoRef.current);
    }
  };

  const handleTriggerSnapshot = () => {
    if (!videoRef.current) return;
    setIsScanning(true);
    setTimeout(() => setIsScanning(false), 1200);
  };

  return (
    <div className="relative w-full h-full min-h-[460px] max-h-[640px] aspect-[9/16] mx-auto bg-black rounded-[32px] border border-white/10 overflow-hidden flex flex-col justify-between shadow-2xl">
      {/* Background Video Stream or Offline Call State */}
      <div className="absolute inset-0 z-0 bg-black flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full ${
            streamType === 'screen' ? 'object-contain' : 'object-cover'
          } ${facingMode === 'user' && streamType === 'camera' ? 'scale-x-[-1]' : ''} ${
            streamType === 'off' ? 'hidden' : 'block'
          }`}
        />

        {/* Scan / Inspection Flash Effect */}
        {isScanning && streamType !== 'off' && (
          <div className="absolute inset-0 bg-[#00f2fe]/20 border-4 border-[#00f2fe] rounded-3xl animate-pulse flex items-center justify-center z-20 backdrop-blur-xs">
            <div className="bg-black/80 px-4 py-2 rounded-2xl border border-[#00f2fe]/50 flex items-center gap-2 text-[#00f2fe] font-mono text-xs shadow-lg">
              <Scan className="w-5 h-5 text-[#00f2fe] animate-spin" />
              <span>Analyzing Visual Frame...</span>
            </div>
          </div>
        )}

        {/* Video Off Placeholder State */}
        {streamType === 'off' && (
          <div className="flex flex-col items-center justify-center text-center p-6 text-zinc-400 z-10 space-y-4">
            <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shadow-xl">
              <CameraOff className="w-8 h-8 text-zinc-500" />
            </div>
            <div>
              <p className="text-base font-bold text-white tracking-tight">Portrait Video Call</p>
              <p className="text-xs text-zinc-500 max-w-xs mt-1 leading-relaxed">
                Turn on your camera or share your screen to start a real-time multimodal video call with Beatrice.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleCameraToggle}
                className="px-4 py-2.5 rounded-full bg-gradient-to-r from-[#00f2fe] to-[#4facfe] text-white font-semibold text-xs shadow-lg shadow-[#00f2fe]/20 active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Start Camera</span>
              </button>

              <button
                type="button"
                onClick={handleScreenToggle}
                className="px-4 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-white font-semibold text-xs active:scale-95 transition-all flex items-center gap-2 cursor-pointer"
              >
                <Monitor className="w-4 h-4" />
                <span>Share Screen</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Top Floating Header Overlay */}
      <div className="relative z-20 p-4 bg-gradient-to-b from-black/80 via-black/40 to-transparent flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white text-xs font-semibold flex items-center gap-2 shadow-lg">
            <Eye className={`w-3.5 h-3.5 ${streamType !== 'off' ? 'text-emerald-400 animate-pulse' : 'text-zinc-500'}`} />
            <span>
              {streamType === 'camera'
                ? facingMode === 'user'
                  ? 'Front Camera'
                  : 'Rear Camera'
                : streamType === 'screen'
                ? 'Screen Share'
                : 'Video Offline'}
            </span>
          </div>

          {streamType !== 'off' && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-[#00f2fe]/30 text-[10px] font-mono font-bold">
              {fps} FPS
            </span>
          )}
        </div>

        {/* Top Controls: Camera Flip Switch & Inspect Frame */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleFacingMode}
            title={`Switch to ${facingMode === 'user' ? 'Rear' : 'Front'} Camera`}
            className="p-2.5 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white hover:bg-white/20 active:scale-90 transition-all cursor-pointer shadow-lg"
          >
            <SwitchCamera className="w-4 h-4 text-[#00f2fe]" />
          </button>

          {streamType !== 'off' && (
            <button
              type="button"
              onClick={handleTriggerSnapshot}
              title="Inspect current visual frame"
              className="p-2.5 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white hover:bg-white/20 active:scale-90 transition-all cursor-pointer shadow-lg"
            >
              <Scan className="w-4 h-4 text-[#00f2fe]" />
            </button>
          )}
        </div>
      </div>

      {/* Beatrice AI Floating PIP Participant Window */}
      {streamType !== 'off' && (
        <div className="relative z-20 self-end mr-4 w-28 h-36 rounded-2xl bg-black/70 border border-white/20 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col items-center justify-center p-2">
          <div className="scale-50 origin-center -my-6">
            <MobileOrb
              status={status}
              inputVolume={inputVolume}
              outputVolume={outputVolume}
              onInterrupt={() => {}}
            />
          </div>
          <div className="absolute bottom-2 text-[10px] font-bold text-white flex items-center gap-1 bg-black/80 px-2 py-0.5 rounded-full border border-white/10">
            <Sparkles className="w-3 h-3 text-[#00f2fe]" />
            <span>Beatrice</span>
          </div>
        </div>
      )}

      {/* Bottom Floating Video Call Control Bar */}
      <div className="relative z-20 p-5 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex items-center justify-center gap-4">
        {/* Toggle Camera */}
        <button
          type="button"
          onClick={handleCameraToggle}
          title={streamType === 'camera' ? 'Turn Off Camera' : 'Turn On Camera'}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 shadow-xl cursor-pointer ${
            streamType === 'camera'
              ? 'bg-[#00f2fe] text-white shadow-[#00f2fe]/30'
              : 'bg-white/10 border border-white/20 text-zinc-300 hover:bg-white/20'
          }`}
        >
          {streamType === 'camera' ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
        </button>

        {/* Switch Front/Back Camera */}
        <button
          type="button"
          onClick={onToggleFacingMode}
          title={`Switch Camera (${facingMode === 'user' ? 'Front' : 'Back'})`}
          className="w-12 h-12 rounded-full bg-white/10 border border-white/20 text-white hover:bg-white/20 active:scale-90 transition-all flex items-center justify-center cursor-pointer shadow-xl"
        >
          <SwitchCamera className="w-5 h-5 text-[#00f2fe]" />
        </button>

        {/* Share Screen */}
        <button
          type="button"
          onClick={handleScreenToggle}
          title={streamType === 'screen' ? 'Stop Screen Share' : 'Share Screen'}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 shadow-xl cursor-pointer ${
            streamType === 'screen'
              ? 'bg-[#4facfe] text-white shadow-[#00f2fe]/30'
              : 'bg-white/10 border border-white/20 text-zinc-300 hover:bg-white/20'
          }`}
        >
          <Monitor className="w-5 h-5" />
        </button>

        {/* Mute Mic */}
        <button
          type="button"
          onClick={onToggleMute}
          title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90 shadow-xl cursor-pointer ${
            isMuted
              ? 'bg-rose-500 text-white shadow-rose-500/30'
              : 'bg-white/10 border border-white/20 text-zinc-300 hover:bg-white/20'
          }`}
        >
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        {/* Close / End Call */}
        {onCloseVideo && (
          <button
            type="button"
            onClick={onCloseVideo}
            title="End Video Call"
            className="w-12 h-12 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center active:scale-90 transition-all cursor-pointer shadow-xl shadow-rose-600/40"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};
