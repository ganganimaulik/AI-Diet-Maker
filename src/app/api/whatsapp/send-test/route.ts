import { NextResponse } from 'next/server';
import { dbConnect, Scheduler } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';

export async function POST() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    
    // Check if recipient is configured in the scheduler first
    const scheduler = await Scheduler.findOne();
    if (!scheduler || !scheduler.recipientId) {
      return NextResponse.json(
        { error: 'Recipient is not configured in the scheduler. Please select a contact or group first.' },
        { status: 400 }
      );
    }
    
    // Set triggerTest: true in Scheduler document
    const updatedScheduler = await Scheduler.findOneAndUpdate(
      {},
      { $set: { triggerTest: true } },
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
