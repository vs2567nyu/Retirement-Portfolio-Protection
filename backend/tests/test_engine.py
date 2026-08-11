from __future__ import annotations

import math
import unittest

from backend.engine import (
    Scenario,
    black_scholes_put_premium,
    expected_terminal_wealth,
    simulate_model_a,
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


class ModelAEngineTests(unittest.TestCase):
    def test_black_scholes_premium_matches_workbook(self) -> None:
        premium = black_scholes_put_premium(0.90, 0.0343, 0.1905)
        self.assertAlmostEqual(premium, 0.023926640772059915, places=14)
        self.assertAlmostEqual(premium, 0.0239266, places=7)

    def test_default_full_precision_premium_matches_final_report(self) -> None:
        scenario = Scenario().normalized()
        premium = black_scholes_put_premium(
            scenario.put_moneyness,
            scenario.risk_free_rate,
            scenario.equity_volatility,
        )
        self.assertAlmostEqual(premium, 0.023946097429252383, places=14)

    def test_seed_is_deterministic(self) -> None:
        scenario = Scenario(paths=257, seed=19, protected_years=12, fan_sample_size=73)
        first = simulate_model_a(scenario)
        second = simulate_model_a(scenario)

        self.assertEqual(first["strategies"], second["strategies"])
        self.assertEqual(first["allocation_paths"], second["allocation_paths"])
        self.assertEqual(first["fan_chart"], second["fan_chart"])
        first_metadata = {k: v for k, v in first["metadata"].items() if k != "runtime_ms"}
        second_metadata = {k: v for k, v in second["metadata"].items() if k != "runtime_ms"}
        self.assertEqual(first_metadata, second_metadata)

    def test_zero_protected_years_exactly_matches_unprotected_80_20(self) -> None:
        result = simulate_model_a(
            Scenario(paths=901, seed=7, protected_years=0, fan_sample_size=101)
        )
        by_key = {strategy["key"]: strategy for strategy in result["strategies"]}
        for metric in METRIC_KEYS:
            self.assertEqual(by_key["s1"][metric], by_key["s5"][metric], metric)

    def test_dynamic_path_count_and_horizon(self) -> None:
        result = simulate_model_a(
            Scenario(
                current_age=50,
                retirement_age=57,
                paths=137,
                seed=123,
                protected_years=3,
                fan_sample_size=41,
            )
        )
        metadata = result["metadata"]
        self.assertEqual(metadata["paths"], 137)
        self.assertEqual(metadata["horizon"], 7)
        self.assertEqual(metadata["fan_chart_sample_size"], 41)
        self.assertEqual(len(result["allocation_paths"]), 7)
        self.assertEqual(len(result["fan_chart"]), 8)  # year zero plus seven return years
        self.assertEqual(result["allocation_paths"][0]["age"], 50)
        self.assertEqual(result["allocation_paths"][-1]["age"], 56)

    def test_simulated_static_mean_is_close_to_analytic_mean(self) -> None:
        scenario = Scenario(
            current_age=35,
            retirement_age=40,
            paths=30_000,
            seed=2_026_080_7,
            protected_years=0,
            fan_sample_size=100,
        )
        expected = expected_terminal_wealth(scenario, equity_weight=0.8)
        result = simulate_model_a(scenario)
        simulated = result["strategies"][0]["mean"]
        relative_error = abs(simulated - expected) / expected
        self.assertLess(relative_error, 0.015)

    def test_response_contract_contains_finite_metrics(self) -> None:
        result = simulate_model_a({"paths": 53, "seed": 5, "protected_years": 4})
        self.assertEqual(
            set(result), {"metadata", "strategies", "allocation_paths", "fan_chart"}
        )
        expected_metadata = {
            "model",
            "seed",
            "paths",
            "horizon",
            "runtime_ms",
            "put_premium",
        }
        self.assertTrue(expected_metadata.issubset(result["metadata"]))
        self.assertEqual([row["key"] for row in result["strategies"]], ["s1", "s2", "s3", "s4", "s5"])
        for strategy in result["strategies"]:
            for key in METRIC_KEYS:
                self.assertTrue(math.isfinite(strategy[key]), f"{strategy['key']} {key}")

    def test_frontend_payload_aliases_are_accepted(self) -> None:
        result = simulate_model_a(
            {
                "current_age": 35,
                "retirement_age": 65,
                "starting_wealth": 50_000,
                "annual_contribution": 10_000,
                "target_wealth": 1_000_000,
                "paths": 31,
                "seed": 41_065,
                "protection_years": 20,
            }
        )
        self.assertEqual(result["metadata"]["protected_years"], 20)
        self.assertEqual(result["metadata"]["paths"], 31)


if __name__ == "__main__":
    unittest.main()
