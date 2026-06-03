'use client';
/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { useState, useEffect } from 'react';

// Type definitions
interface Ingredient {
  name: string;
  weight: string;
  isAuto: boolean;
}

interface CustomSplit {
  id: string;
  name: string;
  value: string;
}

interface Meal {
  id: string;
  name: string;
  mealsPerDay: number;
  ingredients: Ingredient[];
  water: string;
  prepMethod: string;
}

interface Config {
  apiKey: string;
  model: string;
  customModel: string;
  thinkingEnabled: boolean;
  thinkingBudget: number;
  global: {
    dailyCalorieTarget: number;
    totalOliveOil: number;
    oliveOilSplitPercent: number;
  };
  meals: Meal[];
  splits?: {
    oliveOilSplit: string;
    saltSplit: string;
    chickenPrepMethod: string;
  };
  customSplits?: CustomSplit[];
  dailyVariables: {
    [key: string]: Ingredient[];
  };
  generationRange: 'all' | 'single';
  selectedGenerationDay: string;
}

const DEFAULT_CONFIG: Config = {
  apiKey: '',
  model: 'gemini-3.5-flash',
  customModel: 'gemini-3.5-flash',
  thinkingEnabled: true,
  thinkingBudget: 2048,
  global: {
    dailyCalorieTarget: 1600,
    totalOliveOil: 18,
    oliveOilSplitPercent: 50
  },
  meals: [
    {
      id: 'meal-oats',
      name: 'Oats Meal',
      mealsPerDay: 1,
      ingredients: [
        { name: 'Oats (Raw)', weight: '35', isAuto: false },
        { name: 'Whey Protein Isolate', weight: '60', isAuto: false },
        { name: 'Almonds', weight: '5', isAuto: false },
        { name: 'Cashews', weight: '5', isAuto: false },
        { name: 'Walnuts', weight: '5', isAuto: false },
        { name: 'Banana', weight: '60', isAuto: false }
      ],
      water: '190g water',
      prepMethod: 'Oats airfryer 200c, 10min'
    },
    {
      id: 'meal-chicken',
      name: 'Chicken Meal',
      mealsPerDay: 3,
      ingredients: [
        { name: 'Chicken Breast (Raw)', weight: '425', isAuto: false }
      ],
      water: '',
      prepMethod: 'Chicken air fryer 200c, 15 min'
    }
  ],
  dailyVariables: {
    MONDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Tomato', weight: '180', isAuto: false }
    ],
    TUESDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Potato (Raw)', weight: '150', isAuto: false },
      { name: 'Tomato', weight: '80', isAuto: false }
    ],
    WEDNESDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Cluster Beans', weight: '185', isAuto: false },
      { name: 'Tomato', weight: '80', isAuto: false }
    ],
    THURSDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Bottle Gourd', weight: '185', isAuto: false },
      { name: 'Tomato', weight: '80', isAuto: false }
    ],
    FRIDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Potato (Raw)', weight: '', isAuto: true },
      { name: 'Cluster Beans', weight: '180', isAuto: false },
      { name: 'Tomato', weight: '80', isAuto: false }
    ],
    SATURDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Potato (Raw)', weight: '150', isAuto: false },
      { name: 'Bottle Gourd', weight: '185', isAuto: false }
    ],
    SUNDAY: [
      { name: 'Rice', weight: '', isAuto: true },
      { name: 'Potato (Raw)', weight: '', isAuto: true },
      { name: 'Brinjal', weight: '180', isAuto: false },
      { name: 'Tomato', weight: '80', isAuto: false }
    ]
  },
  generationRange: 'all',
  selectedGenerationDay: 'MONDAY'
};

const DAYS_OF_WEEK = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

