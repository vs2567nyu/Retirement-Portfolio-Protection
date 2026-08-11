from __future__ import annotations

import math
import random
import unittest

from backend.engine import ValidationError, glide_equity_weight
from backend.model_b import (
    DATASET_SHA256,
    ModelBScenario,
    empirical_put_premium,
    historical_statistics,
    load_historical_data,
    sample_stationary_path,
    simulate_model_b,
    stationary_bootstrap_indices,
)


METRIC_KEYS = (
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
)


def _exact_markov_expected_means() -> dict[str, float]:
    """Independently integrate wealth over Model B's 91-state Markov chain."""

    dataset = load_historical_data()
    premium = empirical_put_premium(0.90, dataset)
    restart_probability = 0.25
    continuation_probability = 1.0 - restart_probability
    population = len(dataset.rows)
    contribution = 10_000.0
    expected: dict[str, float] = {}

    for strategy in ("s1", "s2", "s3", "s4", "s5"):
        wealth_mass = [50_000.0 / population] * population
        for year in range(30):
            age = 35 + year
            after_return: list[float] = []
            for state, observation in enumerate(dataset.rows):
                stock = observation.stock_return
                bond = observation.bond_return
                if strategy == "s1":
                    weight, stock_for_strategy = 0.8, stock
                elif strategy == "s2":
                    weight, stock_for_strategy = 0.6, stock
                elif strategy == "s3":
                    weight, stock_for_strategy = 0.4, stock
                elif strategy == "s4":
                    weight, stock_for_strategy = glide_equity_weight(age), stock
                else:
                    weight = 0.8
                    stock_for_strategy = max(stock, -0.10) - premium
                gross = 1.0 + weight * stock_for_strategy + (1.0 - weight) * bond
                after_return.append(
                    wealth_mass[state] * gross + contribution / population
                )

            if year == 29:
                expected[strategy] = math.fsum(after_return)
                continue

            restart_mass = restart_probability * math.fsum(after_return) / population
            wealth_mass = [
                restart_mass
                + continuation_probability * after_return[(state - 1) % population]
                for state in range(population)
            ]

    return expected


class _ScriptedRandom:
    """Minimal RNG double exposing the calls made by the sampler."""

    def __init__(self, ranges: list[int], uniforms: list[float]) -> None:
        self.ranges = iter(ranges)
        self.uniforms = iter(uniforms)

    def randrange(self, population_size: int) -> int:
        value = next(self.ranges)
        if not 0 <= value < population_size:
            raise AssertionError("scripted index is outside the population")
        return value

    def random(self) -> float:
        return next(self.uniforms)


