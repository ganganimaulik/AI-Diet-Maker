'use client';
import { useState } from 'react';
import { Config, DAYS_OF_WEEK } from '@/lib/types';
import { getDayVariantName } from '@/lib/compile-prompt';
import { ConfigActions } from '@/hooks/useConfigActions';
import IngredientEditorRow from './IngredientEditorRow';

interface DailyVariablesTabProps {
  config: Config;
  activeDay: string;
  setActiveDay: (day: string) => void;
  actions: ConfigActions;
}

export default function DailyVariablesTab({ config, activeDay, setActiveDay, actions }: DailyVariablesTabProps) {
  const { addIngredient, updateIngredient, removeIngredient, swapDayVariables, updateDailySplit, resetDailySplit } = actions;
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h4 style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 700 }}>
          Ingredients for {activeDay} ({getDayVariantName(config.dailyVariables[activeDay] || [], config.meals.filter(m => !m.disabled))})
        </h4>
      </div>

      <div className="ingredients-list">
        {(config.dailyVariables[activeDay] || []).map((ing, idx) => (
          <IngredientEditorRow
            key={idx}
            ingredient={ing}
            mealOptions={config.meals}
            onField={(field, value) => updateIngredient('daily', idx, field, value, activeDay)}
            onRemove={() => removeIngredient('daily', idx, activeDay)}
          />
        ))}
      </div>

      <button className="btn-add" onClick={() => addIngredient('daily', activeDay)}>
        + Add Ingredient to {activeDay}
      </button>

      <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)', margin: '1.5rem 0' }} />

      <h4 style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.75rem' }}>
        Cook Seasoning &amp; Instructions Splits for {activeDay}
      </h4>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {(config.customSplits || []).map((globalSplit) => {
          const daySplits = config.dailySplits?.[activeDay] || [];
          const override = daySplits.find(s => s.id === globalSplit.id);
          const currentValue = override ? override.value : globalSplit.value;
          const isCustomized = !!override;
          const ownerMeal = (config.meals || []).find(m => m.id === globalSplit.mealId);

          return (
            <div key={globalSplit.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>
                  {globalSplit.name}
                  {ownerMeal && (
                    <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.72rem', marginLeft: '0.4rem' }}>
                      · {ownerMeal.name}
                    </span>
                  )}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.4rem',
                    borderRadius: '4px',
                    fontWeight: 600,
                    background: isCustomized ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.05)',
                    color: isCustomized ? '#c084fc' : 'var(--text-muted)'
                  }}>
                    {isCustomized ? 'Customized' : 'Global Default'}
                  </span>
                  {isCustomized && (
                    <button
                      onClick={() => resetDailySplit(activeDay, globalSplit.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#c084fc',
                        fontSize: '0.7rem',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: 0
                      }}
                    >
                      Reset to default
                    </button>
                  )}
                </div>
              </div>
              <input
                type="text"
                className="form-input"
                style={{ padding: '0.5rem 0.75rem', fontSize: '0.85rem' }}
                value={currentValue}
                onChange={e => updateDailySplit(activeDay, globalSplit.id, e.target.value)}
                placeholder={`Default: ${globalSplit.value}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
