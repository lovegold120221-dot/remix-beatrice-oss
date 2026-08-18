import type { NextFunction, Request, Response } from 'express';
import { logger } from './logger.js';

// Firebase ID-token verification for the server. The client (React SPA) signs
// in via Firebase Auth and sends its ID token; we verify it here against
// Google's public JWKS using `jose` directly.
//
// NOTE: we deliberately do NOT use firebase-admin/auth.verifyIdToken() here.
// firebase-admin's auth module pulls in jwks-rsa, which does a CommonJS
// require() of the ESM-only `jose` package and crashes under the production
// esbuild CJS bundle ("require() of ES Module ... not supported"). Verifying
// with `jose` directly is equivalent (same JWKS, same RS256 algorithm) and
// bundle-safe.

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'beatrice-os';

// Google's public JWKS endpoint for Firebase Auth. Tokens are signed with
// RS256; the public keys are published here and rotated automatically.
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let jwks: any = null;

// Lazily load `jose` via dynamic import(). jose is ESM-only; a static import
// would be emitted as require('jose') in the CJS bundle (which works on Node 22
// but is fragile), so we import it dynamically to be safe across runtimes.
async function getJose() {
  return await import('jose');
}

async function getJwks() {
  if (!jwks) {
    const { createRemoteJWKSet } = await getJose();
    jwks = createRemoteJWKSet(new URL(JWKS_URL));
  }
  return jwks;
}

export interface AuthUser {
  uid: string;
  email: string | null;
}

// Verify a raw Firebase ID token string. Returns the authenticated user, or
// null if the token is missing/invalid/expired. Throws only on unexpected
// infrastructure errors (network failure reaching JWKS).
export async function verifyIdToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  try {
    const { jwtVerify } = await getJose();
    const { payload } = await jwtVerify(token, await getJwks(), {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      algorithms: ['RS256'],
    });
    // Firebase ID tokens carry the user id in `sub` and email in `email`.
    const uid = payload.sub;
    if (!uid) return null;
    const email = typeof payload.email === 'string' ? payload.email : null;
    return { uid, email };
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
// user to res.locals.authUser (and req.authUser) for downstream handlers.
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
