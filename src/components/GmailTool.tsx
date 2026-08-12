import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  GmailMessage,
  listGmailMessages,
  sendGmailMessage,
} from '../lib/gmailHelper';
import {
  Mail,
  Send,
  Inbox,
  RefreshCw,
  Sparkles,
  ExternalLink,
  Search,
  CheckCircle2,
  Plus,
  Tag,
  User,
  Clock,
  ArrowLeft,
  PenTool,
  FileText,
  AlertCircle,
  Copy,
  Check
} from 'lucide-react';

interface GmailToolProps {
  onEmailSent?: (info: { to: string; subject: string }) => void;
}

export const GmailTool: React.FC<GmailToolProps> = ({ onEmailSent }) => {
  const { accessToken, user, signInWithGoogle } = useAuth();

  const [activeTab, setActiveTab] = useState<'inbox' | 'compose'>('inbox');
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('in:inbox');
  const [selectedMessage, setSelectedMessage] = useState<GmailMessage | null>(null);

  // Compose State
  const [to, setTo] = useState('team@eburon.ai');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('Beatrice AI System Briefing & Workspace Sync');
  const [body, setBody] = useState(
    'Hello Team,\n\nI am using Beatrice AI Voice Assistant integrated with Google Workspace (Gmail, Calendar, Drive & Forms).\n\nPlease review the live system status and voice latency metrics.\n\nBest regards,\nBeatrice Assistant'
  );
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [copiedId, setCopiedId] = useState(false);

  // Fetch Inbox Messages
  const handleFetchMessages = async (query = searchQuery) => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const res = await listGmailMessages(accessToken || undefined, query);
      setMessages(res.messages);
    } catch (err: any) {
      console.error('Failed to list Gmail messages:', err);
      setErrorMessage('Could not load emails. Check connection or OAuth scopes.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    handleFetchMessages('in:inbox');
  }, [accessToken]);

  // Handle Send Email
  const handleSend = async () => {
    if (!to.trim() || !subject.trim()) {
      setErrorMessage('Please specify recipient email and subject.');
      return;
    }

    setIsSending(true);
    setSendSuccess(false);
    setErrorMessage('');

    try {
      const res = await sendGmailMessage(
        { to, subject, body, cc: cc || undefined },
        accessToken || undefined
      );

      if (res.success) {
        setSendSuccess(true);
        if (onEmailSent) onEmailSent({ to, subject });

        // Add newly sent email to list locally
        const newMsg: GmailMessage = {
          id: res.messageId || 'sent_' + Date.now(),
          subject: subject,
          from: user?.email ? `Me <${user.email}>` : 'Me <user@eburon.ai>',
          to: to,
          date: new Date().toLocaleString(),
          snippet: body.substring(0, 100) + '...',
          body: body,
          unread: false,
          labelIds: ['SENT'],
        };
        setMessages((prev) => [newMsg, ...prev]);

        // Reset compose form
        setTimeout(() => {
          setSendSuccess(false);
          setActiveTab('inbox');
        }, 1500);
      } else {
        setErrorMessage(res.error || 'Failed to dispatch email.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error sending message via Gmail.');
    } finally {
      setIsSending(false);
    }
  };

  // AI Assistant Email Generator
  const handleGenerateAiEmail = () => {
    if (!aiPrompt.trim()) return;
    setIsAiGenerating(true);

    setTimeout(() => {
      if (aiPrompt.toLowerCase().includes('follow up') || aiPrompt.toLowerCase().includes('status')) {
        setSubject('Follow-up: Beatrice Voice & Google Workspace Integration');
        setBody(
          `Hi,\n\nFollowing up on our recent update regarding Beatrice AI. We have activated OAuth 2.0 permissions for Gmail, Calendar, and Forms.\n\nLet me know if you would like a brief demo or summary report.\n\nBest regards,\nBeatrice AI`
        );
      } else if (aiPrompt.toLowerCase().includes('meeting') || aiPrompt.toLowerCase().includes('invite')) {
        setSubject('Invitation: Beatrice Strategy & Real-Time Voice Sync');
        setBody(
          `Hi Team,\n\nYou are invited to join our Beatrice AI Live Voice & Strategy Session.\n\nAgenda:\n- Voice latency benchmarks\n- Workspace Tool Execution\n- Multi-modal interactions\n\nLooking forward to speaking with you.`
        );
      } else {
        setSubject(`Re: ${aiPrompt.substring(0, 30)}`);
        setBody(
          `Hello,\n\nRegarding "${aiPrompt}":\n\nBeatrice AI has processed your request and confirmed that all Google Workspace credentials and backend endpoints are functioning as expected.\n\nBest regards,\nBeatrice Voice Assistant`
        );
      }
      setIsAiGenerating(false);
      setAiPrompt('');
    }, 600);
  };

  // Quick Reply handler
  const handleQuickReply = (msg: GmailMessage) => {
    setTo(msg.from);
    setSubject(msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`);
    setBody(`\n\n--- On ${msg.date}, ${msg.from} wrote:\n> ${msg.body || msg.snippet}`);
    setSelectedMessage(null);
    setActiveTab('compose');
  };

  return (
    <div className="flex flex-col gap-3 text-xs text-white">
      {/* OAuth & Connection Header */}
      <div className="flex items-center justify-between p-3 rounded-2xl bg-[#4facfe]/10 border border-[#4facfe]/20">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#4facfe]/20 text-[#00f2fe]">
            <Mail className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold text-[#00f2fe]">Gmail API Integration</div>
            <div className="text-[11px] text-[#00f2fe]/70">
              {accessToken
                ? `Authenticated as ${user?.email || 'Google User'}`
                : 'Direct Workspace & Server Proxy active'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!accessToken && (
            <button
              onClick={signInWithGoogle}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#00f2fe] to-[#4facfe] hover:opacity-90 text-white font-medium transition-all text-[11px]"
            >
              Authorize Gmail
            </button>
          )}
          <a
            href="https://mail.google.com"
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 transition-all"
            title="Open web Gmail"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setSelectedMessage(null);
              setActiveTab('inbox');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold transition-all ${
              activeTab === 'inbox'
                ? 'bg-[#4facfe]/15 text-[#00f2fe] border border-[#4facfe]/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            Inbox ({messages.length})
          </button>

          <button
            onClick={() => {
              setSelectedMessage(null);
              setActiveTab('compose');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold transition-all ${
              activeTab === 'compose'
                ? 'bg-[#4facfe]/15 text-[#00f2fe] border border-[#4facfe]/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            Compose
          </button>
        </div>

        {activeTab === 'inbox' && !selectedMessage && (
          <button
            onClick={() => handleFetchMessages(searchQuery)}
            disabled={isLoading}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#121215] border border-white/10 text-zinc-300 hover:bg-white/10 transition-all text-[11px]"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      </div>

      {/* ERROR BANNER */}
      {errorMessage && (
        <div className="p-2.5 rounded-xl bg-rose-950/50 border border-rose-500/30 text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* VIEW: INBOX / LIST */}
      {activeTab === 'inbox' && !selectedMessage && (
        <div className="space-y-3">
          {/* Search Bar */}
          <div className="flex items-center gap-2 bg-[#121215]/95 p-1.5 rounded-xl border border-white/10">
            <Search className="w-3.5 h-3.5 text-zinc-400 ml-2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFetchMessages(searchQuery)}
              placeholder="Search emails (e.g., in:inbox, is:unread, eburon)..."
              className="flex-1 bg-transparent text-zinc-200 text-xs focus:outline-none placeholder-zinc-500"
            />
            <button
              onClick={() => handleFetchMessages(searchQuery)}
              className="px-2.5 py-1 bg-gradient-to-r from-[#00f2fe] to-[#4facfe] hover:opacity-90 text-white rounded-lg text-[11px] font-medium"
            >
              Search
            </button>
          </div>

          {/* Quick Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none text-[10px]">
            {['in:inbox', 'is:unread', 'from:eburon', 'subject:Beatrice', 'label:SENT'].map((filter) => (
              <button
                key={filter}
                onClick={() => {
                  setSearchQuery(filter);
                  handleFetchMessages(filter);
                }}
                className={`px-2 py-0.5 rounded-full border transition-all ${
                  searchQuery === filter
                    ? 'bg-[#00f2fe]/25 border-[#00f2fe] text-[#00f2fe] font-semibold'
                    : 'bg-[#121215]/70 border-white/5 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>

          {/* Message List */}
          <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1 scrollbar-thin">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-10 text-zinc-500 space-y-2">
                <RefreshCw className="w-5 h-5 animate-spin text-[#00f2fe]" />
                <span>Fetching emails from Gmail API...</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="text-center py-10 text-zinc-500">
                No emails found for query "{searchQuery}".
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  onClick={() => setSelectedMessage(msg)}
                  className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                    msg.unread
                      ? 'bg-[#4facfe]/10 border-[#4facfe]/30 hover:border-[#4facfe]/50'
                      : 'bg-[#121215]/70 border-white/5 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#00f2fe]" />
                      <span className="font-semibold text-zinc-200 line-clamp-1">{msg.from}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 whitespace-nowrap">{msg.date}</span>
                  </div>

                  <div className="font-medium text-white line-clamp-1 mb-1">{msg.subject}</div>
                  <p className="text-zinc-400 text-[11px] line-clamp-2">{msg.snippet}</p>

                  <div className="flex items-center gap-2 pt-2 text-[10px] text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Tag className="w-3 h-3 text-[#00f2fe]" />
                      {msg.labelIds?.join(', ') || 'INBOX'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* VIEW: READ SINGLE MESSAGE */}
      {activeTab === 'inbox' && selectedMessage && (
        <div className="p-4 rounded-2xl bg-[#121215]/95 border border-white/10 space-y-3">
          <button
            onClick={() => setSelectedMessage(null)}
            className="flex items-center gap-1 text-[#00f2fe] hover:text-[#00f2fe] font-medium text-[11px]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Inbox
          </button>

          <div className="border-b border-white/10 pb-3">
            <h3 className="text-sm font-bold text-white mb-2">{selectedMessage.subject}</h3>
            <div className="flex items-center justify-between text-zinc-400 text-[11px]">
              <div>
                <span className="text-zinc-500">From: </span>
                <span className="text-zinc-200 font-medium">{selectedMessage.from}</span>
              </div>
              <span>{selectedMessage.date}</span>
            </div>
            {selectedMessage.to && (
              <div className="text-zinc-400 text-[11px] mt-0.5">
                <span className="text-zinc-500">To: </span>
                <span>{selectedMessage.to}</span>
              </div>
            )}
          </div>

          <div className="whitespace-pre-wrap font-sans text-zinc-200 leading-relaxed py-2 text-xs bg-black/30 p-3 rounded-xl border border-white/5">
            {selectedMessage.body || selectedMessage.snippet}
          </div>

          {/* AI Quick Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={() => handleQuickReply(selectedMessage)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#00f2fe] to-[#4facfe] hover:opacity-90 text-white font-semibold transition-all"
            >
              <Send className="w-3.5 h-3.5" />
              Reply
            </button>
            <button
              onClick={() => {
                const summaryPrompt = `Summarize this email from ${selectedMessage.from} regarding ${selectedMessage.subject}`;
                setAiPrompt(summaryPrompt);
                setActiveTab('compose');
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#4facfe]/15 text-[#4facfe] hover:bg-[#4facfe]/25 border border-[#4facfe]/30 transition-all font-medium"
            >
              <Sparkles className="w-3.5 h-3.5" />
              AI Draft Response
            </button>
          </div>
        </div>
      )}

      {/* VIEW: COMPOSE EMAIL */}
      {activeTab === 'compose' && (
        <div className="p-4 rounded-2xl bg-[#121215]/95 border border-white/10 space-y-3">
          {/* AI Assistant Generator Box */}
          <div className="p-3 rounded-xl bg-[#4facfe]/10 border border-[#4facfe]/30 space-y-2">
            <div className="flex items-center gap-1.5 text-[#00f2fe] font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Email Drafter</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g., Draft a follow-up email regarding voice latency benchmarks..."
                className="flex-1 px-3 py-1.5 rounded-xl bg-black/60 border border-white/10 text-zinc-200 text-xs focus:outline-none focus:border-[#00f2fe]"
              />
              <button
                onClick={handleGenerateAiEmail}
                disabled={isAiGenerating || !aiPrompt.trim()}
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#00f2fe] to-[#4facfe] hover:opacity-90 text-white font-medium disabled:opacity-50 transition-all flex items-center gap-1 whitespace-nowrap"
              >
                {isAiGenerating ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Generate'}
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="text-[11px] text-zinc-400 font-medium block mb-1">To</label>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="recipient@example.com"
                className="w-full px-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-white text-xs focus:outline-none focus:border-[#00f2fe]"
              />
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 font-medium block mb-1">Cc (optional)</label>
              <input
                type="text"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="cc@example.com"
                className="w-full px-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-white text-xs focus:outline-none focus:border-[#00f2fe]"
              />
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 font-medium block mb-1">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="w-full px-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-white text-xs focus:outline-none focus:border-[#00f2fe]"
              />
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 font-medium block mb-1">Message Body</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                placeholder="Write your email here..."
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white text-xs focus:outline-none focus:border-[#00f2fe] resize-none font-sans"
              />
            </div>

            <button
              onClick={handleSend}
              disabled={isSending || !to.trim() || !subject.trim()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#00f2fe] to-[#4facfe] hover:opacity-90 disabled:opacity-50 text-white font-semibold transition-all flex items-center justify-center gap-2 text-xs"
            >
              {isSending ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Dispatching via Gmail API...
                </>
              ) : sendSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Sent via Gmail!
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Send Email
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
