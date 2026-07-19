'use client';
import { Config, Meal } from '@/lib/types';
import { ConfigActions } from '@/hooks/useConfigActions';
import IngredientEditorRow from './IngredientEditorRow';

interface MealEditorTabProps {
  meal: Meal;
  config: Config;
  canDelete: boolean;
  actions: ConfigActions;
}

export default function MealEditorTab({ meal: selectedMeal, config, canDelete, actions }: MealEditorTabProps) {
  const {
    updateMeal, deleteMeal, addMealIngredient, updateMealIngredient, removeMealIngredient,
    updateCustomSplit, removeCustomSplit, addCustomSplit, resetAllDailyOverridesForSplit
  } = actions;

  const mealSplits = (config.customSplits || []).filter(s => s.mealId === selectedMeal.id);

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '1.5rem' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Meal Name</label>
          <input
            type="text"
            className="form-input"
            value={selectedMeal.name}
            onChange={e => updateMeal(selectedMeal.id, 'name', e.target.value)}
            placeholder="e.g. Oats Meal, Pasta Meal"
          />
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: '1.2 1 220px', margin: 0 }}>
            <label className="form-label" style={{ whiteSpace: 'nowrap' }}>Meals Per Day (Frequency)</label>
            <input
              type="number"
              className="form-input"
              value={selectedMeal.mealsPerDay}
              onChange={e => updateMeal(selectedMeal.id, 'mealsPerDay', parseInt(e.target.value) || 1)}
            />
          </div>
          <div className="form-group" style={{ flex: '2 1 200px', margin: 0 }}>
            <label className="form-label">Status</label>
            <div style={{ display: 'flex', alignItems: 'center', minHeight: '44px' }}>
              <label className="auto-checkbox-container" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  style={{ cursor: 'pointer' }}
                  checked={!selectedMeal.disabled}
                  onChange={e => updateMeal(selectedMeal.id, 'disabled', !e.target.checked)}
                />
                Active / Include in Prompt
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: '1.5rem', maxWidth: '550px', background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)', padding: '0.85rem 1.15rem', borderRadius: '10px' }}>
        <label className="form-label" style={{ marginBottom: '0.35rem' }}>Cook Quantity Mode</label>
        <div style={{ display: 'flex', gap: '1.5rem', margin: '0.25rem 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
            <input
              type="radio"
              name={`cookQty-${selectedMeal.id}`}
              checked={(selectedMeal.cookQuantityMode || 'daily') === 'daily'}
              onChange={() => updateMeal(selectedMeal.id, 'cookQuantityMode', 'daily')}
            />
            Whole Day Total
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
            <input
              type="radio"
              name={`cookQty-${selectedMeal.id}`}
              checked={(selectedMeal.cookQuantityMode || 'daily') === 'per-meal'}
              onChange={() => updateMeal(selectedMeal.id, 'cookQuantityMode', 'per-meal')}
            />
            Per Meal
          </label>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', margin: '0.25rem 0 0 0', lineHeight: '1.4' }}>
          {(selectedMeal.cookQuantityMode || 'daily') === 'per-meal'
            ? `Cook message will show per-meal quantities (daily total ÷ ${selectedMeal.mealsPerDay}).`
            : 'Cook message will show the entire day\'s total for this meal.'}
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <label className="form-label" style={{ margin: 0 }}>Meal Ingredients</label>
        {canDelete && (
          <button
            className="btn-remove"
            style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--accent-rose)', background: 'rgba(244, 63, 94, 0.08)' }}
            onClick={() => deleteMeal(selectedMeal.id)}
          >
            Delete Meal
          </button>
        )}
      </div>

      <div className="ingredients-list">
        {selectedMeal.ingredients.map((ing, idx) => (
          <IngredientEditorRow
            key={idx}
            ingredient={ing}
            onField={(field, value) => updateMealIngredient(selectedMeal.id, idx, field, value)}
            onRemove={() => removeMealIngredient(selectedMeal.id, idx)}
          />
        ))}
      </div>

      <button className="btn-add" onClick={() => addMealIngredient(selectedMeal.id)}>
        + Add Ingredient to {selectedMeal.name}
      </button>

      <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)', margin: '1.5rem 0' }} />

      <div className="form-group">
        <label className="form-label">Liquid Configuration (e.g. water, milk, or &quot;none&quot;)</label>
        <input
          type="text"
          className="form-input"
          value={selectedMeal.water}
          onChange={e => updateMeal(selectedMeal.id, 'water', e.target.value)}
          placeholder="e.g. 190g water"
        />
      </div>

      <div className="form-group">
        <label className="form-label">Preparation Method &amp; Cooking Instructions</label>
        <textarea
          className="form-input"
          value={selectedMeal.prepMethod}
          onChange={e => updateMeal(selectedMeal.id, 'prepMethod', e.target.value)}
          placeholder="e.g. Cook in airfryer 200c for 10 min"
          rows={3}
          style={{ resize: 'vertical', minHeight: '80px', fontFamily: 'inherit' }}
        />
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)', margin: '1.5rem 0' }} />

      <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>
        Cook Seasoning &amp; Instructions Splits
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
        {mealSplits.map((split) => {
          const hasOverrides = Object.keys(config.dailySplits || {}).some(day => {
            const daySplits = config.dailySplits?.[day] || [];
            return daySplits.some(s => s.id === split.id);
          });
          return (
            <div key={split.id} style={{ display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.02)', padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="text"
                  className="form-input"
                  style={{ flex: 1, padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                  value={split.name}
                  onChange={e => updateCustomSplit(split.id, 'name', e.target.value)}
                  placeholder="Title (e.g. Olive Oil split)"
                />
                <input
                  type="text"
                  className="form-input"
                  style={{ flex: 2, padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                  value={split.value}
                  onChange={e => updateCustomSplit(split.id, 'value', e.target.value)}
                  placeholder="Instruction split"
                />
                <button className="btn-remove" onClick={() => removeCustomSplit(split.id)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              </div>
              {hasOverrides && (
                <div style={{ fontSize: '0.75rem', color: '#c084fc', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.4rem', paddingLeft: '0.2rem' }}>
                  <span>⚠️ Overridden on some days.</span>
                  <button
                    onClick={() => resetAllDailyOverridesForSplit(split.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#c084fc',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: '0.75rem',
                      fontWeight: 600
                    }}
                  >
                    Reset all days to use global value
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button className="btn-add" onClick={() => addCustomSplit(selectedMeal.id)}>
        + Add Cook Split / Instruction to {selectedMeal.name}
      </button>
    </div>
  );
}
