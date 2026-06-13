import { NextResponse } from 'next/server';
import { dbConnect, Scheduler } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const type = body.type || 'all'; // 'cook' | 'myself' | 'all'

    await dbConnect();
    
    const scheduler = await Scheduler.findOne();
    if (!scheduler) {
      return NextResponse.json(
        { error: 'Scheduler config is missing.' },
        { status: 400 }
      );
    }

    const updateFields: Record<string, boolean> = {};

    if (type === 'cook') {
      if (!scheduler.recipientId) {
        return NextResponse.json(
          { error: 'Cook Recipient is not configured in the scheduler.' },
          { status: 400 }
        );
      }
      updateFields.triggerCookTest = true;
    } else if (type === 'myself') {
      if (!scheduler.userRecipientId) {
        return NextResponse.json(
          { error: 'Myself Recipient is not configured in the scheduler.' },
          { status: 400 }
        );
      }
      updateFields.triggerMyselfTest = true;
    } else {
      if (!scheduler.recipientId && !scheduler.userRecipientId) {
        return NextResponse.json(
          { error: 'Neither Cook Recipient nor Myself Recipient is configured in the scheduler.' },
          { status: 400 }
        );
      }
      updateFields.triggerTest = true;
    }
    
    const updatedScheduler = await Scheduler.findOneAndUpdate(
      {},
      { $set: updateFields },
      { upsert: true, new: true }
    );

    return NextResponse.json({
      success: true,
      message: 'Test send successfully triggered. The background worker will run it within a few seconds.',
      scheduler: updatedScheduler
    });
  } catch (error) {
    console.error('Error triggering test send:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
