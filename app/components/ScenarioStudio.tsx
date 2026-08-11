"use client";

import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  Clock3,
  Coins,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { runBrowserSimulation } from "../lib/browser-simulation/client";
import {
  bestStrategy,
  buildSimulationPayload,
  clampProtectionYears,
  createDelayedStartProfile,
  createSaveMoreProfile,
  objectiveValue,
  strategyByKey,
  weeklyToAnnual,
  type ModelKey,
  type Objective,
  type ParticipantProfile,
  type SimulationResponse,
  type StrategyKey,
} from "./scenarioStudioLogic";

type ModelOutcome =
  | { status: "success"; response: SimulationResponse }
  | { status: "error"; message: string };

type ModelPair = {
  modelA: ModelOutcome;
  modelB: ModelOutcome;
};

type StudioRun = {
  baseline: ModelPair;
  saveMore: ModelPair | null;
  startLater: ModelPair | null;
  profile: ParticipantProfile;
  prediction: StrategyKey;
  seed: number;
  paths: number;
};

const DEFAULT_PROFILE: ParticipantProfile = {
  currentAge: 22,
  currentSavings: 5_000,
  weeklyContribution: 75,
  retirementAge: 65,
  targetWealth: 1_000_000,
  protectionYears: 20,
  objective: "confidence",
};

const PATHS = 10_000;
const INITIAL_SEED = 73_021;

const STRATEGIES: Array<{ key: StrategyKey; label: string; detail: string }> = [
  { key: "s1", label: "80/20", detail: "Growth focused" },
  { key: "s2", label: "60/40", detail: "Balanced" },
  { key: "s3", label: "40/60", detail: "Bond focused" },
  { key: "s4", label: "Glide path", detail: "Risk falls with age" },
  { key: "s5", label: "80/20 + puts", detail: "Downside protection" },
];

const OBJECTIVES: Array<{
  key: Objective;
  label: string;
  detail: string;
  icon: typeof Sparkles;
}> = [
  {
    key: "growth",
    label: "Highest wealth",
    detail: "Prioritize average terminal wealth.",
    icon: Sparkles,
  },
  {
    key: "confidence",
    label: "Reach the target",
    detail: "Prioritize the chance of meeting the goal.",
    icon: Target,
  },
  {
    key: "downside",
    label: "Protect downside",
    detail: "Prioritize wealth in the worst 5% of futures.",
    icon: ShieldCheck,
  },
];

const wholeMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

function money(value: number) {
  return wholeMoney.format(value);
}

function compact(value: number) {
  return compactMoney.format(value);
}

function pct(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function objectiveLabel(objective: Objective) {
  if (objective === "growth") return "expected wealth";
  if (objective === "confidence") return "target confidence";
  return "worst-5% average wealth";
}

function formatObjective(value: number, objective: Objective) {
  return objective === "confidence" ? pct(value) : compact(value);
}

function signedDifference(value: number, objective: Objective) {
  if (objective === "confidence") {
    const points = value * 100;
    return `${points >= 0 ? "+" : ""}${points.toFixed(1)} pts`;
  }
  return `${value >= 0 ? "+" : "−"}${compact(Math.abs(value))}`;
}

function NumberInput({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  prefix,
  suffix,
  help,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  prefix?: string;
  suffix?: string;
  help?: string;
  onChange: (value: number) => void;
}) {
  const helpId = `${id}-help`;
  return (
    <label className="studio-field" htmlFor={id}>
      <span className="studio-field__label">{label}</span>
      <span className="studio-field__control">
        {prefix ? <span aria-hidden="true">{prefix}</span> : null}
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ""}
          aria-describedby={help ? helpId : undefined}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {suffix ? <span aria-hidden="true">{suffix}</span> : null}
      </span>
      {help ? <small id={helpId}>{help}</small> : null}
    </label>
  );
}

async function requestSimulation(
  model: ModelKey,
  profile: ParticipantProfile,
  seed: number,
  paths: number,
  signal: AbortSignal,
) {
  return await runBrowserSimulation(
    buildSimulationPayload(model, profile, seed, paths),
    signal,
  ) as SimulationResponse;
}

