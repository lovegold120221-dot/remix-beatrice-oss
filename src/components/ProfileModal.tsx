import React from 'react';
import {
  User as UserIcon,
  Mail,
  ShieldCheck,
  LogOut,
  LogIn,
  X,
  Database,
  Sparkles,
  Activity,
  CheckCircle2,
  Volume2,
  Clock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SessionStatus, BeatriceConfig, voiceAlias } from '../types';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: SessionStatus;
  config: BeatriceConfig;
  transcriptsCount: number;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  status,
  config,
  transcriptsCount,
}) => {
  const { user, signInWithGoogle, logout } = useAuth();

  if (!isOpen) return null;

  return (
    <div className="b-modal-overlay">
      <div className="b-modal max-w-md">
        <div className="b-modal-header">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#00f2fe]/10 border border-[#00f2fe]/30 flex items-center justify-center text-[#00f2fe]">
              <UserIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">User Profile</h2>
              <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-mono">
                EBURON AI IDENTITY
              </p>
            </div>
          </div>
          <button onClick={onClose} className="b-icon-btn !w-8 !h-8" aria-label="Close Profile">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="b-modal-body">
          <div className="p-5 rounded-2xl bg-gradient-to-b from-[#121215] to-black/80 border border-white/10 flex flex-col items-center text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-[#00f2fe] via-[#4facfe] to-[#8e44ad]" />

            {user ? (
              <>
                <div className="relative mb-3">
                  <img
                    src={
                      user.photoURL ||
                      'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80'
                    }
                    alt={user.displayName || 'User Profile'}
                    className="w-20 h-20 rounded-full object-cover border-2 border-[#00f2fe]/40 p-0.5 shadow-xl shadow-[#00f2fe]/10"
                  />
                  <div
                    className="absolute bottom-0 right-0 p-1 bg-emerald-500 text-black rounded-full border-2 border-black"
                    title="Authenticated"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </div>
                </div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  {user.displayName || 'Authenticated User'}
                </h3>
                <div className="flex items-center gap-1.5 mt-1 text-[#8e8e93] text-xs">
                  <Mail className="w-3.5 h-3.5 text-[#00f2fe]" />
                  <span>{user.email}</span>
                </div>
                <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-[#00f2fe]/30 text-emerald-400 text-[11px] font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Firebase Google Account Connected
                </div>
              </>
            ) : (
              <>
                <div className="w-20 h-20 rounded-full bg-white/5 border-2 border-white/10 flex items-center justify-center text-[#8e8e93] mb-3">
                  <UserIcon className="w-9 h-9" />
                </div>
                <h3 className="text-base font-bold text-white">Guest Session</h3>
                <p className="text-[#8e8e93] text-xs mt-1 max-w-[240px]">
                  Using Beatrice OSS in local guest mode. Sign in to back up conversations.
                </p>
                <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-medium">
                  <Clock className="w-3 h-3 text-amber-400" />
                  Guest Mode (Local Storage)
                </div>
              </>
            )}
          </div>

          <div>
            {user ? (
              <button
                onClick={() => logout()}
                className="w-full py-3 px-4 rounded-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center justify-center gap-2 font-semibold text-xs transition-all active:scale-95 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Sign Out of Account
              </button>
            ) : (
              <button onClick={() => signInWithGoogle()} className="b-btn-primary w-full flex items-center justify-center gap-2">
                <LogIn className="w-4 h-4" />
                Sign In with Google
              </button>
            )}
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-[#00f2fe]" />
              Cloud Data & Session Metrics
            </h4>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="b-card !p-3">
                <span className="text-[10px] text-[#8e8e93] block">Realtime Database</span>
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1 mt-0.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {user ? 'Synchronized' : 'Guest Local'}
                </span>
              </div>

              <div className="b-card !p-3">
                <span className="text-[10px] text-[#8e8e93] block">Saved Transcripts</span>
                <span className="text-xs font-bold text-white mt-0.5 block">{transcriptsCount} items</span>
              </div>

              <div className="b-card !p-3">
                <span className="text-[10px] text-[#8e8e93] block">Voice Persona</span>
                <span className="text-xs font-bold text-[#00f2fe] flex items-center gap-1 mt-0.5">
                  <Volume2 className="w-3.5 h-3.5" />
                  {voiceAlias(config.voiceName)}
                </span>
              </div>

              <div className="b-card !p-3">
                <span className="text-[10px] text-[#8e8e93] block">Live Connection</span>
                <span className="text-xs font-bold text-[#4facfe] flex items-center gap-1 mt-0.5">
                  <Activity className="w-3.5 h-3.5" />
                  {status}
                </span>
              </div>
            </div>
          </div>

          <div className="b-card text-[10px] text-[#8e8e93] space-y-1 !p-3">
            <span className="font-semibold text-zinc-300 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-[#00f2fe]" />
              Privacy & Security Notice
            </span>
            <p>
              Voice sessions, transcripts, and tools data are processed via Eburon Live API. Authenticated
              data is stored in your private Firebase Realtime Database.
            </p>
          </div>
        </div>

        <div className="b-modal-footer">
          <button onClick={onClose} className="b-btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
