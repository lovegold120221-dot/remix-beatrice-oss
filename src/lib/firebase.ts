import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getStorage, ref, uploadString, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Persist the Firebase session across page loads / tab restarts (localStorage)
// so returning users are never logged out on refresh. Without this the SDK's
// default can effectively fall back to session/memory persistence in some
// flows (e.g. redirect sign-in inside embedded iframes), which drops the
// session and sends users back to the AuthPage on every reload.
setPersistence(auth, browserLocalPersistence).catch((err) =>
  console.warn('Failed to set Firebase auth persistence to localStorage:', err)
);
export const googleProvider = new GoogleAuthProvider();

// Always show the Google consent screen and request Google services
// permissions (Gmail/Drive/Calendar/Forms/etc.) on every sign-in, so the
// access token we persist carries the scopes the agent needs for CRUD.
googleProvider.setCustomParameters({
  prompt: 'consent',
  access_type: 'offline',
});

// OAuth client ID from Google Cloud (for reference / future use)
export const oAuthClientId = (firebaseConfig as any).oAuthClientId || '112636717363-jc7shven29f6v0014h5f11mjt9bhl0hp.apps.googleusercontent.com';
// Scopes the workspace tools need (Gmail/Drive/Calendar/Forms/...). Shared
// with the GIS silent token renewal in AuthContext so both paths request the
// exact same consent.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.body.readonly',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/documents',
];
for (const scope of GOOGLE_SCOPES) googleProvider.addScope(scope);

export async function testConnection() {
  try {
    const { ref, get } = await import('firebase/database');
    await get(ref(db, '.info/connected'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Firebase client appears offline.");
    }
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirebaseErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirebaseError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirebaseErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path,
  };
  console.error('Firebase Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function uploadMediaToFirebaseStorage(
  base64Data: string,
  contentType: string,
  path: string = 'media'
): Promise<string> {
  const timestamp = Date.now().toString(36);
  // contentType may be "video/mp4" or a bare extension like "mp4" — derive a
  // safe file extension either way (a bare "mp4" used to yield ".undefined").
  const ext = contentType.includes('/') ? (contentType.split('/').pop() || 'bin') : contentType || 'bin';
  const fileName = `${path}/${timestamp}.${ext}`;
  const fileRef = ref(storage, fileName);
  await uploadString(fileRef, base64Data, 'data_url' as const);
  const downloadUrl = await getDownloadURL(fileRef);
  return downloadUrl;
}
