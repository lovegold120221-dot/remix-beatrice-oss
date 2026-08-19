import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  Send,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { InlineTaskCard } from '../components/generation/InlineTaskCard';
import { AttachmentInfo, TranscriptItem } from '../types';
import { isTaskActive } from '../types/generation';

interface TranscriptsViewProps {
  transcripts: TranscriptItem[];
  onSendTextMessage: (text: string, attachment?: AttachmentInfo) => void;
  onClearTranscripts?: () => void;
  isConnected: boolean;
  tasks?: {
    tasks: import('../types/generation').GenerationTask[];
    recentTasks: import('../types/generation').GenerationTask[];
    onOpenActivity: (id: string) => void;
  };
}

export const TranscriptsView: React.FC<TranscriptsViewProps> = ({
  transcripts,
  onSendTextMessage,
  onClearTranscripts,
  isConnected,
  tasks,
}) => {
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<AttachmentInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const reader = new FileReader();

    if (isImage) {
      reader.onload = (event) => {
        const result = event.target?.result as string;
        const base64Data = result.split(',')[1] || '';
        setAttachment({
          name: file.name,
          type: 'image',
          mimeType: file.type || 'image/jpeg',
          dataUrl: result,
          base64: base64Data,
        });
      };
      reader.readAsDataURL(file);
    } else {
      // Read text or document file
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setAttachment({
          name: file.name,
          type: 'file',
          mimeType: file.type || 'text/plain',
          text: result,
        });
      };
      reader.readAsText(file);
    }

    // Reset input value so same file can be chosen again if needed
    e.target.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() && !attachment) return;
    onSendTextMessage(inputText.trim(), attachment || undefined);
    setInputText('');
    setAttachment(null);
  };

  return (
    <div className="flex flex-col h-full bg-[#1c1c1e]/40 rounded-3xl border border-white/5 overflow-hidden backdrop-blur-2xl">
      {/* Header */}
      <div className="px-5 py-4 bg-black/40 border-b border-white/5 flex items-center justify-between text-xs text-zinc-300">
        <div className="flex items-center gap-2 font-semibold">
          <MessageSquare className="w-4 h-4 text-[#4facfe]" />
          <span>Realtime Multimodal Chat</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-zinc-500">{transcripts.length} entries</span>
          {onClearTranscripts && transcripts.length > 0 && (
            <button
              type="button"
              onClick={onClearTranscripts}
              className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-[11px] font-medium flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
              title="Clear transcript history"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear History</span>
            </button>
          )}
        </div>
      </div>

      {/* Transcript Log List */}
      <div ref={scrollRef} className="flex-1 p-5 overflow-y-auto space-y-4 scrollbar-hide">
        {transcripts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
            <Sparkles className="w-10 h-10 text-[#00f2fe]/40 mb-3 animate-pulse" />
            <p className="text-sm font-semibold text-zinc-300">Live Multimodal Chat Ready</p>
            <p className="text-xs text-zinc-500 max-w-xs mt-1.5 leading-relaxed">
              Type a message, attach an image or document, or speak directly to Beatrice.
            </p>
          </div>
        ) : (
          transcripts.map((t) => {
            const isUser = t.role === 'user';
            const isSystem = t.role === 'system';

            if (isSystem) {
              return (
                <div key={t.id} className="text-center my-3 animate-fade-in">
                  <span className="px-3 py-1.5 rounded-full bg-white/5 text-zinc-400 text-[10px] font-mono border border-white/10 uppercase tracking-wider">
                    {t.text}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={t.id}
                className={`flex gap-3 animate-fade-in ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    isUser
                      ? 'bg-gradient-to-br from-[#00f2fe] to-[#4facfe] text-white shadow-lg'
                      : 'bg-gradient-to-br from-[#00f2fe] to-[#4facfe] text-white shadow-lg'
                  }`}
                >
                  {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                <div
                  className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed shadow-sm ${
                    isUser
                      ? 'bg-[#4facfe] text-white rounded-tr-sm'
                      : 'bg-[#121215] text-[#f2f2f7] rounded-tl-sm'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-1 text-[10px] opacity-70">
                    <span className="font-semibold">{isUser ? 'You' : 'Beatrice'}</span>
                    <span>
                      {new Date(t.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  {/* Render Attachments if present */}
                  {t.attachments && t.attachments.length > 0 && (
                    <div className="mb-2 space-y-2">
                      {t.attachments.map((att, idx) => (
                        <div key={idx} className="rounded-xl overflow-hidden">
                          {att.type === 'image' && att.dataUrl ? (
                            <img
                              src={att.dataUrl}
                              alt={att.name}
                              className="max-w-full max-h-48 rounded-lg object-cover border border-white/10"
                            />
                          ) : (
                            <div className="flex items-center gap-2 p-2 rounded-lg bg-black/30 border border-white/10 text-xs">
                              <FileText className="w-4 h-4 text-[#00f2fe]" />
                              <span className="truncate font-mono">{att.name}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {t.text && <p className="whitespace-pre-wrap">{t.text}</p>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Attachment Preview Banner if attached */}
      <div className="p-4 space-y-2">
        {tasks?.tasks
          .filter(isTaskActive)
          .slice(0, 6)
          .map((t) => (
            <InlineTaskCard key={t.id} task={t} />
          ))}
        {tasks?.recentTasks?.length > 0 && (
          <>
            <span className="text-xs text-zinc-500 capitalize">Recent</span>
            {tasks?.recentTasks
              .slice(0, 6)
              .filter(isTaskActive)
              .map((t) => (
                <InlineTaskCard key={t.id} task={t} />
              ))}
          </>
        )}
      </div>

      {attachment && (
        <div className="px-4 py-2 bg-black/80 border-t border-white/10 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 overflow-hidden">
            {attachment.type === 'image' && attachment.dataUrl ? (
              <img
                src={attachment.dataUrl}
                alt="Attachment preview"
                className="w-10 h-10 rounded-lg object-cover border border-white/20"
              />
            ) : (
              <div className="p-2 rounded-lg bg-[#121215] text-[#00f2fe]">
                <FileText className="w-5 h-5" />
              </div>
            )}
            <div className="truncate">
              <span className="font-semibold text-white block truncate">{attachment.name}</span>
              <span className="text-[10px] text-zinc-400 uppercase">
                {attachment.type === 'image' ? 'Image Attachment' : 'Document File'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAttachment(null)}
            className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Remove attachment"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.txt,.pdf,.csv,.json,.js,.py,.html,.css,.md,.ts,.tsx"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Input Form with Attachment & Image Buttons */}
      <form onSubmit={handleSubmit} className="p-3 bg-black/60 border-t border-white/5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!isConnected}
          className="p-2.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-40 transition-colors cursor-pointer shrink-0"
          title="Attach Image or File"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => {
            if (fileInputRef.current) {
              fileInputRef.current.accept = 'image/*';
              fileInputRef.current.click();
            }
          }}
          disabled={!isConnected}
          className="p-2.5 rounded-full text-zinc-400 hover:text-[#00f2fe] hover:bg-[#00f2fe]/10 disabled:opacity-40 transition-colors cursor-pointer shrink-0"
          title="Attach Image"
        >
          <ImageIcon className="w-4 h-4" />
        </button>

        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={
            isConnected
              ? attachment
                ? 'Add prompt for attachment...'
                : 'Message Beatrice...'
              : 'Connecting...'
          }
          disabled={!isConnected}
          className="flex-1 bg-[#121215] border border-transparent focus:border-[#4facfe] rounded-full px-4 py-2.5 text-[13px] text-white focus:outline-none transition-all placeholder:text-[#8e8e93] shadow-inner"
        />

        <button
          type="submit"
          disabled={!isConnected || (!inputText.trim() && !attachment)}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-[#4facfe] text-white disabled:opacity-40 disabled:bg-[#3a3a3c] hover:bg-[#3f8ffb] transition-all shrink-0 cursor-pointer"
        >
          <Send className="w-4 h-4 ml-0.5" />
        </button>
      </form>
    </div>
  );
};