export default function Home() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [isMounted, setIsMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('global');
  const [activeDay, setActiveDay] = useState<string>('MONDAY');
  
  // Custom prompt override state
  const [customPrompt, setCustomPrompt] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);
  
  // UI states
  const [showApiKey, setShowApiKey] = useState(false);
  
  // Output and generation states
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [outputText, setOutputText] = useState('');
  const [thinkingText, setThinkingText] = useState('');
  const [outputTab, setOutputTab] = useState<'user' | 'cook' | 'thoughts'>('user');
  const [copiedStatus, setCopiedStatus] = useState(false);

  // Load from local storage
  useEffect(() => {
    const saved = localStorage.getItem('ai-diet-maker-config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        
        // Dynamic migration to dynamic n-meals architecture
        if (!parsed.meals || parsed.meals.length === 0) {
          const migratedMeals: Meal[] = [];
          
          // Migrate Oats Meal (Meal 1)
          if (parsed.oatsMeal) {
            migratedMeals.push({
              id: 'meal-oats',
              name: parsed.meal1Name || 'Oats Meal',
              mealsPerDay: parsed.global?.oatsMealsPerDay || 1,
              ingredients: parsed.oatsMeal.ingredients || [],
              water: parsed.oatsMeal.water || '',
              prepMethod: parsed.oatsMeal.prepMethod || ''
            });
          } else {
            // Seed default oats meal
            migratedMeals.push({
              id: 'meal-oats',
              name: 'Oats Meal',
              mealsPerDay: 1,
              ingredients: [
                { name: 'Oats (Raw)', weight: '35', isAuto: false },
                { name: 'Whey Protein Isolate', weight: '60', isAuto: false },
                { name: 'Almonds', weight: '5', isAuto: false },
                { name: 'Cashews', weight: '5', isAuto: false },
                { name: 'Walnuts', weight: '5', isAuto: false },
                { name: 'Banana', weight: '60', isAuto: false }
              ],
              water: '190g water',
              prepMethod: 'Oats airfryer 200c, 10min'
            });
          }
          
          // Migrate Chicken Meal (Meal 2)
          if (parsed.chickenMeal) {
            migratedMeals.push({
              id: 'meal-chicken',
              name: parsed.meal2Name || 'Chicken Meal',
              mealsPerDay: parsed.global?.chickenMealsPerDay || 3,
              ingredients: parsed.chickenMeal.baselines || [],
              water: parsed.splits?.oliveOilSplit || '',
              prepMethod: parsed.splits?.chickenPrepMethod || ''
            });
          } else {
            // Seed default chicken meal
            migratedMeals.push({
              id: 'meal-chicken',
              name: 'Chicken Meal',
              mealsPerDay: 3,
              ingredients: [
                { name: 'Chicken Breast (Raw)', weight: '425', isAuto: false }
              ],
              water: '',
              prepMethod: 'Chicken air fryer 200c, 15 min'
            });
          }
          
          parsed.meals = migratedMeals;
        }
        
        // Migrate global olive oil settings if missing
        if (!parsed.global.totalOliveOil) {
          parsed.global.totalOliveOil = 18;
          parsed.global.oliveOilSplitPercent = 50;
        }
        
        // Migrate custom splits
        if (!parsed.customSplits) {
          const splitsObj = parsed.splits || {
            oliveOilSplit: '9g in subji. 9g in chicken',
            saltSplit: '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste',
            chickenPrepMethod: 'Chicken air fryer 200c, 15 min'
          };
          parsed.customSplits = [
            { id: 'salt', name: 'Salt Seasoning Split', value: splitsObj.saltSplit || '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste' },
            { id: 'prep', name: 'Chicken Prep Method', value: splitsObj.chickenPrepMethod || 'Chicken air fryer 200c, 15 min' }
          ];
        } else {
          // Force remove the old olive oil custom split from existing storage
          // since it is now dynamically handled via the global setting
          parsed.customSplits = parsed.customSplits.filter((s: any) => 
            s.id !== 'oil' && !s.name.toLowerCase().includes('olive oil')
          );
        }
        
        // Delete old/deprecated fields to keep storage clean
        delete parsed.meal1Name;
        delete parsed.meal2Name;
        delete parsed.calorieDatabase;
        delete parsed.oatsMeal;
        delete parsed.chickenMeal;
        
        setConfig(parsed);
      } catch (e) {
        console.error('Failed to load configuration from local storage', e);
      }
    } else {
      // Default initialization
      setConfig(prev => ({
        ...prev,
        meals: [
          {
            id: 'meal-oats',
            name: 'Oats Meal',
            mealsPerDay: 1,
            ingredients: [
              { name: 'Oats (Raw)', weight: '35', isAuto: false },
              { name: 'Whey Protein Isolate', weight: '60', isAuto: false },
              { name: 'Almonds', weight: '5', isAuto: false },
              { name: 'Cashews', weight: '5', isAuto: false },
              { name: 'Walnuts', weight: '5', isAuto: false },
              { name: 'Banana', weight: '60', isAuto: false }
            ],
            water: '190g water',
            prepMethod: 'Oats airfryer 200c, 10min'
          },
          {
            id: 'meal-chicken',
            name: 'Chicken Meal',
            mealsPerDay: 3,
            ingredients: [
              { name: 'Chicken Breast (Raw)', weight: '425', isAuto: false }
            ],
            water: '',
            prepMethod: 'Chicken air fryer 200c, 15 min'
          }
        ],
        customSplits: [
          { id: 'salt', name: 'Salt Seasoning Split', value: '8g in subji. 7g in chicken with 1 liter water. 3g in marinate paste' },
          { id: 'prep', name: 'Chicken Prep Method', value: 'Chicken air fryer 200c, 15 min' }
        ]
      }));
    }
    setIsMounted(true);
  }, []);

  // Save to local storage
  useEffect(() => {
    if (isMounted) {
      localStorage.setItem('ai-diet-maker-config', JSON.stringify(config));
    }
  }, [config, isMounted]);

  // Helper: Get variant name for days (e.g. Tomato -> "Just Tomato")
  const getDayVariantName = (ingredients: Ingredient[]) => {
    const nonStapleNames = ingredients
      .filter(ing => !ing.isAuto)
      .map(ing => ing.name);
    if (nonStapleNames.length === 0) return 'Staples Only';
    if (nonStapleNames.length === 1) return `Just ${nonStapleNames[0]}`;
    return nonStapleNames.join(' + ');
  };

  // Compile active prompt from configuration
  const compilePromptText = (c: Config): string => {
    const isSingle = c.generationRange === 'single';
    const activeDays = isSingle ? [c.selectedGenerationDay] : DAYS_OF_WEEK;
    const daysLabel = isSingle ? `only the day ${c.selectedGenerationDay}` : 'Monday through Sunday';
    const dayRefLabel = isSingle ? 'the day' : 'each day';

    const mealsList = c.meals || [];
    const splitsList = c.customSplits || [];
    
    // Dynamic Olive Oil calculation
    const totalOil = c.global.totalOliveOil || 0;
    const oilPercent = c.global.oliveOilSplitPercent || 50;
    const subjiOil = (totalOil * oilPercent / 100).toFixed(0);
    const chickenOil = (totalOil - Number(subjiOil)).toFixed(0);

    const splitsText = [
      `Olive Oil Cooking Split: ${subjiOil}g in subji. ${chickenOil}g in chicken`,
      ...splitsList.map(s => `${s.name}: ${s.value}`)
    ].map(s => `- ${s}`).join('\n');

    const mealsTargetText = mealsList
      .map((meal, idx) => `- Meal ${idx + 1} (${meal.name}): eaten ${meal.mealsPerDay} times per day`)
      .join('\n');

    const mealsDetailsText = mealsList
      .map((meal, idx) => `
[MEAL ${idx + 1} WEIGHTS: ${meal.name} (FOR 1 MEAL)]
${meal.ingredients.map(ing => `- ${ing.name}: ${ing.isAuto ? '[AUTO]' : `${ing.weight}g`}`).join('\n')}
${meal.water ? `- liquids: ${meal.water}` : ''}
${meal.prepMethod ? `- prep method: ${meal.prepMethod}` : ''}
`).join('\n');

    return `Act as a strict meal prep calculator and format generator. Below is a centralized configuration section containing weights, targets, and cooking instructions. 

Your task is to automatically calculate all calories using standard nutritional values for raw/uncooked ingredients, round them to the nearest whole number, solve for any ingredients marked as \`[AUTO]\`, and generate a dual-purpose diet plan document.
- PART 1 must be a detailed macro and meal breakdown for myself (using markdown tables and your computed calories). 
- PART 2 must be a raw, copy-pasteable weekly text plan for my cook containing ONLY strict text blocks for each day with absolutely no conversational text, tables, or calorie explanations.

===================================================================
       CONFIGURABLE VARIABLES (EDIT TARGETS, WEIGHTS & SPLITS HERE)
===================================================================

[GLOBAL DIET TARGETS]
- Daily Calorie Target: ${c.global.dailyCalorieTarget} kcal
- Total Daily Olive Oil: ${c.global.totalOliveOil}g (MUST include this globally in daily calorie sum calculations)
${mealsTargetText}

${mealsDetailsText}
[COOK COOKING & SEASONING SPLITS / INSTRUCTIONS]
${splitsText}

[DAILY VARIABLE INGREDIENT WEIGHTS (WHOLE DAY)]
* Note: Use [AUTO] for any ingredient you want the calculator to dynamically scale to hit your exact Daily Calorie Target.
${activeDays.map(day => {
  const ingredients = c.dailyVariables[day] || [];
  const variant = getDayVariantName(ingredients);
  const itemsText = ingredients.map(ing => `${ing.name}: ${ing.isAuto ? '[AUTO]' : `${ing.weight}g`}`).join(', ');
  return `- ${day} (${variant}): ${itemsText}`;
}).join('\n')}

===================================================================
                        MATH & OUTPUT GENERATION
===================================================================

INSTRUCTIONS FOR THE CALCULATOR:
1. Estimate the raw/uncooked calorie density (kcal per 1g) for each ingredient using standard USDA nutritional values (e.g. Raw Rice ≈ 3.6 kcal/g, Raw Chicken Breast ≈ 1.2 kcal/g, Olive Oil ≈ 8.75 kcal/g, Eggs ≈ 1.43 kcal/g, Butter ≈ 7.17 kcal/g, Pasta ≈ 3.55 kcal/g, Raw Oats ≈ 3.89 kcal/g, Whey Protein Isolate ≈ 3.7 kcal/g, Almonds ≈ 5.79 kcal/g, Cashews ≈ 5.53 kcal/g, Walnuts ≈ 6.54 kcal/g, Banana ≈ 0.89 kcal/g, Tomato ≈ 0.18 kcal/g, Potato (Raw) ≈ 0.77 kcal/g, Cluster Beans ≈ 0.16 kcal/g, Bottle Gourd ≈ 0.15 kcal/g, Brinjal ≈ 0.25 kcal/g, etc.).
2. For ${isSingle ? `the selected day (${c.selectedGenerationDay})` : 'each day'}, sum the calculated calories of all strictly defined weights across all meals and daily variables:
   - Daily calories from meals = Sum over all meals of: (sum of calories of all ingredients in that meal) x (meals per day for that meal)
   - Daily variables calories = sum of calories of all variables for that day
   - Global Olive Oil calories = Total Daily Olive Oil x (calorie density of Olive Oil)
3. Subtract that total (meals + variables + olive oil) from the [Daily Calorie Target] to find the remaining calorie deficit.
4. Convert that remaining calorie deficit into grams for the ingredient(s) marked \`[AUTO]\` using their calorie density to determine their exact weight. 
5. If a day contains multiple \`[AUTO]\` ingredients, split the remaining deficit equally (50-50 in terms of calories) between them, then solve for each weight.
6. For each meal, divide its daily baseline weights and any daily variable weights by the meal's daily frequency to find the per-meal weight.
7. Round all final calculated weights and calories to the nearest whole number so that the day's total hits your target exactly.

---

PART 1: FOR MYSELF (User Breakdown)
Generate this exact section first using markdown tables and bullet points based strictly on your calculations.

${mealsList.map((meal, idx) => `
${idx + 1}. ${meal.name} (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''} Per Day)
Include a markdown table with columns: Ingredient, Weight Per Meal, Daily Total (${meal.mealsPerDay} Meal${meal.mealsPerDay > 1 ? 's' : ''}), Calories (Per Meal). Sum the total calculated calories at the bottom of the table.
`).join('\n')}

For daily variables and splits:
List out ${daysLabel} using bullet points. Under ${dayRefLabel}, list ALL fixed items and variable items together, displaying the per-meal weight, daily weight, and calculated calorie breakdown. If an item was calculated via \`[AUTO]\`, replace the \`[AUTO]\` tag with the calculated real weights. Show a calculated "Meal Total" for each day.

Include a Daily Totals (Summary) bulleted section at the bottom of Part 1 aggregating the calculated daily sum total across all meals (and include the global Olive Oil calories) to prove it hits your configured target.

---

PART 2: FOR MY COOK (Weekly Text Plan)
Separate this from Part 1 using a horizontal rule (---). Output ${isSingle ? `only the day ${c.selectedGenerationDay}` : 'every day from Monday to Sunday'} using the exact line-by-line template below. Map your calculated total daily weights (including solved \`[AUTO]\` weights) and cooking splits/instructions directly. Absolutely no conversational text, tables, or calorie mentions in this section.

Exact Output Template to Follow for Each Day:

### [DAY]: [Ingredient Variant Name]
[For each meal, list its ingredients with daily total weights in grams. Then list liquid configuration and prep methods without any hyphen or bullet point prefix. E.g.
"Meal Name:
ingredient1 name 150g
ingredient2 name 100g
liquids: 190g water
prep method: airfryer 200c, 10min"]
[List all custom splits and cooking instructions for each day here, again with no hyphen prefix]
`;
  };

  const autoGeneratedPrompt = compilePromptText(config);
  const activePrompt = isCustomMode ? customPrompt : autoGeneratedPrompt;

  // Initialize custom prompt if entering custom mode
  useEffect(() => {
    if (isCustomMode && !customPrompt) {
      setCustomPrompt(autoGeneratedPrompt);
    }
  }, [isCustomMode, autoGeneratedPrompt, customPrompt]);

  // Handlers for dynamic state modifications
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
      ingredients: [
        { name: 'Ingredient 1', weight: '0', isAuto: false }
      ],
      water: '',
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
      return { ...prev, meals: remainingMeals };
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
          } else if (field === 'weight') {
            item.weight = value;
            if (value) item.isAuto = false;
          } else {
            item[field] = value as string;
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
    const defaultIng: Ingredient = { name: 'New Item', weight: '0', isAuto: false };
    setConfig(prev => ({
      ...prev,
      dailyVariables: {
        ...prev.dailyVariables,
        [dayKey]: [...(prev.dailyVariables[dayKey] || []), defaultIng]
      }
    }));
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
      } else if (field === 'weight') {
        item.weight = value;
        if (value) item.isAuto = false;
      } else {
        item[field] = value as string;
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

  // Custom Splits manipulators
  const updateCustomSplit = (id: string, field: 'name' | 'value', val: string) => {
    setConfig(prev => {
      const splitsList = prev.customSplits || [];
      const updated = splitsList.map(s => s.id === id ? { ...s, [field]: val } : s);
      return { ...prev, customSplits: updated };
    });
  };

  const addCustomSplit = () => {
    const newSplit = {
      id: Date.now().toString(),
      name: 'New Split/Instruction',
      value: 'Enter instructions here'
    };
    setConfig(prev => ({
      ...prev,
      customSplits: [...(prev.customSplits || []), newSplit]
    }));
  };

  const removeCustomSplit = (id: string) => {
    setConfig(prev => ({
      ...prev,
      customSplits: (prev.customSplits || []).filter(s => s.id !== id)
    }));
  };



  // Run AI Generation
  const handleGenerate = async () => {
    if (!config.apiKey) {
      setErrorMsg('API Key is missing. Please enter your Gemini API Key in the "Global & API Setup" tab.');
      setActiveTab('global');
      return;
    }

    setIsGenerating(true);
    setErrorMsg('');
    setOutputText('');
    setThinkingText('');

    try {
      const selectedModel = config.model === 'custom' ? config.customModel : config.model;
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey
        },
        body: JSON.stringify({
          prompt: activePrompt,
          model: selectedModel,
          thinkingEnabled: config.thinkingEnabled,
          thinkingBudget: config.thinkingBudget
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Server responded with an error.');
      }

      setOutputText(data.text);
      if (data.thought) {
        setThinkingText(data.thought);
        setOutputTab('thoughts');
      } else {
        setOutputTab('user');
      }
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || 'An error occurred while connecting to the Gemini API.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Copy to Clipboard
  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedStatus(true);
      setTimeout(() => setCopiedStatus(false), 2000);
    });
  };

  // Simple custom Markdown rendering to HTML
  const getPart1AndPart2 = (md: string) => {
    if (!md) return { part1: '', part2: '' };
    
    // Find where PART 2 starts
    const splitRegex = /(?:###?\s*)?PART\s*2:\s*FOR\s*MY\s*COOK[^\n]*/i;
    const match = md.match(splitRegex);
    
    if (match && match.index !== undefined) {
      const part1 = md.substring(0, match.index).trim();
      let part2 = md.substring(match.index + match[0].length).trim();
      
      // Clean up leading horizontal rule if present
      if (part2.startsWith('---')) {
        part2 = part2.substring(3).trim();
      }
      
      // Clean up trailing horizontal rule from part1
      let cleanedPart1 = part1;
      if (cleanedPart1.endsWith('---')) {
        cleanedPart1 = cleanedPart1.substring(0, cleanedPart1.length - 3).trim();
      }
      
      return { part1: cleanedPart1, part2 };
    }
    
    // Fallback: split by last horizontal rule
    const sections = md.split('---');
    if (sections.length > 1) {
      const part2 = sections[sections.length - 1].trim();
      const part1 = sections.slice(0, sections.length - 1).join('---').trim();
      return { part1, part2 };
    }
    
    return { part1: md, part2: '' };
  };

  const renderMarkdown = (md: string) => {
    if (!md) return '';
    
    const { part1 } = getPart1AndPart2(md);
    const lines = part1.split('\n');
    const html: string[] = [];
    let inList = false;
    let inTable = false;
    let tableRows: string[] = [];

    const parseInline = (text: string) => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.08); padding: 0.1rem 0.35rem; border-radius: 4px; font-family: monospace;">$1</code>');
    };

    const renderTable = (rows: string[]) => {
      if (rows.length === 0) return '';
      const tHtml = ['<table>'];
      let hasHeader = false;
      
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (row.includes('---') && r === 1) continue;
        
        const cells = row
          .split('|')
          .map(c => c.trim())
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        
        if (r === 0) {
          tHtml.push('<thead><tr>');
          cells.forEach(cell => tHtml.push(`<th>${parseInline(cell)}</th>`));
          tHtml.push('</tr></thead><tbody>');
          hasHeader = true;
        } else {
          tHtml.push('<tr>');
          cells.forEach(cell => tHtml.push(`<td>${parseInline(cell)}</td>`));
          tHtml.push('</tr>');
        }
      }
      if (hasHeader) tHtml.push('</tbody>');
      tHtml.push('</table>');
      return tHtml.join('\n');
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) {
        if (inList) { html.push('</ul>'); inList = false; }
        if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
        continue;
      }

      if (line.startsWith('- ') || line.startsWith('* ')) {
        if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
        if (!inList) { html.push('<ul>'); inList = true; }
        html.push(`<li>${parseInline(line.substring(2))}</li>`);
        continue;
      }

      if (/^\d+\.\s/.test(line)) {
        if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
        if (inList) { html.push('</ul>'); inList = false; }
        const headingContent = line.replace(/^\d+\.\s/, '');
        const num = line.match(/^(\d+)\.\s/)?.[1] || '1';
        html.push(`<h4 style="margin-top: 1.25rem; font-size: 1.05rem; font-weight: 700; color: #c084fc;">${num}. ${parseInline(headingContent)}</h4>`);
        continue;
      }

      if (line.startsWith('### ')) {
        if (inList) { html.push('</ul>'); inList = false; }
        if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
        html.push(`<h3>${parseInline(line.substring(4))}</h3>`);
        continue;
      }

      if (line.startsWith('## ')) {
        if (inList) { html.push('</ul>'); inList = false; }
        if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
        html.push(`<h2>${parseInline(line.substring(3))}</h2>`);
        continue;
      }

      if (line.startsWith('# ')) {
        if (inList) { html.push('</ul>'); inList = false; }
        if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
        html.push(`<h1>${parseInline(line.substring(2))}</h1>`);
        continue;
      }

      if (line.startsWith('|')) {
        if (inList) { html.push('</ul>'); inList = false; }
        inTable = true;
        tableRows.push(line);
        continue;
      }

      if (inList) { html.push('</ul>'); inList = false; }
      if (inTable) { html.push(renderTable(tableRows)); tableRows = []; inTable = false; }
      html.push(`<p style="margin-bottom: 0.5rem;">${parseInline(line)}</p>`);
    }

    if (inList) html.push('</ul>');
    if (inTable) html.push(renderTable(tableRows));

    return html.join('\n');
  };

  const getCookPlanOnly = (md: string) => {
    return getPart1AndPart2(md).part2;
  };

  if (!isMounted) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p style={{ color: 'var(--text-secondary)' }}>Loading configuration dashboard...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-title-container">
          <h1 className="header-title">AI Diet Maker</h1>
          <p className="header-subtitle">Strict meal prep calculator, solved via Gemini Thinking Models</p>
        </div>
        <div className="api-status">
          {config.apiKey ? (
            <span className="api-key-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
              Gemini API Active
            </span>
          ) : (
            <span className="api-key-badge missing">
              ⚠️ API Key Needed
            </span>
          )}
        </div>
      </header>

      <main className="dashboard-grid">
        {/* Left Column: Configuration Panels */}
        <section className="glass-panel">
          <div className="panel-header">
            <h2 className="panel-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              Configuration Builder
            </h2>
          </div>

          <div className="section-tabs" style={{ overflowX: 'auto', whiteSpace: 'nowrap', display: 'flex', gap: '0.5rem', scrollbarWidth: 'none' }}>
            <button className={`section-tab-btn ${activeTab === 'global' ? 'active' : ''}`} onClick={() => setActiveTab('global')}>
              Setup
            </button>
            {(config.meals || []).map(meal => (
              <button
                key={meal.id}
                className={`section-tab-btn ${activeTab === meal.id ? 'active' : ''}`}
                onClick={() => setActiveTab(meal.id)}
              >
                {meal.name}
              </button>
            ))}
            <button 
              className="section-tab-btn" 
              onClick={addNewMeal}
              style={{ border: '1px dashed var(--accent-purple)', color: 'var(--accent-purple)', flex: 'none', minWidth: '100px' }}
            >
              + Add Meal
            </button>
            <button className={`section-tab-btn ${activeTab === 'daily' ? 'active' : ''}`} onClick={() => setActiveTab('daily')}>
              Variables
            </button>
            <button className={`section-tab-btn ${activeTab === 'prompt' ? 'active' : ''}`} onClick={() => setActiveTab('prompt')}>
              Prompt
            </button>
          </div>

          {/* Setup Subpanel */}
          {activeTab === 'global' && (
            <div>
              <div className="form-group">
                <label className="form-label">Gemini API Key</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    className="form-input"
                    placeholder="AIzaSy..."
                    value={config.apiKey}
                    onChange={e => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                  />
                  <button className="btn-secondary" onClick={() => setShowApiKey(!showApiKey)}>
                    {showApiKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
                  Your key is saved locally in localStorage and never sent anywhere except directly to Google.
                </p>
              </div>

              <div className="input-row">
                <div className="form-group">
                  <label className="form-label">Gemini Model</label>
                  <select
                    className="form-input"
                    value={config.model}
                    onChange={e => setConfig(prev => ({ ...prev, model: e.target.value }))}
                  >
                    <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                    <option value="gemini-3.1-pro">Gemini 3.1 Pro</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    <option value="custom">Custom Model Name</option>
                  </select>
                </div>

                {config.model === 'custom' && (
                  <div className="form-group">
                    <label className="form-label">Custom Model Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={config.customModel}
                      onChange={e => setConfig(prev => ({ ...prev, customModel: e.target.value }))}
                      placeholder="gemini-3.5-flash"
                    />
                  </div>
                )}
              </div>

              <div className="form-group" style={{ marginTop: '0.5rem' }}>
                <div 
                  className={`switch-container ${config.thinkingEnabled ? 'checked' : ''}`}
                  onClick={() => setConfig(prev => ({ ...prev, thinkingEnabled: !prev.thinkingEnabled }))}
                >
                  <div className="switch-control"></div>
                  <span className="form-label" style={{ margin: 0, cursor: 'pointer' }}>Enable Thinking Mode</span>
                </div>
              </div>

              {config.thinkingEnabled && (
                <div className="form-group">
                  <label className="form-label">Thinking Budget ({config.thinkingBudget} tokens)</label>
                  <input
                    type="range"
                    min="1024"
                    max="8192"
                    step="1024"
                    value={config.thinkingBudget}
                    onChange={e => setConfig(prev => ({ ...prev, thinkingBudget: parseInt(e.target.value) }))}
                    style={{ width: '100%', accentColor: 'var(--accent-purple)' }}
                  />
                  <p style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    <span>1024 (Low)</span>
                    <span>4096 (Med)</span>
                    <span>8192 (High)</span>
                  </p>
                </div>
              )}

              <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)', margin: '1.5rem 0' }} />

              <div className="input-row">
                <div className="form-group">
                  <label className="form-label">Calorie Target (kcal)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={config.global.dailyCalorieTarget}
                    onChange={e => updateGlobal('dailyCalorieTarget', parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Total Olive Oil (g)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={config.global.totalOliveOil || 18}
                    onChange={e => updateGlobal('totalOliveOil', parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Olive Oil for Subji (%)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={config.global.oliveOilSplitPercent || 50}
                      onChange={e => updateGlobal('oliveOilSplitPercent', parseInt(e.target.value) || 50)}
                      style={{ flex: 1, accentColor: 'var(--accent-purple)' }}
                    />
                    <span style={{ fontSize: '0.85rem', width: '40px' }}>{config.global.oliveOilSplitPercent || 50}%</span>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '0.25rem' }}>
                    Remaining {(100 - (config.global.oliveOilSplitPercent || 50))}% goes to chicken
                  </p>
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)', margin: '1.5rem 0' }} />

              <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>
                Cook Seasoning & Instructions Splits
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
                {(config.customSplits || []).map((split) => (
                  <div key={split.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '0.5rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
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
                ))}
              </div>

              <button className="btn-add" style={{ marginTop: '0.25rem' }} onClick={addCustomSplit}>
                + Add Custom Cook Split / Instruction
              </button>
            </div>
          )}

          {/* Dynamic Meal Config Subpanel */}
          {(() => {
            const selectedMeal = (config.meals || []).find(m => m.id === activeTab);
            if (!selectedMeal) return null;
            return (
              <div>
                <div className="input-row" style={{ marginBottom: '1.25rem' }}>
                  <div className="form-group">
                    <label className="form-label">Meal Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={selectedMeal.name}
                      onChange={e => updateMeal(selectedMeal.id, 'name', e.target.value)}
                      placeholder="e.g. Oats Meal, Pasta Meal"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Meals Per Day (Frequency)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={selectedMeal.mealsPerDay}
                      onChange={e => updateMeal(selectedMeal.id, 'mealsPerDay', parseInt(e.target.value) || 1)}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label className="form-label" style={{ margin: 0 }}>Meal Ingredients</label>
                  {config.meals.length > 1 && (
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
                    <div key={idx} className="ingredient-item">
                      <input
                        type="text"
                        className="form-input"
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                        value={ing.name}
                        onChange={e => updateMealIngredient(selectedMeal.id, idx, 'name', e.target.value)}
                      />
                      <input
                        type="number"
                        className="form-input"
                        style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                        placeholder="g"
                        disabled={ing.isAuto}
                        value={ing.weight}
                        onChange={e => updateMealIngredient(selectedMeal.id, idx, 'weight', e.target.value)}
                      />
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>grams</span>
                      <label className="auto-checkbox-container">
                        <input
                          type="checkbox"
                          checked={ing.isAuto}
                          onChange={e => updateMealIngredient(selectedMeal.id, idx, 'isAuto', e.target.checked)}
                        />
                        AUTO
                      </label>
                      <button className="btn-remove" onClick={() => removeMealIngredient(selectedMeal.id, idx)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
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
                  <label className="form-label">Preparation Method & Cooking Instructions</label>
                  <input
                    type="text"
                    className="form-input"
                    value={selectedMeal.prepMethod}
                    onChange={e => updateMeal(selectedMeal.id, 'prepMethod', e.target.value)}
                    placeholder="e.g. Cook in airfryer 200c for 10 min"
                  />
                </div>
              </div>
            );
          })()}

          {/* Daily Variables Config Subpanel */}
          {activeTab === 'daily' && (
            <div>
              <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>Select Day of Week</label>
              
              <div className="day-selector-grid">
                {DAYS_OF_WEEK.map(day => (
                  <button
                    key={day}
                    className={`day-btn ${activeDay === day ? 'active' : ''}`}
                    onClick={() => setActiveDay(day)}
                  >
                    {day.substring(0, 3)}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h4 style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 700 }}>
                  Ingredients for {activeDay} ({getDayVariantName(config.dailyVariables[activeDay] || [])})
                </h4>
              </div>

              <div className="ingredients-list">
                {(config.dailyVariables[activeDay] || []).map((ing, idx) => (
                  <div key={idx} className="ingredient-item">
                    <input
                      type="text"
                      className="form-input"
                      style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                      value={ing.name}
                      onChange={e => updateIngredient('daily', idx, 'name', e.target.value, activeDay)}
                    />
                    <input
                      type="number"
                      className="form-input"
                      style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                      placeholder="g"
                      disabled={ing.isAuto}
                      value={ing.weight}
                      onChange={e => updateIngredient('daily', idx, 'weight', e.target.value, activeDay)}
                    />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>grams</span>
                    <label className="auto-checkbox-container">
                      <input
                        type="checkbox"
                        checked={ing.isAuto}
                        onChange={e => updateIngredient('daily', idx, 'isAuto', e.target.checked, activeDay)}
                      />
                      AUTO
                    </label>
                    <button className="btn-remove" onClick={() => removeIngredient('daily', idx, activeDay)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              <button className="btn-add" onClick={() => addIngredient('daily', activeDay)}>
                + Add Ingredient to {activeDay}
              </button>
            </div>
          )}

          {/* Prompt Preview Subpanel */}
          {activeTab === 'prompt' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <label className="form-label" style={{ margin: 0 }}>Active LLM Prompt Text</label>
                <div 
                  className={`switch-container ${isCustomMode ? 'checked' : ''}`}
                  onClick={() => setIsCustomMode(!isCustomMode)}
                >
                  <div className="switch-control" style={{ transform: 'scale(0.8)' }}></div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Edit Prompt Directly</span>
                </div>
              </div>

              <textarea
                className={`prompt-preview-body ${isCustomMode ? 'editable' : ''}`}
                style={{ height: '350px' }}
                value={activePrompt}
                disabled={!isCustomMode}
                onChange={e => setCustomPrompt(e.target.value)}
              />
              {!isCustomMode && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                  {'Auto-compiling from form fields above. Enable "Edit Prompt Directly" to tweak instructions manually.'}
                </p>
              )}
            </div>
          )}

          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '10px', marginTop: '1.5rem' }}>
            <label className="form-label" style={{ marginBottom: '0.5rem', display: 'block', fontSize: '0.8rem' }}>Generation Scope</label>
            <div style={{ display: 'flex', gap: '1.25rem', marginBottom: '0.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="generationRange"
                  checked={config.generationRange === 'all'}
                  onChange={() => setConfig(prev => ({ ...prev, generationRange: 'all' }))}
                />
                All Days (Full Week)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="generationRange"
                  checked={config.generationRange === 'single'}
                  onChange={() => setConfig(prev => ({ ...prev, generationRange: 'single' }))}
                />
                Single Day Only
              </label>
            </div>

            {config.generationRange === 'single' && (
              <div className="form-group" style={{ margin: 0, marginTop: '0.75rem' }}>
                <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>Choose Day</label>
                <select
                  className="form-input"
                  style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                  value={config.selectedGenerationDay}
                  onChange={e => setConfig(prev => ({ ...prev, selectedGenerationDay: e.target.value }))}
                >
                  {DAYS_OF_WEEK.map(day => {
                    const ingredients = config.dailyVariables[day] || [];
                    const variant = getDayVariantName(ingredients);
                    return (
                      <option key={day} value={day}>
                        {day} ({variant})
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <button
              className="btn-primary"
              disabled={isGenerating}
              onClick={handleGenerate}
            >
              {isGenerating ? (
                <>
                  <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2px', borderTopColor: '#fff', boxShadow: 'none' }}></div>
                  Calculating & Generating...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                  </svg>
                  Generate Diet Plan
                </>
              )}
            </button>
          </div>
        </section>

        {/* Right Column: AI Outputs */}
        <section className="glass-panel" style={{ minHeight: '500px', display: 'flex', flexDirection: 'column' }}>
          <div className="output-header-tabs">
            {thinkingText && (
              <button 
                className={`output-tab ${outputTab === 'thoughts' ? 'active' : ''}`} 
                onClick={() => setOutputTab('thoughts')}
              >
                Thinking Process
              </button>
            )}
            <button 
              className={`output-tab ${outputTab === 'user' ? 'active' : ''}`} 
              onClick={() => setOutputTab('user')}
            >
              Part 1: For Myself
            </button>
            <button 
              className={`output-tab ${outputTab === 'cook' ? 'active' : ''}`} 
              onClick={() => setOutputTab('cook')}
            >
              Part 2: For Cook
            </button>
          </div>

          {errorMsg && (
            <div style={{ background: 'rgba(244, 63, 94, 0.1)', borderLeft: '4px solid var(--accent-rose)', color: '#fda4af', padding: '1rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.85rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Generation Error</div>
              {errorMsg}
            </div>
          )}

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {isGenerating ? (
              <div className="loading-container" style={{ flex: 1 }}>
                <div className="spinner"></div>
                <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Gemini is solving calculations...</p>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Using precision math constraints</span>
              </div>
            ) : outputText ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                {outputTab === 'thoughts' && thinkingText && (
                  <div className="thinking-box" style={{ flex: 1 }}>
                    <div className="thinking-title">Gemini Thinking Output</div>
                    <div className="thinking-text" style={{ maxHeight: 'none', height: '430px' }}>
                      {thinkingText}
                    </div>
                  </div>
                )}

                {outputTab === 'user' && (
                  <div 
                    className="markdown-content" 
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(outputText) }} 
                  />
                )}

                {outputTab === 'cook' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', height: '100%', flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.75rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Each day can be copied individually below</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto', maxHeight: '500px', paddingRight: '0.25rem' }}>
                      {parseCookPlanDays(getCookPlanOnly(outputText)).map((dayObj, idx) => (
                        <div key={idx} className="glass-panel" style={{ padding: '1rem', background: 'rgba(0,0,0,0.15)', borderColor: 'rgba(255,255,255,0.04)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <h4 style={{ margin: 0, color: '#c084fc', fontSize: '0.9rem', fontWeight: 700 }}>
                              {dayObj.heading.replace('###', '').trim()}
                            </h4>
                            <DayCopyButton 
                              text={(() => {
                                const colonIndex = dayObj.heading.indexOf(':');
                                const variant = colonIndex !== -1 ? dayObj.heading.substring(colonIndex + 1).trim() : '';
                                return variant ? `${variant}\n${dayObj.content}` : dayObj.content;
                              })()} 
                            />
                          </div>
                          <pre style={{ 
                            background: 'rgba(0,0,0,0.2)', 
                            padding: '0.75rem', 
                            borderRadius: '6px', 
                            fontSize: '0.8rem', 
                            fontFamily: 'var(--font-mono)', 
                            color: 'var(--text-secondary)',
                            whiteSpace: 'pre-wrap',
                            lineHeight: '1.5',
                            margin: 0
                          }}>
                            {dayObj.content}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="placeholder-container" style={{ flex: 1 }}>
                <div className="placeholder-icon">📋</div>
                <h3 style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem', fontSize: '1rem' }}>No Plan Generated Yet</h3>
                <p style={{ fontSize: '0.85rem', maxWidth: '300px' }}>
                  {'Configure your variables in the left builder, verify your API Key, and click "Generate Diet Plan".'}
                </p>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>AI Diet Maker © 2026. Made with Google Gemini API.</p>
      </footer>
    </div>
  );
}

// Sub-components and helpers for copying individual days
function DayCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  
  return (
    <button 
      className="btn-secondary" 
      style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }} 
      onClick={handleCopy}
    >
      {copied ? (
        <span style={{ color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          Copied
        </span>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy Day
        </span>
      )}
    </button>
  );
}

function parseCookPlanDays(cookPlan: string) {
  if (!cookPlan) return [];
  
  const dayRegex = /###\s*(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)[^\n]*/i;
  const lines = cookPlan.split('\n');
  const days: { day: string, heading: string, content: string[] }[] = [];
  let currentDay: typeof days[0] | null = null;
  
  for (const line of lines) {
    const match = line.match(dayRegex);
    if (match) {
      const dayName = match[1].toUpperCase();
      currentDay = {
        day: dayName,
        heading: line.trim(),
        content: []
      };
      days.push(currentDay);
    } else if (currentDay) {
      currentDay.content.push(line);
    }
  }
  
  return days.map(d => ({
    day: d.day,
    heading: d.heading,
    content: d.content.join('\n').trim()
  })).filter(d => d.content.length > 0);
}
