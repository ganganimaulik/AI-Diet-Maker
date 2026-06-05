import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { GoogleGenAI } from '@google/genai';

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
      thinkingBudget = 2048,
      provider = 'google-ai-studio',
      enterpriseAuthMethod = 'api-key',
      enterpriseApiKey = '',
      enterpriseProjectId = '',
      enterpriseLocation = 'global',
      enterpriseServiceAccountJson = ''
    } = body;
    
    // Read API key from custom header or body (for AI Studio fallback)
    const apiKey = req.headers.get('x-api-key') || body.apiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required.' }, 
        { status: 400 }
      );
    }

    let text = '';
    let thought = '';

    if (provider === 'gemini-enterprise') {
      if (enterpriseAuthMethod === 'api-key') {
        const activeEnterpriseApiKey = enterpriseApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
        if (!activeEnterpriseApiKey) {
          return NextResponse.json(
            { error: 'Agent Platform API Key is required when API Key authentication is selected.' },
            { status: 400 }
          );
        }
        if (!enterpriseProjectId) {
          return NextResponse.json(
            { error: 'GCP Project ID is required for Gemini Enterprise Agent Platform.' },
            { status: 400 }
          );
        }

        // Build the request payload for Gemini Enterprise REST API
        const payload: GeminiPayload = {
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.1,
          }
        };

        if (thinkingEnabled) {
          payload.generationConfig.thinkingConfig = {
            thinkingBudget: thinkingBudget
          };
        }

        const loc = enterpriseLocation || 'global';
        const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
        const endpoint = `https://${host}/v1/projects/${enterpriseProjectId}/locations/${loc}/publishers/google/models/${model}:generateContent?key=${activeEnterpriseApiKey}`;
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = 'Failed to generate content from Gemini Enterprise API.';
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error?.message || errorMessage;
          } catch {
            errorMessage = errorText || errorMessage;
          }
          return NextResponse.json({ error: errorMessage }, { status: response.status });
        }

        const data = (await response.json()) as GeminiResponse;
        const candidate = data.candidates?.[0];
        const parts = candidate?.content?.parts || [];

        for (const part of parts) {
          if (part.thought === true || part.thought) {
            thought += part.text || '';
          } else if (part.text) {
            text += part.text;
          }
        }

        if (!text && parts.length > 0) {
          text = parts.map((p) => p.text || '').join('');
        }

      } else {
        // Service Account or ADC auth using @google/genai SDK
        if (enterpriseAuthMethod === 'service-account' && !enterpriseServiceAccountJson) {
          return NextResponse.json(
            { error: 'Service Account JSON is required when Service Account authentication is selected.' },
            { status: 400 }
          );
        }
        if (!enterpriseProjectId) {
          return NextResponse.json(
            { error: 'GCP Project ID is required for Gemini Enterprise Agent Platform.' },
            { status: 400 }
          );
        }

        let googleAuthOptions: any = undefined;
        if (enterpriseAuthMethod === 'service-account') {
          try {
            googleAuthOptions = {
              credentials: JSON.parse(enterpriseServiceAccountJson)
            };
          } catch (err: any) {
            return NextResponse.json(
              { error: `Invalid Service Account JSON: ${err.message}` },
              { status: 400 }
            );
          }
        }

        const ai = new GoogleGenAI({
          vertexai: true,
          project: enterpriseProjectId,
          location: enterpriseLocation || 'global',
          googleAuthOptions
        });

        const configObj: any = {
          temperature: 0.1,
        };

        if (thinkingEnabled) {
          configObj.thinkingConfig = {
            thinkingBudget: thinkingBudget
          };
        }

        const sdkResponse = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: configObj
        });

        const candidate = sdkResponse.candidates?.[0];
        const parts = candidate?.content?.parts || [];

        for (const part of parts) {
          if (part.thought === true || part.thought) {
            thought += part.text || '';
          } else if (part.text) {
            text += part.text;
          }
        }

        if (!text && parts.length > 0) {
          text = parts.map((p: any) => p.text || '').join('');
        }
      }
    } else {
      // Default: Google AI Studio API
      if (!apiKey) {
        return NextResponse.json(
          { error: 'Gemini API Key is required. Please set it in the configuration.' }, 
          { status: 400 }
        );
      }

      const payload: GeminiPayload = {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
        }
      };

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
      const candidate = data.candidates?.[0];
      const parts = candidate?.content?.parts || [];

      for (const part of parts) {
        if (part.thought === true || part.thought) {
          thought += part.text || '';
        } else if (part.text) {
          text += part.text;
        }
      }

      if (!text && parts.length > 0) {
        text = parts.map((p) => p.text || '').join('');
      }
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

