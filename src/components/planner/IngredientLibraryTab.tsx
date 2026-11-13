'use client';
import { useState } from 'react';
import { Config, IngredientEntry, IngredientEntryInput } from '@/lib/types';
import { IngredientLibraryHook } from '@/hooks/useIngredientLibrary';
import {
  SALT_ENTRY,
  SODIUM_MG_PER_G_SALT,
  createLibraryLookup,
  findUnlistedIngredients,
  listBuilderIngredients,
  withBuiltIns
} from '@/lib/ingredient-library';

interface IngredientLibraryTabProps {
  config: Config;
  library: IngredientLibraryHook;
  /** A builder ingredient the user asked to add; opens the form with its name. */
  initialName?: string;
}

type FormState = { id?: string; values: IngredientEntryInput };

const FIGURES: { key: 'kcal' | 'protein' | 'carbs' | 'fat' | 'sodium' | 'potassium'; label: string; unit: string }[] = [
  { key: 'kcal', label: 'Calories', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Carbs', unit: 'g' },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'sodium', label: 'Sodium', unit: 'mg' },
  { key: 'potassium', label: 'Potassium', unit: 'mg' }
];

const blankValues = (name = ''): IngredientEntryInput => ({
  name, aliases: '', kcal: '', protein: '', carbs: '', fat: '', sodium: '', potassium: '', note: ''
});

const toValues = (entry: IngredientEntry): IngredientEntryInput => ({
  name: entry.name,
  aliases: (entry.aliases || []).join(', '),
  kcal: String(entry.kcal),
  protein: String(entry.protein),
  carbs: String(entry.carbs),
  fat: String(entry.fat),
  sodium: String(entry.sodium),
  potassium: String(entry.potassium),
  note: entry.note || ''
});

/**
 * The ingredient library editor: the per-100g figures every plan is priced
 * from. Rows save one at a time, straight to the database, independently of
 * the builder's own Save Configuration.
 */
export default function IngredientLibraryTab({ config, library, initialName }: IngredientLibraryTabProps) {
  const [form, setForm] = useState<FormState | null>(initialName ? { values: blankValues(initialName) } : null);
  const [formError, setFormError] = useState('');
  const [listError, setListError] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  // Which existing row each missing ingredient is about to become another name for.
  const [aliasTargets, setAliasTargets] = useState<Record<string, string>>({});

  const entries = library.entries;

  if (!entries) {
    return (
      <div>
        <h3 className="builder-section-title"><span aria-hidden="true">📚</span> Ingredient Library</h3>
        {library.loadError ? (
          <div className="ingredient-warning" role="alert">
            <span aria-hidden="true">⚠️</span>
            <span>
              {library.loadError} Plans cannot be generated until it loads.{' '}
              <button type="button" className="ingredient-warning__action" onClick={() => library.load()}>Try again</button>
            </span>
          </div>
        ) : (
          <p className="note-text">Loading the library…</p>
        )}
      </div>
    );
  }

  const lookup = createLibraryLookup(withBuiltIns(entries));
  const useCount = new Map<IngredientEntry, number>();
  for (const use of listBuilderIngredients(config)) {
    const entry = lookup(use.name);
    if (entry) useCount.set(entry, (useCount.get(entry) || 0) + 1);
  }
  const missing = findUnlistedIngredients(config, entries);

  const query = search.trim().toLowerCase();
  const visible = query
    ? entries.filter(entry => [entry.name, ...(entry.aliases || [])].some(name => name.toLowerCase().includes(query)))
    : entries;

  const openForm = (next: FormState) => {
    setForm(next);
    setFormError('');
    setListError('');
  };

  const closeForm = () => {
    setForm(null);
    setFormError('');
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    const result = await library.save(form.values, form.id);
    setBusy(false);
    if (result.ok) closeForm();
    else setFormError(result.error);
  };

  const deleteEntry = async (entry: IngredientEntry) => {
    if (!entry.id || busy) return;
    const uses = useCount.get(entry) || 0;
    const consequence = uses > 0
      ? `\n\nIt prices ${uses} ingredient${uses === 1 ? '' : 's'} in the builder. Without it the AI will use its own values for ${uses === 1 ? 'that one' : 'those'}.`
      : '';
    if (!window.confirm(`Delete "${entry.name}" from the ingredient library?${consequence}`)) return;
    setBusy(true);
    setListError('');
    const result = await library.remove(entry.id);
    setBusy(false);
    if (!result.ok) setListError(result.error);
    else if (form?.id === entry.id) closeForm();
  };

  const addAsAlias = async (name: string) => {
    const target = entries.find(entry => entry.id === aliasTargets[name]);
    if (!target?.id || busy) return;
    setBusy(true);
    setListError('');
    const result = await library.save({ ...toValues(target), aliases: [...(target.aliases || []), name] }, target.id);
    setBusy(false);
    if (!result.ok) setListError(result.error);
  };

  const renderForm = (title: string) => form && (
    <form className="library-form" onSubmit={submitForm} aria-label={title}>
      <div className="library-form__title">{title}</div>
      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label" htmlFor="library-name">Name</label>
        <input
          id="library-name"
          type="text"
          className="form-input"
          value={form.values.name}
          onChange={e => setForm({ ...form, values: { ...form.values, name: e.target.value } })}
          placeholder="As you spell it in the builder"
          autoFocus
        />
      </div>
      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label" htmlFor="library-aliases">Other names</label>
        <input
          id="library-aliases"
          type="text"
          className="form-input"
          value={form.values.aliases}
          onChange={e => setForm({ ...form, values: { ...form.values, aliases: e.target.value } })}
          placeholder="Optional, comma separated — e.g. oats, rolled oats"
        />
        <p className="note-text">
          Capitals and spacing never matter, and a bracketed note such as &quot;(Raw)&quot; is ignored when matching.
        </p>
      </div>
      <div className="library-form__figures">
        {FIGURES.map(figure => (
          <div className="form-group" style={{ margin: 0 }} key={figure.key}>
            <label className="form-label" htmlFor={`library-${figure.key}`}>{figure.label} ({figure.unit})</label>
            <input
              id={`library-${figure.key}`}
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              className="form-input"
              value={form.values[figure.key]}
              onChange={e => setForm({ ...form, values: { ...form.values, [figure.key]: e.target.value } })}
            />
          </div>
        ))}
      </div>
      <p className="note-text" style={{ marginTop: 0 }}>
        All six are per 100g of the raw, uncooked ingredient. For a packaged product, use the per-100g column of its label.
      </p>
      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label" htmlFor="library-note">Source note</label>
        <input
          id="library-note"
          type="text"
          className="form-input"
          value={form.values.note}
          onChange={e => setForm({ ...form, values: { ...form.values, note: e.target.value } })}
          placeholder="Optional — where the figures came from"
        />
      </div>
      {formError && (
        <div className="ingredient-warning" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{formError}</span>
        </div>
      )}
      <div className="library-form__actions">
        <button type="submit" className="btn-secondary" disabled={busy}>
          {busy ? 'Saving…' : form.id ? 'Save Changes' : 'Add to Library'}
        </button>
        <button type="button" className="btn-remove btn-remove--text library-btn-quiet" onClick={closeForm} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );

  const renderEntry = (entry: IngredientEntry) => {
    const uses = useCount.get(entry) || 0;
    return (
      <div className={`library-entry ${entry.builtIn ? 'is-built-in' : ''}`} key={entry.id || entry.name}>
        <div className="library-entry__head">
          <div className="library-entry__names">
            <span className="library-entry__name">{entry.name}</span>
            {entry.builtIn && <span className="library-chip">Built in</span>}
            {uses > 0 && (
              <span className="library-chip library-chip--used" title={`Prices ${uses} ingredient${uses === 1 ? '' : 's'} in the builder`}>
                In use
              </span>
            )}
            {!!entry.aliases?.length && (
              <span className="library-entry__aliases">also: {entry.aliases.join(', ')}</span>
            )}
          </div>
          {!entry.builtIn && (
            <div className="library-entry__actions">
              <button
                type="button"
                className="btn-remove btn-remove--text library-btn-quiet"
                onClick={() => openForm({ id: entry.id, values: toValues(entry) })}
                disabled={busy}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn-remove"
                onClick={() => deleteEntry(entry)}
                disabled={busy}
                title={`Delete ${entry.name}`}
                aria-label={`Delete ${entry.name}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          )}
        </div>
        <dl className="library-figures">
          {FIGURES.map(figure => (
            <div key={figure.key}>
              <dt>{figure.label}</dt>
              <dd>
                {entry.builtIn && figure.key === 'sodium' ? SODIUM_MG_PER_G_SALT : entry[figure.key]}
                <span className="library-figures__unit">
                  {entry.builtIn && figure.key === 'sodium' ? 'mg per 1g' : figure.unit}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        {entry.note && <p className="note-text library-entry__note">{entry.note}</p>}
      </div>
    );
  };

  return (
    <div>
      <h3 className="builder-section-title"><span aria-hidden="true">📚</span> Ingredient Library</h3>
      <p className="note-text" style={{ marginBottom: '1.25rem' }}>
        The nutrition every plan is calculated and checked from, per 100g raw. An ingredient with no entry here is
        left to the AI&apos;s own values, and that day&apos;s sodium and potassium can no longer be checked exactly.
        Changes save straight away and mark the plans that use the entry as out of date.
      </p>

      {missing.length > 0 && (
        <div className="library-missing" role="status">
          <div className="library-missing__title">
            <span aria-hidden="true">⚠️</span>
            {missing.length === 1 ? '1 builder ingredient has no entry' : `${missing.length} builder ingredients have no entry`}
          </div>
          {missing.map(item => (
            <div className="library-missing__row" key={item.name}>
              <div className="library-missing__what">
                <span className="library-missing__name">{item.name}</span>
                <span className="library-missing__where">used in {item.where.join(', ')}</span>
              </div>
              <div className="library-missing__actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => openForm({ values: blankValues(item.name) })}
                >
                  Add Entry
                </button>
                <select
                  className="form-input form-input--compact"
                  value={aliasTargets[item.name] || ''}
                  onChange={e => setAliasTargets(prev => ({ ...prev, [item.name]: e.target.value }))}
                  aria-label={`Existing entry that ${item.name} is another name for`}
                >
                  <option value="">or same as…</option>
                  {entries.map(entry => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
                {aliasTargets[item.name] && (
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => addAsAlias(item.name)}>
                    Link
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {listError && (
        <div className="ingredient-warning" role="alert" style={{ marginBottom: '0.75rem' }}>
          <span aria-hidden="true">⚠️</span>
          <span>{listError}</span>
        </div>
      )}

      {form && !form.id ? renderForm('New ingredient') : (
        <button type="button" className="btn-add" style={{ marginTop: 0 }} onClick={() => openForm({ values: blankValues() })}>
          + Add Ingredient to Library
        </button>
      )}

      <div className="library-toolbar">
        <input
          type="search"
          className="form-input"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${entries.length} ingredients`}
          aria-label="Search the ingredient library"
        />
      </div>

      <div className="library-list">
        {!query && renderEntry(SALT_ENTRY as IngredientEntry)}
        {visible.map(entry => (form?.id && form.id === entry.id
          ? <div key={entry.id}>{renderForm(`Edit ${entry.name}`)}</div>
          : renderEntry(entry)))}
        {visible.length === 0 && (
          <p className="note-text">No ingredient matches &quot;{search.trim()}&quot;.</p>
        )}
      </div>
    </div>
  );
}
