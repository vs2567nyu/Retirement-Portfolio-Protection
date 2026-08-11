import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compareSequences } from "../app/components/sequenceLabLogic.ts";
import {
  blackScholesPutPremium,
  empiricalPutPremium,
  simulateModelA,
  simulateModelB,
} from "../app/lib/browser-simulation/engine.ts";
import {
  DATASET_SHA256,
  HISTORICAL_CSV,
  HISTORICAL_RETURNS,
} from "../app/lib/browser-simulation/historicalData.ts";
import { PythonRandom } from "../app/lib/browser-simulation/pythonRandom.ts";
import { buildBundledSequenceRiskPayload } from "../app/lib/browser-simulation/sequenceRisk.ts";

const PYTHON_SEED = 41_065;
const PREMIUM_TOLERANCE = 1e-14;
const GOLDEN_TOLERANCE = 1e-9;

const SHARED_SCENARIO = Object.freeze({
  current_age: 35,
  retirement_age: 65,
  initial_wealth: 50_000,
  annual_contribution: 10_000,
  target_wealth: 1_000_000,
  paths: 1_000,
  seed: PYTHON_SEED,
  put_moneyness: 0.9,
  protected_years: 30,
  fan_chart_strategy: "s1",
  fan_sample_size: 1_000,
});

const MODEL_A_SCENARIO = Object.freeze({
  ...SHARED_SCENARIO,
  equity_drift: 0.10881582243142478,
  equity_volatility: 0.19053867269583694,
  bond_drift: 0.04969164137023846,
  bond_volatility: 0.0712130184392765,
  correlation: -0.025960613316734417,
  risk_free_rate: 0.03426263736263736,
});

const GOLDENS = Object.freeze({
  model_a: Object.freeze({
    s1: Object.freeze({
      mean: 2_688_342.0272370023,
      q05: 726_553.239524106,
      cvar5: 526_281.4945249986,
      shortfall_probability: 0.13,
    }),
    s5: Object.freeze({
      mean: 2_200_591.7087446107,
      q05: 719_872.9106509343,
      cvar5: 562_768.3792832266,
      shortfall_probability: 0.153,
    }),
  }),
  model_b: Object.freeze({
    s1: Object.freeze({
      mean: 2_510_620.038200457,
      q05: 775_888.6558023647,
      cvar5: 610_631.6358494833,
      shortfall_probability: 0.1,
    }),
    s5: Object.freeze({
      mean: 2_057_168.60303146,
      q05: 925_732.2726140191,
      cvar5: 763_638.782743999,
      shortfall_probability: 0.081,
    }),
  }),
});

