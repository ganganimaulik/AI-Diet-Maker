'use client';
import { Config } from '@/lib/types';
import { ConfigActions } from '@/hooks/useConfigActions';

interface GlobalTargetsTabProps {
  config: Config;
  actions: ConfigActions;
}

export default function GlobalTargetsTab({ config, actions }: GlobalTargetsTabProps) {
  const { updateGlobal, updateCustomSplit, removeCustomSplit, addCustomSplit, resetAllDailyOverridesForSplit } = actions;

  return (
    <div>
      <h3 style={{ fontSize: '0.95rem', color: '#fff', marginBottom: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        🎯 Daily Calorie &amp; Olive Oil Targets
      </h3>
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
          <label className="form-label">Min Ideal Na:K Ratio</label>
          <input
            type="number"
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
            step="0.01"
            className="form-input"
            value={config.global.idealSodiumPotassiumRatioMax === undefined ? 0.80 : config.global.idealSodiumPotassiumRatioMax}
            onChange={e => updateGlobal('idealSodiumPotassiumRatioMax', parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>

      <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.05)', margin: '1.5rem 0' }} />

      <label className="form-label" style={{ marginBottom: '0.75rem', display: 'block' }}>
        Cook Seasoning &amp; Instructions Splits
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
        {(config.customSplits || []).map((split) => {
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

      <button className="btn-add" style={{ marginTop: '0.25rem' }} onClick={addCustomSplit}>
        + Add Custom Cook Split / Instruction
      </button>
    </div>
  );
}
