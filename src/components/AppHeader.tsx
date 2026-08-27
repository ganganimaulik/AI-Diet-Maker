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

const WHATSAPP_LABEL: Record<string, string> = {
  ready: 'WhatsApp Ready',
  connecting: 'WhatsApp Connecting',
  qr_code: 'WhatsApp Scan QR',
  disconnected: 'WhatsApp Offline'
};

export default function AppHeader({
  currentView,
  onSelectPlanner,
  onSelectConnections,
  whatsappState,
  config,
  onLogout
}: AppHeaderProps) {
  const hasApiCredentials =
    (config.provider === 'fireworks' && config.fireworksApiKey) ||
    (config.provider === 'gemini-enterprise' && (
      (config.enterpriseAuthMethod === 'api-key' && config.enterpriseApiKey) ||
      (config.enterpriseAuthMethod === 'service-account' && config.enterpriseServiceAccountJson) ||
      (config.enterpriseAuthMethod === 'adc')
    ) && config.enterpriseProjectId) ||
    (config.provider !== 'gemini-enterprise' && config.provider !== 'fireworks' && config.apiKey);

  const whatsappLabel = WHATSAPP_LABEL[whatsappState.status] || 'WhatsApp';
  const apiLabel = hasApiCredentials ? 'API Active' : 'API Credentials Needed';

  return (
    <header className="app-header">
      <div className="app-header__bar">
        <div className="app-header__brand">
          <span className="app-header__logo" aria-hidden="true">🥗</span>
          <div className="app-header__titles">
            <h1 className="app-header__title">AI Diet Maker</h1>
            <p className="app-header__subtitle">Strict meal prep calculator, solved via Gemini &amp; Fireworks Reasoning Models</p>
          </div>
        </div>

        {/* Status reads as a coloured dot on phones and a full pill from md up. */}
        <div className="app-header__status">
          <button
            type="button"
            className="status-pill"
            onClick={onSelectConnections}
            title={whatsappLabel}
            aria-label={whatsappLabel}
          >
            <span className={`whatsapp-status-badge ${whatsappState.status}`}>
              <span className="badge-label">{whatsappLabel}</span>
            </span>
          </button>

          <button
            type="button"
            className="status-pill"
            onClick={onSelectConnections}
            title={apiLabel}
            aria-label={apiLabel}
          >
            {hasApiCredentials ? (
              <span className="api-key-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
                <span className="badge-label">API Active</span>
              </span>
            ) : (
              <span className="api-key-badge missing">
                <span aria-hidden="true">⚠️</span>
                <span className="badge-label">API Credentials Needed</span>
              </span>
            )}
          </button>

          <button type="button" className="app-header__logout" onClick={onLogout} aria-label="Log out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span className="app-header__logout-label">Logout</span>
          </button>
        </div>
      </div>

      <nav className="header-nav">
        <button
          className={`header-nav-btn ${currentView === 'planner' ? 'active' : ''}`}
          onClick={onSelectPlanner}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
          <span className="label-short">Planner</span>
          <span className="label-long">Diet Planner</span>
        </button>
        <button
          className={`header-nav-btn ${currentView === 'connections' ? 'active' : ''}`}
          onClick={onSelectConnections}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span className="label-short">Settings</span>
          <span className="label-long">Settings &amp; Connections</span>
        </button>
      </nav>
    </header>
  );
}
