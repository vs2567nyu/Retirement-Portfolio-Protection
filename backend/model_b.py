"""Seeded empirical-return retirement simulation (Model B).

Model B uses the validated 1928--2018 Damodaran annual return history.  Each
path is drawn with a stationary paired block bootstrap: stock and bond returns
always come from the same historical year, blocks continue chronologically
with wraparound, and a new uniformly selected block begins with probability
``p`` each year.

Only the Python standard library is used.  The original data file is verified
against a pinned SHA-256 digest before any result is produced.
"""

from __future__ import annotations

from array import array
from dataclasses import asdict, dataclass, replace
import csv
import hashlib
import io
import math
from pathlib import Path
import random
import time
from typing import Any, Iterator, Mapping, Sequence

from .engine import (
    STRATEGY_NAMES,
    Scenario,
    ValidationError,
    _allocation_paths,
    _fan_chart,
    _metrics,
    glide_equity_weight,
)


DATASET_RELATIVE_PATH = "data/damodaran_histretSPX_1928_2018.csv"
DATASET_PATH = Path(__file__).resolve().parents[1] / DATASET_RELATIVE_PATH
DATASET_SHA256 = "17b989873bbfc155341afafd03a3a389cd7154a6a88408e6f83c2161fc97c8cb"
DATASET_SOURCE_URL = (
    "https://pages.stern.nyu.edu/adamodar/New_Home_Page/datafile/histretSPX.html"
)
DATASET_COLUMNS = (
    "year",
    "sp500_total_return",
    "tbill_3m",
    "tbond_10y_total_return",
)
FIRST_YEAR = 1928
LAST_YEAR = 2018
EXPECTED_ROWS = LAST_YEAR - FIRST_YEAR + 1
MODEL_A_ONLY_FIELDS = {
    "equity_drift",
    "stock_drift",
    "equity_mu",
    "equity_volatility",
    "stock_volatility",
    "equity_sigma",
    "bond_drift",
    "bond_mu",
    "bond_volatility",
    "bond_sigma",
    "correlation",
    "rho",
    "risk_free_rate",
    "risk_free",
}
MODEL_A_ONLY_CANONICAL_FIELDS = (
    "equity_drift",
    "equity_volatility",
    "bond_drift",
    "bond_volatility",
    "correlation",
    "risk_free_rate",
)


@dataclass(frozen=True, slots=True)
class HistoricalReturn:
    """One paired annual observation from the pinned historical dataset."""

    year: int
    stock_return: float
    tbill_return: float
    bond_return: float


@dataclass(frozen=True, slots=True)
class HistoricalDataset:
    """Validated immutable historical observations and their provenance."""

    rows: tuple[HistoricalReturn, ...]
    sha256: str
    path: str

    @property
    def risk_free_rate(self) -> float:
        return math.fsum(row.tbill_return for row in self.rows) / len(self.rows)


