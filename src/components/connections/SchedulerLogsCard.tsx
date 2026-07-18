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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
        <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.02)' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>Last Sent Date</div>
          <div style={{ fontWeight: 700, color: '#fff', marginTop: '0.25rem' }}>{schedulerState.lastSentDate || 'Never'}</div>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.02)' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>Retry Attempts</div>
          <div style={{ fontWeight: 700, color: schedulerState.retryCount > 0 ? 'var(--accent-rose)' : '#fff', marginTop: '0.25rem' }}>
            {schedulerState.retryCount}
          </div>
        </div>

        {schedulerState.retryCount > 0 && (
          <div style={{ gridColumn: 'span 2', background: 'rgba(244, 63, 94, 0.05)', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(244, 63, 94, 0.15)' }}>
            <div style={{ color: 'var(--accent-rose)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700 }}>Next Auto Retry</div>
            <div style={{ fontWeight: 700, color: '#fff', marginTop: '0.25rem' }}>
              {new Date(schedulerState.nextRetryTime).toLocaleString()}
            </div>
          </div>
        )}

        {schedulerState.lastError && (
          <div style={{ gridColumn: 'span 2', background: 'rgba(0,0,0,0.2)', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.02)', color: '#fda4af' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>Last Error Log</div>
            <div style={{ marginTop: '0.25rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>
              {schedulerState.lastError}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
