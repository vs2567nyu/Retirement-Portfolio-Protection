"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleAlert,
  Equal,
  Play,
  RefreshCw,
  RotateCcw,
  Shuffle,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  compareSequences,
  normalizeSequenceDataset,
  type PredictionKey,
  type SequenceComparison,
  type SequenceDataset,
  type SequencePath,
} from "./sequenceLabLogic";

type Draft = {
  initialWealth: number;
  annualContribution: number;
  includeContributions: boolean;
  prediction: PredictionKey | null;
};

type SequenceRun = Draft & {
  prediction: PredictionKey;
};

const DEFAULT_DRAFT: Draft = {
  initialWealth: 50_000,
  annualContribution: 10_000,
  includeContributions: true,
  prediction: null,
};

const PREDICTIONS: Array<{
  key: PredictionKey;
  label: string;
  icon: typeof ArrowUpFromLine;
}> = [
  { key: "bad_first", label: "Worst → best (sorted)", icon: ArrowDownToLine },
  { key: "bad_last", label: "Best → worst (sorted)", icon: ArrowUpFromLine },
  { key: "same", label: "Same ending", icon: Equal },
];

const COLORS = {
  historical: "#2457d6",
  bad_first: "#0f7b5f",
  bad_last: "#b64b43",
};

const wholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 3,
});

function money(value: number) {
  return wholeMoney.format(value);
}

