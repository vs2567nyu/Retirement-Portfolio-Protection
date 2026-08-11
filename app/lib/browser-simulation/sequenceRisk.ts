import {
  DATASET_COLUMNS,
  DATASET_PATH,
  DATASET_SHA256,
  DATASET_SOURCE_URL,
  HISTORICAL_RETURNS,
} from "./historicalData.ts";
import type { SequenceRiskPayload } from "./types.ts";

export const WINDOW_START_YEAR = 1989;
export const WINDOW_END_YEAR = 2018;
export const STOCK_WEIGHT = 0.6;
export const BOND_WEIGHT = 0.4;

const payload: SequenceRiskPayload = {
  metadata: {
    model: "sequence_risk",
    source_model: "model_b",
    row_count: WINDOW_END_YEAR - WINDOW_START_YEAR + 1,
    window_start_year: WINDOW_START_YEAR,
    window_end_year: WINDOW_END_YEAR,
    stock_weight: STOCK_WEIGHT,
    bond_weight: BOND_WEIGHT,
    rebalancing: "annual",
    contribution_timing: "end_of_year",
  },
  provenance: {
    dataset_path: DATASET_PATH,
    dataset_sha256: DATASET_SHA256,
    dataset_rows: HISTORICAL_RETURNS.length,
    dataset_start_year: HISTORICAL_RETURNS[0].year,
    dataset_end_year: HISTORICAL_RETURNS.at(-1)?.year,
    source_url: DATASET_SOURCE_URL,
    columns: [...DATASET_COLUMNS],
  },
  rows: HISTORICAL_RETURNS
    .filter((row) => row.year >= WINDOW_START_YEAR && row.year <= WINDOW_END_YEAR)
    .map((row) => ({
      year: row.year,
      stock_return: row.stock_return,
      bond_return: row.bond_return,
      portfolio_return: STOCK_WEIGHT * row.stock_return + BOND_WEIGHT * row.bond_return,
    })),
};

if (payload.rows.length !== 30 || payload.rows.some((row, index) => row.year !== WINDOW_START_YEAR + index)) {
  throw new Error(`sequence-risk source must contain every year ${WINDOW_START_YEAR}--${WINDOW_END_YEAR}`);
}

export function buildBundledSequenceRiskPayload(): SequenceRiskPayload {
  return structuredClone(payload);
}

export function loadBundledSequenceRisk(signal?: AbortSignal): Promise<SequenceRiskPayload> {
  return new Promise((resolve, reject) => {
    queueMicrotask(() => {
      if (signal?.aborted) {
        reject(new DOMException("Request was cancelled", "AbortError"));
        return;
      }
      resolve(buildBundledSequenceRiskPayload());
    });
  });
}