async function requestPair(
  profile: ParticipantProfile,
  seed: number,
  paths: number,
  signal: AbortSignal,
): Promise<ModelPair> {
  const [modelAResult, modelBResult] = await Promise.allSettled([
    requestSimulation("model_a", profile, seed, paths, signal),
    requestSimulation("model_b", profile, seed, paths, signal),
  ]);
  if (signal.aborted) throw new DOMException("Request was cancelled", "AbortError");

  const toOutcome = (result: PromiseSettledResult<SimulationResponse>): ModelOutcome => {
    if (result.status === "fulfilled") return { status: "success", response: result.value };
    return {
      status: "error",
      message: result.reason instanceof Error ? result.reason.message : "This model did not complete.",
    };
  };

  return { modelA: toOutcome(modelAResult), modelB: toOutcome(modelBResult) };
}

function responseFrom(outcome: ModelOutcome | undefined) {
  return outcome?.status === "success" ? outcome.response : null;
}

function ModelResultCard({
  label,
  method,
  tone,
  outcome,
  objective,
}: {
  label: string;
  method: string;
  tone: "parametric" | "historical";
  outcome: ModelOutcome;
  objective: Objective;
}) {
  if (outcome.status === "error") {
    return (
      <article className={`studio-model-card studio-model-card--${tone}`}>
        <div className="studio-model-card__header">
          <div><span>{label}</span><h3>{method}</h3></div>
          <span className="studio-model-card__badge studio-model-card__badge--error">Unavailable</span>
        </div>
        <div className="studio-model-error" role="status">
          <CircleAlert size={20} />
          <div><strong>This model did not finish.</strong><p>{outcome.message}</p></div>
        </div>
      </article>
    );
  }

  const response = outcome.response;
  const winner = bestStrategy(response, objective);

  return (
    <article className={`studio-model-card studio-model-card--${tone}`}>
      <div className="studio-model-card__header">
        <div>
          <span>{label}</span>
          <h3>{method}</h3>
        </div>
        <span className="studio-model-card__badge">
          {response.metadata.paths.toLocaleString()} paths
        </span>
      </div>

      <div className="studio-winner">
        <span className="studio-winner__icon" aria-hidden="true"><BadgeCheck size={19} /></span>
        <div>
          <span>Best for {objectiveLabel(objective)}</span>
          <strong>{winner.name}</strong>
        </div>
      </div>

      <dl className="studio-stat-grid">
        <div><dt>Expected wealth</dt><dd>{compact(winner.mean)}</dd></div>
        <div><dt>Chance of target</dt><dd>{pct(1 - winner.shortfall_probability)}</dd></div>
        <div><dt>Worst 5% average wealth</dt><dd>{compact(winner.cvar5)}</dd></div>
      </dl>

    </article>
  );
}

function WhatIfCard({
  icon,
  title,
  detail,
  result,
  baseline,
  objective,
  loading,
  unavailableReason,
  onRun,
}: {
  icon: typeof Coins;
  title: string;
  detail: string;
  result: ModelPair | null;
  baseline: ModelPair;
  objective: Objective;
  loading: boolean;
  unavailableReason?: string;
  onRun: () => void;
}) {
  const Icon = icon;
  const renderDelta = (model: "modelA" | "modelB") => {
    const nextResponse = responseFrom(result?.[model]);
    const baselineResponse = responseFrom(baseline[model]);
    if (!nextResponse || !baselineResponse) {
      const failed = result?.[model]?.status === "error" || baseline[model].status === "error";
      return (
        <div>
          <dt>{model === "modelA" ? "Model A" : "Model B"}</dt>
          <dd className="is-unavailable">N/A</dd>
          <span>{failed ? "Unavailable" : "Not run yet"}</span>
        </div>
      );
    }
    const nextWinner = bestStrategy(nextResponse, objective);
    const baselineWinner = bestStrategy(baselineResponse, objective);
    const delta = objectiveValue(nextWinner, objective) - objectiveValue(baselineWinner, objective);
    return (
      <div>
        <dt>{model === "modelA" ? "Model A" : "Model B"}</dt>
        <dd className={delta >= 0 ? "is-positive" : "is-negative"}>{signedDifference(delta, objective)}</dd>
        <span>{nextWinner.name}</span>
      </div>
    );
  };

  return (
    <article className="studio-whatif-card">
      <span className="studio-whatif-card__icon" aria-hidden="true"><Icon size={19} /></span>
      <div className="studio-whatif-card__copy">
        <h4>{title}</h4>
        <p>{detail}</p>
      </div>
      {unavailableReason ? (
        <p className="studio-whatif-unavailable">{unavailableReason}</p>
      ) : result ? <dl>{renderDelta("modelA")}{renderDelta("modelB")}</dl> : (
        <button type="button" className="studio-whatif-run" onClick={onRun} disabled={loading}>
          {loading ? <RefreshCw className="spin" size={15} /> : <Play size={15} />}
          {loading ? "Running…" : "Run this comparison"}
        </button>
      )}
    </article>
  );
}

