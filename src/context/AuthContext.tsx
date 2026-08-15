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
} from 'firebase/auth';
import { auth, googleProvider, db } from '../lib/firebase';
import { ref, update, remove } from 'firebase/database';

const TOKEN_STORAGE_KEY = 'beatrice_google_access_token';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  accessToken: string | null;
  explicitlyAuthenticated: boolean;
  signInWithGoogle: () => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  accessToken: null,
  explicitlyAuthenticated: false,
  signInWithGoogle: async () => {},
  signUpWithEmail: async () => {},
  signInWithEmail: async () => {},
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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [accessToken, setAccessToken] = useState<string | null>(() => loadPersistedToken());
  const [explicitlyAuthenticated, setExplicitlyAuthenticated] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setAccessToken(null);
        clearPersistedToken();
        setExplicitlyAuthenticated(false);
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
        }
      })
      .catch((err) => console.error('Redirect sign-in result error:', err))
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
    setExplicitlyAuthenticated(true);
  };

  const signInWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
    setExplicitlyAuthenticated(true);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        accessToken,
        explicitlyAuthenticated,
        signInWithGoogle,
        signUpWithEmail,
        signInWithEmail,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
