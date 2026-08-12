import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  GoogleContact,
  listGoogleContacts,
  createGoogleContact,
} from '../lib/contactsHelper';
import {
  Users,
  Search,
  Plus,
  RefreshCw,
  Mail,
  Phone,
  Building,
  Briefcase,
  Star,
  ExternalLink,
  MapPin,
  CheckCircle2,
  Copy,
  Check,
  UserCheck,
  Sparkles,
  AlertCircle,
  FileText
} from 'lucide-react';

interface ContactsToolProps {
  onSelectContact?: (contact: GoogleContact) => void;
  onSendEmail?: (email: string) => void;
}

export const ContactsTool: React.FC<ContactsToolProps> = ({
  onSelectContact,
  onSendEmail,
}) => {
  const { accessToken, user, signInWithGoogle } = useAuth();

  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'directory' | 'add'>('directory');
  const [selectedContact, setSelectedContact] = useState<GoogleContact | null>(null);

  // New Contact Form State
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newOrg, setNewOrg] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Copy Feedback State
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Load Contacts
  const handleFetchContacts = async (query = searchQuery) => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const res = await listGoogleContacts(accessToken || undefined, query);
      setContacts(res.contacts);
      if (res.contacts.length > 0 && !selectedContact) {
        setSelectedContact(res.contacts[0]);
      }
    } catch (err: any) {
      console.error('Failed to list contacts:', err);
      setErrorMessage('Unable to load Google Contacts.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    handleFetchContacts('');
  }, [accessToken]);

  // Create Contact Handler
  const handleCreate = async () => {
    if (!newName.trim() || !newEmail.trim()) {
      setErrorMessage('Please provide both full name and email address.');
      return;
    }

    setIsCreating(true);
    setCreateSuccess(false);
    setErrorMessage('');

    try {
      const res = await createGoogleContact(
        {
          name: newName,
          email: newEmail,
          phone: newPhone || undefined,
          organization: newOrg || undefined,
          title: newTitle || undefined,
          notes: newNotes || undefined,
        },
        accessToken || undefined
      );

      if (res.success && res.contact) {
        setCreateSuccess(true);
        setContacts((prev) => [res.contact!, ...prev]);
        setSelectedContact(res.contact);

        // Reset form
        setTimeout(() => {
          setCreateSuccess(false);
          setNewName('');
          setNewEmail('');
          setNewPhone('');
          setNewOrg('');
          setNewTitle('');
          setNewNotes('');
          setActiveTab('directory');
        }, 1200);
      } else {
        setErrorMessage(res.error || 'Failed to create contact.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error saving contact.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 1500);
  };

  return (
    <div className="flex flex-col gap-3 text-xs text-white">
      {/* Banner / Auth Header */}
      <div className="flex items-center justify-between p-3 rounded-2xl bg-[#00f2fe]/10 border border-[#00f2fe]/20">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#00f2fe]/20 text-[#00f2fe]">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold text-[#00f2fe]">Google People & Contacts API</div>
            <div className="text-[11px] text-[#00f2fe]/70">
              {accessToken
                ? `Connected to ${user?.email || 'Google Account'}`
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
              Authorize Contacts
            </button>
          )}
          <a
            href="https://contacts.google.com"
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 transition-all"
            title="Open Google Contacts Web App"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Sub Navigation Bar */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('directory')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold transition-all ${
              activeTab === 'directory'
                ? 'bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Contacts Directory ({contacts.length})
          </button>

          <button
            onClick={() => setActiveTab('add')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold transition-all ${
              activeTab === 'add'
                ? 'bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            Add Contact
          </button>
        </div>

        {activeTab === 'directory' && (
          <button
            onClick={() => handleFetchContacts(searchQuery)}
            disabled={isLoading}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#121215] border border-white/10 text-zinc-300 hover:bg-white/10 transition-all text-[11px]"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            Sync Contacts
          </button>
        )}
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="p-2.5 rounded-xl bg-rose-950/50 border border-rose-500/30 text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* VIEW 1: DIRECTORY & SEARCH */}
      {activeTab === 'directory' && (
        <div className="space-y-3">
          {/* Search Box */}
          <div className="flex items-center gap-2 bg-[#121215]/95 p-1.5 rounded-xl border border-white/10">
            <Search className="w-3.5 h-3.5 text-zinc-400 ml-2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFetchContacts(searchQuery)}
              placeholder="Search contacts by name, email, or company..."
              className="flex-1 bg-transparent text-zinc-200 text-xs focus:outline-none placeholder-zinc-500"
            />
            <button
              onClick={() => handleFetchContacts(searchQuery)}
              className="px-2.5 py-1 bg-gradient-to-r from-[#00f2fe] to-[#4facfe] hover:opacity-90 text-white rounded-lg text-[11px] font-medium"
            >
              Search
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {/* Contacts List Column */}
            <div className="md:col-span-2 space-y-2 max-h-[380px] overflow-y-auto pr-1 scrollbar-thin">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-500 space-y-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-[#00f2fe]" />
                  <span>Loading contacts...</span>
                </div>
              ) : contacts.length === 0 ? (
                <div className="text-center py-10 text-zinc-500">
                  No contacts found.
                </div>
              ) : (
                contacts.map((c) => {
                  const isSelected = selectedContact?.id === c.id;
                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        setSelectedContact(c);
                        if (onSelectContact) onSelectContact(c);
                      }}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center gap-3 ${
                        isSelected
                          ? 'bg-[#00f2fe]/10 border-[#00f2fe]/40'
                          : 'bg-[#121215]/70 border-white/5 hover:border-white/20'
                      }`}
                    >
                      {c.avatarUrl ? (
                        <img
                          src={c.avatarUrl}
                          alt={c.name}
                          className="w-9 h-9 rounded-full object-cover border border-[#00f2fe]/30 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-[#00f2fe]/15 border border-[#00f2fe]/30 flex items-center justify-center text-[#00f2fe] font-bold shrink-0">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-zinc-200 truncate">{c.name}</span>
                          {c.starred && <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />}
                        </div>
                        <div className="text-[11px] text-zinc-400 truncate">{c.email}</div>
                        {c.organization && (
                          <div className="text-[10px] text-[#00f2fe]/80 truncate">{c.organization}</div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Selected Contact Details Card */}
            <div className="md:col-span-3">
              {selectedContact ? (
                <div className="p-4 rounded-2xl bg-[#121215]/95 border border-white/10 space-y-4">
                  {/* Header Profile */}
                  <div className="flex items-start gap-3.5 border-b border-white/10 pb-3">
                    {selectedContact.avatarUrl ? (
                      <img
                        src={selectedContact.avatarUrl}
                        alt={selectedContact.name}
                        className="w-12 h-12 rounded-2xl object-cover border-2 border-[#00f2fe]/40 shadow-md"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-2xl bg-[#00f2fe]/15 border-2 border-[#00f2fe]/40 flex items-center justify-center text-[#00f2fe] text-base font-bold shadow-md">
                        {selectedContact.name.charAt(0).toUpperCase()}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                        {selectedContact.name}
                        {selectedContact.starred && (
                          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                        )}
                      </h3>
                      {selectedContact.title && (
                        <div className="text-zinc-300 font-medium">{selectedContact.title}</div>
                      )}
                      {selectedContact.organization && (
                        <div className="text-[#00f2fe] text-[11px] flex items-center gap-1 mt-0.5">
                          <Building className="w-3 h-3" />
                          {selectedContact.organization}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="space-y-2.5">
                    {/* Email */}
                    <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <Mail className="w-3.5 h-3.5 text-[#00f2fe] shrink-0" />
                        <span className="text-zinc-200 truncate">{selectedContact.email}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleCopy(selectedContact.email, 'email')}
                          className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-zinc-200 transition-all"
                          title="Copy Email"
                        >
                          {copiedField === 'email' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {onSendEmail && (
                          <button
                            onClick={() => onSendEmail(selectedContact.email)}
                            className="px-2 py-1 rounded-lg bg-[#00f2fe]/15 hover:bg-[#00f2fe]/30 text-[#00f2fe] font-medium text-[10px] transition-all flex items-center gap-1"
                          >
                            <Mail className="w-3 h-3" />
                            Draft Email
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Phone */}
                    {selectedContact.phone && (
                      <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5 text-[#00f2fe] shrink-0" />
                          <span className="text-zinc-200">{selectedContact.phone}</span>
                        </div>
                        <button
                          onClick={() => handleCopy(selectedContact.phone!, 'phone')}
                          className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-zinc-200 transition-all"
                          title="Copy Phone"
                        >
                          {copiedField === 'phone' ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    )}

                    {/* Address */}
                    {selectedContact.address && (
                      <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex items-center gap-2">
                        <MapPin className="w-3.5 h-3.5 text-[#00f2fe] shrink-0" />
                        <span className="text-zinc-300">{selectedContact.address}</span>
                      </div>
                    )}

                    {/* Notes */}
                    {selectedContact.notes && (
                      <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                        <div className="text-[10px] text-zinc-500 font-semibold uppercase">Notes</div>
                        <p className="text-zinc-300 leading-relaxed text-[11px]">{selectedContact.notes}</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-16 text-zinc-500 bg-[#121215]/50 rounded-2xl border border-white/5">
                  Select a contact from the directory to inspect details.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: ADD CONTACT */}
      {activeTab === 'add' && (
        <div className="p-4 rounded-2xl bg-[#121215]/95 border border-white/10 space-y-3 max-w-lg mx-auto">
          <div className="font-bold text-sm text-white flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#00f2fe]" />
            Create Google Contact
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="text-[11px] text-zinc-400 font-medium block mb-1">Full Name *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., Sarah Jenkins"
                className="w-full px-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-white text-xs focus:outline-none focus:border-[#00f2fe]"
              />
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 font-medium block mb-1">Email Address *</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="s.jenkins@company.com"
                className="w-full px-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-white text-xs focus:outline-none focus:border-[#00f2fe]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-zinc-400 font-medium block mb-1">Phone Number</label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+1 (555) 019-2834"
                  className="w-full px-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-white text-xs focus:outline-none focus:border-[#00f2fe]"
                />
              </div>

              <div>
                <label className="text-[11px] text-zinc-400 font-medium block mb-1">Organization / Company</label>
                <input
                  type="text"
                  value={newOrg}
                  onChange={(e) => setNewOrg(e.target.value)}
                  placeholder="e.g. Eburon AI Partners"
                  className="w-full px-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-white text-xs focus:outline-none focus:border-[#00f2fe]"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 font-medium block mb-1">Job Title</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Product Manager"
                className="w-full px-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-white text-xs focus:outline-none focus:border-[#00f2fe]"
              />
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 font-medium block mb-1">Notes</label>
              <textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={3}
                placeholder="Additional notes, project tags, or reference..."
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 text-white text-xs focus:outline-none focus:border-[#00f2fe] resize-none font-sans"
              />
            </div>

            <button
              onClick={handleCreate}
              disabled={isCreating || !newName.trim() || !newEmail.trim()}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#00f2fe] to-[#4facfe] hover:opacity-90 disabled:opacity-50 text-white font-semibold transition-all flex items-center justify-center gap-2 text-xs mt-2"
            >
              {isCreating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Saving to Google People API...
                </>
              ) : createSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Contact Created!
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Save Contact
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