@dataclass(frozen=True, slots=True)
class ModelBScenario(Scenario):
    """Model B scenario with a stationary-bootstrap restart probability."""

    restart_probability: float = 0.25

    @property
    def mean_block_length(self) -> float:
        return 1.0 / self.restart_probability

    def validate(self) -> None:
        # ``dataclass(slots=True)`` creates a replacement class object, which
        # makes zero-argument ``super()`` unreliable on some Python versions.
        Scenario.validate(self)
        value = self.restart_probability
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValidationError("restart_probability must be a number")
        if not math.isfinite(value) or not 0.0 < value <= 1.0:
            raise ValidationError("restart_probability must be greater than zero and at most one")

        defaults = Scenario()
        changed_market_fields = [
            field_name
            for field_name in MODEL_A_ONLY_CANONICAL_FIELDS
            if getattr(self, field_name) != getattr(defaults, field_name)
        ]
        if changed_market_fields:
            raise ValidationError(
                "Model B market returns and risk-free rate are fixed by the pinned "
                "historical dataset; unsupported override(s): "
                + ", ".join(changed_market_fields)
            )

    @classmethod
    def from_mapping(cls, payload: Mapping[str, Any] | None) -> "ModelBScenario":
        """Parse the shared scenario contract plus Model B bootstrap controls."""

        if payload is None:
            return cls().normalized()
        if not isinstance(payload, Mapping):
            raise ValidationError("request body must be a JSON object")

        raw = dict(payload)
        requested_model = raw.pop("model", "model_b")
        if not isinstance(requested_model, str) or requested_model.strip().lower().replace(
            " ", "_"
        ) not in {"model_b", "b", "empirical", "bootstrap"}:
            raise ValidationError("this simulator supports only model_b")

        unsupported_market_fields = sorted(set(raw) & MODEL_A_ONLY_FIELDS)
        if unsupported_market_fields:
            raise ValidationError(
                "Model B market returns and risk-free rate are fixed by the pinned "
                "historical dataset; unsupported field(s): "
                + ", ".join(unsupported_market_fields)
            )

        bootstrap_aliases = {
            "restart_probability": "restart_probability",
            "restart_prob": "restart_probability",
            "p_restart": "restart_probability",
            "mean_block_length": "mean_block_length",
            "block_length": "mean_block_length",
        }
        bootstrap_values: dict[str, Any] = {}
        for key in tuple(raw):
            target = bootstrap_aliases.get(key)
            if target is None:
                continue
            if target in bootstrap_values:
                raise ValidationError(f"duplicate values supplied for {target}")
            bootstrap_values[target] = raw.pop(key)

        restart_probability = bootstrap_values.get("restart_probability")
        mean_block_length = bootstrap_values.get("mean_block_length")
        for name, value in (
            ("restart_probability", restart_probability),
            ("mean_block_length", mean_block_length),
        ):
            if value is not None and (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
            ):
                raise ValidationError(f"{name} must be a finite number")

        if restart_probability is not None:
            restart_probability = float(restart_probability)
            if not 0.0 < restart_probability <= 1.0:
                raise ValidationError(
                    "restart_probability must be greater than zero and at most one"
                )
        if mean_block_length is not None:
            mean_block_length = float(mean_block_length)
            if mean_block_length < 1.0:
                raise ValidationError("mean_block_length must be at least one year")

        if restart_probability is None and mean_block_length is None:
            restart_probability = 0.25
        elif restart_probability is None:
            restart_probability = 1.0 / mean_block_length
        elif mean_block_length is not None and not math.isclose(
            restart_probability,
            1.0 / mean_block_length,
            rel_tol=1e-12,
            abs_tol=1e-12,
        ):
            raise ValidationError(
                "restart_probability and mean_block_length describe different bootstraps"
            )

        base = Scenario.from_mapping(raw)
        values = asdict(base)
        values["restart_probability"] = restart_probability
        return cls(**values).normalized()


def load_historical_data(
    path: str | Path = DATASET_PATH,
    *,
    expected_sha256: str = DATASET_SHA256,
) -> HistoricalDataset:
    """Read and rigorously validate the pinned 1928--2018 return history."""

    source_path = Path(path)
    try:
        raw = source_path.read_bytes()
    except OSError as error:
        raise ValidationError(f"could not read Model B dataset: {error}") from error

    digest = hashlib.sha256(raw).hexdigest()
    if digest != expected_sha256:
        raise ValidationError(
            f"Model B dataset SHA-256 mismatch: expected {expected_sha256}, got {digest}"
        )

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValidationError("Model B dataset must be UTF-8 CSV") from error

    reader = csv.DictReader(io.StringIO(text, newline=""))
    if tuple(reader.fieldnames or ()) != DATASET_COLUMNS:
        raise ValidationError(
            "Model B dataset columns must be: " + ", ".join(DATASET_COLUMNS)
        )

    rows: list[HistoricalReturn] = []
    try:
        for record in reader:
            if None in record or any(value is None or value.strip() == "" for value in record.values()):
                raise ValidationError("Model B dataset contains a missing or extra value")
            year_text = record["year"].strip()
            year = int(year_text)
            if str(year) != year_text:
                raise ValidationError(f"invalid year value: {year_text}")
            row = HistoricalReturn(
                year=year,
                stock_return=float(record["sp500_total_return"]),
                tbill_return=float(record["tbill_3m"]),
                bond_return=float(record["tbond_10y_total_return"]),
            )
            returns = (row.stock_return, row.tbill_return, row.bond_return)
            if not all(math.isfinite(value) for value in returns):
                raise ValidationError(f"non-finite return in year {year}")
            if any(value <= -1.0 for value in returns):
                raise ValidationError(f"return must be greater than -100% in year {year}")
            rows.append(row)
    except (KeyError, TypeError, ValueError) as error:
        raise ValidationError(f"invalid Model B dataset value: {error}") from error

    years = [row.year for row in rows]
    expected_years = list(range(FIRST_YEAR, LAST_YEAR + 1))
    if len(rows) != EXPECTED_ROWS:
        raise ValidationError(
            f"Model B dataset must contain exactly {EXPECTED_ROWS} rows; found {len(rows)}"
        )
    if len(set(years)) != len(years):
        raise ValidationError("Model B dataset contains duplicate years")
    if years != expected_years:
        raise ValidationError(
            f"Model B dataset must contain consecutive ordered years {FIRST_YEAR}--{LAST_YEAR}"
        )

    return HistoricalDataset(tuple(rows), digest, DATASET_RELATIVE_PATH)


