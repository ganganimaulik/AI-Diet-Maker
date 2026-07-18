'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Dispatch, SetStateAction, useState } from 'react';
import { Config } from '@/lib/types';

interface HuggingFaceCardProps {
  config: Config;
  setConfig: Dispatch<SetStateAction<Config>>;
  hfStatus: string;
  hfDetails: any;
  wakingUp: boolean;
  isSavingConfig: boolean;
  onSave: () => void;
  onWakeUp: () => void;
}

export default function HuggingFaceCard({
  config,
  setConfig,
  hfStatus,
  hfDetails,
  wakingUp,
  isSavingConfig,
  onSave,
  onWakeUp
}: HuggingFaceCardProps) {
  const [showHfToken, setShowHfToken] = useState(false);

  return (
    <section className="settings-group-card animate-fadeIn">
      <h3 className="settings-group-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--accent-purple)', marginRight: '0.25rem' }}>
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
        </svg>
        <span>Hugging Face Space &amp; Keep-Alive</span>
        <span className={`whatsapp-status-badge ${
          hfStatus === 'RUNNING' ? 'ready' :
          hfStatus === 'SLEEPING' ? 'disconnected' :
          (hfStatus === 'BUILDING' || hfStatus === 'STARTING') ? 'connecting' : 'qr_code'
        }`} style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', marginLeft: 'auto' }}>
          {hfStatus === 'RUNNING' && 'Running'}
          {hfStatus === 'SLEEPING' && 'Sleeping'}
          {(hfStatus === 'BUILDING' || hfStatus === 'STARTING') && 'Building...'}
          {hfStatus === 'UNAUTHORIZED' && 'Unauthorized'}
          {hfStatus === 'NOT_CONFIGURED' && 'Not Configured'}
          {hfStatus !== 'RUNNING' && hfStatus !== 'SLEEPING' && hfStatus !== 'BUILDING' && hfStatus !== 'STARTING' && hfStatus !== 'UNAUTHORIZED' && hfStatus !== 'NOT_CONFIGURED' && hfStatus}
        </span>
      </h3>

      <div className="form-group">
        <label className="form-label">Space Repository ID</label>
        <input
          type="text"
          className="form-input"
          placeholder="username/space-name"
          value={config.huggingFaceSpace || ''}
          onChange={e => {
            const val = e.target.value;
            setConfig(prev => ({ ...prev, huggingFaceSpace: val }));
          }}
        />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
          Format: `username/space-name` (e.g., `ganganimaulik/diet-maker-worker`).
        </p>
      </div>

      <div className="form-group">
        <label className="form-label">Hugging Face Read Token (Optional)</label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type={showHfToken ? 'text' : 'password'}
            className="form-input"
            placeholder="hf_..."
            value={config.huggingFaceToken || ''}
            onChange={e => {
              const val = e.target.value;
              setConfig(prev => ({ ...prev, huggingFaceToken: val }));
            }}
          />
          <button type="button" className="btn-secondary" onClick={() => setShowHfToken(!showHfToken)}>
            {showHfToken ? 'Hide' : 'Show'}
          </button>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
          Required only if your Hugging Face Space is <strong>Private</strong>. Access tokens can be generated in your Hugging Face account settings.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
        <button
          className="btn-primary"
          style={{ flex: 1, padding: '0.6rem 1rem', fontSize: '0.85rem' }}
          onClick={onSave}
          disabled={isSavingConfig}
        >
          {isSavingConfig ? 'Saving...' : 'Save Settings'}
        </button>

        <button
          className="btn-secondary"
          style={{ flex: 1, padding: '0.6rem 1rem', fontSize: '0.85rem', border: '1px solid var(--accent-purple)' }}
          onClick={onWakeUp}
          disabled={wakingUp || !config.huggingFaceSpace}
        >
          {wakingUp ? 'Waking Up...' : 'Wake Up Space'}
        </button>
      </div>

      {hfDetails && (
        <div style={{
          marginTop: '1rem',
          fontSize: '0.8rem',
          padding: '0.75rem',
          borderRadius: '8px',
          background: 'rgba(0,0,0,0.2)',
          border: '1px solid rgba(255,255,255,0.03)',
          color: 'var(--text-secondary)'
        }}>
          <div style={{ fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>Space Specifications:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <span>💻 Hardware: {hfDetails.hardware}</span>
            <span>🛠️ SDK: {hfDetails.sdk}</span>
          </div>
        </div>
      )}

      <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '1rem', lineHeight: '1.4' }}>
        ℹ️ Free Hugging Face Spaces sleep after 48 hours of inactivity. When you open this dashboard, it will automatically check the status and trigger a wake-up request if the Space is sleeping.
      </p>
    </section>
  );
}
