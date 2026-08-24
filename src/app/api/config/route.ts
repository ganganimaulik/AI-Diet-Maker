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
    
    if (!config) {
      // Create a default config document in database
      const defaultData = {
        apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '',
        provider: 'google-ai-studio',
        enterpriseAuthMethod: 'api-key',
        enterpriseApiKey: process.env.GEMINI_API_KEY || process.env.API_KEY || '',
        model: 'gemini-3.7-flash',
        customModel: 'gemini-3.7-flash',
        thinkingEnabled: true,
        thinkingBudget: 2048,
        global: {
          dailyCalorieTarget: 1600,
          totalOliveOil: 18,
          oliveOilSplitPercent: 50,
          idealSodiumPotassiumRatioMin: 0.70,
          idealSodiumPotassiumRatioMax: 0.80
        },
        meals: [
          {
            id: 'meal-1',
            name: 'Breakfast',
            mealsPerDay: 1,
            ingredients: [
              { name: 'Oats', weight: '50', isAuto: false }
            ],
            water: '',
            prepMethod: ''
          }
        ],
        customSplits: [],
        dailyVariables: {},
        huggingFaceToken: '',
        huggingFaceSpace: 'ganganimaulik/diet-maker-worker'
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
      if (config.huggingFaceSpace === undefined) {
        config.huggingFaceSpace = 'ganganimaulik/diet-maker-worker';
        modified = true;
      }
      if (config.huggingFaceToken === undefined) {
        config.huggingFaceToken = '';
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
