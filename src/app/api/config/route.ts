import { NextResponse } from 'next/server';
import { dbConnect, Config } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';

export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    let config = await Config.findOne();
    
    // If no config document exists, we will return an empty object or null
    // and let the frontend initialize it with its DEFAULT_CONFIG.
    return NextResponse.json({ config: config || null });
  } catch (error) {
    console.error('Error fetching config:', error);
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

    const newConfig = await req.json();
    await dbConnect();

    // Clean up _id or version fields if present in input to avoid schema errors
    if (newConfig._id) delete newConfig._id;
    if (newConfig.__v !== undefined) delete newConfig.__v;

    const savedConfig = await Config.findOneAndUpdate(
      {},
      { $set: newConfig },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json({ success: true, config: savedConfig });
  } catch (error) {
    console.error('Error saving config:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
