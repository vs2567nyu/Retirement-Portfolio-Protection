export type SequenceKey = "historical" | "bad_first" | "bad_last";
export type PredictionKey = "bad_first" | "bad_last" | "same";

export type AnnualReturnRow = {
  year: number;
  stock_return: number;
  bond_return: number;
  portfolio_return: number;
};

export type SequenceDataset = {
  metadata: Record<string, unknown>;
  provenance: Record<string, unknown>;
  rows: AnnualReturnRow[];
};

export type WealthPoint = {
  period: number;
  sourceYear: number | null;
  wealth: number;
};

export type SequencePath = {
  key: SequenceKey;
  label: string;
  orderedRows: AnnualReturnRow[];
  points: WealthPoint[];
  terminalWealth: number;
};

export type SequenceComparison = {
  paths: Record<SequenceKey, SequencePath>;
  chartData: Array<{
    period: number;
    historical: number;
    bad_first: number;
    bad_last: number;
  }>;
  actualPrediction: PredictionKey;
  terminalGap: number;
};

const LABELS: Record<SequenceKey, string> = {
  historical: "Historical order",
  bad_first: "Worst → best (sorted)",
  bad_last: "Best → worst (sorted)",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, field: string, index: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Sequence row ${index + 1} has an invalid ${field}.`);
  }
  return value;
}

export function normalizeSequenceDataset(payload: unknown): SequenceDataset {
  if (!isRecord(payload)) throw new Error("Sequence-risk response must be an object.");

  const rawRows = Array.isArray(payload.rows)
    ? payload.rows
    : Array.isArray(payload.annual_returns)
      ? payload.annual_returns
      : Array.isArray(payload.data)
        ? payload.data
        : null;
  if (!rawRows) throw new Error("Sequence-risk response is missing annual return rows.");

  const rows = rawRows.map((rawRow, index) => {
    if (!isRecord(rawRow)) throw new Error(`Sequence row ${index + 1} must be an object.`);
    const year = finiteNumber(rawRow.year, "year", index);
    if (!Number.isInteger(year)) throw new Error(`Sequence row ${index + 1} has an invalid year.`);
    const row = {
      year,
      stock_return: finiteNumber(rawRow.stock_return, "stock_return", index),
      bond_return: finiteNumber(rawRow.bond_return, "bond_return", index),
      portfolio_return: finiteNumber(rawRow.portfolio_return, "portfolio_return", index),
    };
    if (row.portfolio_return <= -1) {
      throw new Error(`Sequence row ${index + 1} has a portfolio return at or below -100%.`);
    }
    const expectedPortfolioReturn = 0.60 * row.stock_return + 0.40 * row.bond_return;
    if (Math.abs(row.portfolio_return - expectedPortfolioReturn) > 1e-12) {
      throw new Error(`Sequence row ${index + 1} does not match the required 60/40 return.`);
    }
    return row;
  }).sort((left, right) => left.year - right.year);

  if (rows.length !== 30 || rows[0]?.year !== 1989 || rows.at(-1)?.year !== 2018) {
    throw new Error("Sequence Lab requires 30 annual observations from 1989 through 2018.");
  }
  const years = new Set(rows.map((row) => row.year));
  if (years.size !== rows.length || rows.some((row, index) => row.year !== 1989 + index)) {
    throw new Error("Sequence Lab requires one consecutive observation for every year from 1989 through 2018.");
  }

  return {
    metadata: isRecord(payload.metadata) ? payload.metadata : {},
    provenance: isRecord(payload.provenance) ? payload.provenance : {},
    rows,
  };
}

export function orderReturnRows(rows: AnnualReturnRow[], key: SequenceKey) {
  if (key === "historical") return [...rows].sort((left, right) => left.year - right.year);
  const direction = key === "bad_first" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const returnDifference = direction * (left.portfolio_return - right.portfolio_return);
    return returnDifference || left.year - right.year;
  });
}

export function calculateWealthPath(
  orderedRows: AnnualReturnRow[],
  initialWealth: number,
  annualContribution: number,
) {
  let wealth = initialWealth;
  const points: WealthPoint[] = [{ period: 0, sourceYear: null, wealth }];
  orderedRows.forEach((row, index) => {
    wealth = wealth * (1 + row.portfolio_return) + annualContribution;
    points.push({ period: index + 1, sourceYear: row.year, wealth });
  });
  return points;
}

export function compareSequences(
  rows: AnnualReturnRow[],
  initialWealth: number,
  annualContribution: number,
): SequenceComparison {
  if (!Number.isFinite(initialWealth) || initialWealth < 0) {
    throw new Error("Initial wealth must be a non-negative number.");
  }
  if (!Number.isFinite(annualContribution) || annualContribution < 0) {
    throw new Error("Annual contribution must be a non-negative number.");
  }

  const keys: SequenceKey[] = ["historical", "bad_first", "bad_last"];
  const paths = Object.fromEntries(keys.map((key) => {
    const orderedRows = orderReturnRows(rows, key);
    const points = calculateWealthPath(orderedRows, initialWealth, annualContribution);
    return [key, {
      key,
      label: LABELS[key],
      orderedRows,
      points,
      terminalWealth: points.at(-1)?.wealth ?? initialWealth,
    }];
  })) as Record<SequenceKey, SequencePath>;

  if (annualContribution === 0) {
    const canonicalTerminal = initialWealth * rows.reduce(
      (grossReturn, row) => grossReturn * (1 + row.portfolio_return),
      1,
    );
    keys.forEach((key) => {
      const finalPoint = paths[key].points.at(-1);
      if (finalPoint) finalPoint.wealth = canonicalTerminal;
      paths[key].terminalWealth = canonicalTerminal;
    });
  }

  const firstTerminal = paths.bad_first.terminalWealth;
  const lastTerminal = paths.bad_last.terminalWealth;
  const tolerance = Math.max(0.005, Math.max(firstTerminal, lastTerminal) * 1e-12);
  const actualPrediction: PredictionKey = Math.abs(firstTerminal - lastTerminal) <= tolerance
    ? "same"
    : firstTerminal > lastTerminal
      ? "bad_first"
      : "bad_last";

  return {
    paths,
    chartData: paths.historical.points.map((point, index) => ({
      period: point.period,
      historical: point.wealth,
      bad_first: paths.bad_first.points[index].wealth,
      bad_last: paths.bad_last.points[index].wealth,
    })),
    actualPrediction,
    terminalGap: Math.abs(firstTerminal - lastTerminal),
  };
}
