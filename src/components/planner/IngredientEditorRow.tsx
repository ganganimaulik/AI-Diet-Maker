'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Ingredient, Meal } from '@/lib/types';

interface IngredientEditorRowProps {
  ingredient: Ingredient;
  /** When provided, renders the "belongs to meal" select (daily-variables mode). */
  mealOptions?: Meal[];
  onField: (field: keyof Ingredient, value: any) => void;
  onRemove: () => void;
}

/**
 * One editable ingredient row (name, weight, Active/AUTO/Personal toggles,
 * optional meal select, plus AUTO-range and split sub-options).
 * Shared by the meal editor and the daily-variables editor.
 */
export default function IngredientEditorRow({ ingredient: ing, mealOptions, onField, onRemove }: IngredientEditorRowProps) {
  const isDailyVariant = !!mealOptions;

  // The prompt compiler only keeps daily variables owned by a live, enabled
  // meal. Without this warning such a row looks active but never reaches the AI.
  const ownerMeal = mealOptions?.find(m => m.id === (ing.mealId || 'meal-chicken'));
  const orphanReason = !isDailyVariant || ing.disabled
    ? ''
    : !ownerMeal
      ? 'its meal no longer exists'
      : ownerMeal.disabled
        ? `"${ownerMeal.name}" is disabled`
        : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <div
        className={`ingredient-row-compact ${ing.disabled ? 'is-disabled' : ''}`}
        style={isDailyVariant ? { gridTemplateColumns: 'minmax(140px, 2fr) minmax(100px, 1.5fr) 125px auto auto auto auto' } : undefined}
      >
        <input
          type="text"
          className="form-input"
          style={{ textDecoration: ing.disabled ? 'line-through' : 'none' }}
          value={ing.name}
          disabled={ing.disabled}
          onChange={e => onField('name', e.target.value)}
          placeholder="Ingredient Name"
        />

        {mealOptions && (
          <select
            className="form-input"
            style={{ background: 'rgba(0,0,0,0.15)' }}
            value={ing.mealId || ''}
            disabled={ing.disabled}
            onChange={e => onField('mealId', e.target.value)}
          >
            <option value="" disabled>Select Meal...</option>
            {mealOptions.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input
            type="number"
            className="form-input"
            placeholder="Weight"
            disabled={ing.isAuto || ing.disabled}
            value={ing.weight}
            onChange={e => onField('weight', e.target.value)}
          />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>g</span>
        </div>

        <label className="auto-checkbox-container" title="Active">
          <input
            type="checkbox"
            checked={!ing.disabled}
            onChange={e => onField('disabled', !e.target.checked)}
          />
          <span style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>Active</span>
        </label>

        <label className="auto-checkbox-container" style={{ opacity: ing.disabled ? 0.5 : 1 }} title="AUTO">
          <input
            type="checkbox"
            disabled={ing.disabled}
            checked={ing.isAuto}
            onChange={e => onField('isAuto', e.target.checked)}
          />
          <span style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>AUTO</span>
        </label>

        <label className="auto-checkbox-container" style={{ opacity: ing.disabled ? 0.5 : 1 }} title="Personal">
          <input
            type="checkbox"
            disabled={ing.disabled}
            checked={!!ing.personalOnly}
            onChange={e => onField('personalOnly', e.target.checked)}
          />
          <span style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>Pers.</span>
        </label>

        <button className="btn-remove" onClick={onRemove} title="Delete Ingredient">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>

      {orphanReason && (
        <div
          style={{
            marginLeft: isDailyVariant ? '1.5rem' : undefined,
            fontSize: '0.72rem',
            color: '#fcd34d',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem'
          }}
        >
          ⚠️ Not sent to the AI — {orphanReason}. Pick another meal to include it.
        </div>
      )}

      {!ing.disabled && (
        <div className="ingredient-sub-options" style={isDailyVariant ? { marginLeft: '1.5rem' } : undefined}>
          {ing.isAuto && (
            <div className="ingredient-sub-range">
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>AUTO RANGE:</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Min</span>
                <input
                  type="number"
                  className="form-input"
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '65px', height: 'auto' }}
                  placeholder="Min g"
                  disabled={ing.disabled || !ing.isAuto}
                  value={ing.minGrams || ''}
                  onChange={e => onField('minGrams', e.target.value)}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>g</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Max</span>
                <input
                  type="number"
                  className="form-input"
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', width: '65px', height: 'auto' }}
                  placeholder="Max g"
                  disabled={ing.disabled || !ing.isAuto}
                  value={ing.maxGrams || ''}
                  onChange={e => onField('maxGrams', e.target.value)}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>g</span>
              </div>
            </div>
          )}

          <div className="ingredient-sub-split">
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', minWidth: '40px', fontWeight: 600 }}>Split:</span>
            <input
              type="text"
              className="form-input"
              style={{ padding: '0.35rem 0.5rem', fontSize: '0.8rem', flex: 1, height: 'auto', background: 'rgba(0,0,0,0.15)' }}
              placeholder="Optional split instruction (e.g. 50% in subji, remaining in chicken)"
              value={ing.split || ''}
              onChange={e => onField('split', e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
