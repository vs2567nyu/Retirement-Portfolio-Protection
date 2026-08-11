import {
  DATASET_COLUMNS,
  DATASET_PATH,
  DATASET_SHA256,
  DATASET_SOURCE_URL,
  HISTORICAL_RETURNS,
} from "./historicalData.ts";
import { PythonRandom } from "./pythonRandom.ts";
import type {
  AllocationPoint,
  FanPoint,
  ModelBScenarioConfig,
  ScenarioConfig,
  SimulationResponse,
  StrategyKey,
  StrategyResult,
} from "./types.ts";

export const HOSTED_MAX_PATHS = 100_000;

export class SimulationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationValidationError";
  }
}

const STRATEGY_NAMES: Readonly<Record<StrategyKey, string>> = {
  s1: "80/20",
  s2: "60/40",
  s3: "40/60",
  s4: "Age-based glide path",
  s5: "80/20 + protective puts",
};
const STRATEGY_KEYS = Object.keys(STRATEGY_NAMES) as StrategyKey[];

const DEFAULTS = {
  current_age: 35,
  retirement_age: 65,
  initial_wealth: 50_000,
  annual_contribution: 10_000,
  target_wealth: 1_000_000,
  paths: 1_000,
  seed: 41_001,
  equity_drift: 0.10881582243142478,
  equity_volatility: 0.19053867269583694,
  bond_drift: 0.04969164137023846,
  bond_volatility: 0.0712130184392765,
  correlation: -0.025960613316734417,
  risk_free_rate: 0.03426263736263736,
  put_moneyness: 0.9,
  protected_years: null as number | null,
  fan_chart_strategy: "s1" as StrategyKey,
  fan_sample_size: 2_000,
};

const ALIASES: Readonly<Record<string, keyof typeof DEFAULTS>> = {
  age: "current_age",
  starting_age: "current_age",
  retire_age: "retirement_age",
  starting_wealth: "initial_wealth",
  initial_balance: "initial_wealth",
  contribution: "annual_contribution",
  target: "target_wealth",
  n_paths: "paths",
  simulations: "paths",
  stock_drift: "equity_drift",
  equity_mu: "equity_drift",
  stock_volatility: "equity_volatility",
  equity_sigma: "equity_volatility",
  bond_mu: "bond_drift",
  bond_sigma: "bond_volatility",
  rho: "correlation",
  risk_free: "risk_free_rate",
  strike_ratio: "put_moneyness",
  k: "protected_years",
  protection_years: "protected_years",
};

