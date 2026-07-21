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
        targetTime: '14:00',
        timezone: 'Asia/Kolkata',
        recipientType: 'contact',
        recipientId: '',
        recipientName: '',
        userRecipientType: 'contact',
        userRecipientId: '',
        userRecipientName: '',
        lastSentDate: '',
        lastSentTime: '',
        lastError: '',
        retryCount: 0,
        nextRetryTime: 0,
      });
    }

    // Check the WhatsApp worker health. The worker was migrated off Hugging Face
    // Spaces to a GCP Compute Engine VM; we ping its health endpoint directly.
    // Field names (hfSpaceStatus/hfSpaceDetails) are kept for call-site compat.
    let hfSpaceStatus = 'UNREACHABLE';
    let hfSpaceDetails: { hardware: string; sdk: string } | null = null;

    const workerUrl = process.env.WORKER_URL || 'http://136.116.192.159:7860';
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 4000); // 4s timeout

      const workerRes = await fetch(`${workerUrl}/`, { signal: controller.signal });
      clearTimeout(id);

      if (workerRes.ok) {
        const workerData = await workerRes.json();
        hfSpaceStatus = workerData?.status === 'online' ? 'RUNNING' : 'DOWN';
        hfSpaceDetails = { hardware: 'GCP e2-micro · us-central1', sdk: 'Node 20 + PM2' };
      } else {
        hfSpaceStatus = `HTTP_ERROR_${workerRes.status}`;
      }
    } catch (err) {
      console.error('Error fetching worker status:', err);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      hfSpaceStatus = isAbort ? 'TIMEOUT' : 'UNREACHABLE';
    }

    return NextResponse.json({ state, scheduler, hfSpaceStatus, hfSpaceDetails });
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

    const {
      isEnabled,
      targetTime,
      timezone,
      recipientType,
      recipientId,
      recipientName,
      userRecipientType,
      userRecipientId,
      userRecipientName
    } = await req.json();
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
          userRecipientType,
          userRecipientId,
          userRecipientName,
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
