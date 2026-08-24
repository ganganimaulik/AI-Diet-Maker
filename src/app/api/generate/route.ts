import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { GoogleGenAI } from '@google/genai';

import {
  extractPartsText,
  extractResponseText,
  buildGenerationPayload,
  buildStudioEndpoint,
  buildEnterpriseEndpoint,
  parseGeminiErrorText,
  type GeminiPart
} from '@/lib/gemini-helpers';

import {
  FIREWORKS_API_URL,
  buildFireworksPayload,
  extractFireworksChunk,
  parseFireworksErrorText
} from '@/lib/fireworks-helpers';

interface StreamChunk {
  text: string;
  thought: string;
}

/** Parse one Gemini SSE `data:` payload into { text, thought }, or null if empty. */
function parseSSEData(dataStr: string): StreamChunk | null {
  if (dataStr === '[DONE]') return null;
  const data = JSON.parse(dataStr);
  const { text, thought } = extractResponseText(data);
  if (text || thought) {
    return { text, thought };
  }
  return null;
}

/** Parse one Fireworks SSE `data:` payload into { text, thought }, or null if empty. */
function parseFireworksSSEData(dataStr: string): StreamChunk | null {
  if (dataStr === '[DONE]') return null;
  const data = JSON.parse(dataStr);
  const { text, thought } = extractFireworksChunk(data);
  if (text || thought) {
    return { text, thought };
  }
  return null;
}

async function* parseSSEResponse(response: Response, isFireworks = false) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';

  const parseLine = (line: string): StreamChunk | null => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return null;
    try {
      const dataStr = trimmed.slice(5).trim();
      return isFireworks ? parseFireworksSSEData(dataStr) : parseSSEData(dataStr);
    } catch (e) {
      console.error('Error parsing SSE chunk:', trimmed, e);
      return null;
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const chunk = parseLine(line);
        if (chunk) yield chunk;
      }
    }

    const tailChunk = parseLine(buffer);
    if (tailChunk) yield tailChunk;
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
  enterpriseServiceAccountJson: string,
  fireworksApiKey: string
) {
  if (provider === 'fireworks') {
    const activeFireworksKey = fireworksApiKey || process.env.FIREWORKS_API_KEY || apiKey;
    if (!activeFireworksKey) {
      throw new Error('Fireworks API Key is required. Please set it in Settings or FIREWORKS_API_KEY environment variable.');
    }

    const payload = buildFireworksPayload(model, prompt, { temperature: 0.1, stream: true });
    const response = await fetch(FIREWORKS_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${activeFireworksKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(parseFireworksErrorText(errorText, 'Failed to generate content from Fireworks API.'));
    }

    yield* parseSSEResponse(response, true);
  } else if (provider === 'gemini-enterprise') {
    if (enterpriseAuthMethod === 'api-key') {
      const activeEnterpriseApiKey = enterpriseApiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!activeEnterpriseApiKey) {
        throw new Error('Agent Platform API Key is required when API Key authentication is selected.');
      }
      if (!enterpriseProjectId) {
        throw new Error('GCP Project ID is required for Gemini Enterprise Agent Platform.');
      }

      const payload = buildGenerationPayload(prompt, thinkingEnabled, thinkingBudget);
      const endpoint = buildEnterpriseEndpoint(
        enterpriseProjectId,
        enterpriseLocation,
        model,
        activeEnterpriseApiKey,
        { stream: true }
      );

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(parseGeminiErrorText(errorText, 'Failed to generate content from Gemini Enterprise API.'));
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
        const parts = (chunk.candidates?.[0]?.content?.parts as GeminiPart[]) || [];
        const { text, thought } = extractPartsText(parts);
        if (text || thought) {
          yield { text, thought };
        }
      }
    }
  } else {
    if (!apiKey) {
      throw new Error('Gemini API Key is required. Please set it in the configuration.');
    }

    const payload = buildGenerationPayload(prompt, thinkingEnabled, thinkingBudget);
    const response = await fetch(buildStudioEndpoint(model, apiKey, { stream: true }), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(parseGeminiErrorText(errorText, 'Failed to generate content from Gemini API.'));
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
      model = 'gemini-3.7-flash',
      thinkingEnabled = false,
      thinkingBudget = 2048,
      provider = 'google-ai-studio',
      fireworksApiKey = '',
      enterpriseAuthMethod = 'api-key',
      enterpriseApiKey = '',
      enterpriseProjectId = '',
      enterpriseLocation = 'global',
      enterpriseServiceAccountJson = ''
    } = body;

    const apiKey = req.headers.get('x-api-key') || body.apiKey || process.env.GEMINI_API_KEY || process.env.API_KEY;
    const activeFireworksKey = req.headers.get('x-fireworks-api-key') || fireworksApiKey || req.headers.get('x-api-key') || body.apiKey || process.env.FIREWORKS_API_KEY;

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
            enterpriseServiceAccountJson,
            activeFireworksKey
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
