'use client';
import { useState } from 'react';
import { Config, DAYS_OF_WEEK } from '@/lib/types';
import { activeMealsForDay, getDayVariantName } from '@/lib/compile-prompt';
import { ConfigActions } from '@/hooks/useConfigActions';
import IngredientEditorRow from './IngredientEditorRow';

interface DailyVariablesTabProps {
  config: Config;
  activeDay: string;
  setActiveDay: (day: string) => void;
  actions: ConfigActions;
  /** Resolves a name to its ingredient-library row; null until the library has loaded. */
  libraryLookup: ((name: string) => unknown) | null;
  onAddToLibrary: (name: string) => void;
}

export default function DailyVariablesTab({ config, activeDay, setActiveDay, actions, libraryLookup, onAddToLibrary }: DailyVariablesTabProps) {
  const { addIngredient, updateIngredient, removeIngredient, swapDayVariables, setMealActiveOnDay } = actions;
  // Meals whose master switch is on; each can still be off for this one day.
  const switchableMeals = config.meals.filter(m => !m.disabled);
  const mealsToday = activeMealsForDay(config, activeDay);
  const [draggedDay, setDraggedDay] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  return (
    <div>
      <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>
        Select Day of Week <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'none', marginLeft: '0.5rem' }}>(Drag &amp; Drop to Swap)</span>
      </label>

      <div className="day-selector-grid">
        {DAYS_OF_WEEK.map(day => (
          <button
            key={day}
            draggable
            className={`day-btn ${activeDay === day ? 'active' : ''} ${dragOverDay === day ? 'drag-over' : ''}`}
            onClick={() => setActiveDay(day)}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', day);
              setDraggedDay(day);
            }}
            onDragEnd={() => {
              setDraggedDay(null);
              setDragOverDay(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (draggedDay && draggedDay !== day) {
                setDragOverDay(day);
              }
            }}
            onDragLeave={() => {
              setDragOverDay(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const sourceDay = e.dataTransfer.getData('text/plain') || draggedDay;
              if (draggedDay && sourceDay && sourceDay !== day) {
                swapDayVariables(sourceDay, day);
              }
              setDraggedDay(null);
              setDragOverDay(null);
            }}
          >
            {day.substring(0, 3)}
          </button>
        ))}
      </div>

      <div className="builder-subheading">
        <h4 className="builder-section-title" style={{ marginBottom: 0 }}>
          Meals on {activeDay}
        </h4>
      </div>

      <div className="day-toggle-row" role="group" aria-label={`Meals on ${activeDay}`}>
        {switchableMeals.map(meal => (
          <label key={meal.id} className="auto-checkbox-container">
            <input
              type="checkbox"
              checked={!(meal.disabledDays || []).includes(activeDay)}
              onChange={e => setMealActiveOnDay(meal.id, activeDay, e.target.checked)}
            />
            <span>{meal.name}</span>
          </label>
        ))}
      </div>
      {mealsToday.length === 0 ? (
        <div className="ingredient-warning" style={{ marginBottom: '1.25rem' }}>
          <span aria-hidden="true">⚠️</span>
          <span>No meal is on for {activeDay}, so there is nothing to plan. Switch at least one on.</span>
        </div>
      ) : (
        <p className="note-text" style={{ marginBottom: '1.25rem' }}>
          Untick a meal to leave it out of {activeDay}&apos;s plan only. Inactive meals are not listed.
        </p>
      )}

      <div className="builder-subheading">
        <h4 className="builder-section-title" style={{ marginBottom: 0 }}>
          Ingredients for {activeDay} ({getDayVariantName(config.dailyVariables[activeDay] || [], mealsToday)})
        </h4>
      </div>

      <div className="ingredients-list">
        {(config.dailyVariables[activeDay] || []).map((ing, idx) => (
          <IngredientEditorRow
            key={idx}
            ingredient={ing}
            mealOptions={config.meals}
            day={activeDay}
            hasLibraryEntry={libraryLookup ? !!libraryLookup(ing.name) : undefined}
            onAddToLibrary={() => onAddToLibrary(ing.name)}
            onField={(field, value) => updateIngredient('daily', idx, field, value, activeDay)}
            onRemove={() => removeIngredient('daily', idx, activeDay)}
          />
        ))}
      </div>

      <button className="btn-add" onClick={() => addIngredient('daily', activeDay)}>
        + Add Ingredient to {activeDay}
      </button>
    </div>
  );
}
