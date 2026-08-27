'use client';
import { useState } from 'react';
import { Meal } from '@/lib/types';

interface BuilderSidebarProps {
  meals: Meal[];
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onAddMeal: () => void;
  onReorderMeals: (draggedId: string, targetId: string) => void;
}

export default function BuilderSidebar({ meals, activeTab, setActiveTab, onAddMeal, onReorderMeals }: BuilderSidebarProps) {
  const [draggedMealId, setDraggedMealId] = useState<string | null>(null);
  const [dragOverMealId, setDragOverMealId] = useState<string | null>(null);

  return (
    <aside className="builder-sidebar">
      <div className="builder-sidebar-title">Configuration</div>
      <button
        className={`builder-nav-btn ${activeTab === 'global' ? 'active' : ''}`}
        onClick={() => setActiveTab('global')}
      >
        <span className="builder-nav-btn__label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="6"/>
            <circle cx="12" cy="12" r="2"/>
          </svg>
          Global Targets
        </span>
      </button>

      <div className="builder-sidebar-title">Meals</div>
      {(meals || []).map(meal => (
        <button
          key={meal.id}
          draggable
          className={`builder-nav-btn ${activeTab === meal.id ? 'active' : ''} ${dragOverMealId === meal.id ? 'drag-over' : ''} ${meal.disabled ? 'disabled' : ''}`}
          onClick={() => setActiveTab(meal.id)}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', meal.id);
            setDraggedMealId(meal.id);
          }}
          onDragEnd={() => {
            setDraggedMealId(null);
            setDragOverMealId(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (draggedMealId && draggedMealId !== meal.id) {
              setDragOverMealId(meal.id);
            }
          }}
          onDragLeave={() => {
            setDragOverMealId(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const sourceMealId = e.dataTransfer.getData('text/plain') || draggedMealId;
            if (sourceMealId && sourceMealId !== meal.id) {
              onReorderMeals(sourceMealId, meal.id);
            }
            setDraggedMealId(null);
            setDragOverMealId(null);
          }}
        >
          <span className="builder-nav-btn__label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            {meal.name}
          </span>
          {meal.disabled && <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>(disabled)</span>}
        </button>
      ))}

      <button
        className="builder-nav-btn builder-nav-btn--add"
        onClick={onAddMeal}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Add Meal
      </button>

      <div className="builder-sidebar-title">Variables &amp; Code</div>
      <button
        className={`builder-nav-btn ${activeTab === 'daily' ? 'active' : ''}`}
        onClick={() => setActiveTab('daily')}
      >
        <span className="builder-nav-btn__label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          Daily Variables
        </span>
      </button>
      <button
        className={`builder-nav-btn ${activeTab === 'prompt' ? 'active' : ''}`}
        onClick={() => setActiveTab('prompt')}
      >
        <span className="builder-nav-btn__label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          System Prompt
        </span>
      </button>
    </aside>
  );
}
