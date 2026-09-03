'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Dispatch, SetStateAction } from 'react';
import { Config, Ingredient, Meal } from '@/lib/types';

/**
 * All config-mutation handlers for the diet builder, extracted from page.tsx.
 * Pure state updates over setConfig; no fetches.
 */
export function useConfigActions(
  setConfig: Dispatch<SetStateAction<Config>>,
  setActiveTab: (tab: string) => void
) {
  const updateGlobal = (field: string, value: any) => {
    setConfig(prev => ({
      ...prev,
      global: { ...prev.global, [field]: value }
    }));
  };

  // Dynamic Meals manipulators
  const addNewMeal = () => {
    const newMeal: Meal = {
      id: `meal-${Date.now()}`,
      name: 'New Meal',
      mealsPerDay: 1,
      cookQuantityMode: 'daily' as const,
      ingredients: [
        { name: 'Ingredient 1', weight: '0', isAuto: false }
      ],
      prepMethod: ''
    };
    setConfig(prev => ({
      ...prev,
      meals: [...(prev.meals || []), newMeal]
    }));
    setActiveTab(newMeal.id);
  };

  const deleteMeal = (id: string) => {
    setConfig(prev => {
      const remainingMeals = (prev.meals || []).filter(m => m.id !== id);

      // Daily variables belonging to this meal go with it. Left behind they
      // would still show in the Daily Variables tab while the prompt compiler
      // silently dropped them (it only keeps ingredients owned by a live meal).
      const dailyVariables: Config['dailyVariables'] = {};
      for (const day in (prev.dailyVariables || {})) {
        dailyVariables[day] = (prev.dailyVariables[day] || []).filter(ing => (ing.mealId || 'meal-chicken') !== id);
      }

      return { ...prev, meals: remainingMeals, dailyVariables };
    });
    setActiveTab('global');
  };

  const updateMeal = (id: string, field: keyof Meal, value: any) => {
    setConfig(prev => {
      const updated = (prev.meals || []).map(m => {
        if (m.id === id) {
          return { ...m, [field]: value };
        }
        return m;
      });
      return { ...prev, meals: updated };
    });
  };

  const reorderMeals = (draggedId: string, targetId: string) => {
    setConfig(prev => {
      const meals = [...(prev.meals || [])];
      const draggedIndex = meals.findIndex(m => m.id === draggedId);
      const targetIndex = meals.findIndex(m => m.id === targetId);
      if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return prev;

      const [draggedMeal] = meals.splice(draggedIndex, 1);
      meals.splice(targetIndex, 0, draggedMeal);

      return {
        ...prev,
        meals
      };
    });
  };

  const addMealIngredient = (mealId: string) => {
    const defaultIng: Ingredient = { name: 'New Item', weight: '0', isAuto: false };
    setConfig(prev => {
      const updated = (prev.meals || []).map(m => {
        if (m.id === mealId) {
          return { ...m, ingredients: [...m.ingredients, defaultIng] };
        }
        return m;
      });
      return { ...prev, meals: updated };
    });
  };

  const updateMealIngredient = (
    mealId: string,
    idx: number,
    field: keyof Ingredient,
    value: any
  ) => {
    setConfig(prev => {
      const updated = (prev.meals || []).map(m => {
        if (m.id === mealId) {
          const updatedIngs = [...m.ingredients];
          const item = { ...updatedIngs[idx] };

          if (field === 'isAuto') {
            item.isAuto = value;
            if (value) item.weight = '';
            if (!value) { item.maxGrams = ''; item.minGrams = ''; }
          } else if (field === 'weight') {
            item.weight = value;
            if (value) { item.isAuto = false; item.maxGrams = ''; item.minGrams = ''; }
          } else if (field === 'disabled') {
            item.disabled = value;
          } else {
            (item as any)[field] = value;
          }

          updatedIngs[idx] = item;
          return { ...m, ingredients: updatedIngs };
        }
        return m;
      });
      return { ...prev, meals: updated };
    });
  };

  const removeMealIngredient = (mealId: string, idx: number) => {
    setConfig(prev => {
      const updated = (prev.meals || []).map(m => {
        if (m.id === mealId) {
          return {
            ...m,
            ingredients: m.ingredients.filter((_, i) => i !== idx)
          };
        }
        return m;
      });
      return { ...prev, meals: updated };
    });
  };

  // Ingredients Lists manipulators (for Daily variables)
  const addIngredient = (target: 'daily', dayKey: string) => {
    setConfig(prev => {
      const defaultMealId = prev.meals[0]?.id || '';
      const defaultIng: Ingredient = {
        name: 'New Item',
        weight: '0',
        isAuto: false,
        personalOnly: false,
        mealId: defaultMealId
      };
      return {
        ...prev,
        dailyVariables: {
          ...prev.dailyVariables,
          [dayKey]: [...(prev.dailyVariables[dayKey] || []), defaultIng]
        }
      };
    });
  };

  const updateIngredient = (
    target: 'daily',
    index: number,
    field: keyof Ingredient,
    value: any,
    dayKey: string
  ) => {
    setConfig(prev => {
      const updated = [...(prev.dailyVariables[dayKey] || [])];
      const item = { ...updated[index] };
      if (field === 'isAuto') {
        item.isAuto = value;
        if (value) item.weight = '';
        if (!value) { item.maxGrams = ''; item.minGrams = ''; }
      } else if (field === 'weight') {
        item.weight = value;
        if (value) { item.isAuto = false; item.maxGrams = ''; item.minGrams = ''; }
      } else if (field === 'disabled') {
        item.disabled = value;
      } else {
        (item as any)[field] = value;
      }
      updated[index] = item;
      return {
        ...prev,
        dailyVariables: { ...prev.dailyVariables, [dayKey]: updated }
      };
    });
  };

  const removeIngredient = (target: 'daily', index: number, dayKey: string) => {
    setConfig(prev => ({
      ...prev,
      dailyVariables: {
        ...prev.dailyVariables,
        [dayKey]: (prev.dailyVariables[dayKey] || []).filter((_, idx) => idx !== index)
      }
    }));
  };

  const swapDayVariables = (dayA: string, dayB: string) => {
    setConfig(prev => {
      const varsA = prev.dailyVariables[dayA] || [];
      const varsB = prev.dailyVariables[dayB] || [];

      return {
        ...prev,
        dailyVariables: {
          ...prev.dailyVariables,
          [dayA]: varsB,
          [dayB]: varsA
        }
      };
    });
  };

  return {
    updateGlobal,
    addNewMeal,
    deleteMeal,
    updateMeal,
    reorderMeals,
    addMealIngredient,
    updateMealIngredient,
    removeMealIngredient,
    addIngredient,
    updateIngredient,
    removeIngredient,
    swapDayVariables
  };
}

export type ConfigActions = ReturnType<typeof useConfigActions>;
