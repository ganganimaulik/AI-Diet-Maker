'use client';
import { Config } from '@/lib/types';
import { ConfigActions } from '@/hooks/useConfigActions';

interface GlobalTargetsTabProps {
  config: Config;
  actions: ConfigActions;
}

export default function GlobalTargetsTab({ config, actions }: GlobalTargetsTabProps) {
  const { updateGlobal } = actions;

  return (
    <div>
      <h3 className="builder-section-title">
        <span aria-hidden="true">🎯</span> Global Nutrition Targets
      </h3>
      <div className="input-row">
        <div className="form-group">
          <label className="form-label">Calorie Target (kcal)</label>
          <input
            type="number"
            inputMode="numeric"
            className="form-input"
            value={config.global.dailyCalorieTarget}
            onChange={e => updateGlobal('dailyCalorieTarget', parseInt(e.target.value) || 0)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Min Ideal Na:K Ratio</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            className="form-input"
            value={config.global.idealSodiumPotassiumRatioMin === undefined ? 0.70 : config.global.idealSodiumPotassiumRatioMin}
            onChange={e => updateGlobal('idealSodiumPotassiumRatioMin', parseFloat(e.target.value) || 0)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Max Ideal Na:K Ratio</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            className="form-input"
            value={config.global.idealSodiumPotassiumRatioMax === undefined ? 0.80 : config.global.idealSodiumPotassiumRatioMax}
            onChange={e => updateGlobal('idealSodiumPotassiumRatioMax', parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>

    </div>
  );
}
