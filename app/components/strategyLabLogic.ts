export type StrategyLabModelKey = "model_a" | "model_b";

export const REPORT_CVAR_PROTECTION_YEARS: Record<StrategyLabModelKey, number> = {
  model_a: 16,
  model_b: 28,
};

export function reportCvarProtectionYears(
  model: StrategyLabModelKey,
  horizon: number,
) {
  const wholeHorizon = Number.isFinite(horizon)
    ? Math.max(0, Math.trunc(horizon))
    : 0;
  return Math.min(REPORT_CVAR_PROTECTION_YEARS[model], wholeHorizon);
}