def _mean(values: Sequence[float]) -> float:
    return math.fsum(values) / len(values)


def _sample_standard_deviation(values: Sequence[float]) -> float:
    center = _mean(values)
    return math.sqrt(math.fsum((value - center) ** 2 for value in values) / (len(values) - 1))


def _correlation(left: Sequence[float], right: Sequence[float]) -> float:
    left_mean = _mean(left)
    right_mean = _mean(right)
    numerator = math.fsum(
        (x - left_mean) * (y - right_mean) for x, y in zip(left, right, strict=True)
    )
    denominator = math.sqrt(
        math.fsum((x - left_mean) ** 2 for x in left)
        * math.fsum((y - right_mean) ** 2 for y in right)
    )
    return numerator / denominator


def historical_statistics(dataset: HistoricalDataset | None = None) -> dict[str, float]:
    """Return the report's historical parameter estimates from the pinned data."""

    data = load_historical_data() if dataset is None else dataset
    stocks = [row.stock_return for row in data.rows]
    bonds = [row.bond_return for row in data.rows]
    tbills = [row.tbill_return for row in data.rows]
    stock_logs = [math.log1p(value) for value in stocks]
    bond_logs = [math.log1p(value) for value in bonds]
    stock_log_mean = _mean(stock_logs)
    bond_log_mean = _mean(bond_logs)
    stock_log_volatility = _sample_standard_deviation(stock_logs)
    bond_log_volatility = _sample_standard_deviation(bond_logs)

    centered = [value - stock_log_mean for value in stock_logs]
    second_moment = _mean([value**2 for value in centered])
    third_moment = _mean([value**3 for value in centered])
    fourth_moment = _mean([value**4 for value in centered])

    return {
        "risk_free_rate": _mean(tbills),
        "equity_arithmetic_mean": _mean(stocks),
        "bond_arithmetic_mean": _mean(bonds),
        "equity_log_return_mean": stock_log_mean,
        "equity_log_return_volatility": stock_log_volatility,
        "equity_gbm_drift": stock_log_mean + 0.5 * stock_log_volatility**2,
        "bond_log_return_mean": bond_log_mean,
        "bond_log_return_volatility": bond_log_volatility,
        "bond_gbm_drift": bond_log_mean + 0.5 * bond_log_volatility**2,
        "equity_bond_log_correlation": _correlation(stock_logs, bond_logs),
        "equity_log_skewness": third_moment / second_moment**1.5,
        "equity_log_excess_kurtosis": fourth_moment / second_moment**2 - 3.0,
    }


def empirical_risk_neutral_shift(dataset: HistoricalDataset | None = None) -> float:
    """Mean-shift log gross stock returns so E_Q[1 + R_s] equals exp(r)."""

    data = load_historical_data() if dataset is None else dataset
    mean_stock_gross = _mean([1.0 + row.stock_return for row in data.rows])
    return data.risk_free_rate - math.log(mean_stock_gross)


