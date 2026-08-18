import fs from 'fs';
import type { NextFunction, Request, Response } from 'express';
import { logger } from './logger.js';

// Firebase ID-token verification for the server. The client (React SPA) signs
// in via Firebase Auth and sends its ID token; we verify it here with the
// firebase-admin SDK so every REST route and WebSocket connection is bound to
// a real, authenticated Firebase user instead of trusting client-supplied
// uid/email headers (which are trivially spoofable).

let adminApp: any = null;
let adminAuth: any = null;
let initError: string | null = null;

function serviceAccountPath(): string {
  return (
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    '/opt/beatrice-services/beatrice-os-service-account.json'
  );
}

async function ensureAdmin(): Promise<any> {
  if (adminAuth) return adminAuth;
  if (initError) throw new Error(initError);

  const saPath = serviceAccountPath();
  if (!fs.existsSync(saPath)) {
    initError = `Firebase service account not found at ${saPath}`;
    throw new Error(initError);
  }

  try {
    const appMod: any = await import('firebase-admin/app');
    const authMod: any = await import('firebase-admin/auth');
    if (!appMod.getApps?.().length) {
      adminApp = appMod.initializeApp({
        credential: appMod.cert(saPath),
      });
    } else {
      adminApp = appMod.getApps()[0];
    }
    adminAuth = authMod.getAuth(adminApp);
    return adminAuth;
  } catch (err: any) {
    initError = err?.message || String(err);
    logger.error({ err: initError }, 'firebase-admin init failed');
    throw new Error(initError);
  }
}

export interface AuthUser {
  uid: string;
  email: string | null;
}

// Verify a raw ID token string. Returns the authenticated user, or null if the
// token is missing/invalid. Throws only on infrastructure errors (no SA file).
export async function verifyIdToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  try {
    const auth = await ensureAdmin();
    const decoded = await auth.verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email || null };
  } catch (err: any) {
    // Invalid/expired token is a normal auth failure, not an infra error.
    logger.warn({ err: err?.message || String(err) }, 'ID token verification failed');
    return null;
  }
}

// Extract a bearer token from an Authorization header.
export function bearerToken(req: Request): string | null {
  const header = req.headers['authorization'] || '';
  if (typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

// Whether auth enforcement is enabled. Defaults to ON in production; can be
// disabled via AUTH_DISABLED=1 for local development without Firebase.
export function authEnabled(): boolean {
  return process.env.AUTH_DISABLED !== '1';
}

// Express middleware: reject unauthenticated requests. Attaches the verified
// user to res.locals.authUser for downstream handlers.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!authEnabled()) {
    next();
    return;
  }
  verifyIdToken(bearerToken(req))
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      (res.locals as any).authUser = user;
      (req as any).authUser = user;
      next();
    })
    .catch((err) => {
      logger.error({ err: err?.message || String(err) }, 'auth middleware error');
      res.status(500).json({ error: 'Authentication service unavailable' });
    });
}
