'use client';
import { SchedulerState } from '@/lib/types';

interface SchedulerLogsCardProps {
  schedulerState: SchedulerState;
}

export default function SchedulerLogsCard({ schedulerState }: SchedulerLogsCardProps) {
  return (
    <section className="settings-group-card">
      <h3 className="settings-group-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--accent-rose)', marginRight: '0.25rem' }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        Scheduler Status Logs
      </h3>

      <div className="info-tiles">
        <div className="info-tile">
          <div className="info-tile__label">Last Sent Date</div>
          <div className="info-tile__value">{schedulerState.lastSentDate || 'Never'}</div>
        </div>

        <div className="info-tile">
          <div className="info-tile__label">Retry Attempts</div>
          <div className="info-tile__value" style={{ color: schedulerState.retryCount > 0 ? 'var(--accent-rose)' : '#fff' }}>
            {schedulerState.retryCount}
          </div>
        </div>

        {schedulerState.retryCount > 0 && (
          <div className="info-tile info-tile--wide info-tile--danger">
            <div className="info-tile__label" style={{ color: 'var(--accent-rose)' }}>Next Auto Retry</div>
            <div className="info-tile__value">
              {new Date(schedulerState.nextRetryTime).toLocaleString()}
            </div>
          </div>
        )}

        {schedulerState.lastError && (
          <div className="info-tile info-tile--wide">
            <div className="info-tile__label">Last Error Log</div>
            <div className="info-tile__log">
              {schedulerState.lastError}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