function assertClose(actual, expected, tolerance, label = "value") {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function strategy(response, key) {
  const result = response.strategies.find((candidate) => candidate.key === key);
  assert.ok(result, `missing strategy ${key}`);
  return result;
}

test("PythonRandom reproduces the CPython seed 41065 streams", async (t) => {
  await t.test("random values", () => {
    const rng = new PythonRandom(PYTHON_SEED);
    assert.deepEqual(
      Array.from({ length: 5 }, () => rng.random()),
      [
        0.8370678827766863,
        0.8443390356351999,
        0.38402253957974264,
        0.16329839031999926,
        0.26320288194074626,
      ],
    );
  });

  await t.test("Gaussian values", () => {
    const rng = new PythonRandom(PYTHON_SEED);
    const actual = Array.from({ length: 6 }, () => rng.gauss());
    const expected = [
      1.0033102675350043,
      -1.647276051954392,
      -0.4454872166124171,
      0.39763888581531603,
      -0.13233341831383072,
      1.5915602665708655,
    ];

    actual.forEach((value, index) => {
      // JavaScript and CPython can differ by one floating-point unit in sin/cos.
      assertClose(value, expected[index], Number.EPSILON, `gauss[${index}]`);
    });
  });

  await t.test("randBelow values", () => {
    const rng = new PythonRandom(PYTHON_SEED);
    assert.deepEqual(
      Array.from({ length: 10 }, () => rng.randBelow(91)),
      [52, 3, 49, 20, 33, 15, 9, 45, 83, 30],
    );
  });
});

test("bundled historical data is byte-for-byte equal to the pinned CSV", () => {
  const pinnedCsv = readFileSync(
    new URL("../data/damodaran_histretSPX_1928_2018.csv", import.meta.url),
    "utf8",
  );

  assert.equal(HISTORICAL_CSV, pinnedCsv);
  assert.equal(createHash("sha256").update(HISTORICAL_CSV).digest("hex"), DATASET_SHA256);
  assert.equal(HISTORICAL_RETURNS.length, 91);
  assert.equal(HISTORICAL_RETURNS[0].year, 1928);
  assert.equal(HISTORICAL_RETURNS.at(-1).year, 2018);
});

test("browser put premiums reproduce the Python reference", () => {
  assertClose(
    blackScholesPutPremium(0.9, 0.03426263736263736, 0.19053867269583694),
    0.023946097429252383,
    PREMIUM_TOLERANCE,
    "Model A premium",
  );
  assertClose(
    empiricalPutPremium(0.9),
    0.02564365741407347,
    PREMIUM_TOLERANCE,
    "Model B premium",
  );
});

test("1,000-path Model A and Model B results reproduce Python goldens", () => {
  const responses = {
    model_a: simulateModelA(MODEL_A_SCENARIO),
    model_b: simulateModelB(SHARED_SCENARIO),
  };

  for (const model of ["model_a", "model_b"]) {
    const response = responses[model];
    assert.equal(response.metadata.model, model);
    assert.equal(response.metadata.seed, PYTHON_SEED);
    assert.equal(response.metadata.paths, 1_000);

    for (const key of ["s1", "s5"]) {
      const actual = strategy(response, key);
      const expected = GOLDENS[model][key];
      assertClose(actual.mean, expected.mean, GOLDEN_TOLERANCE, `${model}.${key}.mean`);
      assertClose(actual.q05, expected.q05, GOLDEN_TOLERANCE, `${model}.${key}.q05`);
      assertClose(actual.cvar5, expected.cvar5, GOLDEN_TOLERANCE, `${model}.${key}.cvar5`);
      assert.equal(
        actual.shortfall_probability,
        expected.shortfall_probability,
        `${model}.${key}.shortfall_probability`,
      );
    }
  }
});

test("zero protection makes strategy s5 identical to s1 in both models", () => {
  const responses = [
    simulateModelA({ ...MODEL_A_SCENARIO, protected_years: 0 }),
    simulateModelB({ ...SHARED_SCENARIO, protected_years: 0 }),
  ];
  const metricKeys = [
    "mean",
    "median",
    "shortfall_probability",
    "shortfall_ci_low",
    "shortfall_ci_high",
    "q01",
    "q05",
    "q10",
    "q90",
    "cvar5",
  ];

  for (const response of responses) {
    const s1 = strategy(response, "s1");
    const s5 = strategy(response, "s5");
    for (const key of metricKeys) {
      assert.equal(s5[key], s1[key], `${response.metadata.model}.${key}`);
    }
  }
});

test("hosted simulation rejects a path count above 100,000", async (t) => {
  await t.test("Model A", () => {
    assert.throws(
      () => simulateModelA({ ...MODEL_A_SCENARIO, paths: 100_001 }),
      /paths must be between 1 and 100,000/,
    );
  });

  await t.test("Model B", () => {
    assert.throws(
      () => simulateModelB({ ...SHARED_SCENARIO, paths: 100_001 }),
      /paths must be between 1 and 100,000/,
    );
  });
});

test("bundled sequence payload covers 30 years and preserves benchmark endpoints", () => {
  const payload = buildBundledSequenceRiskPayload();

  assert.equal(payload.rows.length, 30);
  assert.deepEqual(payload.rows[0], {
    year: 1989,
    stock_return: 0.3148,
    bond_return: 0.1769,
    portfolio_return: 0.25964000000000004,
  });
  assert.deepEqual(payload.rows.at(-1), {
    year: 2018,
    stock_return: -0.0423,
    bond_return: -0.0002,
    portfolio_return: -0.025459999999999997,
  });
  assert.equal(payload.metadata.row_count, 30);
  assert.equal(payload.metadata.window_start_year, 1989);
  assert.equal(payload.metadata.window_end_year, 2018);
  assert.equal(payload.provenance.dataset_sha256, DATASET_SHA256);

  const comparison = compareSequences(payload.rows, 50_000, 10_000);
  assertClose(
    comparison.paths.historical.terminalWealth,
    1_724_679.4704,
    0.0001,
    "historical terminal wealth",
  );
  assertClose(
    comparison.paths.bad_first.terminalWealth,
    3_671_423.7187,
    0.0001,
    "bad-first terminal wealth",
  );
  assertClose(
    comparison.paths.bad_last.terminalWealth,
    1_328_097.8624,
    0.0001,
    "bad-last terminal wealth",
  );
});
