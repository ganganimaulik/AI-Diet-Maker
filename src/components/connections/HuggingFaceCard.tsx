'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Dispatch, SetStateAction } from 'react';
import { Config } from '@/lib/types';

// The worker was migrated off Hugging Face Spaces to a GCP Compute Engine VM.
// This card now reflects that worker's health; /api/whatsapp/status pings the
// worker's own health endpoint. The prop shape is kept (config/setConfig/onSave/
// onWakeUp/etc.) so the call site in page.tsx does not need to change.
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

export default function HuggingFaceCard({ hfStatus, hfDetails }: HuggingFaceCardProps) {
  const online = hfStatus === 'RUNNING';
  const badgeClass = online
    ? 'ready'
    : (hfStatus === 'DOWN' || hfStatus === 'TIMEOUT' || hfStatus === 'UNREACHABLE')
      ? 'disconnected'
      : 'qr_code';
  const badgeLabel =
    hfStatus === 'RUNNING' ? 'Online' :
    hfStatus === 'DOWN' ? 'Down' :
    (hfStatus === 'TIMEOUT' || hfStatus === 'UNREACHABLE') ? 'Unreachable' :
    hfStatus;

  return (
    <section className="settings-group-card animate-fadeIn">
      <h3 className="settings-group-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--accent-purple)', marginRight: '0.25rem' }}>
          <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
          <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
          <line x1="6" y1="6" x2="6.01" y2="6" />
          <line x1="6" y1="18" x2="6.01" y2="18" />
        </svg>
        <span>WhatsApp Worker (GCP VM)</span>
        <span className={`whatsapp-status-badge ${badgeClass}`} style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', marginLeft: 'auto' }}>
          {badgeLabel}
        </span>
      </h3>

      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        The worker runs 24/7 on a Google Cloud VM under PM2. It auto-restarts on
        crash or reboot and reconnects to WhatsApp and MongoDB automatically.
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
          <div style={{ fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>Worker:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <span>💻 Host: {hfDetails.hardware}</span>
            <span>🛠️ Runtime: {hfDetails.sdk}</span>
          </div>
        </div>
      )}

      <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '1rem', lineHeight: '1.4' }}>
        ℹ️ Deploys automatically on every push to <code>main</code> (GitHub Actions → GCP VM). No keep-alive needed — the VM never sleeps.
      </p>
    </section>
  );
}
