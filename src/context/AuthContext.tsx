import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth, googleProvider, db, GOOGLE_SCOPES, oAuthClientId } from '../lib/firebase';
import { ref, update, remove, get } from 'firebase/database';

const TOKEN_STORAGE_KEY = 'beatrice_google_access_token';

// Renewal uses ONLY the Firebase-managed OAuth client (oAuthClientId): Firebase
// auto-syncs its authorized JavaScript origins from the Firebase Auth
// "Authorized domains" list (oss.eburon.ai is registered there), so the silent
// `prompt: ''` flow never surfaces a popup. The manual web client from
// google-web-credentials.json has NO registered origins and makes Google show
// an "Access blocked / 401 invalid_client" card — it must not be used for
// silent renewal on this origin.

interface GsiTokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; error?: string }) => void;
          }) => GsiTokenClient;
        };
      };
    };
  }
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  accessToken: string | null;
  explicitlyAuthenticated: boolean;
  isNewUser: boolean;
  signInWithGoogle: () => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  accessToken: null,
  explicitlyAuthenticated: false,
  isNewUser: false,
  signInWithGoogle: async () => {},
  signUpWithEmail: async () => {},
  signInWithEmail: async () => {},
  resetPassword: async () => {},
  logout: async () => {},
});

function loadPersistedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function clearPersistedToken() {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// Load the Google Identity Services script (used only for silent token
// renewal). Resolves false on load failure/timeout so boot never hangs.
function loadGsiScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false);
      return;
    }
    if (window.google?.accounts?.oauth2) {
      resolve(true);
      return;
    }
    const existing = document.getElementById('gsi-client-script') as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === '1') {
        resolve(true);
        return;
      }
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }
    const s = document.createElement('script');
    s.id = 'gsi-client-script';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      s.dataset.loaded = '1';
      resolve(true);
    };
    s.onerror = () => resolve(false);
    setTimeout(() => resolve(false), 8000);
    document.head.appendChild(s);
  });
}

// Silently renew the Google OAuth access token via GIS (`prompt: ''` never
// shows UI). Returns a fresh token or null if the user's Google session /
// prior consent can't produce one silently.
async function silentlyRenewGoogleToken(): Promise<string | null> {
  const loaded = await loadGsiScript();
  if (!loaded) return null;
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) return null;
  const clientIds = Array.from(new Set([oAuthClientId].filter(Boolean)));
  for (const clientId of clientIds) {
    const token = await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const tokenClient = oauth2.initTokenClient({
          client_id: clientId,
          scope: GOOGLE_SCOPES.join(' '),
          // Errors (e.g. no consent) arrive via the callback with resp.error;
          // an unregistered origin would make Google render its own popup, so
          // only clients whose origin is registered should ever be tried.
          callback: (resp) => {
            if (resp?.error) {
              finish(null);
              return;
            }
            finish(resp?.access_token || null);
          },
        });
        tokenClient.requestAccessToken({ prompt: '' });
        // Safety net: if the callback never fires, don't block the boot.
        setTimeout(() => finish(null), 10000);
      } catch {
        finish(null);
      }
    });
    if (token) return token;
  }
  return null;
}

