'use client';
import { Dispatch, SetStateAction, useState } from 'react';
import { Config } from '@/lib/types';

interface ApiSettingsCardProps {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config>>;
  isSavingConfig: boolean;
  onSave: () => void;
}

export default function ApiSettingsCard({ config, setConfig, isSavingConfig, onSave }: ApiSettingsCardProps) {
  const [showApiKey, setShowApiKey] = useState(false);

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
          <div style={{ display: 'flex', gap: '0.5rem' }}>
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
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
            Your Fireworks API key is saved securely and used for inference requests.
          </p>
        </div>
      ) : (!config.provider || config.provider === 'google-ai-studio') ? (
        <div className="form-group">
          <label className="form-label" htmlFor="geminiApiKey">Gemini API Key</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
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
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
            Your key is saved locally in localStorage and never sent anywhere except directly to Google.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', background: 'rgba(255, 255, 255, 0.01)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.03)', marginBottom: '1.25rem' }}>
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
              <div style={{ display: 'flex', gap: '0.5rem' }}>
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
                style={{ height: '120px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', resize: 'vertical' }}
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
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
                Paste the contents of your Google Cloud Service Account JSON key.
              </p>
            </div>
          )}

          {config.enterpriseAuthMethod === 'adc' && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>
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
          {config.provider === 'fireworks' ? (
            <select
              className="form-input"
              value={config.model}
              onChange={e => setConfig(prev => ({ ...prev, model: e.target.value }))}
            >
              <option value="accounts/fireworks/models/deepseek-v4-pro">DeepSeek V4 Pro (Reasoning)</option>
              <option value="accounts/fireworks/models/deepseek-v4-flash-0731">DeepSeek V4 Flash</option>
              <option value="accounts/fireworks/models/kimi-k3">Kimi K3 (Reasoning)</option>
              <option value="accounts/fireworks/models/glm-5p2">GLM 5.2 (Reasoning)</option>
              <option value="accounts/fireworks/models/minimax-m3">MiniMax M3</option>
              <option value="accounts/fireworks/models/gpt-oss-120b">GPT OSS 120B</option>
              <option value="accounts/fireworks/models/qwen3p8-max">Qwen 3.8 Max</option>
              <option value="accounts/fireworks/models/deepseek-r1">DeepSeek R1 (Reasoning)</option>
              <option value="accounts/fireworks/models/llama-v3p3-70b-instruct">Llama 3.3 70B Instruct</option>
              <option value="custom">Custom Model Name</option>
            </select>
          ) : (
            <select
              className="form-input"
              value={config.model}
              onChange={e => setConfig(prev => ({ ...prev, model: e.target.value }))}
            >
              <option value="gemini-3.7-flash">Gemini 3.7 Flash</option>
              <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
              <option value="gemini-3.1-pro">Gemini 3.1 Pro</option>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
              <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
              <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
              <option value="custom">Custom Model Name</option>
            </select>
          )}
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
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
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
              value={config.reasoningEffort || 'default'}
              onChange={e => setConfig(prev => ({ ...prev, reasoningEffort: e.target.value }))}
            >
              <option value="default">Model default</option>
              <option value="none">None (no reasoning)</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
              Sent as <code>reasoning_effort</code>. Models without reasoning control ignore it.
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
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
            Sent as <code>thinkingConfig.thinkingLevel</code> (Gemini 3+). Levels are relative
            allowances, not token counts &mdash; thinking tokens still come out of the output cap above.
            Pick <em>Model default</em> for pre-Gemini-3 models, which do not accept a level.
          </p>
        </div>
      )}

      <button
        className="btn-primary"
        style={{ marginTop: '1.5rem', background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', boxShadow: '0 4px 15px rgba(59, 130, 246, 0.2)' }}
        disabled={isSavingConfig}
        onClick={onSave}
      >
        {isSavingConfig ? 'Saving Settings...' : 'Save API Settings'}
      </button>
    </section>
  );
}
