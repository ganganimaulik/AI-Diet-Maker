import { NextResponse } from 'next/server';
import { dbConnect, Config, GenerationJob, VerificationResult } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';
import { computeConfigHash } from '@/lib/config-hash';
import { loadIngredientLibrary } from '@/lib/ingredient-store';
import { clearPlans, resolveCurrentPlan, resolvePlanStatuses, storeCurrentPlan } from '@/lib/plan-cache';
import { DAYS_OF_WEEK } from '@/lib/types';

/**
 * GET /api/cache?day=MONDAY  — Returns cached response for a given day (if valid)
 * GET /api/cache             — Returns all cached entries with metadata
 *
 * A day whose current config has an archived plan gets that plan back as its
 * current one here (see src/lib/plan-cache.js), so a setting that was changed
 * and then changed back costs no new generation.
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
    const library = await loadIngredientLibrary();

    if (day) {
      // Return cached response for a specific day
      const dayKey = day.toUpperCase();
      const currentHash = computeConfigHash(config, dayKey, library);
      const { plan, isValid } = await resolveCurrentPlan(dayKey, currentHash);
      if (!plan) {
        return NextResponse.json({ cached: null, configHash: currentHash });
      }

      return NextResponse.json({
        cached: {
          day: plan.day,
          responseText: isValid ? plan.responseText : null,
          thinkingText: isValid ? plan.thinkingText : null,
          generatedAt: plan.generatedAt,
          isValid,
        },
        configHash: currentHash,
      });
    } else {
      // Each day is validated against its own hash, so editing one day
      // leaves the other six cached plans valid.
      const statuses = await resolvePlanStatuses(Object.fromEntries(
        DAYS_OF_WEEK.map((d) => [d, computeConfigHash(config, d, library)])
      ));
      const entries = DAYS_OF_WEEK.filter((d) => statuses[d]).map((d) => ({
        day: d,
        generatedAt: statuses[d].generatedAt,
        isValid: statuses[d].isValid,
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
 * DELETE /api/cache?day=MONDAY  — Delete a day's cached plan and its archived ones
 * DELETE /api/cache             — Delete every cached and archived plan
 */
export async function DELETE(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();

    const { searchParams } = new URL(req.url);
    const day = searchParams.get('day');
    const terminalJobs = { status: { $in: ['completed', 'failed'] as const } };

    // A verification verdict describes one specific plan, so it goes with it.
    if (day) {
      const dayKey = day.toUpperCase();
      const [cacheResult, jobResult] = await Promise.all([
        clearPlans(dayKey),
        GenerationJob.deleteMany({ day: dayKey, ...terminalJobs }),
        VerificationResult.deleteMany({ day: dayKey })
      ]);
      return NextResponse.json({
        success: true,
        deleted: dayKey,
        deletedCount: cacheResult.deletedCount,
        deletedJobCount: jobResult.deletedCount
      });
    } else {
      const [cacheResult, jobResult] = await Promise.all([
        clearPlans(),
        GenerationJob.deleteMany(terminalJobs),
        VerificationResult.deleteMany({})
      ]);
      return NextResponse.json({
        success: true,
        deletedCount: cacheResult.deletedCount,
        deletedJobCount: jobResult.deletedCount
      });
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
    const dayKey = day.toUpperCase();
    const configHash = computeConfigHash(config, dayKey, await loadIngredientLibrary());

    // Becomes the day's current plan; the one it replaces is archived
    const cached = await storeCurrentPlan(dayKey, { configHash, responseText, thinkingText });

    return NextResponse.json({ success: true, cached });
  } catch (error) {
    console.error('Error in cache POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
