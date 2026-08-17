import { useEffect, useState } from 'react';
import type { FC } from 'react';
import { MessageCircle, QrCode, Phone, Check, Copy, User, ShieldCheck, Sparkles } from 'lucide-react';
import { WhatsAppPanelState } from './WhatsAppPanel';

interface WhatsAppOnboardingProps {
  status: WhatsAppPanelState;
  onPair: (phone: string) => void;
  onQr: () => void;
  onCancel: () => void;
  onSkip: () => void;
}

export const WhatsAppOnboarding: FC<WhatsAppOnboardingProps> = ({
  status,
  onPair,
  onQr,
  onCancel,
  onSkip,
}) => {
  const [mode, setMode] = useState<'qr' | 'code'>('qr');
  const [phone, setPhone] = useState('');
  const [copied, setCopied] = useState(false);
  const [userStopped, setUserStopped] = useState(false);

  // WhatsApp-Web-style: the QR code is generated IMMEDIATELY on mount so it is
  // ready for scanning the moment the step appears. No tap needed.
  useEffect(() => {
    if (userStopped) return;
    if (status.connected || status.pairingCode || status.qrDataUrl) return;
    if (status.status === 'connecting' || status.status === 'pairing') return;
    onQr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.connected, status.pairingCode, status.qrDataUrl, status.status, userStopped]);

  const copyCode = async () => {
    if (!status.pairingCode) return;
    try {
      await navigator.clipboard.writeText(status.pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-between bg-[#0a0a0f] relative overflow-hidden">
      {/* Soft ambient glows */}
      <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[420px] h-[420px] bg-[radial-gradient(circle,rgba(0,242,254,0.14)_0%,transparent_65%)] pointer-events-none" />
      <div className="absolute bottom-[-120px] right-[-80px] w-[360px] h-[360px] bg-[radial-gradient(circle,rgba(142,68,173,0.12)_0%,transparent_65%)] pointer-events-none" />
      <div className="absolute top-1/3 left-[-100px] w-[280px] h-[280px] bg-[radial-gradient(circle,rgba(79,172,254,0.08)_0%,transparent_65%)] pointer-events-none" />

      {/* Header */}
      <div className="relative flex flex-col items-center pt-14 sm:pt-16 space-y-5 px-6">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-[#00f2fe]/40 via-[#4facfe]/30 to-[#8e44ad]/40 blur-xl" />
          <div className="relative w-20 h-20 rounded-full bg-gradient-to-tr from-[#00f2fe] via-[#4facfe] to-[#8e44ad] p-[2px] shadow-xl shadow-[#00f2fe]/20">
            <div className="w-full h-full rounded-full bg-[#0d0d14] flex items-center justify-center text-[#00f2fe]">
              <MessageCircle className="w-9 h-9" strokeWidth={1.8} />
            </div>
          </div>
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Connect your WhatsApp
          </h1>
          <p className="text-[13px] text-[#8e8e93] leading-relaxed max-w-[300px] mx-auto">
            Let Beatrice read chats, reply in your style, and manage conversations — all from your phone.
          </p>
        </div>
      </div>

      {/* Pairing card — aligned to the top, horizontally centered */}
      <div className="relative w-full px-6 sm:px-8 pb-20 flex-1 flex items-start justify-center pt-6">
        {status.connected ? (
          <div className="w-full max-w-[340px] space-y-4 animate-[fadeIn_0.4s_ease-out]">
            <div className="flex items-center gap-4 rounded-3xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-xl p-5">
              {status.profile?.avatarUrl ? (
                <img
                  src={status.profile.avatarUrl}
                  alt="WhatsApp profile"
                  className="w-14 h-14 rounded-full object-cover border-2 border-[#00f2fe]/30"
                  draggable={false}
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-[#00f2fe]/20 to-[#8e44ad]/20 border border-[#00f2fe]/30 flex items-center justify-center text-[#00f2fe]">
                  <User className="w-7 h-7" strokeWidth={1.8} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" strokeWidth={2} />
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400">
                    Linked
                  </span>
                </div>
                <div className="text-sm font-semibold text-white truncate mt-0.5">
                  {status.profile?.name || 'WhatsApp connected'}
                </div>
                {status.profile?.phone && (
                  <div className="text-[11px] text-[#8e8e93] font-mono mt-0.5">{status.profile.phone}</div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onSkip}
              className="w-full h-[52px] rounded-2xl bg-gradient-to-r from-[#00f2fe] to-[#4facfe] text-white font-semibold text-sm shadow-lg shadow-[#00f2fe]/25 transition-all active:scale-[0.98] hover:brightness-110 cursor-pointer"
            >
              Continue
            </button>
          </div>
        ) : (
          <div className="w-full max-w-[340px] space-y-4 animate-[fadeIn_0.4s_ease-out]">
            {status.error && (
              <p className="text-center text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl py-2 px-3">
                {status.error}
              </p>
            )}

            {/* Mode toggle */}
            {!status.pairingCode && !status.qrDataUrl && (
              <div className="flex rounded-2xl bg-white/[0.04] border border-white/[0.08] backdrop-blur-xl p-1">
                {(
                  [
                    { key: 'qr', label: 'QR code', icon: QrCode },
                    { key: 'code', label: 'Phone number', icon: Phone },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setMode(m.key)}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11px] font-semibold transition-all cursor-pointer ${
                      mode === m.key
                        ? 'bg-gradient-to-r from-[#00f2fe]/20 to-[#4facfe]/20 text-[#00f2fe] shadow-inner'
                        : 'text-[#8e8e93] hover:text-white'
                    }`}
                  >
                    <m.icon className="w-3.5 h-3.5" strokeWidth={2.2} />
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            {mode === 'qr' && !status.pairingCode && (
              <>
                {status.qrDataUrl ? (
                  <div className="space-y-4">
                    <div className="relative">
                      <div className="absolute inset-0 rounded-3xl bg-gradient-to-tr from-[#00f2fe]/20 via-[#4facfe]/10 to-[#8e44ad]/20 blur-2xl" />
                      <div className="relative bg-white rounded-3xl p-4 shadow-2xl shadow-black/50">
                        <img
                          src={status.qrDataUrl}
                          alt="WhatsApp pairing QR"
                          className="w-full max-w-[240px] mx-auto aspect-square"
                          draggable={false}
                        />
                      </div>
                    </div>
                    <div className="text-center space-y-1.5">
                      <p className="text-[13px] text-white font-medium flex items-center justify-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#00f2fe]" strokeWidth={2} />
                        Scan with your phone
                      </p>
                      <p className="text-[11px] text-[#8e8e93] leading-relaxed">
                        Open WhatsApp → Linked devices → Link a device
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setUserStopped(true);
                        onCancel();
                      }}
                      className="w-full rounded-2xl bg-white/[0.05] border border-white/[0.08] text-white/80 py-2.5 text-[11px] font-semibold active:scale-95 transition-all hover:bg-white/[0.08] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4 py-6">
                    <div className="w-16 h-16 rounded-full border-2 border-[#00f2fe]/20 border-t-[#00f2fe] animate-spin" />
                    <p className="text-[12px] text-[#8e8e93]">Generating QR code…</p>
                  </div>
                )}
              </>
            )}

            {mode === 'code' && !status.qrDataUrl && (
              <>
                {status.pairingCode ? (
                  <div className="space-y-4">
                    <p className="text-[12px] text-[#8e8e93] leading-relaxed text-center">
                      On your phone: WhatsApp → Linked devices → Link a device →{' '}
                      <span className="text-white font-medium">Link with phone number instead</span>, then enter:
                    </p>
                    <div className="flex items-center gap-2 bg-white/[0.04] rounded-2xl px-4 py-4 border border-white/[0.08] backdrop-blur-xl">
                      <span className="font-mono text-xl tracking-[0.2em] text-[#00f2fe] flex-1 text-center">
                        {status.pairingCode.match(/.{1,4}/g)?.join(' ') || status.pairingCode}
                      </span>
                      <button
                        type="button"
                        onClick={copyCode}
                        className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center text-[#8e8e93] active:scale-90 transition-all hover:bg-white/[0.1] cursor-pointer"
                        aria-label="Copy pairing code"
                      >
                        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-amber-400/80 text-center animate-pulse">
                      Waiting for the phone to link…
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setUserStopped(true);
                        onCancel();
                      }}
                      className="w-full rounded-2xl bg-white/[0.05] border border-white/[0.08] text-white/80 py-2.5 text-[11px] font-semibold active:scale-95 transition-all hover:bg-white/[0.08] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[12px] text-[#8e8e93] leading-relaxed text-center">
                      Enter your WhatsApp number with country code to get a 12-digit pairing code.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))}
                        placeholder="e.g. 639171234567"
                        className="flex-1 min-w-0 bg-white/[0.04] rounded-2xl px-4 py-3 text-sm text-white placeholder-[#48484a] border border-white/[0.08] focus:outline-none focus:border-[#4facfe]/50 focus:bg-white/[0.06] transition-all"
                        inputMode="tel"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (phone.trim()) onPair(phone.trim());
                        }}
                        className="flex items-center gap-1.5 bg-gradient-to-r from-[#00f2fe] to-[#4facfe] text-black rounded-2xl px-4 py-3 text-xs font-semibold active:scale-95 transition-all hover:brightness-110 cursor-pointer"
                      >
                        <Phone className="w-3.5 h-3.5" strokeWidth={2.5} />
                        Link
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Skip — bottom right, always available */}
      <button
        type="button"
        onClick={onSkip}
        className="absolute bottom-[max(24px,env(safe-area-inset-bottom))] right-6 px-5 py-2.5 rounded-full bg-white/[0.06] backdrop-blur-xl border border-white/[0.1] text-white/70 text-sm font-medium hover:bg-white/[0.12] hover:text-white active:scale-95 transition-all cursor-pointer shadow-lg shadow-black/20 z-20"
      >
        Skip
      </button>
    </div>
  );
};
