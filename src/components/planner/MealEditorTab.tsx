'use client';
import { DAYS_OF_WEEK, Meal } from '@/lib/types';
import { ConfigActions } from '@/hooks/useConfigActions';
import IngredientEditorRow from './IngredientEditorRow';
import NumberInput from '@/components/NumberInput';

interface MealEditorTabProps {
  meal: Meal;
  canDelete: boolean;
  actions: ConfigActions;
  /** Resolves a name to its ingredient-library row; null until the library has loaded. */
  libraryLookup: ((name: string) => unknown) | null;
  onAddToLibrary: (name: string) => void;
}

export default function MealEditorTab({ meal: selectedMeal, canDelete, actions, libraryLookup, onAddToLibrary }: MealEditorTabProps) {
  const {
    updateMeal, setMealActiveOnDay, deleteMeal, addMealIngredient, updateMealIngredient, removeMealIngredient
  } = actions;
  const daysOff = selectedMeal.disabledDays || [];
  const shortDay = (day: string) => day.charAt(0) + day.slice(1, 3).toLowerCase();

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
        <div className="input-row">
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Meals Per Day (Frequency)</label>
            <NumberInput
              key={selectedMeal.id}
              integer
              min={1}
              className="form-input"
              value={selectedMeal.mealsPerDay}
              onValueChange={n => updateMeal(selectedMeal.id, 'mealsPerDay', n)}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label className="form-label">Status</label>
            <label className="auto-checkbox-container" style={{ justifyContent: 'flex-start' }}>
              <input
                type="checkbox"
                checked={!selectedMeal.disabled}
                onChange={e => updateMeal(selectedMeal.id, 'disabled', !e.target.checked)}
              />
              Active / Include in Prompt
            </label>
          </div>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">Active Days</label>
          <div className="day-toggle-row" role="group" aria-label={`Days ${selectedMeal.name} is on`}>
            {DAYS_OF_WEEK.map(day => (
              <label
                key={day}
                className="auto-checkbox-container"
                style={{ opacity: selectedMeal.disabled ? 0.5 : 1 }}
                title={day}
              >
                <input
                  type="checkbox"
                  disabled={!!selectedMeal.disabled}
                  checked={!selectedMeal.disabled && !daysOff.includes(day)}
                  onChange={e => setMealActiveOnDay(selectedMeal.id, day, e.target.checked)}
                />
                <span>{shortDay(day)}</span>
              </label>
            ))}
          </div>
          <p className="note-text">
            {selectedMeal.disabled
              ? 'This meal is inactive, so it is left out of every day.'
              : daysOff.length === 0
                ? 'Untick a day to leave this meal out of that day\'s plan.'
                : `Left out of the plan on ${daysOff.map(shortDay).join(', ')}, together with its daily ingredients for ${daysOff.length === 1 ? 'that day' : 'those days'}.`}
          </p>
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: '1.5rem', maxWidth: '550px', background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)', padding: '0.85rem 1rem', borderRadius: '10px' }}>
        <label className="form-label" style={{ marginBottom: '0.35rem' }}>Cook Quantity Mode</label>
        <div className="choice-row">
          <label className="choice-option">
            <input
              type="radio"
              name={`cookQty-${selectedMeal.id}`}
              checked={(selectedMeal.cookQuantityMode || 'daily') === 'daily'}
              onChange={() => updateMeal(selectedMeal.id, 'cookQuantityMode', 'daily')}
            />
            Whole Day Total
          </label>
          <label className="choice-option">
            <input
              type="radio"
              name={`cookQty-${selectedMeal.id}`}
              checked={(selectedMeal.cookQuantityMode || 'daily') === 'per-meal'}
              onChange={() => updateMeal(selectedMeal.id, 'cookQuantityMode', 'per-meal')}
            />
            Per Meal
          </label>
        </div>
        <p className="note-text">
          {(selectedMeal.cookQuantityMode || 'daily') === 'per-meal'
            ? `Cook message will show per-meal quantities (daily total ÷ ${selectedMeal.mealsPerDay}).`
            : 'Cook message will show the entire day\'s total for this meal.'}
        </p>
      </div>

      <div className="builder-subheading">
        <label className="form-label" style={{ margin: 0 }}>Meal Ingredients</label>
        {canDelete && (
          <button
            className="btn-remove btn-remove--text"
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
            // An inactive meal is never sent, so its rows have nothing to warn about.
            hasLibraryEntry={libraryLookup && !selectedMeal.disabled ? !!libraryLookup(ing.name) : undefined}
            onAddToLibrary={() => onAddToLibrary(ing.name)}
            onField={(field, value) => updateMealIngredient(selectedMeal.id, idx, field, value)}
            onRemove={() => removeMealIngredient(selectedMeal.id, idx)}
          />
        ))}
      </div>

      <button className="btn-add" onClick={() => addMealIngredient(selectedMeal.id)}>
        + Add Ingredient to {selectedMeal.name}
      </button>

      <hr className="hr-soft" />

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
