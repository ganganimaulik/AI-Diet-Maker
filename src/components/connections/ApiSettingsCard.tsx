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
        Gemini API &amp; LLM Settings
      </h3>

      <div className="form-group">
        <label className="form-label">API Provider</label>
        <select
          className="form-input"
          value={config.provider || 'google-ai-studio'}
          onChange={e => setConfig(prev => ({ ...prev, provider: e.target.value }))}
        >
          <option value="google-ai-studio">Google AI Studio (Gemini API)</option>
          <option value="gemini-enterprise">Gemini Enterprise Agent Platform (Vertex AI)</option>
        </select>
      </div>

      {(!config.provider || config.provider === 'google-ai-studio') ? (
        <div className="form-group">
          <label className="form-label">Gemini API Key</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type={showApiKey ? 'text' : 'password'}
              className="form-input"
              placeholder="AIzaSy..."
              value={config.apiKey}
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
            <label className="form-label">GCP Project ID</label>
            <input
              type="text"
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
              <label className="form-label">Agent Platform API Key</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
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
          <label className="form-label">Gemini Model</label>
          <select
            className="form-input"
            value={config.model}
            onChange={e => setConfig(prev => ({ ...prev, model: e.target.value }))}
          >
            <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
            <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
            <option value="gemini-3.1-pro">Gemini 3.1 Pro</option>
            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
            <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
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
              placeholder="gemini-3.6-flash"
            />
          </div>
        )}
      </div>

      <div className="form-group" style={{ marginTop: '0.5rem' }}>
        <div
          className={`switch-container ${config.thinkingEnabled ? 'checked' : ''}`}
          onClick={() => setConfig(prev => ({ ...prev, thinkingEnabled: !prev.thinkingEnabled }))}
        >
          <div className="switch-control"></div>
          <span className="form-label" style={{ margin: 0, cursor: 'pointer' }}>Enable Thinking Mode</span>
        </div>
      </div>

      {config.thinkingEnabled && (
        <div className="form-group">
          <label className="form-label">Thinking Budget ({config.thinkingBudget} tokens)</label>
          <input
            type="range"
            min="1024"
            max="8192"
            step="1024"
            value={config.thinkingBudget}
            onChange={e => setConfig(prev => ({ ...prev, thinkingBudget: parseInt(e.target.value) }))}
            style={{ width: '100%', accentColor: 'var(--accent-purple)' }}
          />
          <p style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            <span>1024 (Low)</span>
            <span>4096 (Med)</span>
            <span>8192 (High)</span>
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
