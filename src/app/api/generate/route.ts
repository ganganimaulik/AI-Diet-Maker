import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
  };
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

interface GeminiPayload {
  contents: Array<{
    role: string;
    parts: Array<{ text: string }>;
  }>;
  generationConfig: {
    temperature: number;
    thinkingConfig?: {
      thinkingBudget: number;
    };
  };
}

export async function POST(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { 
      prompt, 
      model = 'gemini-2.5-flash', 
      thinkingEnabled = false, 
      thinkingBudget = 2048 
    } = body;
    
    // Read API key from custom header or body
    const apiKey = req.headers.get('x-api-key') || body.apiKey;

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Gemini API Key is required. Please set it in the configuration.' }, 
        { status: 400 }
      );
    }

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required.' }, 
        { status: 400 }
      );
    }

    // Build the request payload for Gemini v1beta API
    const payload: GeminiPayload = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1, // low temperature for precise mathematical calculation
      }
    };

    // If thinking mode is enabled, add the thinkingConfig to generationConfig
    if (thinkingEnabled) {
      payload.generationConfig.thinkingConfig = {
        thinkingBudget: thinkingBudget
      };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = 'Failed to generate content from Gemini API.';
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    const data = (await response.json()) as GeminiResponse;
    
    // Extract candidate responses
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    
    let text = '';
    let thought = '';
    
    for (const part of parts) {
      // Check if the part represents the thinking process
      if (part.thought === true || part.thought) {
        thought += part.text || '';
      } else if (part.text) {
        text += part.text;
      }
    }
    
    // Fallback: if text is empty and there's a part with text
    if (!text && parts.length > 0) {
      text = parts.map((p) => p.text || '').join('');
    }

    return NextResponse.json({ text, thought });
  } catch (error) {
    console.error('Error in generate API route:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json(
      { error: errorMessage }, 
      { status: 500 }
    );
  }
}
