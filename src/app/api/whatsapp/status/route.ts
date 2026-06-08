import { NextResponse } from 'next/server';
import { dbConnect, WhatsAppState, Scheduler, Config } from '@/lib/db';
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

    // Check Hugging Face Space runtime status
    let hfSpaceStatus = 'NOT_CONFIGURED';
    let hfSpaceDetails = null;

    const config = await Config.findOne();
    if (config && config.huggingFaceSpace) {
      try {
        const headers: Record<string, string> = {};
        if (config.huggingFaceToken) {
          headers['Authorization'] = `Bearer ${config.huggingFaceToken}`;
        }
        
        // Query Hugging Face Space API
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 3500); // 3.5s timeout
        
        const hfRes = await fetch(`https://huggingface.co/api/spaces/${config.huggingFaceSpace}`, {
          headers,
          signal: controller.signal
        });
        clearTimeout(id);

        if (hfRes.ok) {
          const hfData = await hfRes.json();
          if (hfData.runtime && hfData.runtime.stage) {
            const stage = hfData.runtime.stage.toUpperCase();
            hfSpaceStatus = stage;
            hfSpaceDetails = {
              stage,
              hardware: hfData.runtime.hardware || '',
              sdk: hfData.runtime.sdk || ''
            };

            // If the space is sleeping, send a background request to wake it up
            if (stage === 'SLEEPING') {
              const normalized = config.huggingFaceSpace.replace(/[\/_.]/g, '-').toLowerCase();
              const spaceUrl = `https://${normalized}.hf.space/`;
              
              // Fire-and-forget wake up request
              fetch(spaceUrl, { headers }).catch(err => {
                console.error('Background HF wake up request failed:', err);
              });
            }
          }
        } else if (hfRes.status === 401 || hfRes.status === 404) {
          hfSpaceStatus = 'UNAUTHORIZED';
        } else {
          hfSpaceStatus = `HTTP_ERROR_${hfRes.status}`;
        }
      } catch (err) {
        console.error('Error fetching Hugging Face status:', err);
        const isAbort = err instanceof Error && err.name === 'AbortError';
        hfSpaceStatus = isAbort ? 'TIMEOUT' : 'ERROR';
      }
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
