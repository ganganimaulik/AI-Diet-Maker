'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Ingredient, Meal } from '@/lib/types';

interface IngredientEditorRowProps {
  ingredient: Ingredient;
  /** When provided, renders the "belongs to meal" select (daily-variables mode). */
  mealOptions?: Meal[];
  /** The weekday a daily-variables row belongs to, to warn when its meal is off that day. */
  day?: string;
  /**
   * Whether the ingredient library prices this name. Leave undefined while the
   * library is still loading, or when the row's meal is not sent to the AI.
   */
  hasLibraryEntry?: boolean;
  /** Opens the library with this ingredient's name filled in. */
  onAddToLibrary?: () => void;
  onField: (field: keyof Ingredient, value: any) => void;
  onRemove: () => void;
}

/**
 * One editable ingredient row (name, weight, Active/AUTO/Personal toggles,
 * optional meal select, plus AUTO-range and split sub-options).
 * Shared by the meal editor and the daily-variables editor.
 *
 * Each cell carries a named class so the stylesheet can place it with grid
 * areas: a stacked card on phones, a single dense row from lg up. The DOM
 * order never changes between the two.
 */
export default function IngredientEditorRow({ ingredient: ing, mealOptions, day, hasLibraryEntry, onAddToLibrary, onField, onRemove }: IngredientEditorRowProps) {
  const isDailyVariant = !!mealOptions;

  // The prompt compiler only keeps daily variables owned by a live meal that
  // is on for the day. Without this warning such a row looks active but never
  // reaches the AI.
  const ownerMeal = mealOptions?.find(m => m.id === (ing.mealId || 'meal-chicken'));
  const orphanReason = !isDailyVariant || ing.disabled
    ? ''
    : !ownerMeal
      ? 'its meal no longer exists'
      : ownerMeal.disabled
        ? `"${ownerMeal.name}" is disabled`
        : day && (ownerMeal.disabledDays || []).includes(day)
          ? `"${ownerMeal.name}" is off on ${day.charAt(0)}${day.slice(1).toLowerCase()}`
          : '';

  // A name the library cannot price gets no reference row in the prompt, so
  // the model falls back to its own figures and the verifier has nothing to
  // re-derive that day's sodium and potassium from. Not shown on a row that
  // is not sent at all — the warning above already covers that.
  const isUnpriced = hasLibraryEntry === false && !ing.disabled && !orphanReason && !!ing.name.trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <div className={`ingredient-row-compact ${isDailyVariant ? 'has-meal' : ''} ${ing.disabled ? 'is-disabled' : ''}`}>
        <input
          type="text"
          className="form-input ing-name"
          style={{ textDecoration: ing.disabled ? 'line-through' : 'none' }}
          value={ing.name}
          disabled={ing.disabled}
          onChange={e => onField('name', e.target.value)}
          placeholder="Ingredient Name"
          aria-label="Ingredient name"
        />

        {mealOptions && (
          <select
            className="form-input ing-meal"
            style={{ background: 'rgba(0,0,0,0.15)' }}
            value={ing.mealId || ''}
            disabled={ing.disabled}
            onChange={e => onField('mealId', e.target.value)}
            aria-label="Belongs to meal"
          >
            <option value="" disabled>Select Meal...</option>
            {mealOptions.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}

        <div className="ing-weight">
          <input
            type="number"
            inputMode="decimal"
            className="form-input"
            placeholder="Weight"
            disabled={ing.isAuto || ing.disabled}
            value={ing.weight}
            onChange={e => onField('weight', e.target.value)}
            aria-label="Weight in grams"
          />
          <span className="ing-unit">g</span>
        </div>

        <div className="ing-flags">
          <label className="auto-checkbox-container" title="Active">
            <input
              type="checkbox"
              checked={!ing.disabled}
              onChange={e => onField('disabled', !e.target.checked)}
            />
            <span>Active</span>
          </label>

          <label className="auto-checkbox-container" style={{ opacity: ing.disabled ? 0.5 : 1 }} title="AUTO">
            <input
              type="checkbox"
              disabled={ing.disabled}
              checked={ing.isAuto}
              onChange={e => onField('isAuto', e.target.checked)}
            />
            <span>AUTO</span>
          </label>

          <label className="auto-checkbox-container" style={{ opacity: ing.disabled ? 0.5 : 1 }} title="Personal">
            <input
              type="checkbox"
              disabled={ing.disabled}
              checked={!!ing.personalOnly}
              onChange={e => onField('personalOnly', e.target.checked)}
            />
            <span>Pers.</span>
          </label>
        </div>

        <button className="btn-remove ing-remove" onClick={onRemove} title="Delete Ingredient" aria-label="Delete ingredient">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>

      {orphanReason && (
        <div className="ingredient-warning">
          <span aria-hidden="true">⚠️</span>
          <span>Not sent to the AI — {orphanReason}. Pick another meal or switch that one on to include it.</span>
        </div>
      )}

      {isUnpriced && (
        <div className="ingredient-warning">
          <span aria-hidden="true">⚠️</span>
          <span>
            No ingredient library entry for &quot;{ing.name.trim()}&quot; — the AI will use its own nutrition values, so
            plans that include it cannot have their sodium and potassium checked exactly.
            {onAddToLibrary && (
              <>
                {' '}
                <button type="button" className="ingredient-warning__action" onClick={onAddToLibrary}>
                  Add it to the library
                </button>
              </>
            )}
          </span>
        </div>
      )}

      {!ing.disabled && (
        <div className="ingredient-sub-options">
          {ing.isAuto && (
            <div className="ingredient-sub-range">
              <span className="sub-label">AUTO RANGE:</span>
              <div className="range-field">
                <span className="sub-label">Min</span>
                <input
                  type="number"
                  inputMode="decimal"
                  className="form-input form-input--compact form-input--num"
                  placeholder="Min g"
                  disabled={ing.disabled || !ing.isAuto}
                  value={ing.minGrams || ''}
                  onChange={e => onField('minGrams', e.target.value)}
                  aria-label="Minimum grams"
                />
                <span className="sub-label">g</span>
              </div>
              <div className="range-field">
                <span className="sub-label">Max</span>
                <input
                  type="number"
                  inputMode="decimal"
                  className="form-input form-input--compact form-input--num"
                  placeholder="Max g"
                  disabled={ing.disabled || !ing.isAuto}
                  value={ing.maxGrams || ''}
                  onChange={e => onField('maxGrams', e.target.value)}
                  aria-label="Maximum grams"
                />
                <span className="sub-label">g</span>
              </div>
            </div>
          )}

          <div className="ingredient-sub-split">
            <span className="sub-label">Split:</span>
            <input
              type="text"
              className="form-input form-input--compact"
              style={{ background: 'rgba(0,0,0,0.15)' }}
              placeholder="Optional split instruction (e.g. 50% in subji, remaining in chicken)"
              value={ing.split || ''}
              onChange={e => onField('split', e.target.value)}
              aria-label="Split instruction"
            />
          </div>
        </div>
      )}
    </div>
  );
}
