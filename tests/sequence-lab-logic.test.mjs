import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  compareSequences,
  normalizeSequenceDataset,
  orderReturnRows,
} from "../app/components/sequenceLabLogic.ts";

function sourceRows() {
  const csv = readFileSync(
    new URL("../data/damodaran_histretSPX_1928_2018.csv", import.meta.url),
    "utf8",
  );
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [year, stockReturn, , bondReturn] = line.split(",").map(Number);
      return {
        year,
        stock_return: stockReturn,
        bond_return: bondReturn,
        portfolio_return: 0.6 * stockReturn + 0.4 * bondReturn,
      };
    })
    .filter((row) => row.year >= 1989 && row.year <= 2018);
}

function assertClose(actual, expected, tolerance = 0.0001) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("validates, sorts, and normalizes the complete 1989–2018 dataset", () => {
  const reversed = Object.freeze(
    sourceRows().reverse().map((row) => Object.freeze(row)),
  );
  const payload = Object.freeze({
    metadata: Object.freeze({ model: "sequence_risk", row_count: 30 }),
    provenance: Object.freeze({
      dataset_sha256: "17b989873bbfc155",
      source_url: "https://example.test/pinned-source",
    }),
    rows: reversed,
  });

  const normalized = normalizeSequenceDataset(payload);

  assert.equal(normalized.rows.length, 30);
  assert.deepEqual(normalized.rows.map((row) => row.year), [...Array(30)].map((_, i) => 1989 + i));
  assert.deepEqual(normalized.metadata, { model: "sequence_risk", row_count: 30 });
  assert.deepEqual(normalized.provenance, {
    dataset_sha256: "17b989873bbfc155",
    source_url: "https://example.test/pinned-source",
  });
  assert.equal(reversed[0].year, 2018, "normalization must not reorder the source payload");
  normalized.rows.forEach((row) => {
    assertClose(row.portfolio_return, 0.6 * row.stock_return + 0.4 * row.bond_return, 1e-15);
  });
});

test("rejects incomplete, duplicate, and invalid annual-return datasets", async (t) => {
  const rows = sourceRows();

  await t.test("missing year", () => {
    assert.throws(
      () => normalizeSequenceDataset({ rows: rows.slice(1) }),
      /requires 30 annual observations/,
    );
  });

  await t.test("duplicate year", () => {
    const duplicate = rows.map((row) => (
      row.year === 2001 ? { ...row, year: 2000 } : row
    ));
    assert.throws(
      () => normalizeSequenceDataset({ rows: duplicate }),
      /one consecutive observation/,
    );
  });

  await t.test("non-finite return", () => {
    const invalid = rows.map((row, index) => (
      index === 4 ? { ...row, portfolio_return: Number.NaN } : row
    ));
    assert.throws(
      () => normalizeSequenceDataset({ rows: invalid }),
      /invalid portfolio_return/,
    );
  });

  await t.test("return at or below -100%", () => {
    const invalid = rows.map((row, index) => (
      index === 4 ? { ...row, portfolio_return: -1 } : row
    ));
    assert.throws(
      () => normalizeSequenceDataset({ rows: invalid }),
      /at or below -100%/,
    );
  });

  await t.test("portfolio return that is not the paired 60/40 return", () => {
    const mismatched = rows.map((row, index) => (
      index === 4 ? { ...row, portfolio_return: row.portfolio_return + 0.0001 } : row
    ));
    assert.throws(
      () => normalizeSequenceDataset({ rows: mismatched }),
      /required 60\/40 return/,
    );
  });
});

test("reproduces the default Sequence Lab terminal wealth values", () => {
  const comparison = compareSequences(sourceRows(), 50_000, 10_000);

  assertClose(comparison.paths.historical.terminalWealth, 1_724_679.4704);
  assertClose(comparison.paths.bad_first.terminalWealth, 3_671_423.7187);
  assertClose(comparison.paths.bad_last.terminalWealth, 1_328_097.8624);
});

test("identifies bad-first as the winning prediction for the default contribution case", () => {
  const comparison = compareSequences(sourceRows(), 50_000, 10_000);

  assert.equal(comparison.actualPrediction, "bad_first");
  assertClose(
    comparison.terminalGap,
    3_671_423.7187 - 1_328_097.8624,
  );
});

test("makes terminal wealth order-invariant when annual contributions are zero", () => {
  const comparison = compareSequences(sourceRows(), 50_000, 0);
  const terminals = [
    comparison.paths.historical.terminalWealth,
    comparison.paths.bad_first.terminalWealth,
    comparison.paths.bad_last.terminalWealth,
  ];

  terminals.forEach((terminal) => assertClose(terminal, 652_626.4483));
  assert.equal(terminals[0], terminals[1]);
  assert.equal(terminals[1], terminals[2]);
  assert.equal(comparison.actualPrediction, "same");
  assert.equal(comparison.terminalGap, 0);
});

test("ordering and comparison helpers do not mutate their source rows", () => {
  const rows = sourceRows();
  const snapshot = structuredClone(rows);

  const badFirst = orderReturnRows(rows, "bad_first");
  const badLast = orderReturnRows(rows, "bad_last");
  const comparison = compareSequences(rows, 50_000, 10_000);

  assert.deepEqual(rows, snapshot);
  assert.notStrictEqual(badFirst, rows);
  assert.notStrictEqual(badLast, rows);
  assert.notStrictEqual(comparison.paths.historical.orderedRows, rows);
  assert.equal(badFirst[0].year, 2008);
  assert.equal(badLast[0].year, 1995);
});