class ModelBEngineTests(unittest.TestCase):
    def test_dataset_invariants_and_report_parameters(self) -> None:
        dataset = load_historical_data()
        self.assertEqual(dataset.sha256, DATASET_SHA256)
        self.assertEqual(len(dataset.rows), 91)
        self.assertEqual([row.year for row in dataset.rows], list(range(1928, 2019)))

        stats = historical_statistics(dataset)
        self.assertAlmostEqual(stats["risk_free_rate"], 0.03426263736263736, places=15)
        self.assertAlmostEqual(stats["equity_log_return_mean"], 0.09066332953507913, places=15)
        self.assertAlmostEqual(stats["equity_log_return_volatility"], 0.19053867269583694, places=15)
        self.assertAlmostEqual(stats["equity_gbm_drift"], 0.10881582243142478, places=15)
        self.assertAlmostEqual(stats["bond_log_return_mean"], 0.04715599437262209, places=15)
        self.assertAlmostEqual(stats["bond_log_return_volatility"], 0.07121301843927648, places=15)
        self.assertAlmostEqual(stats["bond_gbm_drift"], 0.04969164137023846, places=15)
        self.assertAlmostEqual(stats["equity_bond_log_correlation"], -0.02596061331673441, places=15)
        self.assertAlmostEqual(stats["equity_log_skewness"], -0.9868500397932867, places=15)
        self.assertAlmostEqual(stats["equity_log_excess_kurtosis"], 1.3157119709915799, places=15)

    def test_empirical_put_premium_matches_report(self) -> None:
        self.assertAlmostEqual(empirical_put_premium(0.90), 0.02564365741407343, places=15)

    def test_stationary_sampler_continuation_restart_and_wrap(self) -> None:
        # Start at the last row; continue twice (wrapping to zero), restart at
        # row four, then continue once.
        rng = _ScriptedRandom(ranges=[90, 4], uniforms=[0.9, 0.9, 0.1, 0.9])
        indices = list(stationary_bootstrap_indices(rng, 5, 91, 0.25))
        self.assertEqual(indices, [90, 0, 1, 4, 5])

        paired_rng = _ScriptedRandom(ranges=[90, 4], uniforms=[0.9, 0.9, 0.1, 0.9])
        paired = sample_stationary_path(paired_rng, 5)
        self.assertEqual([row.year for row in paired], [2018, 1928, 1929, 1932, 1933])
        # A row is atomic: its stock and bond values remain from the same year.
        self.assertEqual(paired[1].stock_return, 0.4381)
        self.assertEqual(paired[1].bond_return, 0.0084)

    def test_seed_is_deterministic(self) -> None:
        scenario = ModelBScenario(
            paths=257,
            seed=19,
            protected_years=12,
            fan_sample_size=73,
        )
        first = simulate_model_b(scenario)
        second = simulate_model_b(scenario)
        self.assertEqual(first["strategies"], second["strategies"])
        self.assertEqual(first["allocation_paths"], second["allocation_paths"])
        self.assertEqual(first["fan_chart"], second["fan_chart"])
        first_metadata = {key: value for key, value in first["metadata"].items() if key != "runtime_ms"}
        second_metadata = {key: value for key, value in second["metadata"].items() if key != "runtime_ms"}
        self.assertEqual(first_metadata, second_metadata)

    def test_zero_protected_years_exactly_matches_unprotected_80_20(self) -> None:
        result = simulate_model_b(
            ModelBScenario(paths=901, seed=7, protected_years=0, fan_sample_size=101)
        )
        by_key = {strategy["key"]: strategy for strategy in result["strategies"]}
        for metric in METRIC_KEYS:
            self.assertEqual(by_key["s1"][metric], by_key["s5"][metric], metric)

    def test_response_contract_and_provenance(self) -> None:
        result = simulate_model_b(
            {
                "model": "Model B",
                "current_age": 50,
                "retirement_age": 57,
                "paths": 137,
                "seed": 123,
                "protection_years": 3,
                "mean_block_length": 4,
                "fan_sample_size": 41,
            }
        )
        self.assertEqual(set(result), {"metadata", "strategies", "allocation_paths", "fan_chart"})
        metadata = result["metadata"]
        self.assertEqual(metadata["model"], "model_b")
        self.assertEqual(metadata["paths"], 137)
        self.assertEqual(metadata["horizon"], 7)
        self.assertEqual(metadata["restart_probability"], 0.25)
        self.assertEqual(metadata["mean_block_length"], 4.0)
        self.assertEqual(metadata["dataset_sha256"], DATASET_SHA256)
        self.assertEqual(metadata["dataset_rows"], 91)
        self.assertEqual((metadata["dataset_start_year"], metadata["dataset_end_year"]), (1928, 2018))
        self.assertEqual(len(result["allocation_paths"]), 7)
        self.assertEqual(len(result["fan_chart"]), 8)
        self.assertEqual([row["key"] for row in result["strategies"]], ["s1", "s2", "s3", "s4", "s5"])
        for strategy in result["strategies"]:
            for key in METRIC_KEYS:
                self.assertTrue(math.isfinite(strategy[key]), f"{strategy['key']} {key}")

    def test_bootstrap_controls_must_be_consistent(self) -> None:
        consistent = ModelBScenario.from_mapping(
            {"restart_probability": 0.125, "mean_block_length": 8}
        )
        self.assertEqual(consistent.restart_probability, 0.125)
        with self.assertRaises(ValidationError):
            ModelBScenario.from_mapping(
                {"restart_probability": 0.25, "mean_block_length": 8}
            )

    def test_model_a_market_parameter_overrides_are_rejected(self) -> None:
        for field_name in (
            "equity_drift",
            "stock_volatility",
            "bond_mu",
            "rho",
            "risk_free_rate",
        ):
            with self.subTest(field_name=field_name):
                with self.assertRaisesRegex(ValidationError, "fixed by the pinned"):
                    ModelBScenario.from_mapping({field_name: 0.123})

        with self.assertRaisesRegex(ValidationError, "unsupported override"):
            ModelBScenario(equity_drift=-5.0).normalized()

    def test_age_35_high_replication_results_are_consistent_with_report(self) -> None:
        # The report used a different/undisclosed seed and 300k--400k paths.
        # These seed-tolerant gates are wider than the report's stated Monte
        # Carlo error but tight enough to catch method, unit, and timing errors.
        result = simulate_model_b(
            ModelBScenario(paths=30_000, seed=2_026_080_7, fan_sample_size=100)
        )
        by_key = {row["key"]: row for row in result["strategies"]}
        table_5 = {
            "s1": (2_503_459, 2_101_333, 0.121, 739_426, 582_112),
            "s2": (1_950_667, 1_739_474, 0.125, 788_278, 654_056),
            "s3": (1_517_264, 1_384_594, 0.176, 788_636, 690_431),
            "s4": (1_912_185, 1_706_671, 0.123, 806_409, 679_165),
            "s5": (2_060_523, 1_831_655, 0.090, 876_419, 743_721),
        }
        for key, (mean, median, shortfall, q05, cvar5) in table_5.items():
            with self.subTest(strategy=key):
                actual = by_key[key]
                self.assertAlmostEqual(actual["mean"], mean, delta=20_000)
                self.assertAlmostEqual(actual["median"], median, delta=20_000)
                self.assertAlmostEqual(actual["shortfall_probability"], shortfall, delta=0.006)
                self.assertAlmostEqual(actual["q05"], q05, delta=12_000)
                self.assertAlmostEqual(actual["cvar5"], cvar5, delta=10_000)

    def test_simulated_means_match_exact_markov_expectations(self) -> None:
        result = simulate_model_b(
            ModelBScenario(paths=30_000, seed=2_026_080_7, fan_sample_size=100)
        )
        by_key = {row["key"]: row for row in result["strategies"]}
        oracle = _exact_markov_expected_means()
        expected_oracle = {
            "s1": 2_502_379.5922355466,
            "s2": 1_949_607.9076056955,
            "s3": 1_516_264.1318035848,
            "s4": 1_910_927.1393258015,
            "s5": 2_060_162.3486923801,
        }
        for key, exact_mean in expected_oracle.items():
            with self.subTest(strategy=key):
                self.assertAlmostEqual(oracle[key], exact_mean, places=7)
                self.assertAlmostEqual(by_key[key]["mean"], oracle[key], delta=15_000)


if __name__ == "__main__":
    unittest.main()
