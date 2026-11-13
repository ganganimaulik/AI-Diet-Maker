interface WorkerStatusCardProps {
  workerStatus: string;
  workerDetails: { hardware: string; sdk: string } | null;
}

// Health of the WhatsApp worker (Docker on an Oracle Cloud Always-Free VM),
// as reported by /api/whatsapp/status.
export default function WorkerStatusCard({ workerStatus, workerDetails }: WorkerStatusCardProps) {
  const online = workerStatus === 'RUNNING';
  const badgeClass = online
    ? 'ready'
    : (workerStatus === 'DOWN' || workerStatus === 'TIMEOUT' || workerStatus === 'UNREACHABLE')
      ? 'disconnected'
      : 'qr_code';
  const badgeLabel =
    workerStatus === 'RUNNING' ? 'Online' :
    workerStatus === 'DOWN' ? 'Down' :
    (workerStatus === 'TIMEOUT' || workerStatus === 'UNREACHABLE') ? 'Unreachable' :
    workerStatus;

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

      {workerDetails && (
        <div className="info-tile info-tile--wide" style={{ marginTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
          <div style={{ fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>Worker:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', overflowWrap: 'anywhere' }}>
            <span>💻 Host: {workerDetails.hardware}</span>
            <span>🛠️ Runtime: {workerDetails.sdk}</span>
          </div>
        </div>
      )}

      <p className="note-text" style={{ marginTop: '1rem' }}>
        ℹ️ Deploys automatically on every push to <code>main</code> (GitHub Actions → Oracle VM). No keep-alive needed — the VM never sleeps.
      </p>
    </section>
  );
}
