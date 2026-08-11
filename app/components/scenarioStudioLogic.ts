export type ModelKey = "model_a" | "model_b";
export type Objective = "growth" | "confidence" | "downside";
export type StrategyKey = "s1" | "s2" | "s3" | "s4" | "s5";

export type ParticipantProfile = {
  currentAge: number;
  currentSavings: number;
  weeklyContribution: number;
  retirementAge: number;
  targetWealth: number;
  protectionYears: number;
  objective: Objective;
};

export type StrategyResult = {
  key: StrategyKey;
  name: string;
  mean: number;
  median: number;
  shortfall_probability: number;
  q05: number;
  cvar5: number;
};

export type SimulationResponse = {
  metadata: {
    model: ModelKey | string;
    seed: number;
    paths: number;
  };
  strategies: StrategyResult[];
};

export function weeklyToAnnual(weeklyContribution: number) {
  return weeklyContribution * 52;
}

export function clampProtectionYears(profile: ParticipantProfile) {
  const horizon = Math.max(0, profile.retirementAge - profile.currentAge);
  return Math.min(horizon, Math.max(0, Math.trunc(profile.protectionYears)));
}

export function createSaveMoreProfile(profile: ParticipantProfile): ParticipantProfile {
  return { ...profile, weeklyContribution: profile.weeklyContribution + 25 };
}

export function createDelayedStartProfile(profile: ParticipantProfile): ParticipantProfile {
  const latestValidStartAge = Math.max(profile.currentAge, profile.retirementAge - 1);
  const delayed = {
    ...profile,
    currentAge: Math.min(profile.currentAge + 5, latestValidStartAge),
  };
  return { ...delayed, protectionYears: clampProtectionYears(delayed) };
}

export function buildSimulationPayload(
  model: ModelKey,
  profile: ParticipantProfile,
  seed: number,
  paths: number,
) {
  return {
    model,
    current_age: profile.currentAge,
    retirement_age: profile.retirementAge,
    starting_wealth: profile.currentSavings,
    annual_contribution: weeklyToAnnual(profile.weeklyContribution),
    target_wealth: profile.targetWealth,
    protection_years: clampProtectionYears(profile),
    paths,
    seed,
    fan_sample_size: 100,
  };
}

export function objectiveValue(strategy: StrategyResult, objective: Objective) {
  if (objective === "growth") return strategy.mean;
  if (objective === "confidence") return 1 - strategy.shortfall_probability;
  return strategy.cvar5;
}

export function bestStrategy(response: SimulationResponse, objective: Objective) {
  return [...response.strategies].sort(
    (left, right) => objectiveValue(right, objective) - objectiveValue(left, objective),
  )[0];
}

export function strategyByKey(response: SimulationResponse, key: StrategyKey) {
  return response.strategies.find((strategy) => strategy.key === key);
}
