'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { Config, ContactEntry, SchedulerState, WhatsAppStatus } from '@/lib/types';

interface UseWhatsAppArgs {
  isAuthenticated: boolean | null;
  activeTab: string;
  currentView: string;
  config: Config;
  saveConfig: (configToSave?: Config) => Promise<void>;
}

/**
 * WhatsApp worker status polling, contacts, scheduler settings and
 * Hugging Face Space status — extracted from page.tsx.
 */
export function useWhatsApp({ isAuthenticated, activeTab, currentView, config, saveConfig }: UseWhatsAppArgs) {
  const [whatsappState, setWhatsappState] = useState<WhatsAppStatus>({
    status: 'disconnected',
    qr: '',
    connectedPhone: '',
    connectedName: '',
  });
  const [schedulerState, setSchedulerState] = useState<SchedulerState>({
    isEnabled: false,
    targetTime: '14:00',
    timezone: 'Asia/Kolkata',
    recipientType: 'contact',
    recipientId: '',
    recipientName: '',
    userRecipientType: 'contact',
    userRecipientId: '',
    userRecipientName: '',
    lastSentDate: '',
    lastSentTime: '',
    lastError: '',
    retryCount: 0,
    nextRetryTime: 0,
  });
  const [isSchedulerDirty, setIsSchedulerDirtyState] = useState(false);
  const isSchedulerDirtyRef = useRef(false);
  const setIsSchedulerDirty = (value: boolean) => {
    isSchedulerDirtyRef.current = value;
    setIsSchedulerDirtyState(value);
  };
  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [isSavingScheduler, setIsSavingScheduler] = useState(false);
  const [testSendStatus, setTestSendStatus] = useState({ status: 'idle', message: '' });

  // Hugging Face Space status states
  const [hfStatus, setHfStatus] = useState('NOT_CONFIGURED');
  const [hfDetails, setHfDetails] = useState<any>(null);
  const [wakingUp, setWakingUp] = useState(false);
  const [isResettingWhatsapp, setIsResettingWhatsapp] = useState(false);

  const fetchWhatsAppStatus = async () => {
    try {
      const res = await fetch('/api/whatsapp/status');
      if (res.ok) {
        const data = await res.json();
        if (data.state) setWhatsappState(data.state);
        if (data.scheduler) {
          if (!isSchedulerDirtyRef.current) {
            setSchedulerState(data.scheduler);
          } else {
            // Merge background updates into local state without losing user edits
            setSchedulerState(prev => ({
              ...prev,
              lastSentDate: data.scheduler.lastSentDate,
              lastSentTime: data.scheduler.lastSentTime,
              lastError: data.scheduler.lastError,
              retryCount: data.scheduler.retryCount,
              nextRetryTime: data.scheduler.nextRetryTime,
            }));
          }
        }
        if (data.hfSpaceStatus) setHfStatus(data.hfSpaceStatus);
        if (data.hfSpaceDetails) setHfDetails(data.hfSpaceDetails);
      }
    } catch (e) {
      console.error('Error fetching WhatsApp status:', e);
    }
  };

  const fetchContacts = async () => {
    try {
      const res = await fetch('/api/whatsapp/contacts');
      if (res.ok) {
        const data = await res.json();
        if (data.contacts) setContacts(data.contacts);
      }
    } catch (e) {
      console.error('Error fetching contacts:', e);
    }
  };

  const handleWakeUpSpace = async () => {
    if (!config.huggingFaceSpace) return;
    setWakingUp(true);
    try {
      const normalized = config.huggingFaceSpace.replace(/[\/_.]/g, '-').toLowerCase();
      const spaceUrl = `https://${normalized}.hf.space/`;

      const headers: Record<string, string> = {};
      if (config.huggingFaceToken) {
        headers['Authorization'] = `Bearer ${config.huggingFaceToken}`;
      }

      await fetch(spaceUrl, { headers, mode: 'no-cors' });
      alert('Wake up request sent! Hugging Face takes about 30-60 seconds to boot up the container. The status badge will update automatically.');
      fetchWhatsAppStatus();
    } catch (e) {
      console.error('Error sending wake up request:', e);
      alert('Failed to send wake up request.');
    } finally {
      setWakingUp(false);
    }
  };

  const handleResetWhatsapp = async () => {
    if (!confirm('Are you sure you want to reset the WhatsApp connection? This will wipe the active session and force the worker to restart and generate a new QR code.')) {
      return;
    }
    setIsResettingWhatsapp(true);
    try {
      const res = await fetch('/api/whatsapp/reset', {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(data.message || 'WhatsApp session reset successfully. Please wait 10-15 seconds for a new QR code.');
        // Refetch status immediately
        fetchWhatsAppStatus();
      } else {
        alert(data.error || 'Failed to reset WhatsApp session.');
      }
    } catch (e) {
      console.error('Error resetting WhatsApp:', e);
      alert('An error occurred while resetting WhatsApp session.');
    } finally {
      setIsResettingWhatsapp(false);
    }
  };

  // Save Scheduler data to MongoDB
  const saveSchedulerDb = async (stateToSave: SchedulerState) => {
    const res = await fetch('/api/whatsapp/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stateToSave)
    });
    if (!res.ok) {
      throw new Error('Failed to save scheduler settings.');
    }
  };

  // Save Scheduler configuration
  const saveSchedulerSettings = async () => {
    setIsSavingScheduler(true);
    try {
      if (schedulerState.isEnabled && !schedulerState.recipientId && !schedulerState.userRecipientId) {
        alert('Please select at least one recipient (Cook or Myself) before enabling the automated scheduler.');
        setIsSavingScheduler(false);
        return;
      }
      if (schedulerState.isEnabled) {
        const [hourStr, minStr] = schedulerState.targetTime.split(':');
        const hour = parseInt(hourStr);
        const minute = parseInt(minStr);
        const totalMinutes = hour * 60 + minute;

        const isMorning = totalMinutes >= 0 && totalMinutes <= 9 * 60 + 30;
        const isAfternoon = totalMinutes >= 14 * 60 && totalMinutes <= 23 * 60 + 59;

        if (!isMorning && !isAfternoon) {
          alert('Automated messages must be scheduled to send either in the morning (12:00 AM to 9:30 AM) for the same day, or after 2:00 PM (14:00 to 11:59 PM) today for the next day. Please update the send time.');
          setIsSavingScheduler(false);
          return;
        }
      }
      await saveSchedulerDb(schedulerState);
      setIsSchedulerDirty(false);
      alert('Scheduler settings saved successfully!');
    } catch {
      alert('Failed to save scheduler settings.');
    } finally {
      setIsSavingScheduler(false);
    }
  };

  // Trigger immediate test message delivery
  const handleSendTestMessage = async (type: 'myself' | 'cook') => {
    setTestSendStatus({ status: 'sending', message: `Triggering test send for ${type === 'myself' ? 'Myself' : 'Cook'}...` });
    try {
      // Auto-save the config first to ensure today's test matches edits
      await saveConfig(config);

      // Auto-save scheduler settings first to ensure the recipient JID is updated in the DB
      await saveSchedulerDb(schedulerState);
      setIsSchedulerDirty(false);

      const res = await fetch('/api/whatsapp/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      const data = await res.json();
      if (res.ok) {
        setTestSendStatus({
          status: 'success',
          message: `Test for ${type === 'myself' ? 'Myself' : 'Cook'} triggered successfully! The background worker will generate and send the message shortly.`
        });
        setTimeout(() => setTestSendStatus({ status: 'idle', message: '' }), 5000);
      } else {
        throw new Error(data.error || 'Failed to trigger test send.');
      }
    } catch (e: any) {
      setTestSendStatus({ status: 'error', message: e.message || 'Error triggering test send.' });
    }
  };

  // WhatsApp Poll Loop
  useEffect(() => {
    if (isAuthenticated !== true) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchWhatsAppStatus();

    // Poll status every 5 seconds to track QR updates or ready state changes
    const interval = setInterval(() => {
      fetchWhatsAppStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [isAuthenticated, activeTab, currentView]);

  return {
    whatsappState,
    schedulerState,
    setSchedulerState,
    isSchedulerDirty,
    setIsSchedulerDirty,
    contacts,
    isSavingScheduler,
    testSendStatus,
    hfStatus,
    hfDetails,
    wakingUp,
    isResettingWhatsapp,
    fetchWhatsAppStatus,
    fetchContacts,
    handleWakeUpSpace,
    handleResetWhatsapp,
    saveSchedulerDb,
    saveSchedulerSettings,
    handleSendTestMessage
  };
}

export type WhatsAppHook = ReturnType<typeof useWhatsApp>;
