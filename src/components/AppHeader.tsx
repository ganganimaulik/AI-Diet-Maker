'use client';
import { Config, WhatsAppStatus } from '@/lib/types';

interface AppHeaderProps {
  currentView: 'planner' | 'connections';
  onSelectPlanner: () => void;
  onSelectConnections: () => void;
  whatsappState: WhatsAppStatus;
  config: Config;
  onLogout: () => void;
}

export default function AppHeader({
  currentView,
  onSelectPlanner,
  onSelectConnections,
  whatsappState,
  config,
  onLogout
}: AppHeaderProps) {
  const hasApiCredentials =
    (config.provider === 'fireworks' && (config.fireworksApiKey || config.apiKey)) ||
    (config.provider === 'gemini-enterprise' && (
      (config.enterpriseAuthMethod === 'api-key' && config.enterpriseApiKey) ||
      (config.enterpriseAuthMethod === 'service-account' && config.enterpriseServiceAccountJson) ||
      (config.enterpriseAuthMethod === 'adc')
    ) && config.enterpriseProjectId) ||
    (config.provider !== 'gemini-enterprise' && config.provider !== 'fireworks' && config.apiKey);

  return (
    <header className="header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
        <div className="header-title-container">
          <h1 className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ filter: 'drop-shadow(0 0 8px rgba(168, 85, 247, 0.45))' }}>🥗</span> AI Diet Maker
          </h1>
          <p className="header-subtitle">Strict meal prep calculator, solved via Gemini &amp; Fireworks Reasoning Models</p>
        </div>

        <nav className="header-nav">
          <button
            className={`header-nav-btn ${currentView === 'planner' ? 'active' : ''}`}
            onClick={onSelectPlanner}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
            Diet Planner
          </button>
          <button
            className={`header-nav-btn ${currentView === 'connections' ? 'active' : ''}`}
            onClick={onSelectConnections}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            Settings &amp; Connections
          </button>
        </nav>
      </div>

      <div className="header-status-container">
        <div
          className="clickable-status-pill"
          onClick={onSelectConnections}
          title="Configure WhatsApp connection"
        >
          <span className={`whatsapp-status-badge ${whatsappState.status}`}>
            {whatsappState.status === 'ready' && 'WhatsApp Ready'}
            {whatsappState.status === 'connecting' && 'WhatsApp Connecting'}
            {whatsappState.status === 'qr_code' && 'WhatsApp Scan QR'}
            {whatsappState.status === 'disconnected' && 'WhatsApp Offline'}
          </span>
        </div>

        <div
          className="clickable-status-pill"
          onClick={onSelectConnections}
          title="Configure Gemini API credentials"
        >
          {hasApiCredentials ? (
            <span className="api-key-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ marginRight: '0.2rem' }}>
                <path d="M20 6L9 17l-5-5"/>
              </svg>
              API Active
            </span>
          ) : (
            <span className="api-key-badge missing">
              ⚠️ API Credentials Needed
            </span>
          )}
        </div>

        <button className="btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }} onClick={onLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}