export function ScenarioStudio() {
  const [profile, setProfile] = useState<ParticipantProfile>(DEFAULT_PROFILE);
  const [prediction, setPrediction] = useState<StrategyKey | null>(null);
  const [run, setRun] = useState<StudioRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingExperiment, setLoadingExperiment] = useState<"saveMore" | "startLater" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState(INITIAL_SEED);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const requestId = useRef(0);
  const activeController = useRef<AbortController | null>(null);

  const annualContribution = weeklyToAnnual(profile.weeklyContribution);
  const validationMessage = useMemo(() => {
    if (!Number.isInteger(profile.currentAge) || profile.currentAge < 21 || profile.currentAge > 64) {
      return "Current age must be a whole number from 21 through 64.";
    }
    if (!Number.isInteger(profile.retirementAge) || profile.retirementAge <= profile.currentAge) {
      return "Retirement age must be a whole number after the current age.";
    }
    if (profile.retirementAge > 85) return "Retirement age cannot be above 85.";
    if (!Number.isFinite(profile.currentSavings) || profile.currentSavings < 0) {
      return "Current savings cannot be negative.";
    }
    if (!Number.isFinite(profile.weeklyContribution) || profile.weeklyContribution < 0) {
      return "Weekly contribution cannot be negative.";
    }
    if (!Number.isFinite(profile.targetWealth) || profile.targetWealth <= 0) {
      return "Enter a retirement target greater than zero.";
    }
    if (!Number.isFinite(profile.protectionYears) || profile.protectionYears < 0) {
      return "Protection years cannot be negative.";
    }
    return null;
  }, [profile]);

  useEffect(() => () => activeController.current?.abort(), []);

  const cancelActiveRequest = () => {
    requestId.current += 1;
    activeController.current?.abort();
    activeController.current = null;
    setLoading(false);
    setLoadingExperiment(null);
  };

  const updateProfile = (patch: Partial<ParticipantProfile>) => {
    cancelActiveRequest();
    setProfile((current) => {
      const next = { ...current, ...patch };
      return { ...next, protectionYears: clampProtectionYears(next) };
    });
    setRun(null);
    setError(null);
  };

  const reset = () => {
    cancelActiveRequest();
    setProfile(DEFAULT_PROFILE);
    setPrediction(null);
    setRun(null);
    setError(null);
    setSeed(INITIAL_SEED);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (validationMessage || !prediction) return;

    setLoading(true);
    setError(null);
    const capturedProfile = { ...profile };
    const capturedPrediction = prediction;
    const thisRequest = requestId.current + 1;
    requestId.current = thisRequest;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;

    try {
      const baseline = await requestPair(capturedProfile, seed, PATHS, controller.signal);
      if (requestId.current !== thisRequest) return;
      setRun({
        baseline,
        saveMore: null,
        startLater: null,
        profile: capturedProfile,
        prediction: capturedPrediction,
        seed,
        paths: PATHS,
      });
      if (baseline.modelA.status === "error" && baseline.modelB.status === "error") {
        setError("Neither market model completed. Try the run again or reduce the path count.");
      }
      window.setTimeout(() => resultsHeading.current?.focus(), 0);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "The simulation could not be completed.");
    } finally {
      if (requestId.current === thisRequest) {
        setLoading(false);
        activeController.current = null;
      }
    }
  };

  const runExperiment = async (kind: "saveMore" | "startLater") => {
    if (!run) return;
    if (kind === "startLater" && createDelayedStartProfile(run.profile).currentAge <= run.profile.currentAge) {
      return;
    }
    setLoadingExperiment(kind);
    setError(null);
    const thisRequest = requestId.current + 1;
    requestId.current = thisRequest;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const experimentProfile = kind === "saveMore"
      ? createSaveMoreProfile(run.profile)
      : createDelayedStartProfile(run.profile);

    try {
      const pair = await requestPair(experimentProfile, run.seed, run.paths, controller.signal);
      if (requestId.current !== thisRequest) return;
      setRun((current) => current ? { ...current, [kind]: pair } : current);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "The comparison could not be completed.");
    } finally {
      if (requestId.current === thisRequest) {
        setLoadingExperiment(null);
        activeController.current = null;
      }
    }
  };

  const newMarketFuture = () => {
    cancelActiveRequest();
    const nextSeed = Math.floor(10_000 + Math.random() * 990_000);
    setSeed(nextSeed);
    setRun(null);
    setError(null);
  };

  const baselineA = responseFrom(run?.baseline.modelA);
  const baselineB = responseFrom(run?.baseline.modelB);
  const aWinner = baselineA && run ? bestStrategy(baselineA, run.profile.objective) : null;
  const bWinner = baselineB && run ? bestStrategy(baselineB, run.profile.objective) : null;
  const predictionMatches = run
    ? Number(aWinner?.key === run.prediction) + Number(bWinner?.key === run.prediction)
    : 0;
  const completedModels = Number(Boolean(aWinner)) + Number(Boolean(bWinner));
  const modelsAgree = Boolean(aWinner && bWinner && aWinner.key === bWinner.key);
  const predictedLabel = run
    ? STRATEGIES.find((strategy) => strategy.key === run.prediction)?.label ?? "Selected strategy"
    : "Selected strategy";
  const delayedStartProfile = run ? createDelayedStartProfile(run.profile) : null;
  const delayedStartYears = run && delayedStartProfile
    ? delayedStartProfile.currentAge - run.profile.currentAge
    : 0;

  return (
    <section
      id="scenario-studio-panel"
      className="scenario-studio"
      role="tabpanel"
      aria-labelledby="scenario-studio-tab"
    >
      <div className="studio-hero">
        <div>
          <p className="section-kicker">Personal scenario comparison</p>
          <h1>See one retirement plan through two market models.</h1>
          <p>The calibration aligns the models on stock and bond log-return means, volatilities, and log-return correlation, not exact simple-return moments. Model B also retains same-year stock-bond pairing, empirical tail shape, and some serial dependence through stationary blocks.</p>
        </div>
      </div>

      <div className="studio-layout">
        <form className="studio-form" onSubmit={submit} noValidate>
          <div className="studio-card studio-card--profile">
            <div className="studio-step-heading">
              <div><p className="section-kicker">Profile</p><h2>Participant scenario</h2></div>
            </div>

            <div className="studio-fields studio-fields--ages">
              <NumberInput
                id="studio-current-age"
                label="Current age"
                value={profile.currentAge}
                min={21}
                max={64}
                help="Ages 21 through 64"
                onChange={(currentAge) => updateProfile({ currentAge })}
              />
              <NumberInput
                id="studio-retirement-age"
                label="Retirement age"
                value={profile.retirementAge}
                min={Math.min(85, profile.currentAge + 1)}
                max={85}
                onChange={(retirementAge) => updateProfile({ retirementAge })}
              />
            </div>

            <div className="studio-fields">
              <NumberInput
                id="studio-savings"
                label="Current invested savings"
                value={profile.currentSavings}
                min={0}
                max={100_000_000}
                step={500}
                prefix="$"
                onChange={(currentSavings) => updateProfile({ currentSavings })}
              />
              <NumberInput
                id="studio-weekly"
                label="Weekly contribution"
                value={profile.weeklyContribution}
                min={0}
                max={20_000}
                step={5}
                prefix="$"
                suffix="/ wk"
                help={`${money(profile.weeklyContribution)}/week × 52 = ${money(annualContribution)}/year, applied at year-end`}
                onChange={(weeklyContribution) => updateProfile({ weeklyContribution })}
              />
              <NumberInput
                id="studio-target"
                label="Retirement target"
                value={profile.targetWealth}
                min={1}
                max={100_000_000}
                step={50_000}
                prefix="$"
                onChange={(targetWealth) => updateProfile({ targetWealth })}
              />
              <NumberInput
                id="studio-protection-years"
                label="Put protection window"
                value={profile.protectionYears}
                min={0}
                max={Math.max(0, profile.retirementAge - profile.currentAge)}
                suffix="years"
                help="Applies to the final years of the 80/20 + puts strategy only"
                onChange={(protectionYears) => updateProfile({ protectionYears })}
              />
            </div>
          </div>

          <fieldset className="studio-card studio-objective">
            <legend className="studio-step-heading">
              <span><span className="section-kicker">Objective</span><strong>Choose the priority</strong></span>
            </legend>
            <div className="studio-choice-grid">
              {OBJECTIVES.map((objective) => {
                const Icon = objective.icon;
                return (
                  <label
                    className={profile.objective === objective.key ? "studio-choice is-selected" : "studio-choice"}
                    key={objective.key}
                  >
                    <input
                      type="radio"
                      name="studio-objective"
                      value={objective.key}
                      checked={profile.objective === objective.key}
                      onChange={() => updateProfile({ objective: objective.key })}
                    />
                    <Icon size={18} />
                    <span><strong>{objective.label}</strong></span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="studio-card studio-prediction">
            <legend className="studio-step-heading">
              <span><span className="section-kicker">Prediction</span><strong>Which strategy will lead?</strong></span>
            </legend>
            <div className="studio-prediction-grid">
              {STRATEGIES.map((strategy) => (
                <label
                  className={prediction === strategy.key ? "studio-prediction-option is-selected" : "studio-prediction-option"}
                  key={strategy.key}
                >
                  <input
                    type="radio"
                    name="studio-prediction"
                    value={strategy.key}
                    checked={prediction === strategy.key}
                    onChange={() => {
                      cancelActiveRequest();
                      setPrediction(strategy.key);
                      setRun(null);
                    }}
                  />
                  <strong>{strategy.label}</strong>
                </label>
              ))}
            </div>
          </fieldset>

          {validationMessage ? <p className="studio-form-message" role="alert">{validationMessage}</p> : null}
          {!prediction ? <p className="studio-form-hint">Select a predicted winner to run the comparison.</p> : null}
          {error ? (
            <div className="studio-error" role="alert">
              <CircleAlert size={18} />
              <div><strong>The calculation did not complete.</strong><span>{error}</span></div>
            </div>
          ) : null}

          <div className="studio-actions">
            <button
              className="studio-run-button"
              type="submit"
              disabled={loading || Boolean(loadingExperiment) || Boolean(validationMessage) || !prediction}
            >
              {loading ? <RefreshCw className="spin" size={18} /> : <Play size={18} fill="currentColor" />}
              {loading ? "Comparing models…" : "Run comparison"}
            </button>
            <button className="studio-reset-button" type="button" onClick={reset}>
              <RefreshCw size={16} /> Clear participant
            </button>
          </div>
          <p className="studio-run-note" aria-live="polite">
            {loading
              ? "Model A and Model B are using the same participant assumptions and numeric seed, but each model generates its own paths."
              : `${PATHS.toLocaleString()} live paths/model · seed ${seed} · separate return processes · report benchmarks use 300,000 to 400,000 paths`}
          </p>
        </form>

        <div className="studio-results" aria-live="polite" aria-busy={loading}>
          {!run ? (
            <div className="studio-empty-state">
              <p className="section-kicker">Comparison preview</p>
              <h2>Choose a strategy, then compare both models.</h2>
              <p>Results include the leading strategy, downside outcomes, target confidence, and two optional what-if tests.</p>
            </div>
          ) : (
            <>
              <div className="studio-results-heading">
                <div>
                  <p className="section-kicker">Comparison results</p>
                  <h2 ref={resultsHeading} tabIndex={-1}>Model A vs. Model B</h2>
                  <p>
                    Age {run.profile.currentAge} · {money(run.profile.currentSavings)} invested · {money(run.profile.weeklyContribution)}/week · target {compact(run.profile.targetWealth)} · final {run.profile.protectionYears} years protected
                  </p>
                </div>
                <button type="button" className="studio-seed-button" onClick={newMarketFuture}>
                  <RefreshCw size={14} /> New market future
                </button>
              </div>

              <div className={`studio-verdict ${modelsAgree ? "studio-verdict--agree" : "studio-verdict--split"}`}>
                <span aria-hidden="true">{modelsAgree ? <BadgeCheck size={20} /> : <ArrowRight size={20} />}</span>
                <div>
                  <strong>{completedModels === 0 ? "Neither model completed" : completedModels === 1 ? "One model result is still available" : modelsAgree ? "The models agree" : "The model choice changes the winner"}</strong>
                  <p>
                    {completedModels === 0
                      ? "The error cards below preserve each model’s status so the run can be diagnosed without guessing."
                      : completedModels === 1
                      ? `${aWinner ? "Model A" : "Model B"} completed; the other model’s error is shown without discarding this result.`
                      : modelsAgree
                      ? `${aWinner?.name} ranks first for ${objectiveLabel(run.profile.objective)} in both views.`
                      : `Model A favors ${aWinner?.name}; Model B favors ${bWinner?.name} for the same objective.`}
                  </p>
                </div>
                <span className="studio-verdict__prediction">
                  {predictedLabel} · {predictionMatches === 2 ? "matched both" : predictionMatches === 1 ? "matched one" : completedModels ? "did not match" : "not scored"}
                </span>
              </div>

              <div className="studio-model-grid">
                <ModelResultCard
                  label="Model A"
                  method="Parametric log returns"
                  tone="parametric"
                  outcome={run.baseline.modelA}
                  objective={run.profile.objective}
                />
                <ModelResultCard
                  label="Model B"
                  method="Paired historical blocks"
                  tone="historical"
                  outcome={run.baseline.modelB}
                  objective={run.profile.objective}
                />
              </div>

              <article className="studio-scoreboard">
                <div className="studio-scoreboard__heading">
                  <div><p className="section-kicker">All five strategies</p><h3>Side-by-side {objectiveLabel(run.profile.objective)}</h3></div>
                  <span>Higher is better</span>
                </div>
                <div className="studio-scoreboard__grid" role="table" aria-label={`Strategy ${objectiveLabel(run.profile.objective)} by model`}>
                  <div className="studio-scoreboard__row studio-scoreboard__row--header" role="row">
                    <span role="columnheader">Strategy</span><span role="columnheader">Model A</span><span role="columnheader">Model B</span>
                  </div>
                  {STRATEGIES.map((strategy) => {
                    const a = baselineA ? strategyByKey(baselineA, strategy.key) : null;
                    const b = baselineB ? strategyByKey(baselineB, strategy.key) : null;
                    return (
                      <div className="studio-scoreboard__row" role="row" key={strategy.key}>
                        <span role="cell">
                          <strong>{strategy.label}</strong>
                        </span>
                        <span role="cell" className={aWinner?.key === strategy.key ? "is-winner" : ""}>
                          {a ? formatObjective(objectiveValue(a, run.profile.objective), run.profile.objective) : "N/A"}
                          {aWinner?.key === strategy.key ? <small>Best</small> : null}
                        </span>
                        <span role="cell" className={bWinner?.key === strategy.key ? "is-winner" : ""}>
                          {b ? formatObjective(objectiveValue(b, run.profile.objective), run.profile.objective) : "N/A"}
                          {bWinner?.key === strategy.key ? <small>Best</small> : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </article>

              <section className="studio-whatifs" aria-labelledby="studio-whatifs-title">
                <div className="studio-whatifs__heading">
                  <div><p className="section-kicker">Behavior versus timing</p><h3 id="studio-whatifs-title">What changes the outcome?</h3></div>
                  <span>Change in best {objectiveLabel(run.profile.objective)}</span>
                </div>
                <div className="studio-whatif-grid">
                  <WhatIfCard
                    icon={Coins}
                    title="Save $25 more each week"
                    detail={`+$1,300/year · ${money(run.profile.weeklyContribution + 25)}/week`}
                    result={run.saveMore}
                    baseline={run.baseline}
                    objective={run.profile.objective}
                    loading={loadingExperiment === "saveMore"}
                    onRun={() => void runExperiment("saveMore")}
                  />
                  <WhatIfCard
                    icon={Clock3}
                    title={delayedStartYears === 0
                      ? "Later start unavailable"
                      : delayedStartYears === 1
                        ? "Start one year later"
                        : `Start ${delayedStartYears} years later`}
                    detail={delayedStartProfile
                      ? `Start at ${delayedStartProfile.currentAge} · same plan · ${delayedStartProfile.protectionYears} protected years`
                      : "Compare a later starting age"}
                    result={run.startLater}
                    baseline={run.baseline}
                    objective={run.profile.objective}
                    loading={loadingExperiment === "startLater"}
                    unavailableReason={delayedStartYears === 0 ? "No later starting age remains before retirement." : undefined}
                    onRun={() => void runExperiment("startLater")}
                  />
                </div>
              </section>

            </>
          )}
        </div>
      </div>

      <footer className="studio-footer">
        <span>Illustrative accumulation scenario, not a forecast or individualized recommendation.</span>
        <span>No names or contact details are collected. Numeric inputs are processed for the run and are not saved by this app.</span>
        <span>Strategies share paths within each model; Model A and Model B generate different paths. Antithetic variates are not used.</span>
        <span>10,000-path live results prioritize speed; report benchmarks use 300,000 to 400,000 paths and are more stable.</span>
        <span>Nominal terminal wealth · annual returns and rebalancing · year-end contributions · no inflation, taxes, fees, salary growth, employer match, withdrawals, or mortality.</span>
      </footer>
    </section>
  );
}
