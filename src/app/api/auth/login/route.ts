import { NextResponse } from 'next/server';
import { checkLoginRate, clearLoginRate, clientKey, createSessionToken, verifyPassword } from '@/lib/auth';
import { cookies } from 'next/headers';

export async function POST(req: Request) {
  try {
    const { password } = await req.json();
    const expectedPassword = process.env.APP_PASSWORD;

    if (!expectedPassword) {
      return NextResponse.json(
        { error: 'Security is not configured on the server. Set APP_PASSWORD.' },
        { status: 500 }
      );
    }

    // Throttle guesses before doing any comparison
    const key = clientKey(req);
    const retryAfter = checkLoginRate(key);
    if (retryAfter !== null) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    if (!verifyPassword(password)) {
      return NextResponse.json(
        { error: 'Incorrect password' },
        { status: 401 }
      );
    }

    clearLoginRate(key);
    const token = createSessionToken();
    const cookieStore = await cookies();

    cookieStore.set('diet_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      sameSite: 'lax',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error logging in:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete('diet_session');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error logging out:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
