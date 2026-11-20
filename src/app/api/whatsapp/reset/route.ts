import { NextResponse } from 'next/server';
import { dbConnect, WhatsAppState } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';

/**
 * Log WhatsApp out and get a fresh QR code.
 *
 * The worker owns the session: its browser holds it and keeps backing it up
 * to GridFS, so deleting it from here would only be undone by the next backup.
 * This route records the request instead, and the worker picks it up within
 * a few seconds (or at its next startup, if it is not running), deletes the
 * stored session and restarts.
 */
export async function POST() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();

    await WhatsAppState.findOneAndUpdate(
      {},
      {
        $set: {
          resetRequestedAt: new Date(),
          status: 'disconnected',
          qr: '',
          connectedPhone: '',
          connectedName: '',
          authFailureCount: 0
        }
      },
      { upsert: true }
    );

    return NextResponse.json({
      success: true,
      message: 'WhatsApp reset requested. The worker will log out, restart and show a new QR code shortly.'
    });
  } catch (error) {
    console.error('Error requesting a WhatsApp session reset:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
