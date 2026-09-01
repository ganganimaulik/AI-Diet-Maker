/**
 * Model pickers shared by the generation and verification settings, so the two
 * lists cannot drift apart when a new model is added.
 */

export interface ModelOption {
  value: string;
  label: string;
}

export const FIREWORKS_MODELS: ModelOption[] = [
  { value: 'accounts/fireworks/models/deepseek-v4-pro', label: 'DeepSeek V4 Pro (Reasoning)' },
  { value: 'accounts/fireworks/models/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash' },
  { value: 'accounts/fireworks/models/llama4-maverick-instruct-basic', label: 'Llama 4 Maverick Instruct (401B)' },
  { value: 'accounts/fireworks/models/kimi-k3', label: 'Kimi K3 (Reasoning)' },
  { value: 'accounts/fireworks/routers/kimi-k3-fast', label: 'Kimi K3 Fast' },
  { value: 'accounts/fireworks/models/glm-5p3', label: 'GLM 5.3 (Reasoning)' },
  { value: 'accounts/fireworks/models/glm-5p3-flash', label: 'GLM 5.3 Flash' },
  { value: 'accounts/fireworks/models/qwen3p8-max', label: 'Qwen 3.8 Max' },
  { value: 'accounts/fireworks/models/qwen3p7-plus', label: 'Qwen 3.7 Plus (Reasoning)' },
  { value: 'accounts/fireworks/models/minimax-m3', label: 'MiniMax M3' }
];

export const GEMINI_MODELS: ModelOption[] = [
  { value: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }
];

export const modelsForProvider = (provider?: string): ModelOption[] =>
  provider === 'fireworks' ? FIREWORKS_MODELS : GEMINI_MODELS;

export const PROVIDER_LABELS: Record<string, string> = {
  'google-ai-studio': 'Google AI Studio',
  'gemini-enterprise': 'Gemini Enterprise',
  fireworks: 'Fireworks.ai'
};
