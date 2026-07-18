'use client';
import { Meal } from '@/lib/types';
import { ConfigActions } from '@/hooks/useConfigActions';
import IngredientEditorRow from './IngredientEditorRow';

interface MealEditorTabProps {
  meal: Meal;
  canDelete: boolean;
  actions: ConfigActions;
}

export default function MealEditorTab({ meal: selectedMeal, canDelete, actions }: MealEditorTabProps) {
  const { updateMeal, deleteMeal, addMealIngredient, updateMealIngredient, removeMealIngredient } = actions;

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
    </div>
  );
}
