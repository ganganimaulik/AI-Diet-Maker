'use client';
/* eslint-disable @next/next/no-img-element */
import { WhatsAppStatus } from '@/lib/types';

interface WhatsAppConnectionCardProps {
  whatsappState: WhatsAppStatus;
  isResettingWhatsapp: boolean;
  onReset: () => void;
}

export default function WhatsAppConnectionCard({ whatsappState, isResettingWhatsapp, onReset }: WhatsAppConnectionCardProps) {
  return (
    <section className="settings-group-card">
      <h3 className="settings-group-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--accent-green)', marginRight: '0.25rem' }}>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        <span>WhatsApp Bot Connection</span>
        <span className={`whatsapp-status-badge ${whatsappState.status}`} style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', marginLeft: 'auto' }}>
          {whatsappState.status === 'ready' && 'Ready'}
          {whatsappState.status === 'connecting' && 'Connecting'}
          {whatsappState.status === 'qr_code' && 'Scan QR'}
          {whatsappState.status === 'disconnected' && 'Offline'}
        </span>
      </h3>

      {whatsappState.status === 'qr_code' && (
        <div style={{ textAlign: 'center', margin: '0.5rem 0' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Scan this QR code with WhatsApp on your phone:
          </p>
          <div className="whatsapp-qr-container">
            <img src={whatsappState.qr} alt="WhatsApp QR Code" className="whatsapp-qr-img" />
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            QR code refreshes automatically.
          </span>
        </div>
      )}

      {whatsappState.status === 'ready' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(16, 185, 129, 0.05)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.15)' }}>
          <span style={{ fontSize: '1.75rem' }}>📱</span>
          <div>
            <div style={{ fontWeight: 700, color: '#fff' }}>{whatsappState.connectedName}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Number: {whatsappState.connectedPhone}</div>
          </div>
        </div>
      )}

      {whatsappState.status === 'disconnected' && (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.5rem 0' }}>
          The WhatsApp background worker is starting up. If this message remains after 30 seconds, please check the Hugging Face space log.
        </p>
      )}

      {whatsappState.status === 'connecting' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0' }}>
          <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px' }}></div>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Initializing WhatsApp Web session...</span>
        </div>
      )}

      <div style={{ marginTop: '1.25rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '1rem' }}>
        <button
          className="btn-secondary"
          style={{
            width: '100%',
            padding: '0.6rem 1rem',
            fontSize: '0.85rem',
            borderColor: 'rgba(244, 63, 94, 0.3)',
            color: '#fca5a5',
            background: 'rgba(244, 63, 94, 0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem'
          }}
          disabled={isResettingWhatsapp}
          onClick={onReset}
        >
          {isResettingWhatsapp ? (
            <>
              <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', borderTopColor: '#fca5a5' }}></div>
              Resetting Connection...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
              </svg>
              Reset WhatsApp Connection
            </>
          )}
        </button>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.5rem', textAlign: 'center', lineHeight: '1.3' }}>
          ⚠️ If you logged out from WhatsApp on your phone or need to switch accounts, use this reset button to clear the session and generate a new QR code.
        </p>
      </div>
    </section>
  );
}
