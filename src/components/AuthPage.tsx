import React, { useState } from 'react';
import { Loader2, Mail, Lock, KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import iconEburon from '../assets/icon-eburon.svg';

const GoogleG: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z"
    />
    <path
      fill="#FBBC05"
      d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
    />
  </svg>
);

interface AuthPageProps {
  onSkip: () => void;
}

const authErrorText = (err: unknown): string => {
  const code = (err as { code?: string })?.code || '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'This email is already registered.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/user-not-found':
      return 'No account found with this email.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/operation-not-allowed':
      return 'Email sign-in is not enabled for this app.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again later.';
    default:
      return 'Something went wrong. Please try again.';
  }
};

export const AuthPage: React.FC<AuthPageProps> = ({ onSkip }) => {
  const { signInWithGoogle, signUpWithEmail, signInWithEmail, resetPassword } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetMode) {
      if (!email) {
        setError('Enter your email address.');
        return;
      }
      setBusy('email');
      setError(null);
      try {
        await resetPassword(email);
        setResetSent(true);
      } catch (err) {
        const code = (err as { code?: string })?.code || '';
        // Do not reveal whether the account exists.
        if (code === 'auth/user-not-found') {
          setResetSent(true);
        } else {
          setError(authErrorText(err));
          console.error('AuthPage reset error:', err);
        }
      } finally {
        setBusy(null);
      }
      return;
    }
    if (!email || !password) {
      setError('Enter your email and password.');
      return;
    }
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy('email');
    setError(null);
    try {
      if (mode === 'signup') {
        await signUpWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err) {
      setError(authErrorText(err));
      console.error('AuthPage email error:', err);
    } finally {
      setBusy(null);
    }
  };

  const handleGoogle = async () => {
    setBusy('google');
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError('Google sign-in failed. Please try again.');
      console.error('AuthPage google error:', err);
    } finally {
      setBusy(null);
    }
  };

  const inputCls =
    'w-full h-[48px] rounded-xl bg-white/5 border border-white/10 focus:border-[#00f2fe]/60 text-white text-sm px-4 pl-11 focus:outline-none placeholder:text-[#8e8e93] transition-colors';

  return (
    <div className="w-full h-full flex flex-col items-center justify-between bg-[#050505] relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-[15%] left-1/2 -translate-x-1/2 w-[300px] h-[300px] bg-[radial-gradient(circle,rgba(0,242,254,0.12)_0%,transparent_70%)] pointer-events-none" />

      {/* Brand */}
      <div className="relative flex flex-col items-center pt-16 space-y-4">
        <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-[#00f2fe] via-[#4facfe] to-[#8e44ad] p-[3px] shadow-xl shadow-[#00f2fe]/20">
          <img
            src={iconEburon}
            alt="Beatrice"
            className="w-full h-full rounded-full object-cover"
            draggable={false}
          />
        </div>
        <div className="text-center space-y-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
            Beatrice
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#00f2fe]/15 text-[#00f2fe] border border-[#00f2fe]/30">
              OSS
            </span>
          </h1>
          <p className="text-xs text-[#8e8e93]">Your AI voice assistant</p>
        </div>
      </div>

      {/* Auth Form */}
      <div className="relative w-full px-8 pb-12 space-y-4">
        {/* Mode Toggle */}
        <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/5 border border-white/10">
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setResetMode(false);
                setResetSent(false);
                setConfirmPassword('');
                setError(null);
              }}
              className={`flex-1 h-10 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                mode === m
                  ? 'bg-gradient-to-r from-[#00f2fe] to-[#4facfe] text-white shadow-lg shadow-[#00f2fe]/20'
                  : 'text-[#8e8e93] hover:text-white'
              }`}
            >
              {m === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-3">
          {!resetMode && (
            <>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#8e8e93] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  autoComplete="email"
                  className={inputCls}
                />
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#8e8e93] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  className={inputCls}
                />
              </div>
              {mode === 'signup' && (
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#8e8e93] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    autoComplete="new-password"
                    className={inputCls}
                  />
                </div>
              )}
            </>
          )}
          {resetMode && (
            <div className="relative">
              <Mail className="w-4 h-4 text-[#8e8e93] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                autoComplete="email"
                className={inputCls}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={busy !== null}
            className="w-full h-[52px] rounded-2xl bg-gradient-to-r from-[#00f2fe] to-[#4facfe] text-white font-semibold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-[#00f2fe]/20 transition-all active:scale-[0.98] disabled:opacity-70 cursor-pointer"
          >
            {busy === 'email' ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : resetMode ? (
              <Mail className="w-4 h-4" />
            ) : (
              <KeyRound className="w-4 h-4" />
            )}
            {busy === 'email'
              ? resetMode
                ? 'Sending reset link...'
                : mode === 'signup'
                  ? 'Creating account...'
                  : 'Signing in...'
              : resetMode
                ? 'Send Reset Link'
                : mode === 'signup'
                  ? 'Create Account'
                  : 'Sign In'}
          </button>

          {resetSent ? (
            <p className="text-center text-[11px] text-emerald-400">
              If an account exists for {email}, a password reset link has been sent. Check your inbox.
            </p>
          ) : resetMode ? (
            <button
              type="button"
              onClick={() => {
                setResetMode(false);
                setResetSent(false);
                setError(null);
              }}
              className="w-full text-center text-xs text-[#8e8e93] hover:text-white transition-colors py-1 cursor-pointer"
            >
              Back to sign in
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setResetMode(true);
                setError(null);
              }}
              className="w-full text-center text-xs text-[#8e8e93] hover:text-white transition-colors py-1 cursor-pointer"
            >
              Forgot password?
            </button>
          )}
        </form>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] uppercase tracking-widest text-[#8e8e93] font-mono">
            or
          </span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy !== null}
          className="w-full h-[52px] rounded-2xl bg-white text-[#1c1c1e] font-semibold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-white/10 transition-all active:scale-[0.98] disabled:opacity-70 cursor-pointer"
        >
          {busy === 'google' ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <GoogleG className="w-5 h-5" />
          )}
          {busy === 'google' ? 'Signing in...' : 'Continue with Google'}
        </button>

        <button
          type="button"
          onClick={onSkip}
          className="w-full text-center text-xs text-[#8e8e93] hover:text-white transition-colors py-1 cursor-pointer"
        >
          Continue as guest
        </button>

        {error && <p className="text-center text-[11px] text-rose-400">{error}</p>}
      </div>
    </div>
  );
};