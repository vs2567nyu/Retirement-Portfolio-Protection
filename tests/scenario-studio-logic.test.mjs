import assert from "node:assert/strict";
import test from "node:test";

import {
  bestStrategy,
  buildSimulationPayload,
  clampProtectionYears,
  createDelayedStartProfile,
  createSaveMoreProfile,
  objectiveValue,
  weeklyToAnnual,
} from "../app/components/scenarioStudioLogic.ts";

const baseProfile = Object.freeze({
  currentAge: 22,
  currentSavings: 5_000,
  weeklyContribution: 75,
  retirementAge: 65,
  targetWealth: 1_000_000,
  protectionYears: 20,
  objective: "confidence",
});

test("converts weekly savings to annual contributions", () => {
  assert.equal(weeklyToAnnual(0), 0);
  assert.equal(weeklyToAnnual(25), 1_300);
  assert.equal(weeklyToAnnual(75), 3_900);
});

test("the save-more experiment adds exactly $25 per week and $1,300 per year", () => {
  const saveMore = createSaveMoreProfile(baseProfile);

  assert.notStrictEqual(saveMore, baseProfile);
  assert.equal(baseProfile.weeklyContribution, 75);
  assert.equal(saveMore.weeklyContribution, 100);
  assert.equal(
    weeklyToAnnual(saveMore.weeklyContribution) - weeklyToAnnual(baseProfile.weeklyContribution),
    1_300,
  );
  assert.deepEqual(
    { ...saveMore, weeklyContribution: baseProfile.weeklyContribution },
    baseProfile,
  );
});

test("builds clean Model A and Model B payloads with identical shared inputs", () => {
  const profile = { ...baseProfile, protectionYears: 80 };
  const modelA = buildSimulationPayload("model_a", profile, 73_021, 10_000);
  const modelB = buildSimulationPayload("model_b", profile, 73_021, 10_000);
  const supportedFields = [
    "annual_contribution",
    "current_age",
    "fan_sample_size",
    "model",
    "paths",
    "protection_years",
    "retirement_age",
    "seed",
    "starting_wealth",
    "target_wealth",
  ];

  assert.deepEqual(Object.keys(modelA).sort(), supportedFields);
  assert.deepEqual(Object.keys(modelB).sort(), supportedFields);

  const { model: modelAName, ...modelAShared } = modelA;
  const { model: modelBName, ...modelBShared } = modelB;
  assert.equal(modelAName, "model_a");
  assert.equal(modelBName, "model_b");
  assert.deepEqual(modelAShared, modelBShared);
  assert.equal(modelAShared.annual_contribution, 3_900);
  assert.equal(modelAShared.protection_years, 43);
  assert.equal("objective" in modelA, false);
  assert.equal("weeklyContribution" in modelA, false);
});

test("passes an age-64 participant through with a one-year retirement horizon", () => {
  const profile = {
    ...baseProfile,
    currentAge: 64,
    retirementAge: 65,
    protectionYears: 20,
  };
  const payload = buildSimulationPayload("model_a", profile, 73_021, 1_000);

  assert.equal(payload.current_age, 64);
  assert.equal(payload.retirement_age, 65);
  assert.equal(payload.protection_years, 1);
});

test("ranks each decision objective in the intended higher-is-better direction", () => {
  const response = {
    metadata: { model: "model_a", seed: 1, paths: 3 },
    strategies: [
      {
        key: "s1",
        name: "Growth leader",
        mean: 2_500_000,
        median: 2_000_000,
        shortfall_probability: 0.25,
        q05: 400_000,
        cvar5: 300_000,
      },
      {
        key: "s2",
        name: "Confidence leader",
        mean: 2_000_000,
        median: 1_800_000,
        shortfall_probability: 0.08,
        q05: 650_000,
        cvar5: 500_000,
      },
      {
        key: "s3",
        name: "Downside leader",
        mean: 1_700_000,
        median: 1_600_000,
        shortfall_probability: 0.1,
        q05: 750_000,
        cvar5: 620_000,
      },
    ],
  };

  assert.equal(bestStrategy(response, "growth").key, "s1");
  assert.equal(bestStrategy(response, "confidence").key, "s2");
  assert.equal(bestStrategy(response, "downside").key, "s3");
  assert.equal(objectiveValue(response.strategies[1], "confidence"), 0.92);
});

test("moves a delayed start forward five years and clamps protection to the shorter horizon", () => {
  const profile = { ...baseProfile, protectionYears: 42 };
  const delayed = createDelayedStartProfile(profile);

  assert.equal(profile.currentAge, 22);
  assert.equal(delayed.currentAge, 27);
  assert.equal(delayed.retirementAge, 65);
  assert.equal(delayed.protectionYears, 38);
  assert.equal(delayed.currentSavings, profile.currentSavings);
  assert.equal(delayed.weeklyContribution, profile.weeklyContribution);
  assert.equal(delayed.targetWealth, profile.targetWealth);
  assert.equal(delayed.objective, profile.objective);

  assert.equal(clampProtectionYears({ ...profile, protectionYears: -4 }), 0);
  assert.equal(clampProtectionYears({ ...profile, protectionYears: 17.9 }), 17);
  assert.equal(
    clampProtectionYears({ ...profile, currentAge: 70, retirementAge: 65 }),
    0,
  );

  const nearRetirement = createDelayedStartProfile({
    ...profile,
    currentAge: 63,
    retirementAge: 65,
  });
  assert.equal(nearRetirement.currentAge, 64);
  assert.equal(nearRetirement.protectionYears, 1);

  const finalWorkingYear = createDelayedStartProfile({
    ...profile,
    currentAge: 64,
    retirementAge: 65,
  });
  assert.equal(finalWorkingYear.currentAge, 64);
  assert.equal(finalWorkingYear.protectionYears, 1);
});
