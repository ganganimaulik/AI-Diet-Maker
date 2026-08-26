import { NextResponse } from 'next/server';
import { dbConnect, Config } from '@/lib/db';
import { isAuthenticated } from '@/lib/auth';
import { DEFAULT_CONFIG } from '@/lib/types';

export async function GET() {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await dbConnect();
    let config = await Config.findOne();
    
    if (!config) {
      // Create a default config document in database
      const defaultData = {
        ...DEFAULT_CONFIG,
        apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || DEFAULT_CONFIG.apiKey,
        fireworksApiKey: process.env.FIREWORKS_API_KEY || DEFAULT_CONFIG.fireworksApiKey,
        enterpriseApiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || DEFAULT_CONFIG.enterpriseApiKey
      };
      config = await Config.create(defaultData);
    } else {
      // Fallback/pre-fill API key from environment variables if not set in DB
      let modified = false;
      if (!config.apiKey && (process.env.GEMINI_API_KEY || process.env.API_KEY)) {
        config.apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY) as string;
        modified = true;
      }
      if (!config.enterpriseApiKey && (process.env.GEMINI_API_KEY || process.env.API_KEY)) {
        config.enterpriseApiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY) as string;
        modified = true;
      }
      if (!config.fireworksApiKey && process.env.FIREWORKS_API_KEY) {
        config.fireworksApiKey = process.env.FIREWORKS_API_KEY;
        modified = true;
      }
      if (config.huggingFaceSpace === undefined) {
        config.huggingFaceSpace = 'ganganimaulik/diet-maker-worker';
        modified = true;
      }
      if (config.huggingFaceToken === undefined) {
        config.huggingFaceToken = '';
        modified = true;
      }
      // Configs written before Gemini 3 carry thinkingEnabled + a numeric
      // thinkingBudget instead; both are ignored now, so seed the level.
      if (!config.thinkingLevel) {
        config.thinkingLevel = 'high';
        modified = true;
      }
      if (!config.global) {
        config.global = {
          dailyCalorieTarget: 1600,
          totalOliveOil: 18,
          oliveOilSplitPercent: 50,
          idealSodiumPotassiumRatioMin: 0.70,
          idealSodiumPotassiumRatioMax: 0.80
        };
        modified = true;
      } else {
        if (config.global.idealSodiumPotassiumRatioMin === undefined) {
          config.global.idealSodiumPotassiumRatioMin = 0.70;
          modified = true;
        }
        if (config.global.idealSodiumPotassiumRatioMax === undefined) {
          config.global.idealSodiumPotassiumRatioMax = 0.80;
          modified = true;
        }
      }
      if (modified) {
        await Config.findOneAndUpdate({}, { $set: config.toObject() }, { upsert: true });
      }
    }

    return NextResponse.json({ config });
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
