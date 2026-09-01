'use client';
import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { Config } from '@/lib/types';
import { getReasoningEffortsForModel } from '@/lib/fireworks-helpers';
import { modelsForProvider, PROVIDER_LABELS } from '@/lib/model-options';

const REASONING_EFFORT_LABELS: Record<string, string> = {
  default: 'Model default',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  none: 'None (no reasoning)'
};

interface ApiSettingsCardProps {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config>>;
  isSavingConfig: boolean;
  onSave: () => void;
}

export default function ApiSettingsCard({ config, setConfig, isSavingConfig, onSave }: ApiSettingsCardProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const selectedFireworksModel = config.model === 'custom' ? config.customModel : config.model;
  const supportedReasoningEfforts = getReasoningEffortsForModel(selectedFireworksModel);
  const configuredReasoningEffort = config.reasoningEffort || 'default';
  const displayedReasoningEffort = supportedReasoningEfforts.includes(configuredReasoningEffort)
    ? configuredReasoningEffort
    : 'default';

  // A blank verification provider/model means "reuse the generation one", so
  // the effective values drive the pickers below.
  const verificationInheritsProvider = !config.verificationProvider || config.verificationProvider === config.provider;
  const verificationProvider = config.verificationProvider || config.provider || 'google-ai-studio';
  const selectedVerificationModel = config.verificationModel === 'custom'
    ? config.verificationCustomModel
    : (config.verificationModel || (verificationInheritsProvider ? selectedFireworksModel : ''));
  const supportedVerificationEfforts = getReasoningEffortsForModel(selectedVerificationModel);
  const configuredVerificationEffort = config.verificationReasoningEffort || 'default';
  const displayedVerificationEffort = supportedVerificationEfforts.includes(configuredVerificationEffort)
    ? configuredVerificationEffort
    : 'default';

  // The chat assistant inherits the same way the verification settings do, but
  // usually is pointed somewhere faster: a chat turn makes several model calls.
  const agentInheritsProvider = !config.agentProvider || config.agentProvider === config.provider;
  const agentProvider = config.agentProvider || config.provider || 'google-ai-studio';
  const selectedAgentModel = config.agentModel === 'custom'
    ? config.agentCustomModel
    : (config.agentModel || (agentInheritsProvider ? selectedFireworksModel : ''));
  const supportedAgentEfforts = getReasoningEffortsForModel(selectedAgentModel);
  const configuredAgentEffort = config.agentReasoningEffort || 'default';
  const displayedAgentEffort = supportedAgentEfforts.includes(configuredAgentEffort)
    ? configuredAgentEffort
    : 'default';

  // Retries after the first attempt; the API clamps to the same ceiling, so the
  // picker never offers a value the server would silently reduce.
  const rawAutoRetryLimit = Number(config.verificationMaxRetries ?? 3);
  const autoRetryLimit = Number.isFinite(rawAutoRetryLimit)
    ? Math.min(5, Math.max(0, Math.floor(rawAutoRetryLimit)))
    : 3;

  // A saved effort can become invalid when the user changes models. Reset it
  // immediately so saving or generating cannot send a hidden unsupported value.
  useEffect(() => {
    if (config.provider !== 'fireworks') return;
    const model = config.model === 'custom' ? config.customModel : config.model;
    const supported = getReasoningEffortsForModel(model);
    const current = config.reasoningEffort || 'default';
    if (supported.includes(current)) return;

    setConfig(prev => {
      if (prev.provider !== 'fireworks') return prev;
      const latestModel = prev.model === 'custom' ? prev.customModel : prev.model;
      const latestSupported = getReasoningEffortsForModel(latestModel);
      const latestEffort = prev.reasoningEffort || 'default';
      return latestSupported.includes(latestEffort)
        ? prev
        : { ...prev, reasoningEffort: 'default' };
    });
  }, [config.customModel, config.model, config.provider, config.reasoningEffort, setConfig]);

  // Same guard for the verification model: never let a saved effort survive a
  // model change that no longer supports it.
  useEffect(() => {
    if (verificationProvider !== 'fireworks') return;
    // Recomputed here rather than closed over, so every dependency is a string
    // and the effect does not re-run on unrelated form edits.
    if (getReasoningEffortsForModel(selectedVerificationModel).includes(configuredVerificationEffort)) return;
    setConfig(prev => (prev.verificationReasoningEffort === 'default'
      ? prev
      : { ...prev, verificationReasoningEffort: 'default' }));
  }, [verificationProvider, selectedVerificationModel, configuredVerificationEffort, setConfig]);

  // And the same guard again for the assistant model.
  useEffect(() => {
    if (agentProvider !== 'fireworks') return;
    if (getReasoningEffortsForModel(selectedAgentModel).includes(configuredAgentEffort)) return;
    setConfig(prev => (prev.agentReasoningEffort === 'default'
      ? prev
      : { ...prev, agentReasoningEffort: 'default' }));
  }, [agentProvider, selectedAgentModel, configuredAgentEffort, setConfig]);

  return (
    <section className="settings-group-card">
      <h3 className="settings-group-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--accent-purple)', marginRight: '0.25rem' }}>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
        </svg>
        AI Provider &amp; LLM Settings
      </h3>

      <div className="form-group">
        <label className="form-label">API Provider</label>
        <select
          className="form-input"
          value={config.provider || 'google-ai-studio'}
          onChange={e => {
            const nextProvider = e.target.value;
            setConfig(prev => {
              const prevModel = prev.model || '';
              const prevCustomModel = prev.customModel || '';
              let updatedModel = prevModel;
              let updatedCustomModel = prevCustomModel;
              if (nextProvider === 'fireworks') {
                // Rewrite customModel too, or `model: 'custom'` carries a Gemini id to Fireworks.
                if (!prevModel || prevModel.startsWith('gemini')) {
                  updatedModel = 'accounts/fireworks/models/deepseek-v4-pro';
                }
                if (!prevCustomModel || prevCustomModel.startsWith('gemini')) {
                  updatedCustomModel = 'accounts/fireworks/models/deepseek-v4-pro';
                }
              } else {
                if (prevModel.includes('fireworks')) {
                  updatedModel = 'gemini-3.7-flash';
                }
                if (prevCustomModel.includes('fireworks')) {
                  updatedCustomModel = 'gemini-3.7-flash';
                }
              }
              return {
                ...prev,
                provider: nextProvider,
                model: updatedModel,
                customModel: updatedCustomModel
              };
            });
          }}
        >
          <option value="google-ai-studio">Google AI Studio (Gemini API)</option>
          <option value="gemini-enterprise">Gemini Enterprise Agent Platform (Vertex AI)</option>
          <option value="fireworks">Fireworks.ai (OpenAI-Compatible Inference)</option>
        </select>
      </div>

      {config.provider === 'fireworks' ? (
        <div className="form-group">
          <label className="form-label" htmlFor="fireworksApiKey">Fireworks API Key</label>
          <div className="input-with-action">
            <input
              type={showApiKey ? 'text' : 'password'}
              name="fireworksApiKey"
              id="fireworksApiKey"
              autoComplete="new-password"
              data-1p-ignore="true"
              data-lpignore="true"
              data-bwignore="true"
              spellCheck={false}
              className="form-input"
              placeholder="fw_..."
              value={config.fireworksApiKey || ''}
              onChange={e => setConfig(prev => ({ ...prev, fireworksApiKey: e.target.value }))}
            />
            <button className="btn-secondary" onClick={() => setShowApiKey(!showApiKey)}>
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="note-text">
            Your Fireworks API key is saved securely and used for inference requests.
          </p>
        </div>
      ) : (!config.provider || config.provider === 'google-ai-studio') ? (
        <div className="form-group">
          <label className="form-label" htmlFor="geminiApiKey">Gemini API Key</label>
          <div className="input-with-action">
            <input
              type={showApiKey ? 'text' : 'password'}
              name="geminiApiKey"
              id="geminiApiKey"
              autoComplete="new-password"
              data-1p-ignore="true"
              data-lpignore="true"
              data-bwignore="true"
              spellCheck={false}
              className="form-input"
              placeholder="AIzaSy..."
              value={config.apiKey || ''}
              onChange={e => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
            />
            <button className="btn-secondary" onClick={() => setShowApiKey(!showApiKey)}>
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="note-text">
            Your key is saved locally in localStorage and never sent anywhere except directly to Google.
          </p>
        </div>
      ) : (
        <div className="settings-subgroup">
          <div className="form-group">
            <label className="form-label" htmlFor="enterpriseProjectId">GCP Project ID</label>
            <input
              type="text"
              name="enterpriseProjectId"
              id="enterpriseProjectId"
              autoComplete="off"
              className="form-input"
              placeholder="my-gcp-project-id"
              value={config.enterpriseProjectId || ''}
              onChange={e => setConfig(prev => ({ ...prev, enterpriseProjectId: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Authentication Method</label>
            <select
              className="form-input"
              value={config.enterpriseAuthMethod || 'api-key'}
              onChange={e => setConfig(prev => ({ ...prev, enterpriseAuthMethod: e.target.value }))}
            >
              <option value="api-key">API Key (Express Mode)</option>
              <option value="service-account">Service Account JSON</option>
              <option value="adc">Application Default Credentials (ADC)</option>
            </select>
          </div>

          {config.enterpriseAuthMethod === 'api-key' && (
            <div className="form-group">
              <label className="form-label" htmlFor="enterpriseApiKey">Agent Platform API Key</label>
              <div className="input-with-action">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  name="enterpriseApiKey"
                  id="enterpriseApiKey"
                  autoComplete="new-password"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-bwignore="true"
                  spellCheck={false}
                  className="form-input"
                  placeholder="Agent Platform API Key..."
                  value={config.enterpriseApiKey || ''}
                  onChange={e => setConfig(prev => ({ ...prev, enterpriseApiKey: e.target.value }))}
                />
                <button type="button" className="btn-secondary" onClick={() => setShowApiKey(!showApiKey)}>
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          )}

          {config.enterpriseAuthMethod === 'service-account' && (
            <div className="form-group">
              <label className="form-label">Service Account Key (JSON)</label>
              <textarea
                className="form-input"
                style={{ height: '120px', fontFamily: 'var(--font-mono)' }}
                placeholder='{ "type": "service_account", ... }'
                value={config.enterpriseServiceAccountJson || ''}
                onChange={e => {
                  const val = e.target.value;
                  let updatedProjId = config.enterpriseProjectId;
                  try {
                    const parsed = JSON.parse(val);
                    if (parsed.project_id && !config.enterpriseProjectId) {
                      updatedProjId = parsed.project_id;
                    }
                  } catch {}
                  setConfig(prev => ({
                    ...prev,
                    enterpriseServiceAccountJson: val,
                    enterpriseProjectId: updatedProjId
                  }));
                }}
              />
              <p className="note-text">
                Paste the contents of your Google Cloud Service Account JSON key.
              </p>
            </div>
          )}

          {config.enterpriseAuthMethod === 'adc' && (
            <p className="note-text" style={{ marginTop: 0 }}>
              ℹ️ Authenticating via Application Default Credentials (ADC). Make sure your environment has GCP credentials configured.
            </p>
          )}
        </div>
      )}

      <div className="input-row">
        <div className="form-group">
          <label className="form-label">
            {config.provider === 'fireworks' ? 'Fireworks Model' : 'Gemini Model'}
          </label>
          <select
            className="form-input"
            value={config.model}
            onChange={e => setConfig(prev => ({ ...prev, model: e.target.value }))}
          >
            {modelsForProvider(config.provider).map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
            <option value="custom">Custom Model Name</option>
          </select>
        </div>

        {config.model === 'custom' && (
          <div className="form-group">
            <label className="form-label">Custom Model Name</label>
            <input
              type="text"
              className="form-input"
              value={config.customModel}
              onChange={e => setConfig(prev => ({ ...prev, customModel: e.target.value }))}
              placeholder={config.provider === 'fireworks' ? 'accounts/fireworks/models/...' : 'gemini-3.7-flash'}
            />
          </div>
        )}
      </div>

      <div className="input-row">
        <div className="form-group">
          <label className="form-label">Max Output Tokens</label>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            step="256"
            className="form-input"
            placeholder={config.provider === 'fireworks' ? 'Auto (16384)' : 'Auto (model default)'}
            value={config.maxTokens ? String(config.maxTokens) : ''}
            onChange={e => {
              const parsed = parseInt(e.target.value, 10);
              setConfig(prev => ({ ...prev, maxTokens: Number.isFinite(parsed) && parsed > 0 ? parsed : 0 }));
            }}
          />
          <p className="note-text">
            Caps the response length. Leave blank for the provider default
            ({config.provider === 'fireworks' ? '16,384' : "the model's own limit"}).
            Thinking/reasoning tokens are charged against this same budget.
          </p>
        </div>

        {config.provider === 'fireworks' && (
          <div className="form-group">
            <label className="form-label">Reasoning Effort</label>
            <select
              className="form-input"
              value={displayedReasoningEffort}
              onChange={e => setConfig(prev => ({ ...prev, reasoningEffort: e.target.value }))}
              disabled={supportedReasoningEfforts.length === 1}
            >
              {supportedReasoningEfforts.map(effort => (
                <option key={effort} value={effort}>
                  {REASONING_EFFORT_LABELS[effort] || effort}
                </option>
              ))}
            </select>
            <p className="note-text">
              {supportedReasoningEfforts.length > 1
                ? <>Only levels supported by this model are shown and sent as <code>reasoning_effort</code>.</>
                : <>This model does not expose a compatible <code>reasoning_effort</code> control on Fireworks.</>}
            </p>
          </div>
        )}
      </div>

      {config.provider !== 'fireworks' && (
        <div className="form-group" style={{ marginTop: '0.5rem' }}>
          <label className="form-label">Thinking Level</label>
          <select
            className="form-input"
            value={config.thinkingLevel || 'default'}
            onChange={e => setConfig(prev => ({ ...prev, thinkingLevel: e.target.value }))}
          >
            <option value="default">Model default (dynamic)</option>
            <option value="low">Low (fastest, cheapest)</option>
            <option value="medium">Medium</option>
            <option value="high">High (deepest reasoning)</option>
          </select>
          <p className="note-text">
            Sent as <code>thinkingConfig.thinkingLevel</code> (Gemini 3+). Levels are relative
            allowances, not token counts &mdash; thinking tokens still come out of the output cap above.
            Pick <em>Model default</em> for pre-Gemini-3 models, which do not accept a level.
          </p>
        </div>
      )}

      <div className="settings-subgroup verification-settings">
        <h4 className="settings-subgroup-title">
          <span aria-hidden="true">🔍</span> Plan Verification
        </h4>
        <p className="note-text" style={{ marginTop: 0 }}>
          Every plan is re-checked by re-deriving all weights, calories, macros and the Na:K ratio
          from the reference nutrition table. That pass is pure arithmetic and always runs — no
          model involved. On top of it you can have a model read the plan for instructions it
          ignored and claims its own numbers do not support.
        </p>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={!!config.verificationAiReview}
            onChange={e => setConfig(prev => ({ ...prev, verificationAiReview: e.target.checked }))}
          />
          <span>Also run a second-opinion AI review when verifying</span>
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={config.verificationAutoRetry !== false}
            onChange={e => setConfig(prev => ({ ...prev, verificationAutoRetry: e.target.checked }))}
          />
          <span>Verify automatically after generating, and regenerate until it passes</span>
        </label>

        {config.verificationAutoRetry !== false && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Max Regeneration Retries</label>
            <select
              className="form-input"
              value={String(autoRetryLimit)}
              onChange={e => setConfig(prev => ({ ...prev, verificationMaxRetries: Number(e.target.value) }))}
            >
              <option value="0">0 — verify once, never regenerate</option>
              <option value="1">1 retry (up to 2 generations per day)</option>
              <option value="2">2 retries (up to 3 generations per day)</option>
              <option value="3">3 retries (up to 4 generations per day)</option>
              <option value="4">4 retries (up to 5 generations per day)</option>
              <option value="5">5 retries (up to 6 generations per day)</option>
            </select>
            <p className="note-text">
              A rejected plan is regenerated with the checker&apos;s exact findings appended to the
              prompt, and the retries stop as soon as the arithmetic pass comes back clean. Each
              retry is a full plan generation, so &ldquo;Generate All 7 Days&rdquo; can cost up to{' '}
              {7 * (1 + autoRetryLimit)} generations in the worst case. If the budget runs out, the
              last plan is kept and its failing verdict is shown on the day.
            </p>
          </div>
        )}

        <div className="input-row">
          <div className="form-group">
            <label className="form-label">Verification Provider</label>
            <select
              className="form-input"
              value={config.verificationProvider || ''}
              onChange={e => {
                const nextProvider = e.target.value;
                setConfig(prev => {
                  // Switching to a different provider makes the inherited model
                  // id meaningless, so seed that provider's first model.
                  const effective = nextProvider || prev.provider || 'google-ai-studio';
                  const inherits = !nextProvider || nextProvider === prev.provider;
                  const nextModel = inherits ? (prev.verificationModel || '') : modelsForProvider(effective)[0].value;
                  return {
                    ...prev,
                    verificationProvider: nextProvider,
                    verificationModel: nextModel,
                    verificationReasoningEffort: 'default'
                  };
                });
              }}
            >
              <option value="">
                Same as generation ({PROVIDER_LABELS[config.provider || 'google-ai-studio'] || config.provider})
              </option>
              <option value="google-ai-studio">Google AI Studio (Gemini API)</option>
              <option value="gemini-enterprise">Gemini Enterprise Agent Platform (Vertex AI)</option>
              <option value="fireworks">Fireworks.ai (OpenAI-Compatible Inference)</option>
            </select>
            <p className="note-text">Uses the API key already configured above for that provider.</p>
          </div>

          <div className="form-group">
            <label className="form-label">Verification Model</label>
            <select
              className="form-input"
              value={config.verificationModel || ''}
              onChange={e => setConfig(prev => ({ ...prev, verificationModel: e.target.value }))}
            >
              {verificationInheritsProvider && (
                <option value="">Same as generation model</option>
              )}
              {modelsForProvider(verificationProvider).map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option value="custom">Custom Model Name</option>
            </select>
            <p className="note-text">
              A model that did not write the plan makes a better reviewer than the one that did.
            </p>
          </div>
        </div>

        {config.verificationModel === 'custom' && (
          <div className="form-group">
            <label className="form-label">Custom Verification Model Name</label>
            <input
              type="text"
              className="form-input"
              value={config.verificationCustomModel || ''}
              onChange={e => setConfig(prev => ({ ...prev, verificationCustomModel: e.target.value }))}
              placeholder={verificationProvider === 'fireworks' ? 'accounts/fireworks/models/...' : 'gemini-3.7-flash'}
            />
          </div>
        )}

        <div className="input-row">
          {verificationProvider === 'fireworks' ? (
            <div className="form-group">
              <label className="form-label">Verification Reasoning Effort</label>
              <select
                className="form-input"
                value={displayedVerificationEffort}
                onChange={e => setConfig(prev => ({ ...prev, verificationReasoningEffort: e.target.value }))}
                disabled={supportedVerificationEfforts.length === 1}
              >
                {supportedVerificationEfforts.map(effort => (
                  <option key={effort} value={effort}>{REASONING_EFFORT_LABELS[effort] || effort}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label">Verification Thinking Level</label>
              <select
                className="form-input"
                value={config.verificationThinkingLevel || 'default'}
                onChange={e => setConfig(prev => ({ ...prev, verificationThinkingLevel: e.target.value }))}
              >
                <option value="default">Model default (dynamic)</option>
                <option value="low">Low (fastest, cheapest)</option>
                <option value="medium">Medium</option>
                <option value="high">High (deepest reasoning)</option>
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Verification Max Output Tokens</label>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="256"
              className="form-input"
              placeholder="Auto (8192)"
              value={config.verificationMaxTokens ? String(config.verificationMaxTokens) : ''}
              onChange={e => {
                const parsed = parseInt(e.target.value, 10);
                setConfig(prev => ({ ...prev, verificationMaxTokens: Number.isFinite(parsed) && parsed > 0 ? parsed : 0 }));
              }}
            />
            <p className="note-text">A review is short; the default keeps reasoning models from running long.</p>
          </div>
        </div>
      </div>

      <div className="settings-subgroup assistant-settings">
        <h4 className="settings-subgroup-title">
          <span aria-hidden="true">💬</span> Chat Assistant
        </h4>
        <p className="note-text" style={{ marginTop: 0 }}>
          Powers the Assistant tab. It answers by reading your configuration, plans and
          verification verdicts straight from the database &mdash; read-only, with no way to change
          anything or send a message. One question can take several model calls in a row, so a fast
          model here beats a deep one.
        </p>

        <div className="input-row">
          <div className="form-group">
            <label className="form-label">Assistant Provider</label>
            <select
              className="form-input"
              value={config.agentProvider || ''}
              onChange={e => {
                const nextProvider = e.target.value;
                setConfig(prev => {
                  const effective = nextProvider || prev.provider || 'google-ai-studio';
                  const inherits = !nextProvider || nextProvider === prev.provider;
                  const nextModel = inherits ? (prev.agentModel || '') : modelsForProvider(effective)[0].value;
                  return {
                    ...prev,
                    agentProvider: nextProvider,
                    agentModel: nextModel,
                    agentReasoningEffort: 'default'
                  };
                });
              }}
            >
              <option value="">
                Same as generation ({PROVIDER_LABELS[config.provider || 'google-ai-studio'] || config.provider})
              </option>
              <option value="google-ai-studio">Google AI Studio (Gemini API)</option>
              <option value="gemini-enterprise">Gemini Enterprise Agent Platform (Vertex AI)</option>
              <option value="fireworks">Fireworks.ai (OpenAI-Compatible Inference)</option>
            </select>
            <p className="note-text">
              The model must support tool calling, which every model in these lists does.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Assistant Model</label>
            <select
              className="form-input"
              value={config.agentModel || ''}
              onChange={e => setConfig(prev => ({ ...prev, agentModel: e.target.value }))}
            >
              {agentInheritsProvider && (
                <option value="">Same as generation model</option>
              )}
              {modelsForProvider(agentProvider).map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option value="custom">Custom Model Name</option>
            </select>
          </div>
        </div>

        {config.agentModel === 'custom' && (
          <div className="form-group">
            <label className="form-label">Custom Assistant Model Name</label>
            <input
              type="text"
              className="form-input"
              value={config.agentCustomModel || ''}
              onChange={e => setConfig(prev => ({ ...prev, agentCustomModel: e.target.value }))}
              placeholder={agentProvider === 'fireworks' ? 'accounts/fireworks/models/...' : 'gemini-3.7-flash'}
            />
          </div>
        )}

        <div className="input-row">
          {agentProvider === 'fireworks' ? (
            <div className="form-group">
              <label className="form-label">Assistant Reasoning Effort</label>
              <select
                className="form-input"
                value={displayedAgentEffort}
                onChange={e => setConfig(prev => ({ ...prev, agentReasoningEffort: e.target.value }))}
                disabled={supportedAgentEfforts.length === 1}
              >
                {supportedAgentEfforts.map(effort => (
                  <option key={effort} value={effort}>{REASONING_EFFORT_LABELS[effort] || effort}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label">Assistant Thinking Level</label>
              <select
                className="form-input"
                value={config.agentThinkingLevel || 'default'}
                onChange={e => setConfig(prev => ({ ...prev, agentThinkingLevel: e.target.value }))}
              >
                <option value="default">Model default (dynamic)</option>
                <option value="low">Low (fastest, cheapest)</option>
                <option value="medium">Medium</option>
                <option value="high">High (deepest reasoning)</option>
              </select>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Assistant Max Output Tokens</label>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="256"
              className="form-input"
              placeholder="Auto (8192)"
              value={config.agentMaxTokens ? String(config.agentMaxTokens) : ''}
              onChange={e => {
                const parsed = parseInt(e.target.value, 10);
                setConfig(prev => ({ ...prev, agentMaxTokens: Number.isFinite(parsed) && parsed > 0 ? parsed : 0 }));
              }}
            />
            <p className="note-text">Applies to each model call in a turn, not the whole answer.</p>
          </div>
        </div>
      </div>

      <button
        className="btn-primary"
        style={{ marginTop: '0.5rem', background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', boxShadow: '0 4px 15px rgba(59, 130, 246, 0.2)' }}
        disabled={isSavingConfig}
        onClick={onSave}
      >
        {isSavingConfig ? 'Saving Settings...' : 'Save API Settings'}
      </button>
    </section>
  );
}
