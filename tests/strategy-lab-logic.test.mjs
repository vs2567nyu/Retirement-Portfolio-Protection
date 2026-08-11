import assert from "node:assert/strict";
import test from "node:test";

import {
  REPORT_CVAR_PROTECTION_YEARS,
  reportCvarProtectionYears,
} from "../app/components/strategyLabLogic.ts";

test("uses the report CVaR timing for each return model", () => {
  assert.deepEqual(REPORT_CVAR_PROTECTION_YEARS, {
    model_a: 16,
    model_b: 28,
  });
  assert.equal(reportCvarProtectionYears("model_a", 40), 16);
  assert.equal(reportCvarProtectionYears("model_b", 40), 28);
});

test("caps report timing at the participant's remaining horizon", () => {
  assert.equal(reportCvarProtectionYears("model_a", 9), 9);
  assert.equal(reportCvarProtectionYears("model_b", 9), 9);
  assert.equal(reportCvarProtectionYears("model_a", 16), 16);
  assert.equal(reportCvarProtectionYears("model_b", 28), 28);
});

test("normalizes fractional, negative, and non-finite horizons safely", () => {
  assert.equal(reportCvarProtectionYears("model_b", 17.9), 17);
  assert.equal(reportCvarProtectionYears("model_a", -3.5), 0);
  assert.equal(reportCvarProtectionYears("model_a", Number.NaN), 0);
  assert.equal(reportCvarProtectionYears("model_b", Number.POSITIVE_INFINITY), 0);
  assert.equal(reportCvarProtectionYears("model_b", Number.NEGATIVE_INFINITY), 0);
});

test("calculating a capped horizon does not alter the exported report timings", () => {
  const before = { ...REPORT_CVAR_PROTECTION_YEARS };

  reportCvarProtectionYears("model_a", 2);
  reportCvarProtectionYears("model_b", 3);

  assert.deepEqual(REPORT_CVAR_PROTECTION_YEARS, before);
});
