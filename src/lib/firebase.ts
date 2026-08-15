import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getStorage, ref, uploadString, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
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
googleProvider.addScope('https://www.googleapis.com/auth/drive');
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');
googleProvider.addScope('https://www.googleapis.com/auth/drive.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/forms.body');
googleProvider.addScope('https://www.googleapis.com/auth/forms.body.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/forms.responses.readonly');
googleProvider.addScope('https://mail.google.com/');
googleProvider.addScope('https://www.googleapis.com/auth/gmail.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/gmail.send');
googleProvider.addScope('https://www.googleapis.com/auth/gmail.compose');
googleProvider.addScope('https://www.googleapis.com/auth/gmail.modify');
googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
googleProvider.addScope('https://www.googleapis.com/auth/calendar');
googleProvider.addScope('https://www.googleapis.com/auth/tasks');
googleProvider.addScope('https://www.googleapis.com/auth/contacts');
googleProvider.addScope('https://www.googleapis.com/auth/documents');

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
  const fileName = `${path}/${timestamp}.${contentType.split('/')[1]}`;
  const fileRef = ref(storage, fileName);
  await uploadString(fileRef, base64Data, 'data_url' as const);
  const downloadUrl = await getDownloadURL(fileRef);
  return downloadUrl;
}
