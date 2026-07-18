'use client';
import { useState } from 'react';
import { ContactEntry } from '@/lib/types';

interface ContactPickerProps {
  label: string;
  contacts: ContactEntry[];
  selectedId: string;
  selectedName: string;
  selectedType: 'contact' | 'group';
  /** Cyan accent styling for the "Myself" picker; default styling for "Cook". */
  accent?: 'cyan';
  onSelect: (id: string, name: string, type: 'contact' | 'group') => void;
  onClear: () => void;
}

/**
 * Searchable WhatsApp contact/group picker with manual-ID fallback.
 * Used for both the Cook and Myself recipients (previously duplicated inline).
 */
export default function ContactPicker({
  label,
  contacts,
  selectedId,
  selectedName,
  selectedType,
  accent,
  onSelect,
  onClear
}: ContactPickerProps) {
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const filteredContacts = contacts.filter(
    c => c.name.toLowerCase().includes(search.toLowerCase()) || c.id.includes(search)
  );

  const isCyan = accent === 'cyan';

  return (
    <div className="form-group contact-picker-input">
      <label className="form-label">{label}</label>

      {selectedId ? (
        <div
          className="selected-contact-card"
          style={isCyan ? { background: 'rgba(6, 182, 212, 0.08)', border: '1px solid rgba(6, 182, 212, 0.25)' } : undefined}
        >
          <div className="selected-contact-info">
            <span className="selected-contact-name">
              {selectedName || 'Selected Recipient'}
              <span
                className="selected-contact-type"
                style={isCyan ? { background: 'rgba(6, 182, 212, 0.2)', color: 'var(--accent-cyan)' } : undefined}
              >
                {selectedType === 'group' ? 'Group' : 'Contact'}
              </span>
            </span>
            <span className="selected-contact-id">
              {selectedId}
            </span>
          </div>
          <button
            type="button"
            className="selected-contact-clear"
            onClick={() => {
              onClear();
              setSearch('');
            }}
            title="Clear selection"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
            </svg>
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            className="form-input"
            placeholder="Search contact or group by name or number..."
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          />

          {showDropdown && (
            <div className="contacts-dropdown">
              {filteredContacts.map(contact => (
                <div
                  key={contact.id}
                  className="contact-option"
                  onMouseDown={() => {
                    onSelect(contact.id, contact.name, contact.isGroup ? 'group' : 'contact');
                    setSearch('');
                    setShowDropdown(false);
                  }}
                >
                  <span>{contact.name}</span>
                  <span className="contact-option-type">{contact.isGroup ? 'Group' : 'Contact'}</span>
                </div>
              ))}

              {search.trim() && (
                <div
                  className="contact-option"
                  style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', color: 'var(--accent-cyan)' }}
                  onMouseDown={() => {
                    const inputVal = search.trim();
                    const isGroup = inputVal.endsWith('@g.us') || inputVal.includes('-');
                    onSelect(inputVal, inputVal.split('@')[0], isGroup ? 'group' : 'contact');
                    setSearch('');
                    setShowDropdown(false);
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span>➕ Use manual ID:</span>
                    <strong style={{ fontFamily: 'var(--font-mono)' }}>{search}</strong>
                  </span>
                  <span className="contact-option-type" style={{ color: 'var(--accent-cyan)', background: 'rgba(6, 182, 212, 0.15)' }}>Manual</span>
                </div>
              )}

              {filteredContacts.length === 0 && !search.trim() && (
                <div className="contact-option" style={{ cursor: 'default', color: 'var(--text-muted)' }}>
                  <span>No contacts found. Scan QR/connect first.</span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
