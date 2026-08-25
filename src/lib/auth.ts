import { cookies } from 'next/headers';
import crypto from 'crypto';

const SECRET_SALT = process.env.MONGODB_URI || 'default_diet_salt';

/** Sessions older than this are rejected even if the signature still verifies. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Login attempts allowed per IP inside one window before locking out. */
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Per-instance signing key. Derived from the app password, so changing the
 * password (or the Mongo URI) invalidates every issued session.
 */
function signingKey(): Buffer {
  const password = process.env.APP_PASSWORD || 'admin123';
  return crypto.createHmac('sha256', SECRET_SALT).update(password).digest();
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', signingKey()).update(payload).digest('hex');
}

/** Compare two strings without leaking their contents through timing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Check a submitted password against APP_PASSWORD in constant time.
 */
export function verifyPassword(submitted: unknown): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  if (typeof submitted !== 'string') return false;
  return safeEqual(submitted, expected);
}

/**
 * Mint a fresh session token: `issuedAt.nonce.signature`.
 *
 * Unlike a bare HMAC of the password, this rotates per login and carries its
 * own issue time, so a leaked cookie stops working after SESSION_TTL_MS.
 */
export function createSessionToken(): string {
  const issuedAt = Date.now().toString(36);
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${issuedAt}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a session token's signature and age.
 */
export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [issuedAt, nonce, signature] = parts;
  if (!safeEqual(signature, sign(`${issuedAt}.${nonce}`))) return false;

  const issuedAtMs = parseInt(issuedAt, 36);
  if (!Number.isFinite(issuedAtMs)) return false;
  const age = Date.now() - issuedAtMs;
  return age >= 0 && age < SESSION_TTL_MS;
}

/**
 * Checks if the request contains a valid session cookie.
 */
export async function isAuthenticated(): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  // If APP_PASSWORD is not set, we require no authentication (for local dev convenience)
  // but warn in console.
  if (!password) {
    console.warn('WARNING: APP_PASSWORD environment variable is not set. Security is disabled.');
    return true;
  }

  try {
    const cookieStore = await cookies();
    return verifySessionToken(cookieStore.get('diet_session')?.value);
  } catch (error) {
    console.error('Error verifying authentication:', error);
    return false;
  }
}

/**
 * Clears the session cookie.
 */
export async function logoutUser() {
  const cookieStore = await cookies();
  cookieStore.delete('diet_session');
}

// -------------------------------------------------------------
// LOGIN RATE LIMITING
// -------------------------------------------------------------
// In-memory and therefore per-instance: it will not stop a distributed
// attacker across serverless instances, but it does stop a plain password
// grind against a single long-lived container (the Docker/VM deployment).
const attempts = new Map<string, { count: number; resetAt: number }>();

/** Best-effort client identity for rate limiting. */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

/**
 * Returns null when the caller may attempt a login, or the number of seconds
 * to wait when they are locked out. Counts the attempt.
 */
export function checkLoginRate(key: string): number | null {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return null;
  }

  entry.count += 1;
  if (entry.count > MAX_LOGIN_ATTEMPTS) {
    return Math.ceil((entry.resetAt - now) / 1000);
  }
  return null;
}

/** Drop the counter for a key after a successful login. */
export function clearLoginRate(key: string): void {
  attempts.delete(key);
}
