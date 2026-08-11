"""Canonical, seeded implementation of retirement simulation Model A.

Model A follows the supplied workbook's mechanics:

* correlated Gaussian log returns for equity and bonds;
* lognormal one-year simple returns;
* annual rebalancing and end-of-year contributions;
* five strategies evaluated on exactly the same return paths; and
* a one-year Black--Scholes put renewed during the final ``k`` years.

Only the Python standard library is used.  That keeps this module portable and
also makes the random-number stream explicit (``random.Random`` / MT19937).
"""

from __future__ import annotations

from array import array
from dataclasses import asdict, dataclass, replace
import json
import math
import random
import time
from typing import Any, Mapping, Sequence


class ValidationError(ValueError):
    """Raised when a scenario cannot be simulated safely."""


@dataclass(frozen=True, slots=True)
class Scenario:
    """Inputs for a Model A run, with workbook defaults."""

    current_age: int = 35
    retirement_age: int = 65
    initial_wealth: float = 50_000.0
    annual_contribution: float = 10_000.0
    target_wealth: float = 1_000_000.0
    paths: int = 1_000
    # Reproducible app baseline; the workbook's volatile RAND() has no seed.
    seed: int = 41_001

    # Full-precision estimates behind the rounded values displayed in Table 1.
    # Keeping the engine at full precision reproduces the report's 2.3946%
    # Black-Scholes premium while the interface can still show concise inputs.
    equity_drift: float = 0.10881582243142478
    equity_volatility: float = 0.19053867269583694
    bond_drift: float = 0.04969164137023846
    bond_volatility: float = 0.0712130184392765
    correlation: float = -0.025960613316734417
    risk_free_rate: float = 0.03426263736263736

    put_moneyness: float = 0.90
    protected_years: int | None = None

    fan_chart_strategy: str = "s1"
    fan_sample_size: int = 2_000

    @property
    def horizon(self) -> int:
        return self.retirement_age - self.current_age

    @property
    def resolved_protected_years(self) -> int:
        return self.horizon if self.protected_years is None else self.protected_years

    def normalized(self) -> "Scenario":
        """Return a validated scenario with a concrete protection window."""

        scenario = replace(self, protected_years=self.resolved_protected_years)
        scenario.validate()
        return scenario

    def validate(self) -> None:
        if isinstance(self.current_age, bool) or not isinstance(self.current_age, int):
            raise ValidationError("current_age must be an integer")
        if isinstance(self.retirement_age, bool) or not isinstance(self.retirement_age, int):
            raise ValidationError("retirement_age must be an integer")
        if not 0 <= self.current_age < 120:
            raise ValidationError("current_age must be between 0 and 119")
        if not self.current_age < self.retirement_age <= 120:
            raise ValidationError("retirement_age must be greater than current_age and at most 120")
        if self.horizon > 100:
            raise ValidationError("simulation horizon cannot exceed 100 years")

        if isinstance(self.paths, bool) or not isinstance(self.paths, int):
            raise ValidationError("paths must be an integer")
        if not 1 <= self.paths <= 2_000_000:
            raise ValidationError("paths must be between 1 and 2,000,000")
        if isinstance(self.seed, bool) or not isinstance(self.seed, int):
            raise ValidationError("seed must be an integer")

        for field_name in ("initial_wealth", "annual_contribution", "target_wealth"):
            value = getattr(self, field_name)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                raise ValidationError(f"{field_name} must be a finite number")
            if value < 0:
                raise ValidationError(f"{field_name} cannot be negative")
        if self.target_wealth == 0:
            raise ValidationError("target_wealth must be greater than zero")

        for field_name in (
            "equity_drift",
            "equity_volatility",
            "bond_drift",
            "bond_volatility",
            "correlation",
            "risk_free_rate",
            "put_moneyness",
        ):
            value = getattr(self, field_name)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                raise ValidationError(f"{field_name} must be a finite number")
        if self.equity_volatility <= 0 or self.bond_volatility <= 0:
            raise ValidationError("volatilities must be greater than zero")
        if not -1 <= self.correlation <= 1:
            raise ValidationError("correlation must be between -1 and 1")
        if self.put_moneyness <= 0:
            raise ValidationError("put_moneyness must be greater than zero")

        if isinstance(self.protected_years, bool) or not isinstance(self.protected_years, int):
            raise ValidationError("protected_years must be an integer")
        if not 0 <= self.protected_years <= self.horizon:
            raise ValidationError("protected_years must be between 0 and the simulation horizon")
        if self.fan_chart_strategy not in STRATEGY_NAMES:
            valid = ", ".join(STRATEGY_NAMES)
            raise ValidationError(f"fan_chart_strategy must be one of: {valid}")
        if isinstance(self.fan_sample_size, bool) or not isinstance(self.fan_sample_size, int):
            raise ValidationError("fan_sample_size must be an integer")
        if not 1 <= self.fan_sample_size <= 10_000:
            raise ValidationError("fan_sample_size must be between 1 and 10,000")

    @classmethod
    def from_mapping(cls, payload: Mapping[str, Any] | None) -> "Scenario":
        """Create a scenario from a snake_case API payload.

        A small set of intuitive aliases is accepted so an early frontend can
        migrate without silently changing the financial meaning of an input.
        Unknown fields are rejected to catch presentation-time typos.
        """

        if payload is None:
            return cls().normalized()
        if not isinstance(payload, Mapping):
            raise ValidationError("request body must be a JSON object")

        raw = dict(payload)
        requested_model = raw.pop("model", "model_a")
        if requested_model not in ("model_a", "a", "Model A"):
            raise ValidationError("this endpoint currently supports only model_a")

        aliases = {
            "age": "current_age",
            "starting_age": "current_age",
            "retire_age": "retirement_age",
            "starting_wealth": "initial_wealth",
            "initial_balance": "initial_wealth",
            "contribution": "annual_contribution",
            "target": "target_wealth",
            "n_paths": "paths",
            "simulations": "paths",
            "stock_drift": "equity_drift",
            "equity_mu": "equity_drift",
            "stock_volatility": "equity_volatility",
            "equity_sigma": "equity_volatility",
            "bond_mu": "bond_drift",
            "bond_sigma": "bond_volatility",
            "rho": "correlation",
            "risk_free": "risk_free_rate",
            "strike_ratio": "put_moneyness",
            "k": "protected_years",
            "protection_years": "protected_years",
        }
        canonical: dict[str, Any] = {}
        for key, value in raw.items():
            target = aliases.get(key, key)
            if target in canonical:
                raise ValidationError(f"duplicate values supplied for {target}")
            canonical[target] = value

        allowed = set(cls.__dataclass_fields__)
        unknown = sorted(set(canonical) - allowed)
        if unknown:
            raise ValidationError(f"unsupported scenario field(s): {', '.join(unknown)}")

        integer_fields = {
            "current_age",
            "retirement_age",
            "paths",
            "seed",
            "protected_years",
            "fan_sample_size",
        }
        float_fields = {
            "initial_wealth",
            "annual_contribution",
            "target_wealth",
            "equity_drift",
            "equity_volatility",
            "bond_drift",
            "bond_volatility",
            "correlation",
            "risk_free_rate",
            "put_moneyness",
        }
        for key in integer_fields & canonical.keys():
            value = canonical[key]
            if value is not None:
                if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
                    raise ValidationError(f"{key} must be an integer")
                canonical[key] = int(value)
        for key in float_fields & canonical.keys():
            value = canonical[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValidationError(f"{key} must be a number")
            canonical[key] = float(value)

        return cls(**canonical).normalized()


STRATEGY_NAMES: dict[str, str] = {
    "s1": "80/20",
    "s2": "60/40",
    "s3": "40/60",
    "s4": "Age-based glide path",
    "s5": "80/20 + protective puts",
}


def _normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def black_scholes_put_premium(
    moneyness: float,
    risk_free_rate: float,
    volatility: float,
    years: float = 1.0,
) -> float:
    """Return a European put premium as a fraction of the stock price.

    ``moneyness`` is ``strike / spot``.  The workbook assumes no dividend
    yield and renews a one-year put annually.
    """

    if not all(math.isfinite(v) for v in (moneyness, risk_free_rate, volatility, years)):
        raise ValidationError("put-pricing inputs must be finite")
    if moneyness <= 0 or volatility <= 0 or years <= 0:
        raise ValidationError("moneyness, volatility, and years must be greater than zero")
    root_t = math.sqrt(years)
    d1 = (
        math.log(1.0 / moneyness)
        + (risk_free_rate + 0.5 * volatility * volatility) * years
    ) / (volatility * root_t)
    d2 = d1 - volatility * root_t
    return (
        moneyness * math.exp(-risk_free_rate * years) * _normal_cdf(-d2)
        - _normal_cdf(-d1)
    )


def glide_equity_weight(age: int) -> float:
    """Workbook glide rule: clamp((110 - age) / 100, 20%, 80%)."""

    return min(0.8, max(0.2, (110.0 - age) / 100.0))


def expected_terminal_wealth(scenario: Scenario, equity_weight: float) -> float:
    """Analytic expected wealth for an annually rebalanced static allocation."""

    scenario = scenario.normalized()
    if not 0 <= equity_weight <= 1:
        raise ValidationError("equity_weight must be between 0 and 1")
    expected_gross_return = (
        equity_weight * math.exp(scenario.equity_drift)
        + (1.0 - equity_weight) * math.exp(scenario.bond_drift)
    )
    growth = expected_gross_return**scenario.horizon
    if math.isclose(expected_gross_return, 1.0, rel_tol=0.0, abs_tol=1e-14):
        contribution_value = scenario.annual_contribution * scenario.horizon
    else:
        contribution_value = scenario.annual_contribution * (
            (growth - 1.0) / (expected_gross_return - 1.0)
        )
    return scenario.initial_wealth * growth + contribution_value


def _percentile(sorted_values: Sequence[float], probability: float) -> float:
    """Linear inclusive percentile (equivalent to Excel PERCENTILE.INC)."""

    if not sorted_values:
        raise ValueError("cannot calculate a percentile of an empty sequence")
    if not 0 <= probability <= 1:
        raise ValueError("probability must be between zero and one")
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    index = (len(sorted_values) - 1) * probability
    low = math.floor(index)
    high = math.ceil(index)
    if low == high:
        return float(sorted_values[low])
    fraction = index - low
    return float(sorted_values[low] * (1.0 - fraction) + sorted_values[high] * fraction)


def _metrics(values: array, target: float) -> dict[str, float]:
    ordered = sorted(values)
    count = len(ordered)
    mean = math.fsum(ordered) / count
    shortfall_count = sum(value < target for value in ordered)
    shortfall = shortfall_count / count
    half_width = 1.96 * math.sqrt(shortfall * (1.0 - shortfall) / count)
    tail_count = max(1, math.ceil(0.05 * count))
    return {
        "mean": mean,
        "median": _percentile(ordered, 0.50),
        "shortfall_probability": shortfall,
        "shortfall_ci_low": max(0.0, shortfall - half_width),
        "shortfall_ci_high": min(1.0, shortfall + half_width),
        "q01": _percentile(ordered, 0.01),
        "q05": _percentile(ordered, 0.05),
        "q10": _percentile(ordered, 0.10),
        "q90": _percentile(ordered, 0.90),
        "cvar5": math.fsum(ordered[:tail_count]) / tail_count,
    }


def _allocation_paths(scenario: Scenario) -> list[dict[str, float | int]]:
    rows: list[dict[str, float | int]] = []
    for offset in range(scenario.horizon):
        age = scenario.current_age + offset
        rows.append(
            {
                "year": offset + 1,
                "age": age,
                "s1": 0.8,
                "s2": 0.6,
                "s3": 0.4,
                "s4": glide_equity_weight(age),
                "s5": 0.8,
            }
        )
    return rows


def _fan_chart(sample_by_year: Sequence[array]) -> list[dict[str, float | int]]:
    result: list[dict[str, float | int]] = []
    for year, values in enumerate(sample_by_year):
        ordered = sorted(values)
        result.append(
            {
                "year": year,
                "p10": _percentile(ordered, 0.10),
                "p25": _percentile(ordered, 0.25),
                "p50": _percentile(ordered, 0.50),
                "p75": _percentile(ordered, 0.75),
                "p90": _percentile(ordered, 0.90),
            }
        )
    return result


def simulate_model_a(scenario: Scenario | Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Run all five Model A strategies on shared seeded return paths.

    The returned object is the frontend contract used by ``POST /api/simulate``.
    The fan chart uses a deterministic subset of paths for responsiveness; the
    terminal metrics always use all requested paths.
    """

    if scenario is None or isinstance(scenario, Mapping):
        config = Scenario.from_mapping(scenario)
    elif isinstance(scenario, Scenario):
        config = scenario.normalized()
    else:
        raise ValidationError("scenario must be a Scenario or mapping")

    started = time.perf_counter()
    horizon = config.horizon
    protected_years = config.resolved_protected_years
    protection_start = horizon - protected_years
    premium = black_scholes_put_premium(
        config.put_moneyness,
        config.risk_free_rate,
        config.equity_volatility,
    )
    floor_return = config.put_moneyness - 1.0

    stock_location = config.equity_drift - 0.5 * config.equity_volatility**2
    bond_location = config.bond_drift - 0.5 * config.bond_volatility**2
    correlation_scale = math.sqrt(max(0.0, 1.0 - config.correlation**2))
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
    equity_volatility = config.equity_volatility
    bond_volatility = config.bond_volatility
    correlation = config.correlation
    selected_fan_strategy = config.fan_chart_strategy

    for path_index in range(config.paths):
        wealth_s1 = initial_wealth
        wealth_s2 = initial_wealth
        wealth_s3 = initial_wealth
        wealth_s4 = initial_wealth
        wealth_s5 = initial_wealth

        for year in range(horizon):
            z_equity = rng.gauss(0.0, 1.0)
            z_independent = rng.gauss(0.0, 1.0)
            z_bond = correlation * z_equity + correlation_scale * z_independent
            equity_return = math.exp(stock_location + equity_volatility * z_equity) - 1.0
            bond_return = math.exp(bond_location + bond_volatility * z_bond) - 1.0

            gross_s1 = 1.0 + 0.8 * equity_return + 0.2 * bond_return
            gross_s2 = 1.0 + 0.6 * equity_return + 0.4 * bond_return
            gross_s3 = 1.0 + 0.4 * equity_return + 0.6 * bond_return
            glide_weight = glide_weights[year]
            gross_s4 = 1.0 + glide_weight * equity_return + (1.0 - glide_weight) * bond_return
            if year >= protection_start:
                protected_equity_return = max(equity_return, floor_return) - premium
                gross_s5 = 1.0 + 0.8 * protected_equity_return + 0.2 * bond_return
            else:
                # Reuse the exact S1 gross return so k=0 is bit-for-bit identical.
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

    strategies: list[dict[str, Any]] = []
    for key, name in STRATEGY_NAMES.items():
        strategies.append({"key": key, "name": name, **_metrics(terminal[key], config.target_wealth)})

    runtime_ms = (time.perf_counter() - started) * 1_000.0
    scenario_metadata = asdict(config)
    scenario_metadata["horizon"] = horizon
    return {
        "metadata": {
            "model": "model_a",
            "seed": config.seed,
            "paths": config.paths,
            "horizon": horizon,
            "runtime_ms": runtime_ms,
            "put_premium": premium,
            "protected_years": protected_years,
            "random_generator": "python_random_mt19937",
            "common_random_numbers": True,
            "fan_chart_strategy": selected_fan_strategy,
            "fan_chart_sample_size": fan_count,
            "fan_chart_is_sampled": fan_count < config.paths,
            "scenario": scenario_metadata,
        },
        "strategies": strategies,
        "allocation_paths": _allocation_paths(config),
        "fan_chart": _fan_chart(fan_samples),
    }


def _main() -> None:
    """Run a scenario from an optional inline JSON command-line argument."""

    import argparse

    parser = argparse.ArgumentParser(description="Run the seeded retirement Model A simulation")
    parser.add_argument(
        "scenario",
        nargs="?",
        default="{}",
        help="inline JSON object containing snake_case scenario fields",
    )
    arguments = parser.parse_args()
    try:
        payload = json.loads(arguments.scenario)
        print(json.dumps(simulate_model_a(payload), indent=2))
    except (json.JSONDecodeError, ValidationError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    _main()
