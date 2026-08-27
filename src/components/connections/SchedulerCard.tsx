'use client';
import { WhatsAppHook } from '@/hooks/useWhatsApp';
import ContactPicker from './ContactPicker';

interface SchedulerCardProps {
  whatsapp: WhatsAppHook;
}

export default function SchedulerCard({ whatsapp }: SchedulerCardProps) {
  const {
    whatsappState,
    schedulerState,
    setSchedulerState,
    setIsSchedulerDirty,
    contacts,
    isSavingScheduler,
    testSendStatus,
    saveSchedulerDb,
    saveSchedulerSettings,
    handleSendTestMessage
  } = whatsapp;

  // Update recipient fields and auto-save to DB (used by both pickers)
  const applyRecipientChange = (fields: Partial<typeof schedulerState>) => {
    const newState = { ...schedulerState, ...fields };
    setSchedulerState(newState);
    setIsSchedulerDirty(true);
    saveSchedulerDb(newState)
      .then(() => setIsSchedulerDirty(false))
      .catch(e => {
        console.error('Failed to auto-save:', e);
        setIsSchedulerDirty(false);
      });
  };

  return (
    <section className="settings-group-card">
      <h3 className="settings-group-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--accent-cyan)', marginRight: '0.25rem' }}>
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        Daily Auto-Send Scheduler
      </h3>

      <div className="form-group" style={{ marginBottom: '1.25rem' }}>
        <button
          type="button"
          role="switch"
          aria-checked={schedulerState.isEnabled}
          className={`switch-container ${schedulerState.isEnabled ? 'checked' : ''}`}
          style={{ background: 'none', border: 'none', padding: 0, color: 'inherit' }}
          onClick={() => {
            setSchedulerState(prev => ({ ...prev, isEnabled: !prev.isEnabled }));
            setIsSchedulerDirty(true);
          }}
        >
          <span className="switch-control"></span>
          <span className="form-label" style={{ margin: 0, cursor: 'pointer' }}>Enable Automated Sending</span>
        </button>
      </div>

      <div className="input-row" style={{ marginBottom: '1rem' }}>
        <div className="form-group">
          <label className="form-label">Send Time (Daily)</label>
          <input
            type="time"
            className="form-input"
            value={schedulerState.targetTime}
            onChange={e => {
              setSchedulerState(prev => ({ ...prev, targetTime: e.target.value }));
              setIsSchedulerDirty(true);
            }}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Timezone</label>
          <select
            className="form-input"
            value={schedulerState.timezone || 'Asia/Kolkata'}
            onChange={e => {
              setSchedulerState(prev => ({ ...prev, timezone: e.target.value }));
              setIsSchedulerDirty(true);
            }}
          >
            <option value="Asia/Kolkata">India (IST) - GMT+5:30</option>
            <option value="UTC">Coordinated Universal Time (UTC)</option>
            <option value="America/New_York">US East (EST/EDT)</option>
            <option value="America/Chicago">US Central (CST/CDT)</option>
            <option value="America/Denver">US Mountain (MST/MDT)</option>
            <option value="America/Los_Angeles">US West (PST/PDT)</option>
            <option value="Europe/London">London (GMT/BST)</option>
            <option value="Europe/Paris">Paris (CET/CEST)</option>
            <option value="Asia/Singapore">Singapore (SGT)</option>
            <option value="Asia/Dubai">Dubai (GST)</option>
            <option value="Australia/Sydney">Sydney (AEST/AEDT)</option>
          </select>
        </div>
      </div>

      <div className="input-row" style={{ marginBottom: '1rem' }}>
        <ContactPicker
          label="Cook Recipient (Part 2: For Cook)"
          contacts={contacts}
          selectedId={schedulerState.recipientId}
          selectedName={schedulerState.recipientName}
          selectedType={schedulerState.recipientType}
          onSelect={(id, name, type) => applyRecipientChange({
            recipientId: id,
            recipientName: name,
            recipientType: type
          })}
          onClear={() => applyRecipientChange({
            recipientId: '',
            recipientName: '',
            recipientType: 'contact'
          })}
        />

        <ContactPicker
          label="Myself Recipient (Part 1: For Myself)"
          contacts={contacts}
          selectedId={schedulerState.userRecipientId}
          selectedName={schedulerState.userRecipientName}
          selectedType={schedulerState.userRecipientType}
          accent="cyan"
          onSelect={(id, name, type) => applyRecipientChange({
            userRecipientId: id,
            userRecipientName: name,
            userRecipientType: type
          })}
          onClear={() => applyRecipientChange({
            userRecipientId: '',
            userRecipientName: '',
            userRecipientType: 'contact'
          })}
        />
      </div>

      <div className="settings-actions">
        <button
          className="btn-primary"
          onClick={saveSchedulerSettings}
          disabled={isSavingScheduler}
        >
          {isSavingScheduler ? 'Saving...' : 'Save Settings'}
        </button>

        <button
          className="btn-secondary"
          style={{ border: '1px solid var(--accent-cyan)', color: 'var(--accent-cyan)' }}
          onClick={() => handleSendTestMessage('myself')}
          disabled={testSendStatus.status === 'sending' || whatsappState.status !== 'ready' || !schedulerState.userRecipientId}
        >
          {testSendStatus.status === 'sending' ? 'Sending...' : 'Test Myself'}
        </button>

        <button
          className="btn-secondary"
          style={{ border: '1px solid var(--accent-purple)' }}
          onClick={() => handleSendTestMessage('cook')}
          disabled={testSendStatus.status === 'sending' || whatsappState.status !== 'ready' || !schedulerState.recipientId}
        >
          {testSendStatus.status === 'sending' ? 'Sending...' : 'Test Cook'}
        </button>
      </div>

      {!schedulerState.recipientId && !schedulerState.userRecipientId && whatsappState.status === 'ready' && (
        <div className="callout callout--danger">
          ⚠️ Select at least one recipient (Cook or Myself) above to enable test sending.
        </div>
      )}

      {testSendStatus.message && (
        <div className={`callout ${testSendStatus.status === 'success' ? 'callout--success' : testSendStatus.status === 'error' ? 'callout--danger' : 'callout--neutral'}`}>
          {testSendStatus.message}
        </div>
      )}
    </section>
  );
}