const INTEGER_FIELDS = new Set([
  "current_age", "retirement_age", "paths", "seed", "protected_years", "fan_sample_size",
]);
const FLOAT_FIELDS = new Set([
  "initial_wealth", "annual_contribution", "target_wealth", "equity_drift",
  "equity_volatility", "bond_drift", "bond_volatility", "correlation",
  "risk_free_rate", "put_moneyness",
]);
const MODEL_A_ONLY_FIELDS = new Set([
  "equity_drift", "stock_drift", "equity_mu", "equity_volatility", "stock_volatility",
  "equity_sigma", "bond_drift", "bond_mu", "bond_volatility", "bond_sigma",
  "correlation", "rho", "risk_free_rate", "risk_free",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rawPayload(payload: unknown): Record<string, unknown> {
  if (payload === undefined || payload === null) return {};
  if (!isRecord(payload)) throw new SimulationValidationError("request body must be a JSON object");
  const keys = Object.keys(payload);
  if (keys.length === 1 && keys[0] === "scenario") {
    if (!isRecord(payload.scenario)) {
      throw new SimulationValidationError("request body must be a JSON object");
    }
    return { ...payload.scenario };
  }
  return { ...payload };
}

function parseScenario(input: Record<string, unknown>): ScenarioConfig {
  const raw = { ...input };
  const requestedModel = raw.model ?? "model_a";
  delete raw.model;
  if (!(requestedModel === "model_a" || requestedModel === "a" || requestedModel === "Model A")) {
    throw new SimulationValidationError("this endpoint currently supports only model_a");
  }

  const canonical: Record<string, unknown> = {};
  for (const [source, value] of Object.entries(raw)) {
    const target = ALIASES[source] ?? source;
    if (Object.hasOwn(canonical, target)) {
      throw new SimulationValidationError(`duplicate values supplied for ${target}`);
    }
    canonical[target] = value;
  }
  const allowed = new Set(Object.keys(DEFAULTS));
  const unknown = Object.keys(canonical).filter((key) => !allowed.has(key)).sort();
  if (unknown.length) {
    throw new SimulationValidationError(`unsupported scenario field(s): ${unknown.join(", ")}`);
  }
  for (const [key, value] of Object.entries(canonical)) {
    if (INTEGER_FIELDS.has(key) && value !== null && !Number.isSafeInteger(value)) {
      throw new SimulationValidationError(`${key} must be an integer`);
    }
    if (FLOAT_FIELDS.has(key) && typeof value !== "number") {
      throw new SimulationValidationError(`${key} must be a number`);
    }
  }

  const merged = { ...DEFAULTS, ...canonical } as typeof DEFAULTS;
  const currentAge = merged.current_age;
  const retirementAge = merged.retirement_age;
  if (!Number.isSafeInteger(currentAge)) throw new SimulationValidationError("current_age must be an integer");
  if (!Number.isSafeInteger(retirementAge)) throw new SimulationValidationError("retirement_age must be an integer");
  if (!(currentAge >= 0 && currentAge < 120)) {
    throw new SimulationValidationError("current_age must be between 0 and 119");
  }
  if (!(retirementAge > currentAge && retirementAge <= 120)) {
    throw new SimulationValidationError("retirement_age must be greater than current_age and at most 120");
  }
  const horizon = retirementAge - currentAge;
  if (horizon > 100) throw new SimulationValidationError("simulation horizon cannot exceed 100 years");
  if (!Number.isSafeInteger(merged.paths)) throw new SimulationValidationError("paths must be an integer");
  if (!(merged.paths >= 1 && merged.paths <= HOSTED_MAX_PATHS)) {
    throw new SimulationValidationError(`paths must be between 1 and ${HOSTED_MAX_PATHS.toLocaleString("en-US")}`);
  }
  if (!Number.isSafeInteger(merged.seed)) throw new SimulationValidationError("seed must be an integer");

  for (const field of ["initial_wealth", "annual_contribution", "target_wealth"] as const) {
    const value = merged[field];
    if (!Number.isFinite(value)) throw new SimulationValidationError(`${field} must be a finite number`);
    if (value < 0) throw new SimulationValidationError(`${field} cannot be negative`);
  }
  if (merged.target_wealth === 0) {
    throw new SimulationValidationError("target_wealth must be greater than zero");
  }
  for (const field of [
    "equity_drift", "equity_volatility", "bond_drift", "bond_volatility",
    "correlation", "risk_free_rate", "put_moneyness",
  ] as const) {
    if (!Number.isFinite(merged[field])) {
      throw new SimulationValidationError(`${field} must be a finite number`);
    }
  }
  if (merged.equity_volatility <= 0 || merged.bond_volatility <= 0) {
    throw new SimulationValidationError("volatilities must be greater than zero");
  }
  if (merged.correlation < -1 || merged.correlation > 1) {
    throw new SimulationValidationError("correlation must be between -1 and 1");
  }
  if (merged.put_moneyness <= 0) {
    throw new SimulationValidationError("put_moneyness must be greater than zero");
  }
  const protectedYears = merged.protected_years === null ? horizon : merged.protected_years;
  if (!Number.isSafeInteger(protectedYears)) {
    throw new SimulationValidationError("protected_years must be an integer");
  }
  if (protectedYears < 0 || protectedYears > horizon) {
    throw new SimulationValidationError("protected_years must be between 0 and the simulation horizon");
  }
  if (!STRATEGY_KEYS.includes(merged.fan_chart_strategy as StrategyKey)) {
    throw new SimulationValidationError(`fan_chart_strategy must be one of: ${STRATEGY_KEYS.join(", ")}`);
  }
  if (!Number.isSafeInteger(merged.fan_sample_size)) {
    throw new SimulationValidationError("fan_sample_size must be an integer");
  }
  if (merged.fan_sample_size < 1 || merged.fan_sample_size > 10_000) {
    throw new SimulationValidationError("fan_sample_size must be between 1 and 10,000");
  }

  return { ...merged, protected_years: protectedYears } as ScenarioConfig;
}

function close(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(1e-12, 1e-12 * Math.max(Math.abs(left), Math.abs(right)));
}

function parseModelBScenario(input: Record<string, unknown>): ModelBScenarioConfig {
  const raw = { ...input };
  const requestedModel = raw.model ?? "model_b";
  delete raw.model;
  if (
    typeof requestedModel !== "string"
    || !new Set(["model_b", "b", "empirical", "bootstrap"]).has(
      requestedModel.trim().toLowerCase().replaceAll(" ", "_"),
    )
  ) {
    throw new SimulationValidationError("this simulator supports only model_b");
  }
  const unsupported = Object.keys(raw).filter((key) => MODEL_A_ONLY_FIELDS.has(key)).sort();
  if (unsupported.length) {
    throw new SimulationValidationError(
      `Model B market returns and risk-free rate are fixed by the pinned historical dataset; unsupported field(s): ${unsupported.join(", ")}`,
    );
  }

  const bootstrapAliases: Record<string, "restart_probability" | "mean_block_length"> = {
    restart_probability: "restart_probability",
    restart_prob: "restart_probability",
    p_restart: "restart_probability",
    mean_block_length: "mean_block_length",
    block_length: "mean_block_length",
  };
  const bootstrap: Partial<Record<"restart_probability" | "mean_block_length", unknown>> = {};
  for (const key of Object.keys(raw)) {
    const target = bootstrapAliases[key];
    if (!target) continue;
    if (Object.hasOwn(bootstrap, target)) {
      throw new SimulationValidationError(`duplicate values supplied for ${target}`);
    }
    bootstrap[target] = raw[key];
    delete raw[key];
  }
  for (const [name, value] of Object.entries(bootstrap)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new SimulationValidationError(`${name} must be a finite number`);
    }
  }
  let restart = bootstrap.restart_probability as number | undefined;
  const blockLength = bootstrap.mean_block_length as number | undefined;
  if (restart !== undefined && !(restart > 0 && restart <= 1)) {
    throw new SimulationValidationError("restart_probability must be greater than zero and at most one");
  }
  if (blockLength !== undefined && blockLength < 1) {
    throw new SimulationValidationError("mean_block_length must be at least one year");
  }
  if (restart === undefined && blockLength === undefined) restart = 0.25;
  else if (restart === undefined) restart = 1 / (blockLength as number);
  else if (blockLength !== undefined && !close(restart, 1 / blockLength)) {
    throw new SimulationValidationError("restart_probability and mean_block_length describe different bootstraps");
  }
  return { ...parseScenario({ ...raw, model: "model_a" }), restart_probability: restart as number };
}

export function accurateSum(values: Iterable<number>) {
  const partials: number[] = [];
  for (const original of values) {
    let value = original;
    let next = 0;
    for (let index = 0; index < partials.length; index += 1) {
      let other = partials[index];
      if (Math.abs(value) < Math.abs(other)) [value, other] = [other, value];
      const high = value + other;
      const low = other - (high - value);
      if (low !== 0) {
        partials[next] = low;
        next += 1;
      }
      value = high;
    }
    partials.length = next;
    partials.push(value);
  }
  let total = 0;
  for (let index = partials.length - 1; index >= 0; index -= 1) total += partials[index];
  return total;
}

function mean(values: Iterable<number>, count: number) {
  return accurateSum(values) / count;
}

function normalDensity(value: number) {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function adaptiveSimpson(
  left: number,
  right: number,
  fLeft: number,
  fMiddle: number,
  fRight: number,
  estimate: number,
  epsilon: number,
  depth: number,
): number {
  const middle = (left + right) / 2;
  const leftMiddle = (left + middle) / 2;
  const rightMiddle = (middle + right) / 2;
  const fLeftMiddle = normalDensity(leftMiddle);
  const fRightMiddle = normalDensity(rightMiddle);
  const leftEstimate = (middle - left) * (fLeft + 4 * fLeftMiddle + fMiddle) / 6;
  const rightEstimate = (right - middle) * (fMiddle + 4 * fRightMiddle + fRight) / 6;
  const combined = leftEstimate + rightEstimate;
  if (depth <= 0 || Math.abs(combined - estimate) <= 15 * epsilon) {
    return combined + (combined - estimate) / 15;
  }
  return adaptiveSimpson(left, middle, fLeft, fLeftMiddle, fMiddle, leftEstimate, epsilon / 2, depth - 1)
    + adaptiveSimpson(middle, right, fMiddle, fRightMiddle, fRight, rightEstimate, epsilon / 2, depth - 1);
}

function normalCdf(value: number) {
  if (value <= -8) return 0;
  if (value >= 8) return 1;
  const magnitude = Math.abs(value);
  if (magnitude === 0) return 0.5;
  const middle = magnitude / 2;
  const estimate = magnitude * (normalDensity(0) + 4 * normalDensity(middle) + normalDensity(magnitude)) / 6;
  const integral = adaptiveSimpson(0, magnitude, normalDensity(0), normalDensity(middle), normalDensity(magnitude), estimate, 1e-15, 20);
  return value < 0 ? 0.5 - integral : 0.5 + integral;
}

export function blackScholesPutPremium(
  moneyness: number,
  riskFreeRate: number,
  volatility: number,
  years = 1,
) {
  if (![moneyness, riskFreeRate, volatility, years].every(Number.isFinite)) {
    throw new SimulationValidationError("put-pricing inputs must be finite");
  }
  if (moneyness <= 0 || volatility <= 0 || years <= 0) {
    throw new SimulationValidationError("moneyness, volatility, and years must be greater than zero");
  }
  const rootTime = Math.sqrt(years);
  const d1 = (Math.log(1 / moneyness) + (riskFreeRate + 0.5 * volatility ** 2) * years) / (volatility * rootTime);
  const d2 = d1 - volatility * rootTime;
  return moneyness * Math.exp(-riskFreeRate * years) * normalCdf(-d2) - normalCdf(-d1);
}

export function glideEquityWeight(age: number) {
  return Math.min(0.8, Math.max(0.2, (110 - age) / 100));
}

function percentile(sorted: Float64Array, probability: number) {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  const fraction = position - low;
  return sorted[low] * (1 - fraction) + sorted[high] * fraction;
}

function metrics(values: Float64Array, target: number) {
  const ordered = values.slice().sort();
  let shortfallCount = 0;
  for (const value of ordered) if (value < target) shortfallCount += 1;
  const shortfall = shortfallCount / ordered.length;
  const halfWidth = 1.96 * Math.sqrt(shortfall * (1 - shortfall) / ordered.length);
  const tailCount = Math.max(1, Math.ceil(0.05 * ordered.length));
  return {
    mean: mean(ordered, ordered.length),
    median: percentile(ordered, 0.5),
    shortfall_probability: shortfall,
    shortfall_ci_low: Math.max(0, shortfall - halfWidth),
    shortfall_ci_high: Math.min(1, shortfall + halfWidth),
    q01: percentile(ordered, 0.01),
    q05: percentile(ordered, 0.05),
    q10: percentile(ordered, 0.1),
    q90: percentile(ordered, 0.9),
    cvar5: accurateSum(ordered.subarray(0, tailCount)) / tailCount,
  };
}

function allocationPaths(config: ScenarioConfig): AllocationPoint[] {
  return Array.from({ length: config.retirement_age - config.current_age }, (_, offset) => ({
    year: offset + 1,
    age: config.current_age + offset,
    s1: 0.8,
    s2: 0.6,
    s3: 0.4,
    s4: glideEquityWeight(config.current_age + offset),
    s5: 0.8,
  }));
}

function fanChart(samples: Float64Array[]): FanPoint[] {
  return samples.map((values, year) => {
    const ordered = values.slice().sort();
    return {
      year,
      p10: percentile(ordered, 0.1),
      p25: percentile(ordered, 0.25),
      p50: percentile(ordered, 0.5),
      p75: percentile(ordered, 0.75),
      p90: percentile(ordered, 0.9),
    };
  });
}

function terminalBuffers(paths: number): Record<StrategyKey, Float64Array> {
  return {
    s1: new Float64Array(paths), s2: new Float64Array(paths), s3: new Float64Array(paths),
    s4: new Float64Array(paths), s5: new Float64Array(paths),
  };
}

function selectedWealth(key: StrategyKey, values: readonly number[]) {
  return values[STRATEGY_KEYS.indexOf(key)];
}

function scenarioMetadata(config: ScenarioConfig) {
  return { ...config, horizon: config.retirement_age - config.current_age };
}

export function simulateModelA(payload?: unknown): SimulationResponse {
  const config = parseScenario(rawPayload(payload));
  const started = performance.now();
  const horizon = config.retirement_age - config.current_age;
  const protectionStart = horizon - config.protected_years;
  const premium = blackScholesPutPremium(config.put_moneyness, config.risk_free_rate, config.equity_volatility);
  const floorReturn = config.put_moneyness - 1;
  const stockLocation = config.equity_drift - 0.5 * config.equity_volatility ** 2;
  const bondLocation = config.bond_drift - 0.5 * config.bond_volatility ** 2;
  const correlationScale = Math.sqrt(Math.max(0, 1 - config.correlation ** 2));
  const glideWeights = Array.from({ length: horizon }, (_, year) => glideEquityWeight(config.current_age + year));
  const terminal = terminalBuffers(config.paths);
  const fanCount = Math.min(config.paths, config.fan_sample_size);
  const fanSamples = Array.from({ length: horizon + 1 }, () => new Float64Array(fanCount));
  fanSamples[0].fill(config.initial_wealth);
  const rng = new PythonRandom(config.seed);

  for (let path = 0; path < config.paths; path += 1) {
    const wealth = [config.initial_wealth, config.initial_wealth, config.initial_wealth, config.initial_wealth, config.initial_wealth];
    for (let year = 0; year < horizon; year += 1) {
      const zEquity = rng.gauss();
      const zIndependent = rng.gauss();
      const zBond = config.correlation * zEquity + correlationScale * zIndependent;
      const equityReturn = Math.exp(stockLocation + config.equity_volatility * zEquity) - 1;
      const bondReturn = Math.exp(bondLocation + config.bond_volatility * zBond) - 1;
      const glideWeight = glideWeights[year];
      const gross = [
        1 + 0.8 * equityReturn + 0.2 * bondReturn,
        1 + 0.6 * equityReturn + 0.4 * bondReturn,
        1 + 0.4 * equityReturn + 0.6 * bondReturn,
        1 + glideWeight * equityReturn + (1 - glideWeight) * bondReturn,
        0,
      ];
      gross[4] = year >= protectionStart
        ? 1 + 0.8 * (Math.max(equityReturn, floorReturn) - premium) + 0.2 * bondReturn
        : gross[0];
      for (let strategy = 0; strategy < 5; strategy += 1) {
        wealth[strategy] = wealth[strategy] * gross[strategy] + config.annual_contribution;
      }
      if (path < fanCount) fanSamples[year + 1][path] = selectedWealth(config.fan_chart_strategy, wealth);
    }
    STRATEGY_KEYS.forEach((key, index) => { terminal[key][path] = wealth[index]; });
  }

  const strategies: StrategyResult[] = STRATEGY_KEYS.map((key) => ({
    key, name: STRATEGY_NAMES[key], ...metrics(terminal[key], config.target_wealth),
  }));
  return {
    metadata: {
      model: "model_a", seed: config.seed, paths: config.paths, horizon,
      runtime_ms: performance.now() - started, put_premium: premium,
      protected_years: config.protected_years, random_generator: "python_random_mt19937",
      common_random_numbers: true, fan_chart_strategy: config.fan_chart_strategy,
      fan_chart_sample_size: fanCount, fan_chart_is_sampled: fanCount < config.paths,
      scenario: scenarioMetadata(config),
    },
    strategies,
    allocation_paths: allocationPaths(config),
    fan_chart: fanChart(fanSamples),
  };
}

function historicalStatistics() {
  const count = HISTORICAL_RETURNS.length;
  const stocks = HISTORICAL_RETURNS.map((row) => row.stock_return);
  const bonds = HISTORICAL_RETURNS.map((row) => row.bond_return);
  const tbills = HISTORICAL_RETURNS.map((row) => row.tbill_return);
  const stockLogs = stocks.map(Math.log1p);
  const bondLogs = bonds.map(Math.log1p);
  const stockMean = mean(stockLogs, count);
  const bondMean = mean(bondLogs, count);
  const sampleDeviation = (values: number[], center: number) => Math.sqrt(
    accurateSum(values.map((value) => (value - center) ** 2)) / (values.length - 1),
  );
  const stockVolatility = sampleDeviation(stockLogs, stockMean);
  const bondVolatility = sampleDeviation(bondLogs, bondMean);
  const centered = stockLogs.map((value) => value - stockMean);
  const second = mean(centered.map((value) => value ** 2), count);
  const third = mean(centered.map((value) => value ** 3), count);
  const fourth = mean(centered.map((value) => value ** 4), count);
  const leftCentered = stockLogs.map((value) => value - stockMean);
  const rightCentered = bondLogs.map((value) => value - bondMean);
  const correlation = accurateSum(leftCentered.map((value, index) => value * rightCentered[index]))
    / Math.sqrt(accurateSum(leftCentered.map((value) => value ** 2)) * accurateSum(rightCentered.map((value) => value ** 2)));
  return {
    risk_free_rate: mean(tbills, count),
    equity_arithmetic_mean: mean(stocks, count),
    bond_arithmetic_mean: mean(bonds, count),
    equity_log_return_mean: stockMean,
    equity_log_return_volatility: stockVolatility,
    equity_gbm_drift: stockMean + 0.5 * stockVolatility ** 2,
    bond_log_return_mean: bondMean,
    bond_log_return_volatility: bondVolatility,
    bond_gbm_drift: bondMean + 0.5 * bondVolatility ** 2,
    equity_bond_log_correlation: correlation,
    equity_log_skewness: third / second ** 1.5,
    equity_log_excess_kurtosis: fourth / second ** 2 - 3,
  };
}

function empiricalInputs() {
  const count = HISTORICAL_RETURNS.length;
  const riskFreeRate = mean(HISTORICAL_RETURNS.map((row) => row.tbill_return), count);
  const meanStockGross = mean(HISTORICAL_RETURNS.map((row) => 1 + row.stock_return), count);
  const shift = riskFreeRate - Math.log(meanStockGross);
  return { riskFreeRate, shift };
}

export function empiricalPutPremium(moneyness = 0.9) {
  if (!Number.isFinite(moneyness) || moneyness <= 0) {
    throw new SimulationValidationError("put_moneyness must be greater than zero");
  }
  const { riskFreeRate, shift } = empiricalInputs();
  const payoffs = HISTORICAL_RETURNS.map((row) => Math.max(moneyness - Math.exp(Math.log1p(row.stock_return) + shift), 0));
  return Math.exp(-riskFreeRate) * mean(payoffs, payoffs.length);
}

export function simulateModelB(payload?: unknown): SimulationResponse {
  const config = parseModelBScenario(rawPayload(payload));
  const started = performance.now();
  const horizon = config.retirement_age - config.current_age;
  const protectionStart = horizon - config.protected_years;
  const premium = empiricalPutPremium(config.put_moneyness);
  const { riskFreeRate, shift } = empiricalInputs();
  const floorReturn = config.put_moneyness - 1;
  const glideWeights = Array.from({ length: horizon }, (_, year) => glideEquityWeight(config.current_age + year));
  const terminal = terminalBuffers(config.paths);
  const fanCount = Math.min(config.paths, config.fan_sample_size);
  const fanSamples = Array.from({ length: horizon + 1 }, () => new Float64Array(fanCount));
  fanSamples[0].fill(config.initial_wealth);
  const rng = new PythonRandom(config.seed);

  for (let path = 0; path < config.paths; path += 1) {
    const wealth = [config.initial_wealth, config.initial_wealth, config.initial_wealth, config.initial_wealth, config.initial_wealth];
    let historicalIndex = rng.randBelow(HISTORICAL_RETURNS.length);
    for (let year = 0; year < horizon; year += 1) {
      if (year > 0) {
        historicalIndex = rng.random() < config.restart_probability
          ? rng.randBelow(HISTORICAL_RETURNS.length)
          : (historicalIndex + 1) % HISTORICAL_RETURNS.length;
      }
      const observation = HISTORICAL_RETURNS[historicalIndex];
      const equityReturn = observation.stock_return;
      const bondReturn = observation.bond_return;
      const glideWeight = glideWeights[year];
      const gross = [
        1 + 0.8 * equityReturn + 0.2 * bondReturn,
        1 + 0.6 * equityReturn + 0.4 * bondReturn,
        1 + 0.4 * equityReturn + 0.6 * bondReturn,
        1 + glideWeight * equityReturn + (1 - glideWeight) * bondReturn,
        0,
      ];
      gross[4] = year >= protectionStart
        ? 1 + 0.8 * (Math.max(equityReturn, floorReturn) - premium) + 0.2 * bondReturn
        : gross[0];
      for (let strategy = 0; strategy < 5; strategy += 1) {
        wealth[strategy] = wealth[strategy] * gross[strategy] + config.annual_contribution;
      }
      if (path < fanCount) fanSamples[year + 1][path] = selectedWealth(config.fan_chart_strategy, wealth);
    }
    STRATEGY_KEYS.forEach((key, index) => { terminal[key][path] = wealth[index]; });
  }

  const scenario: Record<string, unknown> = scenarioMetadata(config);
  for (const field of ["equity_drift", "equity_volatility", "bond_drift", "bond_volatility", "correlation", "risk_free_rate"]) {
    delete scenario[field];
  }
  const provenance = {
    path: DATASET_PATH, sha256: DATASET_SHA256, rows: HISTORICAL_RETURNS.length,
    first_year: HISTORICAL_RETURNS[0].year, last_year: HISTORICAL_RETURNS.at(-1)?.year,
    source_url: DATASET_SOURCE_URL, columns: [...DATASET_COLUMNS],
  };
  const strategies: StrategyResult[] = STRATEGY_KEYS.map((key) => ({
    key, name: STRATEGY_NAMES[key], ...metrics(terminal[key], config.target_wealth),
  }));
  return {
    metadata: {
      model: "model_b", seed: config.seed, paths: config.paths, horizon,
      runtime_ms: performance.now() - started, put_premium: premium,
      protected_years: config.protected_years, random_generator: "python_random_mt19937",
      common_random_numbers: true, bootstrap_method: "stationary_paired_block_bootstrap",
      restart_probability: config.restart_probability, mean_block_length: 1 / config.restart_probability,
      risk_free_rate: riskFreeRate, risk_neutral_log_gross_shift: shift,
      dataset_sha256: DATASET_SHA256, dataset_rows: HISTORICAL_RETURNS.length,
      dataset_start_year: HISTORICAL_RETURNS[0].year,
      dataset_end_year: HISTORICAL_RETURNS.at(-1)?.year,
      dataset: provenance, historical_statistics: historicalStatistics(),
      fan_chart_strategy: config.fan_chart_strategy, fan_chart_sample_size: fanCount,
      fan_chart_is_sampled: fanCount < config.paths, scenario,
    },
    strategies,
    allocation_paths: allocationPaths(config),
    fan_chart: fanChart(fanSamples),
  };
}

export function simulate(payload?: unknown): SimulationResponse {
  const raw = rawPayload(payload);
  const model = raw.model ?? "model_a";
  if (model === "model_a" || model === "a" || model === "Model A") return simulateModelA(raw);
  if (model === "model_b" || model === "b" || model === "Model B") return simulateModelB(raw);
  throw new SimulationValidationError("model must be model_a or model_b");
}