// Restore the per-user Google access token from the RTDB backup
// (google_tokens/{uid}, written by persistAccessToken on every grant).
async function restoreTokenFromRtdb(uid: string): Promise<string | null> {
  try {
    const snap = await get(ref(db, `google_tokens/${uid}`));
    const val = snap.val();
    if (val && typeof val.accessToken === 'string' && val.accessToken) {
      return val.accessToken;
    }
  } catch (err) {
    console.warn('Token restore from RTDB failed:', err);
  }
  return null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [accessToken, setAccessToken] = useState<string | null>(() => loadPersistedToken());
  const [explicitlyAuthenticated, setExplicitlyAuthenticated] = useState<boolean>(false);
  // True when the signed-in account was created in this session (fresh
  // registration) — used to route new users to the WhatsApp integration step.
  const [isNewUser, setIsNewUser] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setAccessToken(null);
        clearPersistedToken();
        setExplicitlyAuthenticated(false);
        return;
      }
      // Auto-login returning users: a silently restored Firebase session
      // passes the gate instead of forcing the AuthPage again. The Google
      // access token is restored (localStorage → RTDB backup) and silently
      // renewed via GIS so workspace tools keep working on return visits.
      setExplicitlyAuthenticated(true);
      let token = loadPersistedToken();
      if (!token) {
        token = await restoreTokenFromRtdb(currentUser.uid);
        if (token) {
          setAccessToken(token);
          try {
            localStorage.setItem(TOKEN_STORAGE_KEY, token);
          } catch {
            // ignore
          }
        }
      }
      const renewed = await silentlyRenewGoogleToken();
      if (renewed) {
        void persistAccessToken(renewed).catch(() => {
          // renewal already saved to localStorage; RTDB backup failure is non-fatal
        });
      }
    });

    // Resume a full-page Google redirect (used when popups are blocked):
    // the user lands back on the app after granting permissions, so
    // finalize the sign-in and let the gate flip to the main page.
    getRedirectResult(auth)
      .then(async (result) => {
        if (result) {
          const credential = GoogleAuthProvider.credentialFromResult(result);
          if (credential?.accessToken) {
            await persistAccessToken(credential.accessToken);
          }
          setExplicitlyAuthenticated(true);
          const isFresh = result.user.metadata?.creationTime === result.user.metadata?.lastSignInTime;
          setIsNewUser(!!isFresh);
        }
      })
      .catch((err) => console.error('Redirect sign-in result error:', err));

    // Only reveal the app once Firebase has restored any persisted session
    // (or confirmed there is none). Without this, `loading` could flip false
    // before onAuthStateChanged fires and the login page would flash while
    // the session is being restored on refresh/restart.
    auth
      .authStateReady()
      .catch((err) => console.error('authStateReady error:', err))
      .finally(() => setLoading(false));

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the Google OAuth access token (localStorage + RTDB per-UID backup)
  // so the agent can CRUD Google services across sessions.
  const persistAccessToken = async (token: string | null) => {
    setAccessToken(token);
    if (token) {
      try {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      } catch {
        // ignore
      }
    } else {
      clearPersistedToken();
    }
    const u = auth.currentUser;
    if (u && token) {
      try {
        await update(ref(db, `google_tokens/${u.uid}`), {
          accessToken: token,
          updatedAt: Date.now(),
          email: u.email || null,
        });
      } catch (err) {
        console.warn('Token persist to RTDB failed:', err);
      }
    } else if (u) {
      try {
        await remove(ref(db, `google_tokens/${u.uid}`));
      } catch (err) {
        console.warn('Token clear from RTDB failed:', err);
      }
    }
  };

  const signInWithGoogle = async () => {
    try {
      let result: Awaited<ReturnType<typeof signInWithPopup>>;
      try {
        result = await signInWithPopup(auth, googleProvider);
      } catch (err: any) {
        const code = err?.code || '';
        // Popups get blocked in iframes / embedded contexts: fall back to a
        // full-page redirect. On return, getRedirectResult resumes the sign-in.
        if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request') {
          await signInWithRedirect(auth, googleProvider);
          return;
        }
        throw err;
      }
      const credential = GoogleAuthProvider.credentialFromResult(result);
      // Flip the gate immediately so the main page shows right away; the
      // token persistence runs in the background.
      setExplicitlyAuthenticated(true);
      // Fresh Google account (just created) → route to WhatsApp integration.
      const isFresh = result.user.metadata?.creationTime === result.user.metadata?.lastSignInTime;
      setIsNewUser(!!isFresh);
      if (credential?.accessToken) {
        void persistAccessToken(credential.accessToken).catch(() => {
          // token already saved to localStorage; RTDB backup failure is non-fatal
        });
      }
    } catch (err) {
      console.error('Google Sign In Error:', err);
      throw err;
    }
  };

  const logout = async () => {
    try {
      const uid = auth.currentUser?.uid || null;
      await signOut(auth);
      setAccessToken(null);
      clearPersistedToken();
      setExplicitlyAuthenticated(false);
      if (uid) {
        try {
          await remove(ref(db, `google_tokens/${uid}`));
        } catch (err) {
          console.warn('Token clear from RTDB failed:', err);
        }
      }
    } catch (err) {
      console.error('Sign Out Error:', err);
    }
  };

  const signUpWithEmail = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
    setIsNewUser(true);
    setExplicitlyAuthenticated(true);
  };

  const signInWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    setExplicitlyAuthenticated(true);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        accessToken,
        explicitlyAuthenticated,
        isNewUser,
        signInWithGoogle,
        signUpWithEmail,
        signInWithEmail,
        resetPassword,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
