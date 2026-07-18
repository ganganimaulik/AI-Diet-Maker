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

async function* parseSSEResponse(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const data = JSON.parse(dataStr);
            const candidate = data.candidates?.[0];
            const parts: GeminiPart[] = candidate?.content?.parts || [];

            let text = '';
            let thought = '';
            for (const part of parts) {
              if (part.thought === true || part.thought) {
                thought += part.text || '';
              } else if (part.text) {
                text += part.text;
              }
            }
            if (!text && !thought && parts.length > 0) {
              text = parts.map((p) => p.text || '').join('');
            }

            if (text || thought) {
              yield { text, thought };
            }
          } catch (e) {
            console.error('Error parsing SSE chunk:', dataStr, e);
          }
        }
      }
    }

    const trimmed = buffer.trim();
    if (trimmed.startsWith('data:')) {
      const dataStr = trimmed.slice(5).trim();
      if (dataStr !== '[DONE]') {
        try {
          const data = JSON.parse(dataStr);
          const candidate = data.candidates?.[0];
          const parts: GeminiPart[] = candidate?.content?.parts || [];
          let text = '';
          let thought = '';
          for (const part of parts) {
            if (part.thought === true || part.thought) {
              thought += part.text || '';
            } else if (part.text) {
              text += part.text;
            }
          }
          if (!text && !thought && parts.length > 0) {
            text = parts.map((p) => p.text || '').join('');
          }
          if (text || thought) {
            yield { text, thought };
          }
        } catch (e) {}
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* getChunks(
  provider: string,
  apiKey: string,
  model: string,
  prompt: string,
  thinkingEnabled: boolean,
  thinkingBudget: number,
  enterpriseAuthMethod: string,
  enterpriseApiKey: string,
  enterpriseProjectId: string,
  enterpriseLocation: string,
  enterpriseServiceAccountJson: string
) {
  if (provider === 'gemini-enterprise') {
    if (enterpriseAuthMethod === 'api-key') {
      const activeEnterpriseApiKey = enterpriseApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!activeEnterpriseApiKey) {
        throw new Error('Agent Platform API Key is required when API Key authentication is selected.');
      }
      if (!enterpriseProjectId) {
        throw new Error('GCP Project ID is required for Gemini Enterprise Agent Platform.');
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

      const loc = enterpriseLocation || 'global';
      const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
      const endpoint = `https://${host}/v1/projects/${enterpriseProjectId}/locations/${loc}/publishers/google/models/${model}:streamGenerateContent?key=${activeEnterpriseApiKey}&alt=sse`;

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
        throw new Error(errorMessage);
      }

      yield* parseSSEResponse(response);
    } else {
      if (enterpriseAuthMethod === 'service-account' && !enterpriseServiceAccountJson) {
        throw new Error('Service Account JSON is required when Service Account authentication is selected.');
      }
      if (!enterpriseProjectId) {
        throw new Error('GCP Project ID is required for Gemini Enterprise Agent Platform.');
      }

      let googleAuthOptions: Record<string, unknown> | undefined = undefined;
      if (enterpriseAuthMethod === 'service-account') {
        try {
          googleAuthOptions = {
            credentials: JSON.parse(enterpriseServiceAccountJson)
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          throw new Error(`Invalid Service Account JSON: ${errMsg}`);
        }
      }

      const ai = new GoogleGenAI({
        vertexai: true,
        project: enterpriseProjectId,
        location: enterpriseLocation || 'global',
        googleAuthOptions
      });

      const configObj: Record<string, unknown> = {
        temperature: 0.1,
      };

      if (thinkingEnabled) {
        configObj.thinkingConfig = {
          thinkingBudget: thinkingBudget
        };
      }

      const responseStream = await ai.models.generateContentStream({
        model: model,
        contents: prompt,
        config: configObj
      });

      for await (const chunk of responseStream) {
        const candidate = chunk.candidates?.[0];
        const parts: GeminiPart[] = candidate?.content?.parts as GeminiPart[] || [];
        let text = '';
        let thought = '';

        for (const part of parts) {
          if (part.thought === true || part.thought) {
            thought += part.text || '';
          } else if (part.text) {
            text += part.text;
          }
        }

        if (!text && !thought && parts.length > 0) {
          text = parts.map((p) => p.text || '').join('');
        }

        if (text || thought) {
          yield { text, thought };
        }
      }
    }
  } else {
    if (!apiKey) {
      throw new Error('Gemini API Key is required. Please set it in the configuration.');
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
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`,
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
      throw new Error(errorMessage);
    }

    yield* parseSSEResponse(response);
  }
}

export async function POST(req: Request) {
  try {
    if (!(await isAuthenticated())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { 
      prompt, 
      model = 'gemini-3.5-flash',
      thinkingEnabled = false, 
      thinkingBudget = 2048,
      provider = 'google-ai-studio',
      enterpriseAuthMethod = 'api-key',
      enterpriseApiKey = '',
      enterpriseProjectId = '',
      enterpriseLocation = 'global',
      enterpriseServiceAccountJson = ''
    } = body;
    
    const apiKey = req.headers.get('x-api-key') || body.apiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required.' }, 
        { status: 400 }
      );
    }

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const sendEvent = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          const generator = getChunks(
            provider,
            apiKey,
            model,
            prompt,
            thinkingEnabled,
            thinkingBudget,
            enterpriseAuthMethod,
            enterpriseApiKey,
            enterpriseProjectId,
            enterpriseLocation,
            enterpriseServiceAccountJson
          );

          for await (const chunk of generator) {
            sendEvent(chunk);
          }
        } catch (error) {
          console.error('Streaming error in API route:', error);
          const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
          sendEvent({ error: errorMessage });
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Error in generate API route:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json(
      { error: errorMessage }, 
      { status: 500 }
    );
  }
}
