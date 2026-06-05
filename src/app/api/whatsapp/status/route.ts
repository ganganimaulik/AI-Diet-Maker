import { NextResponse } from 'next/server';
import { dbConnect, WhatsAppState, Scheduler } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';

export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    
    let state = await WhatsAppState.findOne();
    if (!state) {
      state = await WhatsAppState.create({
        status: 'disconnected',
        qr: '',
        connectedPhone: '',
        connectedName: '',
      });
    }

    let scheduler = await Scheduler.findOne();
    if (!scheduler) {
      scheduler = await Scheduler.create({
        isEnabled: false,
        targetTime: '07:30',
        timezone: 'Asia/Kolkata',
        recipientType: 'contact',
        recipientId: '',
        recipientName: '',
        lastSentDate: '',
        lastError: '',
        retryCount: 0,
        nextRetryTime: 0,
      });
    }

    return NextResponse.json({ state, scheduler });
  } catch (error) {
    console.error('Error fetching WhatsApp status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { isEnabled, targetTime, timezone, recipientType, recipientId, recipientName } = await req.json();
    await dbConnect();

    const updatedScheduler = await Scheduler.findOneAndUpdate(
      {},
      {
        $set: {
          isEnabled,
          targetTime,
          timezone,
          recipientType,
          recipientId,
          recipientName,
        },
      },
      { upsert: true, new: true }
    );

    return NextResponse.json({ success: true, scheduler: updatedScheduler });
  } catch (error) {
    console.error('Error updating scheduler settings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
