'use client';
import { Config } from '@/lib/types';
import { ConfigActions } from '@/hooks/useConfigActions';
import NumberInput from '@/components/NumberInput';

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
          <NumberInput
            integer
            min={0}
            className="form-input"
            value={config.global.dailyCalorieTarget}
            onValueChange={n => updateGlobal('dailyCalorieTarget', n)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Min Ideal Na:K Ratio</label>
          <NumberInput
            step="0.01"
            min={0}
            className="form-input"
            value={config.global.idealSodiumPotassiumRatioMin ?? 0.70}
            onValueChange={n => updateGlobal('idealSodiumPotassiumRatioMin', n)}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Max Ideal Na:K Ratio</label>
          <NumberInput
            step="0.01"
            min={0}
            className="form-input"
            value={config.global.idealSodiumPotassiumRatioMax ?? 0.80}
            onValueChange={n => updateGlobal('idealSodiumPotassiumRatioMax', n)}
          />
        </div>
      </div>

    </div>
  );
}
