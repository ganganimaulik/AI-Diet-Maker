import { NextResponse } from 'next/server';
import { dbConnect, Config, CachedResponse } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';
import { computeConfigHash } from '@/lib/config-hash';

/**
 * GET /api/cache?day=MONDAY  — Returns cached response for a given day (if valid)
 * GET /api/cache             — Returns all cached entries with metadata
 */
export async function GET(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();

    const { searchParams } = new URL(req.url);
    const day = searchParams.get('day');

    // Load current config to compute hashes (one per day)
    const config = await Config.findOne();
    if (!config) {
      return NextResponse.json({ error: 'No configuration found' }, { status: 404 });
    }

    if (day) {
      // Return cached response for a specific day
      const dayKey = day.toUpperCase();
      const currentHash = computeConfigHash(config, dayKey);
      const cached = await CachedResponse.findOne({ day: dayKey });
      if (!cached) {
        return NextResponse.json({ cached: null, configHash: currentHash });
      }

      const isValid = cached.configHash === currentHash;
      return NextResponse.json({
        cached: {
          day: cached.day,
          responseText: isValid ? cached.responseText : null,
          thinkingText: isValid ? cached.thinkingText : null,
          generatedAt: cached.generatedAt,
          isValid,
        },
        configHash: currentHash,
      });
    } else {
      // Return all cached entries with metadata
      const allCached = await CachedResponse.find({}).sort({ day: 1 });
      const entries = allCached.map((entry) => ({
        day: entry.day,
        generatedAt: entry.generatedAt,
        // Each day is validated against its own hash, so editing one day
        // leaves the other six cached plans valid.
        isValid: entry.configHash === computeConfigHash(config, entry.day),
      }));

      return NextResponse.json({ entries });
    }
  } catch (error) {
    console.error('Error in cache GET:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/cache?day=MONDAY  — Delete cached response for a specific day
 * DELETE /api/cache             — Delete all cached responses
 */
export async function DELETE(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();

    const { searchParams } = new URL(req.url);
    const day = searchParams.get('day');

    if (day) {
      await CachedResponse.deleteOne({ day: day.toUpperCase() });
      return NextResponse.json({ success: true, deleted: day.toUpperCase() });
    } else {
      const result = await CachedResponse.deleteMany({});
      return NextResponse.json({ success: true, deletedCount: result.deletedCount });
    }
  } catch (error) {
    console.error('Error in cache DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cache — Save a cached response
 * Body: { day, responseText, thinkingText }
 */
export async function POST(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    const body = await req.json();
    const { day, responseText, thinkingText } = body;

    if (!day) {
      return NextResponse.json({ error: 'Day is required' }, { status: 400 });
    }

    // Compute current config hash
    const config = await Config.findOne();
    if (!config) {
      return NextResponse.json({ error: 'No configuration found' }, { status: 404 });
    }
    const configHash = computeConfigHash(config, day.toUpperCase());

    // Upsert the cached response
    const cached = await CachedResponse.findOneAndUpdate(
      { day: day.toUpperCase() },
      {
        $set: {
          configHash,
          responseText: responseText || '',
          thinkingText: thinkingText || '',
          generatedAt: new Date(),
        }
      },
      { upsert: true, new: true }
    );

    return NextResponse.json({ success: true, cached });
  } catch (error) {
    console.error('Error in cache POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
