import { cookies } from 'next/headers';
import crypto from 'crypto';

const SECRET_SALT = process.env.MONGODB_URI || 'default_diet_salt';

/**
 * Generates a session token based on the environment's app password.
 */
export function generateSessionToken(): string {
  const password = process.env.APP_PASSWORD || 'admin123';
  return crypto
    .createHmac('sha256', SECRET_SALT)
    .update(password)
    .digest('hex');
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
    const sessionCookie = cookieStore.get('diet_session');
    
    if (!sessionCookie) {
      return false;
    }

    const expectedToken = generateSessionToken();
    return sessionCookie.value === expectedToken;
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