def empirical_put_premium(
    moneyness: float = 0.90,
    dataset: HistoricalDataset | None = None,
) -> float:
    """Price the one-year put from the risk-neutralized empirical distribution."""

    if isinstance(moneyness, bool) or not isinstance(moneyness, (int, float)):
        raise ValidationError("put_moneyness must be a number")
    if not math.isfinite(moneyness) or moneyness <= 0.0:
        raise ValidationError("put_moneyness must be greater than zero")
    data = load_historical_data() if dataset is None else dataset
    shift = empirical_risk_neutral_shift(data)
    payoffs = [
        max(moneyness - math.exp(math.log1p(row.stock_return) + shift), 0.0)
        for row in data.rows
    ]
    return math.exp(-data.risk_free_rate) * _mean(payoffs)


def stationary_bootstrap_indices(
    rng: random.Random,
    horizon: int,
    population_size: int = EXPECTED_ROWS,
    restart_probability: float = 0.25,
) -> Iterator[int]:
    """Yield one stationary-bootstrap index path with continuation and wraparound."""

    if isinstance(horizon, bool) or not isinstance(horizon, int) or horizon < 0:
        raise ValidationError("horizon must be a non-negative integer")
    if isinstance(population_size, bool) or not isinstance(population_size, int) or population_size < 1:
        raise ValidationError("population_size must be a positive integer")
    if (
        isinstance(restart_probability, bool)
        or not isinstance(restart_probability, (int, float))
        or not math.isfinite(restart_probability)
        or not 0.0 < restart_probability <= 1.0
    ):
        raise ValidationError("restart_probability must be greater than zero and at most one")
    if horizon == 0:
        return

    index = rng.randrange(population_size)
    yield index
    for _ in range(1, horizon):
        if rng.random() < restart_probability:
            index = rng.randrange(population_size)
        else:
            index = (index + 1) % population_size
        yield index


def sample_stationary_path(
    rng: random.Random,
    horizon: int,
    dataset: HistoricalDataset | None = None,
    restart_probability: float = 0.25,
) -> tuple[HistoricalReturn, ...]:
    """Return paired stock/bond rows for a testable stationary-bootstrap path."""

    data = load_historical_data() if dataset is None else dataset
    return tuple(
        data.rows[index]
        for index in stationary_bootstrap_indices(
            rng, horizon, len(data.rows), restart_probability
        )
    )


def _coerce_scenario(
    scenario: ModelBScenario | Scenario | Mapping[str, Any] | None,
) -> ModelBScenario:
    if scenario is None or isinstance(scenario, Mapping):
        return ModelBScenario.from_mapping(scenario)
    if isinstance(scenario, ModelBScenario):
        return scenario.normalized()
    if isinstance(scenario, Scenario):
        values = asdict(scenario.normalized())
        values["restart_probability"] = 0.25
        return ModelBScenario(**values).normalized()
    raise ValidationError("scenario must be a Scenario, ModelBScenario, or mapping")


