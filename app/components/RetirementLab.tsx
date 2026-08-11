"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  Clock3,
  Info,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScenarioStudio } from "./ScenarioStudio";
import { SequenceLab } from "./SequenceLab";
import {
  REPORT_CVAR_PROTECTION_YEARS,
  reportCvarProtectionYears,
} from "./strategyLabLogic";

type ModelKey = "model_a" | "model_b";

type Scenario = {
  model: ModelKey;
  current_age: number;
  retirement_age: number;
  starting_wealth: number;
  annual_contribution: number;
  target_wealth: number;
  paths: number;
  seed: number;
  protection_years: number;
};

type StrategyResult = {
  key: string;
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

type AllocationPoint = {
  year: number;
  age: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  s5: number;
};

type FanPoint = {
  year: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
};

type SimulationResponse = {
  metadata: {
    model: ModelKey | string;
    seed: number;
    paths: number;
    horizon: number;
    runtime_ms: number;
    put_premium: number;
    restart_probability?: number;
    mean_block_length?: number;
    dataset_rows?: number;
    dataset_start_year?: number;
    dataset_end_year?: number;
    dataset_sha256?: string;
  };
  strategies: StrategyResult[];
  allocation_paths: AllocationPoint[];
  fan_chart: FanPoint[];
};

const DEFAULT_SCENARIO: Scenario = {
  model: "model_a",
  current_age: 35,
  retirement_age: 65,
  starting_wealth: 50_000,
  annual_contribution: 10_000,
  target_wealth: 1_000_000,
  paths: 10_000,
  seed: 41_065,
  protection_years: 30,
};

const STRATEGY_COLORS: Record<string, string> = {
  s1: "#35c89f",
  s2: "#7a9dff",
  s3: "#a692ff",
  s4: "#f0b35a",
  s5: "#ff7b70",
};

const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const wholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function pct(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function money(value: number) {
  return wholeMoney.format(value);
}

function chartMoney(value: number) {
  return compactMoney.format(value);
}

function isModelB(model: string | undefined): boolean {
  return model === "model_b";
}

function modelDisplayName(model: string | undefined): string {
  return isModelB(model) ? "Model B · Historical blocks" : "Model A · Parametric";
}

function shortHash(value: string | undefined): string {
  if (!value) return "Fingerprint unavailable";
  return `SHA-256 ${value.slice(0, 10)}…${value.slice(-6)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sameScenario(left: Scenario, right: Scenario) {
  return (Object.keys(left) as Array<keyof Scenario>).every(
    (key) => left[key] === right[key],
  );
}

function formatInput(value: number) {
  return Number.isFinite(value) ? String(value) : "";
}

function MetricCard({
  eyebrow,
  value,
  detail,
  tone = "neutral",
}: {
  eyebrow: string;
  value: string;
  detail: string;
  tone?: "neutral" | "positive" | "warning";
}) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <p className="metric-card__eyebrow">{eyebrow}</p>
      <p className="metric-card__value">{value}</p>
      <p className="metric-card__detail">{detail}</p>
    </article>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  prefix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__control">
        {prefix ? <span className="field__prefix">{prefix}</span> : null}
        <input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={formatInput(value)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </span>
    </label>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  valueKind = "money",
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string; payload?: StrategyResult }>;
  label?: string | number;
  valueKind?: "money" | "percent" | "allocation";
}) {
  if (!active || !payload?.length) return null;
  const format = (value: number) => {
    if (valueKind === "percent" || valueKind === "allocation") return pct(value);
    return money(value);
  };

  return (
    <div className="chart-tooltip">
      {label !== undefined ? <p className="chart-tooltip__label">{label}</p> : null}
      {payload.map((entry) => (
        <div className="chart-tooltip__row" key={`${entry.name}-${entry.value}`}>
          <span className="chart-tooltip__dot" style={{ background: entry.color }} />
          <span>{entry.name}</span>
          <strong>{format(entry.value)}</strong>
        </div>
      ))}
    </div>
  );
}

export function RetirementLab() {
  const [activeSection, setActiveSection] = useState<"strategy" | "studio" | "sequence">("strategy");
  const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO);
  const [lastRun, setLastRun] = useState<Scenario>(DEFAULT_SCENARIO);
  const [result, setResult] = useState<SimulationResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState("s1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [useReportTiming, setUseReportTiming] = useState(false);
  const initialized = useRef(false);
  const latestScenario = useRef<Scenario>(DEFAULT_SCENARIO);

  const horizon = Math.max(1, scenario.retirement_age - scenario.current_age);
  const reportTimingYears = reportCvarProtectionYears(scenario.model, horizon);
  const reportTimingTarget = REPORT_CVAR_PROTECTION_YEARS[scenario.model];
  const reportTimingStartAge = scenario.retirement_age - reportTimingYears;
  const reportTimingIsCapped = reportTimingYears < reportTimingTarget;
  const completedModel = isModelB(result?.metadata.model) ? "model_b" : "model_a";
  const completedIsModelB = completedModel === "model_b";

  const updateScenario = useCallback((patch: Partial<Scenario>) => {
    setScenario((current) => {
      const next = { ...current, ...patch };
      const nextHorizon = Math.max(1, next.retirement_age - next.current_age);
      next.protection_years = useReportTiming
        ? reportCvarProtectionYears(next.model, nextHorizon)
        : clamp(next.protection_years, 0, nextHorizon);
      latestScenario.current = next;
      return next;
    });
    setDirty(true);
  }, [useReportTiming]);

  const runSimulation = useCallback(async (request: Scenario) => {
    setLoading(true);
    setError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_MODEL_API_URL ?? "http://127.0.0.1:8000";
      const response = await fetch(`${apiBase}/api/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Simulation failed (${response.status})`);
      }
      const next = (await response.json()) as SimulationResponse;
      setResult(next);
      setLastRun(request);
      setDirty(!sameScenario(latestScenario.current, request));
      if (!next.strategies.some((strategy) => strategy.key === selectedKey)) {
        setSelectedKey(next.strategies[0]?.key ?? "s1");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The model engine did not respond.");
    } finally {
      setLoading(false);
    }
  }, [selectedKey]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void runSimulation(DEFAULT_SCENARIO);
  }, [runSimulation]);

  const selected = useMemo(
    () => result?.strategies.find((strategy) => strategy.key === selectedKey) ?? result?.strategies[0],
    [result, selectedKey],
  );

  const lowestShortfall = useMemo(() => {
    if (!result?.strategies.length) return undefined;
    return [...result.strategies].sort(
      (a, b) => a.shortfall_probability - b.shortfall_probability,
    )[0];
  }, [result]);

  const highestMean = useMemo(() => {
    if (!result?.strategies.length) return undefined;
    return [...result.strategies].sort((a, b) => b.mean - a.mean)[0];
  }, [result]);

  const frontierData = useMemo(
    () =>
      result?.strategies.map((strategy) => ({
        ...strategy,
        fill: STRATEGY_COLORS[strategy.key] ?? "#7a9dff",
      })) ?? [],
    [result],
  );

  const shortfallData = useMemo(
    () =>
      result?.strategies.map((strategy) => ({
        ...strategy,
        shortfall: strategy.shortfall_probability,
      })) ?? [],
    [result],
  );

  const applyPreset = (age: 35 | 50 | 60) => {
    const wealth = age === 35 ? 50_000 : age === 50 ? 300_000 : 700_000;
    const protection = 65 - age;
    updateScenario({
      current_age: age,
      retirement_age: 65,
      starting_wealth: wealth,
      protection_years: protection,
    });
  };

  const resample = () => {
    const seed = Math.floor(10_000 + Math.random() * 900_000);
    const request = { ...scenario, seed };
    latestScenario.current = request;
    setScenario(request);
    void runSimulation(request);
  };

  const toggleReportTiming = (enabled: boolean) => {
    setUseReportTiming(enabled);
    if (enabled) {
      updateScenario({ protection_years: reportTimingYears });
    }
  };

  return (
    <main className="lab-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <ShieldCheck size={19} strokeWidth={2.2} />
          </span>
          <div>
            <p className="brand-name">Retirement Protection Lab</p>
            <p className="brand-subtitle">Live stochastic strategy model</p>
          </div>
        </div>
        <div className="primary-nav" aria-label="Retirement lab sections" role="tablist">
          <button
            id="strategy-lab-tab"
            type="button"
            role="tab"
            aria-selected={activeSection === "strategy"}
            aria-controls="strategy-lab-panel"
            className={activeSection === "strategy" ? "primary-nav__tab is-active" : "primary-nav__tab"}
            onClick={() => setActiveSection("strategy")}
          >
            Strategy Lab
          </button>
          <button
            id="scenario-studio-tab"
            type="button"
            role="tab"
            aria-selected={activeSection === "studio"}
            aria-controls="scenario-studio-panel"
            className={activeSection === "studio" ? "primary-nav__tab is-active" : "primary-nav__tab"}
            onClick={() => setActiveSection("studio")}
          >
            Scenario Studio
          </button>
          <button
            id="sequence-lab-tab"
            type="button"
            role="tab"
            aria-selected={activeSection === "sequence"}
            aria-controls="sequence-lab-panel"
            className={activeSection === "sequence" ? "primary-nav__tab is-active" : "primary-nav__tab"}
            onClick={() => setActiveSection("sequence")}
          >
            Sequence Lab
          </button>
        </div>
        <div className="topbar__status">
          {activeSection === "strategy" ? (
            <>
              <span className={`model-pill ${completedIsModelB ? "model-pill--historical" : ""}`}>
                <span /> {modelDisplayName(result?.metadata.model)}
              </span>
              <span className={`run-stamp ${dirty ? "run-stamp--stale" : ""}`}>
                {result
                  ? dirty
                    ? `Changes not run · showing ${integer.format(result.metadata.paths)} paths`
                    : `${integer.format(result.metadata.paths)} paths · seed ${result.metadata.seed}`
                  : "Engine connecting"}
              </span>
            </>
          ) : (
            <span className="privacy-pill"><ShieldCheck size={14} /> Inputs are not saved</span>
          )}
        </div>
      </header>

      {activeSection === "strategy" ? (
      <div
        id="strategy-lab-panel"
        className="lab-layout"
        role="tabpanel"
        aria-labelledby="strategy-lab-tab"
      >
        <aside className="control-rail" aria-label="Scenario controls">
          <div className="rail-heading">
            <div>
              <p className="section-kicker">Investor scenario</p>
              <h2>Shape the retirement path</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Reset to report defaults"
              title="Reset to report defaults"
              onClick={() => {
                latestScenario.current = DEFAULT_SCENARIO;
                setScenario(DEFAULT_SCENARIO);
                setUseReportTiming(false);
                setDirty(true);
              }}
            >
              <RefreshCw size={15} />
            </button>
          </div>

          <fieldset className="model-selector">
            <legend>Return model</legend>
            <div className="model-selector__options">
              <label className={scenario.model === "model_a" ? "model-option is-selected" : "model-option"}>
                <input
                  type="radio"
                  name="return-model"
                  value="model_a"
                  aria-label="Model A · Parametric"
                  checked={scenario.model === "model_a"}
                  onChange={() => updateScenario({ model: "model_a" })}
                />
                <span><strong>Model A</strong><small>Parametric</small></span>
              </label>
              <label className={scenario.model === "model_b" ? "model-option is-selected" : "model-option"}>
                <input
                  type="radio"
                  name="return-model"
                  value="model_b"
                  aria-label="Model B · Historical blocks"
                  checked={scenario.model === "model_b"}
                  onChange={() => updateScenario({ model: "model_b" })}
                />
                <span><strong>Model B</strong><small>Historical blocks</small></span>
              </label>
            </div>
            {dirty && scenario.model !== completedModel ? (
              <p className="model-selector__pending" role="status">Run the scenario to apply this model.</p>
            ) : null}
          </fieldset>

          <div className="preset-row" aria-label="Report scenario presets">
            {[35, 50, 60].map((age) => (
              <button
                className={scenario.current_age === age ? "preset is-active" : "preset"}
                key={age}
                type="button"
                onClick={() => applyPreset(age as 35 | 50 | 60)}
              >
                Age {age}
              </button>
            ))}
          </div>

          <div className="field-grid field-grid--two">
            <NumberField
              label="Current age"
              value={scenario.current_age}
              min={18}
              max={79}
              onChange={(value) => updateScenario({ current_age: value })}
            />
            <NumberField
              label="Retirement age"
              value={scenario.retirement_age}
              min={19}
              max={85}
              onChange={(value) => updateScenario({ retirement_age: value })}
            />
          </div>

          <div className="field-grid">
            <NumberField
              label="Starting wealth"
              value={scenario.starting_wealth}
              min={0}
              max={100_000_000}
              step={5_000}
              prefix="$"
              onChange={(value) => updateScenario({ starting_wealth: value })}
            />
            <NumberField
              label="Annual contribution"
              value={scenario.annual_contribution}
              min={0}
              max={1_000_000}
              step={1_000}
              prefix="$"
              onChange={(value) => updateScenario({ annual_contribution: value })}
            />
            <NumberField
              label="Retirement target"
              value={scenario.target_wealth}
              min={1}
              max={100_000_000}
              step={25_000}
              prefix="$"
              onChange={(value) => updateScenario({ target_wealth: value })}
            />
          </div>

          <div className="control-divider" />

          <label
            className={`protection-toggle ${useReportTiming ? "is-active" : ""}`}
            htmlFor="report-cvar-timing"
            aria-label="Use report CVaR timing"
          >
            <input
              id="report-cvar-timing"
              type="checkbox"
              role="switch"
              checked={useReportTiming}
              aria-describedby="report-timing-detail"
              onChange={(event) => toggleReportTiming(event.target.checked)}
            />
            <span className="protection-toggle__track" aria-hidden="true"><span /></span>
            <span className="protection-toggle__copy">
              <strong>Use report CVaR timing</strong>
              <small>Model A: 16 years · Model B: 28 years</small>
            </span>
          </label>
          <p id="report-timing-detail" className="protection-timing-status" aria-live="polite">
            {useReportTiming
              ? reportTimingIsCapped
                ? `The report window is ${reportTimingTarget} years. This shorter horizon protects all ${reportTimingYears} remaining years from age ${reportTimingStartAge}.`
                : `${scenario.model === "model_a" ? "Model A" : "Model B"} protects the final ${reportTimingYears} years, starting at age ${reportTimingStartAge}.`
              : `Manual timing is active at ${scenario.protection_years} of ${horizon} years.`}
          </p>

          <div className="range-field">
            <div className="range-field__header">
              <span>Final years protected</span>
              <strong>{useReportTiming ? `${scenario.protection_years} report timing` : `${scenario.protection_years} of ${horizon}`}</strong>
            </div>
            <input
              aria-label="Final years protected"
              type="range"
              min={0}
              max={horizon}
              step={1}
              value={scenario.protection_years}
              disabled={useReportTiming}
              onChange={(event) => updateScenario({ protection_years: Number(event.target.value) })}
            />
            <div className="range-field__scale"><span>Never</span><span>Always</span></div>
          </div>

          <label className="field">
            <span className="field__label">Live run size</span>
            <span className="select-wrap">
              <select
                aria-label="Live run size"
                value={scenario.paths}
                onChange={(event) => updateScenario({ paths: Number(event.target.value) })}
              >
                <option value={1_000}>1,000 · quick check</option>
                <option value={10_000}>10,000 · live presentation</option>
                <option value={50_000}>50,000 · steadier estimate</option>
                <option value={100_000}>100,000 · slower detail</option>
              </select>
            </span>
          </label>

          <NumberField
            label="Random seed"
            value={scenario.seed}
            min={0}
            max={2_147_483_647}
            onChange={(value) => updateScenario({ seed: value })}
          />

          <div className="run-actions">
            <button
              className="run-button"
              type="button"
              disabled={loading}
              onClick={() => void runSimulation(scenario)}
            >
              {loading ? <RefreshCw className="spin" size={17} /> : <Play size={17} fill="currentColor" />}
              {loading ? "Running model…" : dirty ? "Run updated scenario" : "Run analysis"}
            </button>
            <button className="secondary-button" type="button" disabled={loading} onClick={resample}>
              New paths
            </button>
          </div>

          <div className="source-note">
            <Info size={15} />
            <p>
              {completedIsModelB
                ? "Completed results use the pinned 1928–2018 paired-return dataset. Live runs prioritize speed; report benchmarks use 300,000 to 400,000 paths, so values can vary with the seed and run size. Contributions occur at each year-end."
                : "Completed results use the report's parametric market calibration. Live runs prioritize speed; report benchmarks use 300,000 to 400,000 paths, so values can vary with the seed and run size. Contributions occur at each year-end."}
            </p>
          </div>
        </aside>

        <section className="workspace">
          <div className="hero-copy">
            <div>
              <p className="section-kicker">Decision view · age {lastRun.current_age} to {lastRun.retirement_age}</p>
              <h1>Growth and downside protection do not move in lockstep.</h1>
              <p>
                {completedIsModelB
                  ? "Model B resamples paired annual stock and bond returns from 1928–2018 in stationary blocks, retaining same-year pairing and some serial dependence. All five strategies share paths within this model for a fair comparison."
                  : "Model A draws correlated Gaussian log returns calibrated to the report's stock and bond log-return means, volatilities, and log-return correlation. All five strategies share paths within this model for a fair comparison."}
              </p>
            </div>
            <div className="hero-callout">
              <Target size={17} />
              <div>
                <span>Retirement objective</span>
                <strong>{money(lastRun.target_wealth)}</strong>
              </div>
            </div>
          </div>

          {error ? (
            <div className="engine-alert" role="alert">
              <CircleAlert size={20} />
              <div>
                <strong>The calculation engine is not connected yet.</strong>
                <p>{error}</p>
              </div>
              <button type="button" onClick={() => void runSimulation(scenario)}>Try again</button>
            </div>
          ) : null}

          <div className="metric-strip" aria-live="polite">
            <MetricCard
              eyebrow="Selected strategy"
              value={selected?.name ?? "Connecting…"}
              detail={selected ? `${pct(1 - selected.shortfall_probability)} chance of reaching target` : "Waiting for verified results"}
              tone="positive"
            />
            <MetricCard
              eyebrow="Expected terminal wealth"
              value={selected ? chartMoney(selected.mean) : "N/A"}
              detail={selected ? `Median ${chartMoney(selected.median)}` : "Mean and median shown together"}
            />
            <MetricCard
              eyebrow="5th-percentile wealth"
              value={selected ? chartMoney(selected.q05) : "N/A"}
              detail="Lower-tail terminal wealth, not loss VaR"
              tone="warning"
            />
            <MetricCard
              eyebrow="Shortfall probability"
              value={selected ? pct(selected.shortfall_probability) : "N/A"}
              detail={selected ? `95% MC interval ${pct(selected.shortfall_ci_low)}–${pct(selected.shortfall_ci_high)}` : "Includes simulation uncertainty"}
            />
          </div>

          <div className="insight-row">
            <div className="insight-card">
              <span className="insight-card__icon insight-card__icon--green"><Sparkles size={17} /></span>
              <p><strong>Highest expected wealth</strong><br />{highestMean ? `${highestMean.name} · ${chartMoney(highestMean.mean)}` : "Calculating…"}</p>
            </div>
            <div className="insight-card">
              <span className="insight-card__icon insight-card__icon--gold"><ShieldCheck size={17} /></span>
              <p><strong>Lowest target shortfall</strong><br />{lowestShortfall ? `${lowestShortfall.name} · ${pct(lowestShortfall.shortfall_probability)}` : "Calculating…"}</p>
            </div>
            <div className="insight-card insight-card--source">
              <span className="insight-card__icon"><Clock3 size={17} /></span>
              <p>
                <strong>{completedIsModelB ? "Historical run provenance" : "Parametric run provenance"}</strong><br />
                {result
                  ? `${result.metadata.runtime_ms.toFixed(0)} ms · ${completedIsModelB ? "empirical" : "Black–Scholes"} put premium ${pct(result.metadata.put_premium, 2)}`
                  : "Seed, runtime, and premium appear after calculation"}
              </p>
            </div>
          </div>

          <div className="dashboard-grid">
            <article className="panel panel--wide">
              <div className="panel__header">
                <div>
                  <p className="section-kicker">Risk / return map</p>
                  <h3>Expected wealth versus average wealth in the worst 5%</h3>
                </div>
                <span className="panel-tag">Higher is better ↗</span>
              </div>
              <div className="chart-box chart-box--frontier">
                {result ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 15, right: 24, bottom: 8, left: 8 }}>
                      <CartesianGrid stroke="#21314a" strokeDasharray="3 5" vertical={false} />
                      <XAxis
                        type="number"
                        dataKey="mean"
                        name="Expected wealth"
                        tickFormatter={chartMoney}
                        stroke="#7f91aa"
                        tickLine={false}
                        axisLine={false}
                        domain={["dataMin - 100000", "dataMax + 100000"]}
                      />
                      <YAxis
                        type="number"
                        dataKey="cvar5"
                        name="Worst 5% average wealth"
                        tickFormatter={chartMoney}
                        stroke="#7f91aa"
                        tickLine={false}
                        axisLine={false}
                        width={66}
                        domain={["dataMin - 30000", "dataMax + 30000"]}
                      />
                      <ZAxis range={[145, 145]} />
                      <Tooltip
                        cursor={{ strokeDasharray: "3 3", stroke: "#6b7b94" }}
                        content={({ active, payload }) => {
                          const item = payload?.[0]?.payload as StrategyResult | undefined;
                          if (!active || !item) return null;
                          return (
                            <div className="chart-tooltip chart-tooltip--stack">
                              <strong>{item.name}</strong>
                              <span>Expected wealth {money(item.mean)}</span>
                              <span>Worst 5% average wealth {money(item.cvar5)}</span>
                              <span>Shortfall {pct(item.shortfall_probability)}</span>
                            </div>
                          );
                        }}
                      />
                      <Scatter data={frontierData} onClick={(point) => setSelectedKey(point.key)}>
                        {frontierData.map((point) => (
                          <Cell
                            key={point.key}
                            fill={point.fill}
                            stroke={selectedKey === point.key ? "#ffffff" : "#0f1828"}
                            strokeWidth={selectedKey === point.key ? 3 : 1.5}
                            cursor="pointer"
                          />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                ) : <div className="chart-empty">Waiting for the verified simulation output…</div>}
              </div>
              <div className="strategy-legend">
                {result?.strategies.map((strategy) => (
                  <button
                    key={strategy.key}
                    type="button"
                    className={selectedKey === strategy.key ? "legend-item is-active" : "legend-item"}
                    onClick={() => setSelectedKey(strategy.key)}
                  >
                    <span style={{ background: STRATEGY_COLORS[strategy.key] }} />
                    {strategy.name}
                  </button>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel__header">
                <div>
                  <p className="section-kicker">Target risk</p>
                  <h3>Probability of shortfall</h3>
                </div>
              </div>
              <div className="chart-box">
                {result ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={shortfallData} margin={{ top: 14, right: 8, bottom: 4, left: -8 }}>
                      <CartesianGrid stroke="#21314a" strokeDasharray="3 5" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "#98a7bb", fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
                      <YAxis tickFormatter={(value) => pct(value, 0)} tick={{ fill: "#7f91aa", fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip valueKind="percent" />} cursor={{ fill: "rgba(255,255,255,.035)" }} />
                      <Bar dataKey="shortfall" name="Shortfall" radius={[6, 6, 2, 2]}>
                        {shortfallData.map((point) => (
                          <Cell key={point.key} fill={STRATEGY_COLORS[point.key] ?? "#7a9dff"} opacity={selectedKey === point.key ? 1 : 0.68} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <div className="chart-empty">No results yet</div>}
              </div>
            </article>

            <article className="panel panel--wide">
              <div className="panel__header">
                <div>
                  <p className="section-kicker">Allocation design</p>
                  <h3>Equity weight through time</h3>
                </div>
                <span className="panel-note">Annual rebalancing</span>
              </div>
              <div className="chart-box">
                {result ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={result.allocation_paths} margin={{ top: 12, right: 16, bottom: 2, left: -8 }}>
                      <CartesianGrid stroke="#21314a" strokeDasharray="3 5" vertical={false} />
                      <XAxis dataKey="age" tick={{ fill: "#7f91aa", fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 1]} tickFormatter={(value) => pct(value, 0)} tick={{ fill: "#7f91aa", fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip valueKind="allocation" />} />
                      <Legend wrapperStyle={{ fontSize: 11, color: "#aeb9c9" }} />
                      <Line type="stepAfter" dataKey="s1" name="80/20" stroke={STRATEGY_COLORS.s1} dot={false} strokeWidth={2} />
                      <Line type="stepAfter" dataKey="s2" name="60/40" stroke={STRATEGY_COLORS.s2} dot={false} strokeWidth={2} />
                      <Line type="stepAfter" dataKey="s3" name="40/60" stroke={STRATEGY_COLORS.s3} dot={false} strokeWidth={2} />
                      <Line type="stepAfter" dataKey="s4" name="Glide path" stroke={STRATEGY_COLORS.s4} dot={false} strokeWidth={2.5} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <div className="chart-empty">No allocation path yet</div>}
              </div>
            </article>

            <article className={`panel model-method-card ${completedIsModelB ? "model-method-card--historical" : ""}`}>
              <span className="model-method-card__icon"><ArrowUpRight size={20} /></span>
              <p className="section-kicker">Completed model method</p>
              <h3>{completedIsModelB ? "Historical-block resampling" : "Parametric market paths"}</h3>
              <p>
                {completedIsModelB
                  ? `Paired annual returns ${result?.metadata.dataset_start_year ?? 1928}–${result?.metadata.dataset_end_year ?? 2018} are resampled with a stationary block bootstrap, with a mean block length of ${result?.metadata.mean_block_length ?? 4} years. This retains same-year stock-bond pairing, empirical tail shape, and some serial dependence; the put premium is empirical.`
                  : "Correlated Gaussian log returns use the report's calibrated stock and bond log-return means, volatilities, and log-return correlation. The annual protective put is valued with the Black–Scholes formula."}
              </p>
              <div className="method-facts" aria-label="Model methodology details">
                {completedIsModelB ? (
                  <>
                    <span><Check size={14} /> Mean block length {result?.metadata.mean_block_length ?? 4}</span>
                    <span><Check size={14} /> Restart probability {pct(result?.metadata.restart_probability ?? 0.25, 0)}</span>
                    <span><Check size={14} /> Empirical put premium {result ? pct(result.metadata.put_premium, 2) : "N/A"}</span>
                    <span><Check size={14} /> Shared paths across strategies</span>
                    <span><Check size={14} /> No antithetic variates</span>
                  </>
                ) : (
                  <>
                    <span><Check size={14} /> Correlated Gaussian log returns</span>
                    <span><Check size={14} /> Black–Scholes put premium {result ? pct(result.metadata.put_premium, 2) : "N/A"}</span>
                    <span><Check size={14} /> Shared paths across strategies</span>
                    <span><Check size={14} /> No antithetic variates</span>
                  </>
                )}
              </div>
              <div className="method-source">
                <Info size={15} />
                <div>
                  <strong>Source &amp; provenance</strong>
                  {completedIsModelB ? (
                    <>
                      <span>
                        {result?.metadata.dataset_rows ?? 91} paired annual observations · {result?.metadata.dataset_start_year ?? 1928}–{result?.metadata.dataset_end_year ?? 2018}
                      </span>
                      <code title={result?.metadata.dataset_sha256}>{shortHash(result?.metadata.dataset_sha256)}</code>
                      <span>Compared with Model A on calibrated log-return moments, not exact simple-return moments.</span>
                    </>
                  ) : (
                    <>
                      <span>Market calibration uses stock and bond log-return means, volatilities, log-return correlation, and the historical risk-free rate. Scenario and design inputs are set explicitly.</span>
                      <span>Compared with Model B on calibrated log-return moments, not exact simple-return moments.</span>
                    </>
                  )}
                </div>
              </div>
            </article>
          </div>

          <article className="results-table-panel">
            <div className="panel__header">
              <div>
                <p className="section-kicker">Exact values</p>
                <h3>Strategy scorecard</h3>
              </div>
              <p className="table-caption">Strategies share paths within this model. Model A and Model B generate different paths.</p>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>Mean</th>
                    <th>Median</th>
                    <th>Shortfall</th>
                    <th>5th-percentile wealth</th>
                    <th>Worst 5% average</th>
                    <th>90th percentile</th>
                  </tr>
                </thead>
                <tbody>
                  {result?.strategies.map((strategy) => (
                    <tr
                      key={strategy.key}
                      className={selectedKey === strategy.key ? "is-selected" : ""}
                      onClick={() => setSelectedKey(strategy.key)}
                    >
                      <td><span className="strategy-dot" style={{ background: STRATEGY_COLORS[strategy.key] }} />{strategy.name}</td>
                      <td>{money(strategy.mean)}</td>
                      <td>{money(strategy.median)}</td>
                      <td>{pct(strategy.shortfall_probability)}</td>
                      <td>{money(strategy.q05)}</td>
                      <td>{money(strategy.cvar5)}</td>
                      <td>{money(strategy.q90)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <footer className="model-footer">
            <span>Educational stochastic model. Illustrative simulation, not a forecast or individualized investment recommendation.</span>
            <span>Nominal terminal wealth · annual returns and rebalancing · no inflation, taxes, fees, withdrawals, or mortality.</span>
            <span>Scenario inputs are processed for the run and are not saved by this app.</span>
          </footer>
        </section>
      </div>
      ) : activeSection === "studio" ? <ScenarioStudio /> : <SequenceLab />}
    </main>
  );
}