function compact(value: number) {
  return compactMoney.format(value);
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function sameDraft(left: Draft, right: SequenceRun | null) {
  return Boolean(
    right
    && left.initialWealth === right.initialWealth
    && left.annualContribution === right.annualContribution
    && left.includeContributions === right.includeContributions
    && left.prediction === right.prediction,
  );
}

function predictionLabel(key: PredictionKey) {
  return PREDICTIONS.find((prediction) => prediction.key === key)?.label ?? "Selected outcome";
}

function SequenceNumberField({
  id,
  label,
  value,
  step,
  disabled,
  help,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  step: number;
  disabled?: boolean;
  help?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="sequence-field" htmlFor={id}>
      <span>{label}</span>
      <span className="sequence-field__control">
        <span aria-hidden="true">$</span>
        <input
          id={id}
          type="number"
          min={0}
          max={100_000_000}
          step={step}
          value={Number.isFinite(value) ? value : ""}
          disabled={disabled}
          aria-describedby={help ? `${id}-help` : undefined}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </span>
      {help ? <small id={`${id}-help`}>{help}</small> : null}
    </label>
  );
}

function SequenceMetric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "blue" | "green" | "red";
}) {
  return (
    <article className={`sequence-metric sequence-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

type TooltipEntry = {
  name?: string;
  value?: number;
  color?: string;
};

function SequenceTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="sequence-tooltip">
      <strong>{label === 0 ? "Starting wealth" : `After year ${label}`}</strong>
      {payload.map((entry) => (
        <span key={entry.name}>
          <i style={{ background: entry.color }} />
          {entry.name}
          <b>{money(entry.value ?? 0)}</b>
        </span>
      ))}
    </div>
  );
}

function returnColor(value: number) {
  const intensity = 0.25 + Math.min(Math.abs(value) / 0.28, 1) * 0.65;
  return value >= 0
    ? `rgba(15, 123, 95, ${intensity})`
    : `rgba(182, 75, 67, ${intensity})`;
}

function ReturnStrip({ path }: { path: SequencePath }) {
  const first = path.orderedRows[0];
  const last = path.orderedRows.at(-1);
  return (
    <div className="sequence-strip-row">
      <div className="sequence-strip-row__label">
        <strong>{path.label}</strong>
        <span>{compact(path.terminalWealth)}</span>
      </div>
      <div className="sequence-strip-scroll">
        <div
          className="sequence-strip"
          role="img"
          aria-label={`${path.label}: 30 annual portfolio returns, beginning with ${first?.year} at ${pct(first?.portfolio_return ?? 0)} and ending with ${last?.year} at ${pct(last?.portfolio_return ?? 0)}.`}
        >
          {path.orderedRows.map((row, index) => (
            <span
              key={`${path.key}-${row.year}`}
              aria-hidden="true"
              className={row.portfolio_return >= 0 ? "is-positive" : "is-negative"}
              style={{ backgroundColor: returnColor(row.portfolio_return) }}
              title={`Position ${index + 1}: ${row.year}, ${pct(row.portfolio_return)}`}
            />
          ))}
        </div>
        <div className="sequence-strip-ends" aria-hidden="true">
          <span>First</span><span>Last</span>
        </div>
      </div>
    </div>
  );
}

function SequenceDataTable({ comparison }: { comparison: SequenceComparison }) {
  const paths = [
    comparison.paths.historical,
    comparison.paths.bad_first,
    comparison.paths.bad_last,
  ];

  return (
    <details className="sequence-data-table">
      <summary>View exact annual returns and wealth paths</summary>
      <div>
        <table>
          <caption>
            The source year, 60/40 return, and year-end wealth at each position in all three orderings.
          </caption>
          <thead>
            <tr>
              <th rowSpan={2} scope="col">Position</th>
              {paths.map((path) => <th key={path.key} colSpan={3} scope="colgroup">{path.label}</th>)}
            </tr>
            <tr>
              {paths.flatMap((path) => [
                <th key={`${path.key}-year`} scope="col">Source year</th>,
                <th key={`${path.key}-return`} scope="col">Return</th>,
                <th key={`${path.key}-wealth`} scope="col">Year-end wealth</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 30 }, (_, index) => (
              <tr key={index + 1}>
                <th scope="row">{index + 1}</th>
                {paths.flatMap((path) => {
                  const row = path.orderedRows[index];
                  return [
                    <td key={`${path.key}-${index}-year`}>{row.year}</td>,
                    <td key={`${path.key}-${index}-return`}>{pct(row.portfolio_return)}</td>,
                    <td key={`${path.key}-${index}-wealth`}>{money(path.points[index + 1].wealth)}</td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function SequenceResults({
  comparison,
  run,
  headingRef,
  onRemoveContributions,
}: {
  comparison: SequenceComparison;
  run: SequenceRun;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onRemoveContributions: () => void;
}) {
  const matched = comparison.actualPrediction === run.prediction;
  const noContributions = !run.includeContributions || run.annualContribution === 0;
  const historical = comparison.paths.historical;
  const badFirst = comparison.paths.bad_first;
  const badLast = comparison.paths.bad_last;
  const scenarioLabel = run.initialWealth === DEFAULT_DRAFT.initialWealth
    && run.annualContribution === DEFAULT_DRAFT.annualContribution
    ? run.includeContributions ? "Report example" : "Report example · contributions removed"
    : "Custom scenario";

  return (
    <div className="sequence-reveal">
      <div className="sequence-results-heading">
        <div>
          <p className="section-kicker">Sequence comparison</p>
          <h2 ref={headingRef} tabIndex={-1}>One return set, three wealth paths</h2>
          <p>
            {money(run.initialWealth)} initial wealth · {noContributions ? "no contributions" : `${money(run.annualContribution)} contributed at each year-end`}
          </p>
        </div>
        <div className="sequence-result-tags">
          <span className="sequence-scenario-label">{scenarioLabel}</span>
          <span className={matched ? "sequence-prediction is-match" : "sequence-prediction"}>
            {predictionLabel(run.prediction)} · {matched ? "matched" : "did not match"}
          </span>
        </div>
      </div>

      <div className={`sequence-verdict ${noContributions ? "sequence-verdict--equal" : ""}`}>
        <span aria-hidden="true">{noContributions ? <Equal size={22} /> : <Shuffle size={22} />}</span>
        <div>
          <strong>{noContributions ? "No modeled cash flows, same endpoint" : "Cash flows make return order matter"}</strong>
          <p>
            {noContributions
              ? `All three orders finish at ${compact(badFirst.terminalWealth)}. Order changes the journey, not terminal wealth.`
              : `With ${money(run.annualContribution)} added after every year, worst → best ends at ${compact(badFirst.terminalWealth)}; best → worst ends at ${compact(badLast.terminalWealth)}.`}
          </p>
        </div>
        {!noContributions ? (
          <button type="button" onClick={onRemoveContributions}>Remove contributions</button>
        ) : null}
      </div>

      <p className="sequence-result-caveat">
        These deliberately sorted counterfactuals isolate ordering. They are not forecasts, probability estimates, or Model B bootstrap paths. This is an accumulation example; withdrawals can also create sequence risk.
      </p>

      <div className="sequence-metrics">
        <SequenceMetric label="Historical order" value={compact(historical.terminalWealth)} detail="1989 → 2018" tone="blue" />
        <SequenceMetric label="Worst → best" value={compact(badFirst.terminalWealth)} detail="Sorted lowest to highest" tone="green" />
        <SequenceMetric label="Best → worst" value={compact(badLast.terminalWealth)} detail="Sorted highest to lowest" tone="red" />
        <SequenceMetric
          label="Order gap"
          value={noContributions ? "$0" : compact(comparison.terminalGap)}
          detail="Difference between sorted extremes"
          tone={noContributions ? "neutral" : "red"}
        />
      </div>

      <article className="sequence-panel sequence-chart-panel">
        <div className="sequence-panel__heading">
          <div><p className="section-kicker">Wealth through time</p><h3>The returns are identical; their positions change.</h3></div>
          <span>30 annual periods</span>
        </div>
        <div
          className="sequence-chart"
          role="img"
          aria-label={`Line chart comparing wealth under three orderings. Historical order ends at ${money(historical.terminalWealth)}; worst to best ends at ${money(badFirst.terminalWealth)}; best to worst ends at ${money(badLast.terminalWealth)}.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={comparison.chartData} margin={{ top: 14, right: 18, bottom: 22, left: 4 }}>
              <CartesianGrid stroke="#d9e0ea" strokeDasharray="3 5" vertical={false} />
              <XAxis
                dataKey="period"
                tick={{ fill: "#69758a", fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                ticks={[0, 5, 10, 15, 20, 25, 30]}
                tickFormatter={(value) => value === 0 ? "Start" : `Yr ${value}`}
                label={{ value: "Portfolio year (reordered)", position: "insideBottom", offset: -10, fill: "#69758a", fontSize: 12 }}
              />
              <YAxis
                tick={{ fill: "#69758a", fontSize: 12 }}
                tickFormatter={compact}
                tickLine={false}
                axisLine={false}
                width={68}
                domain={[0, "auto"]}
              />
              <Tooltip content={<SequenceTooltip />} />
              <Legend wrapperStyle={{ color: "#556176", fontSize: 12, paddingTop: 6 }} />
              <Line type="linear" dataKey="historical" name="Historical order" stroke={COLORS.historical} strokeWidth={3} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line type="linear" dataKey="bad_first" name="Worst → best" stroke={COLORS.bad_first} strokeDasharray="10 4" strokeWidth={3} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line type="linear" dataKey="bad_last" name="Best → worst" stroke={COLORS.bad_last} strokeDasharray="2 4" strokeWidth={3} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className="sequence-panel sequence-order-panel">
        <div className="sequence-panel__heading">
          <div><p className="section-kicker">Return order</p><h3>The same 30 annual observations, rearranged</h3></div>
          <div className="sequence-return-legend"><span><i className="is-positive" /> Positive · solid</span><span><i className="is-negative" /> Negative · striped</span></div>
        </div>
        <div className="sequence-strip-list">
          <ReturnStrip path={historical} />
          <ReturnStrip path={badFirst} />
          <ReturnStrip path={badLast} />
        </div>
        <SequenceDataTable comparison={comparison} />
      </article>
    </div>
  );
}

export function SequenceLab() {
  const [dataset, setDataset] = useState<SequenceDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [run, setRun] = useState<SequenceRun | null>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const apiBase = process.env.NEXT_PUBLIC_MODEL_API_URL ?? "http://127.0.0.1:8000";
        const response = await fetch(`${apiBase}/api/sequence-risk`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Historical sequence data failed to load (${response.status}).`);
        const payload = await response.json() as unknown;
        setDataset(normalizeSequenceDataset(payload));
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setDataset(null);
        setError(reason instanceof Error ? reason.message : "Historical sequence data could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [reloadKey]);

  const validationMessage = useMemo(() => {
    if (!Number.isFinite(draft.initialWealth) || draft.initialWealth < 0) return "Initial wealth cannot be negative.";
    if (!Number.isFinite(draft.annualContribution) || draft.annualContribution < 0) return "Annual contribution cannot be negative.";
    return null;
  }, [draft]);

  const comparison = useMemo(() => {
    if (!dataset || !run) return null;
    return compareSequences(
      dataset.rows,
      run.initialWealth,
      run.includeContributions ? run.annualContribution : 0,
    );
  }, [dataset, run]);

  const updateDraft = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const reveal = (event: FormEvent) => {
    event.preventDefault();
    if (!dataset || validationMessage || !draft.prediction) return;
    setRun({ ...draft, prediction: draft.prediction });
    window.setTimeout(() => resultsHeading.current?.focus(), 0);
  };

  const reset = () => {
    setDraft(DEFAULT_DRAFT);
    setRun(null);
  };

  const removeContributions = () => {
    if (!draft.prediction) return;
    const nextDraft = { ...draft, includeContributions: false };
    setDraft(nextDraft);
    setRun({ ...nextDraft, prediction: draft.prediction });
    window.setTimeout(() => resultsHeading.current?.focus(), 0);
  };

  const newPrediction = () => {
    setDraft((current) => ({ ...current, prediction: null }));
    setRun(null);
  };

  const datasetSha = typeof dataset?.provenance.dataset_sha256 === "string"
    ? `${dataset.provenance.dataset_sha256.slice(0, 8)}…`
    : "unavailable";
  const dirty = run ? !sameDraft(draft, run) : false;

  return (
    <section id="sequence-lab-panel" className="sequence-lab" role="tabpanel" aria-labelledby="sequence-lab-tab">
      <div className="sequence-hero">
        <div>
          <p className="section-kicker">Sequence risk</p>
          <h1>Same 30 returns. Different order. Different ending with contributions.</h1>
          <p>Reorder the report’s 1989–2018 60/40 returns without changing a single annual observation.</p>
        </div>
        <div className="sequence-hero__facts" aria-label="Sequence Lab dataset facts">
          <span><strong>30</strong> annual returns</span>
          <span><strong>60/40</strong> stock / bond mix</span>
        </div>
      </div>

      <div className="sequence-layout">
        <form className="sequence-controls" onSubmit={reveal} noValidate>
          <div className="sequence-controls__heading">
            <div><p className="section-kicker">Scenario</p><h2>Set the cash flows</h2></div>
            <button type="button" className="sequence-icon-button" onClick={reset} aria-label="Reset Sequence Lab" title="Reset Sequence Lab"><RotateCcw size={16} /></button>
          </div>

          <div className="sequence-field-grid">
            <SequenceNumberField
              id="sequence-initial-wealth"
              label="Initial wealth"
              value={draft.initialWealth}
              step={5_000}
              onChange={(initialWealth) => updateDraft({ initialWealth })}
            />
            <SequenceNumberField
              id="sequence-contribution"
              label="Annual contribution"
              value={draft.annualContribution}
              step={1_000}
              disabled={!draft.includeContributions}
              help="Applied after each year’s return"
              onChange={(annualContribution) => updateDraft({ annualContribution })}
            />
          </div>

          <label className="sequence-toggle" htmlFor="sequence-contributions-toggle" aria-label="Include annual contributions">
            <input
              id="sequence-contributions-toggle"
              type="checkbox"
              checked={draft.includeContributions}
              onChange={(event) => updateDraft({ includeContributions: event.target.checked })}
            />
            <span className="sequence-toggle__track" aria-hidden="true"><span /></span>
            <span><strong>{draft.includeContributions ? "Contributions on" : "Contributions off"}</strong><small>{draft.includeContributions ? "Cash enters at every year-end" : "Only the original balance compounds"}</small></span>
          </label>

          <fieldset className="sequence-predictions">
            <legend><span className="section-kicker">Prediction</span><strong>Which sorted order finishes highest?</strong></legend>
            <div>
              {PREDICTIONS.map((prediction) => {
                const Icon = prediction.icon;
                return (
                  <label className={draft.prediction === prediction.key ? "is-selected" : ""} key={prediction.key}>
                    <input
                      type="radio"
                      name="sequence-prediction"
                      value={prediction.key}
                      checked={draft.prediction === prediction.key}
                      disabled={Boolean(run)}
                      onChange={() => updateDraft({ prediction: prediction.key })}
                    />
                    <Icon size={18} />
                    <span>{prediction.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {run ? (
            <button className="sequence-new-prediction" type="button" onClick={newPrediction}>
              New prediction
            </button>
          ) : null}

          {validationMessage ? <p className="sequence-message sequence-message--error" role="alert">{validationMessage}</p> : null}
          {!draft.prediction ? <p className="sequence-message">Select a prediction to enable the comparison.</p> : null}

          <div className="sequence-actions">
            <button className="sequence-run-button" type="submit" disabled={loading || Boolean(error) || Boolean(validationMessage) || !draft.prediction}>
              {loading ? <RefreshCw className="spin" size={18} /> : <Play size={18} fill="currentColor" />}
              {loading ? "Loading returns…" : run ? dirty ? "Update comparison" : "Show comparison" : "Reveal sequence effect"}
            </button>
            <span className={dataset ? "sequence-data-status is-ready" : "sequence-data-status"}>
              <i /> {dataset ? `${dataset.rows.length} years loaded` : loading ? "Loading dataset" : "Dataset unavailable"}
            </span>
          </div>

          <div className="sequence-source-note">
            <strong>Pinned Damodaran paired-return dataset · 1989–2018 subset · SHA {datasetSha}</strong>
            <span>S&amp;P 500 total return + 10-year U.S. Treasury total return · annually rebalanced 60/40</span>
            <span>Observed annual sample used as a counterfactual demonstration, not a forecast of recurrence</span>
            <span>Nominal wealth · year-end contributions · no intrayear returns, taxes, fees, inflation, withdrawals, or mortality</span>
          </div>
        </form>

        <div className="sequence-results" aria-live="polite" aria-busy={loading}>
          {loading ? (
            <div className="sequence-loading" role="status">
              <RefreshCw className="spin" size={24} />
              <strong>Loading the 1989–2018 return sequence</strong>
              <span>Preparing the report-faithful 60/40 series.</span>
            </div>
          ) : error ? (
            <div className="sequence-error" role="alert">
              <CircleAlert size={26} />
              <strong>Sequence data is unavailable.</strong>
              <p>{error}</p>
              <button type="button" onClick={() => setReloadKey((current) => current + 1)}><RefreshCw size={15} /> Try again</button>
            </div>
          ) : comparison && run ? (
            <div className={dirty ? "sequence-results-state is-stale" : "sequence-results-state"}>
              {dirty ? <p className="sequence-stale-note" role="status">Inputs changed. Update the comparison to refresh these results.</p> : null}
              <SequenceResults comparison={comparison} run={run} headingRef={resultsHeading} onRemoveContributions={removeContributions} />
            </div>
          ) : (
            <div className="sequence-empty">
              <Shuffle size={32} />
              <p className="section-kicker">Ready to compare</p>
              <h2>Order changes the path. Cash flows decide whether it changes the endpoint.</h2>
              <p>Set the scenario and select an expected outcome to reveal all three wealth paths.</p>
            </div>
          )}
        </div>
      </div>

      <footer className="sequence-footer">
        <span>Illustrative sequence-risk demonstration, not a forecast or individualized recommendation.</span>
        <span>Same 30 annual 60/40 returns in every path · sorted counterfactual extremes, not forecasts or probabilities.</span>
        <span>Inputs stay in this browser session and are not saved by this app.</span>
      </footer>
    </section>
  );
}
