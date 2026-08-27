'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Dispatch, SetStateAction } from 'react';
import { Config } from '@/lib/types';

// The worker was migrated off Hugging Face Spaces to an Oracle Cloud
// Always-Free VM (Docker). This card now reflects that worker's health;
// /api/whatsapp/status pings the worker's own health endpoint. The prop shape
// is kept (config/setConfig/onSave/onWakeUp/etc.) so the call site in
// page.tsx does not need to change.
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
        <span>WhatsApp Worker (Oracle VM)</span>
        <span className={`whatsapp-status-badge ${badgeClass}`} style={{ marginLeft: 'auto' }}>
          {badgeLabel}
        </span>
      </h3>

      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        The worker runs 24/7 in Docker on an Oracle Cloud Always-Free VM. It
        auto-restarts on crash or reboot and reconnects to WhatsApp and
        MongoDB automatically.
      </div>

      {hfDetails && (
        <div className="info-tile info-tile--wide" style={{ marginTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
          <div style={{ fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>Worker:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', overflowWrap: 'anywhere' }}>
            <span>💻 Host: {hfDetails.hardware}</span>
            <span>🛠️ Runtime: {hfDetails.sdk}</span>
          </div>
        </div>
      )}

      <p className="note-text" style={{ marginTop: '1rem' }}>
        ℹ️ Deploys automatically on every push to <code>main</code> (GitHub Actions → Oracle VM). No keep-alive needed — the VM never sleeps.
      </p>
    </section>
  );
}
