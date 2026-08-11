export type ModelKey = "model_a" | "model_b";
export type StrategyKey = "s1" | "s2" | "s3" | "s4" | "s5";

export type SimulationRequest = Record<string, unknown>;

export type ScenarioConfig = {
  current_age: number;
  retirement_age: number;
  initial_wealth: number;
  annual_contribution: number;
  target_wealth: number;
  paths: number;
  seed: number;
  equity_drift: number;
  equity_volatility: number;
  bond_drift: number;
  bond_volatility: number;
  correlation: number;
  risk_free_rate: number;
  put_moneyness: number;
  protected_years: number;
  fan_chart_strategy: StrategyKey;
  fan_sample_size: number;
};

export type ModelBScenarioConfig = ScenarioConfig & {
  restart_probability: number;
};

export type StrategyResult = {
  key: StrategyKey;
  name: string;
  mean: number;
  median: number;
  shortfall_probability: number;
  shortfall_ci_low: number;
  shortfall_ci_high: number;
  q01: number;
  q05: number;
  q10: number;
  q90: number;
  cvar5: number;
};

export type AllocationPoint = {
  year: number;
  age: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  s5: number;
};

export type FanPoint = {
  year: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
};

export type SimulationMetadata = {
  model: ModelKey;
  seed: number;
  paths: number;
  horizon: number;
  runtime_ms: number;
  put_premium: number;
  protected_years: number;
  random_generator: "python_random_mt19937";
  common_random_numbers: true;
  fan_chart_strategy: StrategyKey;
  fan_chart_sample_size: number;
  fan_chart_is_sampled: boolean;
  scenario: Record<string, unknown>;
  [key: string]: unknown;
};

export type SimulationResponse = {
  metadata: SimulationMetadata;
  strategies: StrategyResult[];
  allocation_paths: AllocationPoint[];
  fan_chart: FanPoint[];
};

export type SequenceReturnRow = {
  year: number;
  stock_return: number;
  bond_return: number;
  portfolio_return: number;
};

export type SequenceRiskPayload = {
  metadata: Record<string, unknown>;
  provenance: Record<string, unknown>;
  rows: SequenceReturnRow[];
};

export type SimulationWorkerRequest = {
  id: number;
  payload: unknown;
};

export type SimulationWorkerResponse =
  | { id: number; ok: true; result: SimulationResponse }
  | {
      id: number;
      ok: false;
      error: { type: "validation_error" | "simulation_error"; message: string };
    };
