import { useState } from 'react';
import { Check, Copy, MessageCircle, Phone, QrCode, Unplug } from 'lucide-react';

export interface WhatsAppPanelState {
  status: string;
  connected: boolean;
  pairingCode: string | null;
  qrDataUrl: string | null;
  error: string | null;
  reconnectAttempt?: number;
}

export interface WhatsAppApprovalState {
  id: string;
  recipient: string;
  recipientName?: string;
  purpose?: string;
}

interface WhatsAppApprovalModalProps {
  approval: WhatsAppApprovalState | null;
  onApprove: (approve: boolean) => void;
}

export function WhatsAppApprovalModal({ approval, onApprove }: WhatsAppApprovalModalProps) {
  if (!approval) return null;
  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-[340px] rounded-3xl border border-white/10 bg-[#121215] p-5 shadow-2xl animate-fade-in">
        <div className="flex items-center gap-2 mb-3">
          <MessageCircle className="w-4 h-4 text-[#00f2fe]" strokeWidth={2.5} />
          <span className="text-sm font-semibold text-white">WhatsApp approval</span>
        </div>
        <p className="text-sm text-white leading-relaxed">
          Beatrice wants to send a WhatsApp message to{' '}
          <span className="font-semibold text-[#00f2fe]">
            {approval.recipientName || approval.recipient}
          </span>
          .
        </p>
        {approval.purpose && (
          <p className="text-xs text-[#8e8e93] mt-2 leading-relaxed">{approval.purpose}</p>
        )}
        <div className="flex gap-2 mt-5">
          <button
            onClick={() => onApprove(false)}
            className="flex-1 rounded-xl bg-white/5 border border-white/10 text-white py-2.5 text-sm font-semibold active:scale-95 transition-transform cursor-pointer"
          >
            Deny
          </button>
          <button
            onClick={() => onApprove(true)}
            className="flex-1 rounded-xl bg-[#00f2fe] text-black py-2.5 text-sm font-semibold active:scale-95 transition-transform cursor-pointer"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp link card (used inside Settings > Connect WhatsApp)
// ---------------------------------------------------------------------------

interface WhatsAppLinkCardProps {
  status: WhatsAppPanelState;
  onPair: (phone: string) => void;
  onQr: () => void;
  onCancel: () => void;
  onLogout: () => void;
}

const statusMeta = (s: WhatsAppPanelState) => {
  if (s.connected) return { dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]', label: 'Connected', pulse: false };
  if (s.status === 'pairing') return { dot: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]', label: 'Linking', pulse: true };
  if (s.status === 'connecting') {
    const attempt = s.reconnectAttempt ? ` (retry ${s.reconnectAttempt})` : '';
    return { dot: 'bg-[#4facfe] shadow-[0_0_8px_rgba(79,172,254,0.8)]', label: `Reconnecting${attempt}`, pulse: true };
  }
  if (s.status === 'failed') return { dot: 'bg-rose-400', label: 'Failed', pulse: false };
  if (s.status === 'logged_out') return { dot: 'bg-[#48484a]', label: 'Not linked', pulse: false };
  return { dot: 'bg-[#48484a]', label: 'Not linked', pulse: false };
};

export function WhatsAppLinkCard({ status, onPair, onQr, onCancel, onLogout }: WhatsAppLinkCardProps) {
  const [mode, setMode] = useState<'qr' | 'code'>('qr');
  const [phone, setPhone] = useState('');
  const [copied, setCopied] = useState(false);
  const meta = statusMeta(status);

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
    <div className="rounded-2xl bg-[#121215] border border-white/10 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.07]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#00f2fe]/10 border border-[#00f2fe]/30 flex items-center justify-center text-[#00f2fe]">
            <MessageCircle className="w-4 h-4" strokeWidth={2.2} />
          </div>
          <div>
            <div className="text-xs font-semibold text-white">Connect WhatsApp</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${meta.pulse ? 'animate-pulse' : ''}`} />
              <span className="text-[10px] text-[#8e8e93]">{meta.label}</span>
            </div>
          </div>
        </div>
        {status.connected && (
          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 px-3 py-1.5 text-[10px] font-semibold active:scale-95 transition-transform cursor-pointer"
          >
            <Unplug className="w-3 h-3" />
            Unlink
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        {status.error && (
          <p className="text-[0.7rem] leading-snug text-rose-400">{status.error}</p>
        )}

        {status.connected && (
          <p className="text-[0.7rem] text-[#8e8e93] leading-snug">
            Beatrice is linked to WhatsApp. Chats, contacts, and messages are synced and saved to
            Firebase. She can read conversations, send messages (with approval), transcribe voice
            notes, and manage groups.
          </p>
        )}

        {!status.connected && (
          <>
            {/* Mode toggle, like WhatsApp's own pairing screen */}
            {!status.pairingCode && !status.qrDataUrl && (
              <div className="flex rounded-xl bg-black/40 border border-white/5 p-1">
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
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                      mode === m.key ? 'bg-[#00f2fe]/15 text-[#00f2fe]' : 'text-[#8e8e93]'
                    }`}
                  >
                    <m.icon className="w-3 h-3" />
                    {m.label}
                  </button>
                ))}
              </div>
            )}

            {mode === 'qr' && !status.pairingCode && (
              <>
                {status.qrDataUrl ? (
                  <div className="space-y-2">
                    <div className="flex justify-center bg-white rounded-2xl p-3">
                      <img src={status.qrDataUrl} alt="WhatsApp pairing QR" className="w-48 h-48" draggable={false} />
                    </div>
                    <p className="text-[0.65rem] text-amber-400/80 text-center animate-pulse">
                      Waiting for scan… open WhatsApp → Linked devices → Link a device
                    </p>
                    <button
                      type="button"
                      onClick={onCancel}
                      className="w-full rounded-xl bg-white/5 border border-white/10 text-white py-2 text-[11px] font-semibold active:scale-95 transition-transform cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={onQr}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#00f2fe] text-black py-2.5 text-xs font-semibold active:scale-95 transition-transform cursor-pointer"
                  >
                    <QrCode className="w-4 h-4" strokeWidth={2.5} />
                    Show QR code
                  </button>
                )}
              </>
            )}

            {mode === 'code' && !status.qrDataUrl && (
              <>
                {status.pairingCode ? (
                  <div className="space-y-2">
                    <p className="text-[0.7rem] text-[#8e8e93] leading-snug">
                      On your phone: WhatsApp → Linked devices → Link a device →{' '}
                      <span className="text-white">Link with phone number instead</span>, then enter:
                    </p>
                    <div className="flex items-center gap-2 bg-black/40 rounded-2xl px-4 py-3 border border-white/5">
                      <span className="font-mono text-lg tracking-[0.2em] text-[#00f2fe] flex-1">
                        {status.pairingCode.match(/.{1,4}/g)?.join(' ') || status.pairingCode}
                      </span>
                      <button
                        type="button"
                        onClick={copyCode}
                        className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-[#8e8e93] active:scale-90 cursor-pointer"
                        aria-label="Copy pairing code"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-[0.65rem] text-amber-400/80 animate-pulse">Waiting for the phone to link…</p>
                    <button
                      type="button"
                      onClick={onCancel}
                      className="w-full rounded-xl bg-white/5 border border-white/10 text-white py-2 text-[11px] font-semibold active:scale-95 transition-transform cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[0.7rem] text-[#8e8e93] leading-snug">
                      Enter your WhatsApp number with country code to get a 12-digit pairing code.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))}
                        placeholder="e.g. 639171234567"
                        className="flex-1 min-w-0 bg-black/40 rounded-xl px-3 py-2.5 text-sm text-white placeholder-[#48484a] border border-white/5 focus:outline-none focus:border-[#4facfe]/50"
                        inputMode="tel"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (phone.trim()) onPair(phone.trim());
                        }}
                        className="flex items-center gap-1.5 bg-[#00f2fe] text-black rounded-xl px-3.5 py-2.5 text-xs font-semibold active:scale-95 transition-transform cursor-pointer"
                      >
                        <Phone className="w-3.5 h-3.5" strokeWidth={2.5} />
                        Link
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Backwards-compatible default export (approval modal only)
export default WhatsAppApprovalModal;