def simulate_model_b(
    scenario: ModelBScenario | Scenario | Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Run all five strategies on shared seeded stationary-bootstrap paths."""

    config = _coerce_scenario(scenario)
    dataset = load_historical_data()
    data_statistics = historical_statistics(dataset)
    started = time.perf_counter()

    horizon = config.horizon
    protected_years = config.resolved_protected_years
    protection_start = horizon - protected_years
    premium = empirical_put_premium(config.put_moneyness, dataset)
    risk_neutral_shift = empirical_risk_neutral_shift(dataset)
    floor_return = config.put_moneyness - 1.0
    glide_weights = [
        glide_equity_weight(config.current_age + year) for year in range(horizon)
    ]

    terminal = {key: array("d") for key in STRATEGY_NAMES}
    fan_count = min(config.paths, config.fan_sample_size)
    fan_samples = [array("d") for _ in range(horizon + 1)]
    fan_samples[0].extend([config.initial_wealth] * fan_count)

    rng = random.Random(config.seed)
    contribution = config.annual_contribution
    initial_wealth = config.initial_wealth
    selected_fan_strategy = config.fan_chart_strategy
    rows = dataset.rows

    for path_index in range(config.paths):
        wealth_s1 = initial_wealth
        wealth_s2 = initial_wealth
        wealth_s3 = initial_wealth
        wealth_s4 = initial_wealth
        wealth_s5 = initial_wealth

        indices = stationary_bootstrap_indices(
            rng,
            horizon,
            len(rows),
            config.restart_probability,
        )
        for year, historical_index in enumerate(indices):
            observation = rows[historical_index]
            equity_return = observation.stock_return
            bond_return = observation.bond_return

            gross_s1 = 1.0 + 0.8 * equity_return + 0.2 * bond_return
            gross_s2 = 1.0 + 0.6 * equity_return + 0.4 * bond_return
            gross_s3 = 1.0 + 0.4 * equity_return + 0.6 * bond_return
            glide_weight = glide_weights[year]
            gross_s4 = 1.0 + glide_weight * equity_return + (1.0 - glide_weight) * bond_return
            if year >= protection_start:
                protected_equity_return = max(equity_return, floor_return) - premium
                gross_s5 = 1.0 + 0.8 * protected_equity_return + 0.2 * bond_return
            else:
                gross_s5 = gross_s1

            wealth_s1 = wealth_s1 * gross_s1 + contribution
            wealth_s2 = wealth_s2 * gross_s2 + contribution
            wealth_s3 = wealth_s3 * gross_s3 + contribution
            wealth_s4 = wealth_s4 * gross_s4 + contribution
            wealth_s5 = wealth_s5 * gross_s5 + contribution

            if path_index < fan_count:
                selected_wealth = {
                    "s1": wealth_s1,
                    "s2": wealth_s2,
                    "s3": wealth_s3,
                    "s4": wealth_s4,
                    "s5": wealth_s5,
                }[selected_fan_strategy]
                fan_samples[year + 1].append(selected_wealth)

        terminal["s1"].append(wealth_s1)
        terminal["s2"].append(wealth_s2)
        terminal["s3"].append(wealth_s3)
        terminal["s4"].append(wealth_s4)
        terminal["s5"].append(wealth_s5)

    strategies = [
        {
            "key": key,
            "name": name,
            **_metrics(terminal[key], config.target_wealth),
        }
        for key, name in STRATEGY_NAMES.items()
    ]

    runtime_ms = (time.perf_counter() - started) * 1_000.0
    scenario_metadata = asdict(config)
    scenario_metadata["horizon"] = horizon
    # Avoid implying that inherited Model A calibration fields are live Model B
    # inputs. The empirical market parameters are reported separately below.
    for field_name in MODEL_A_ONLY_CANONICAL_FIELDS:
        scenario_metadata.pop(field_name, None)
    provenance = {
        "path": dataset.path,
        "sha256": dataset.sha256,
        "rows": len(dataset.rows),
        "first_year": dataset.rows[0].year,
        "last_year": dataset.rows[-1].year,
        "source_url": DATASET_SOURCE_URL,
        "columns": list(DATASET_COLUMNS),
    }
    return {
        "metadata": {
            "model": "model_b",
            "seed": config.seed,
            "paths": config.paths,
            "horizon": horizon,
            "runtime_ms": runtime_ms,
            "put_premium": premium,
            "protected_years": protected_years,
            "random_generator": "python_random_mt19937",
            "common_random_numbers": True,
            "bootstrap_method": "stationary_paired_block_bootstrap",
            "restart_probability": config.restart_probability,
            "mean_block_length": config.mean_block_length,
            "risk_free_rate": dataset.risk_free_rate,
            "risk_neutral_log_gross_shift": risk_neutral_shift,
            "dataset_sha256": dataset.sha256,
            "dataset_rows": len(dataset.rows),
            "dataset_start_year": dataset.rows[0].year,
            "dataset_end_year": dataset.rows[-1].year,
            "dataset": provenance,
            "historical_statistics": data_statistics,
            "fan_chart_strategy": selected_fan_strategy,
            "fan_chart_sample_size": fan_count,
            "fan_chart_is_sampled": fan_count < config.paths,
            "scenario": scenario_metadata,
        },
        "strategies": strategies,
        "allocation_paths": _allocation_paths(config),
        "fan_chart": _fan_chart(fan_samples),
    }


__all__ = [
    "DATASET_PATH",
    "DATASET_SHA256",
    "HistoricalDataset",
    "HistoricalReturn",
    "ModelBScenario",
    "empirical_put_premium",
    "empirical_risk_neutral_shift",
    "historical_statistics",
    "load_historical_data",
    "sample_stationary_path",
    "simulate_model_b",
    "stationary_bootstrap_indices",
]
