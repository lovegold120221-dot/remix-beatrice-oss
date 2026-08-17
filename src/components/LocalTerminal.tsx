import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import { X, Terminal as TerminalIcon, Smartphone, Copy, ExternalLink } from 'lucide-react';
import { DeviceType, TerminalInfo } from '../types';

interface LocalTerminalProps {
  isOpen: boolean;
  onClose: () => void;
  deviceType: DeviceType;
  sshInfo?: TerminalInfo | null;
}

export const LocalTerminal: React.FC<LocalTerminalProps> = ({
  isOpen,
  onClose,
  deviceType,
  sshInfo,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || deviceType !== 'desktop' || !containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#050507', foreground: '#d4d4d8' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    const sessionId = 'term_' + Math.random().toString(36).substring(2, 9);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/terminal`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'startSession', sessionId }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'cliStream' && msg.sessionId === sessionId) {
          term.write(msg.chunk || '');
        } else if (msg.type === 'status') {
          term.write('\r\n\x1b[32m[terminal connected]\x1b[0m\r\n');
        }
      } catch {
        // ignore non-json
      }
    };
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', sessionId, data }));
      }
    });
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', sessionId, cols, rows }));
      }
    });

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'closeSession', sessionId }));
      }
      ws.close();
      term.dispose();
    };
  }, [isOpen, deviceType]);

  if (!isOpen) return null;

  const sshUrl = sshInfo?.sshUrl || '';
  const sshCmd = `ssh ${sshInfo?.user || 'root'}@${sshInfo?.host || 'localhost'} -p ${sshInfo?.port || 22}`;

  const copySsh = async () => {
    try {
      await navigator.clipboard.writeText(sshCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const openTermius = () => {
    if (sshUrl) window.location.href = sshUrl;
  };

  return (
    <div className="b-modal-overlay">
      <div className="b-modal max-w-2xl">
        <div className="b-modal-header">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-emerald-400/10 border border-emerald-400/30 flex items-center justify-center text-emerald-400">
              <TerminalIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">Local Terminal</h2>
              <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-mono">
                {deviceType === 'mobile' ? 'TERMIUS SSH' : 'IN-BROWSER SHELL'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="b-icon-btn !w-8 !h-8" aria-label="Close Terminal">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="b-modal-body">
          {deviceType === 'mobile' ? (
            <div className="space-y-4">
              <div className="p-5 rounded-2xl bg-gradient-to-b from-[#121215] to-black/80 border border-white/10 flex flex-col items-center text-center gap-3">
                <div className="w-12 h-12 rounded-full bg-[#00f2fe]/10 border border-[#00f2fe]/30 flex items-center justify-center text-[#00f2fe]">
                  <Smartphone className="w-6 h-6" />
                </div>
                <p className="text-sm text-zinc-300">
                  You're on a phone. Open the terminal in{' '}
                  <span className="text-white font-semibold">Termius</span> to SSH into the server.
                </p>
                <button
                  onClick={openTermius}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-[#00f2fe] to-[#4facfe] text-white font-bold text-xs shadow-lg shadow-[#00f2fe]/20 transition-all active:scale-95 cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open in Termius
                </button>
              </div>
              <div className="rounded-xl bg-black/60 border border-white/10 p-3 flex items-center gap-2">
                <code className="flex-1 text-[11px] font-mono text-zinc-300 break-all">{sshCmd}</code>
                <button onClick={copySsh} className="b-icon-btn !w-8 !h-8" aria-label="Copy SSH command">
                  {copied ? (
                    <span className="text-emerald-400 text-[10px] font-bold">✓</span>
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="text-[10px] text-[#52525b] px-1">
                If Termius isn't installed, copy the command above into any SSH client.
              </p>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden border border-white/10 bg-[#050507]">
              <div ref={containerRef} className="h-[360px] w-full p-2" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
