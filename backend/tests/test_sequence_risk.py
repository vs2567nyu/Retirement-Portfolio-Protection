from __future__ import annotations

import json
import threading
import unittest
from urllib.request import Request, urlopen
from unittest.mock import patch

from backend.engine import ValidationError
from backend.model_b import DATASET_SHA256
from backend.sequence_risk import (
    BOND_WEIGHT,
    DEFAULT_ANNUAL_CONTRIBUTION,
    DEFAULT_INITIAL_WEALTH,
    STOCK_WEIGHT,
    SequenceReturn,
    build_sequence_risk_payload,
    load_sequence_returns,
    order_sequence,
    wealth_path,
)
from backend.server import SimulationHandler, ThreadingHTTPServer


class SequenceRiskTests(unittest.TestCase):
    def test_source_window_is_paired_and_fixed_60_40(self) -> None:
        rows = load_sequence_returns()

        self.assertEqual(len(rows), 30)
        self.assertEqual([row.year for row in rows], list(range(1989, 2019)))
        self.assertEqual((STOCK_WEIGHT, BOND_WEIGHT), (0.60, 0.40))
        for row in rows:
            self.assertAlmostEqual(
                row.portfolio_return,
                0.60 * row.stock_return + 0.40 * row.bond_return,
                places=15,
            )
        self.assertEqual(rows[0].year, 1989)
        self.assertEqual(rows[0].stock_return, 0.3148)
        self.assertEqual(rows[0].bond_return, 0.1769)
        self.assertAlmostEqual(rows[0].portfolio_return, 0.25964, places=15)

    def test_ordering_helpers_are_pure_and_deterministic(self) -> None:
        historical = load_sequence_returns()
        snapshot = tuple(historical)
        bad_first = order_sequence(historical, "bad-first")
        bad_last = order_sequence(historical, "bad_last")

        self.assertEqual(historical, snapshot)
        self.assertEqual(order_sequence(reversed(historical), "historical"), historical)
        self.assertEqual(bad_first[0].year, 2008)
        self.assertEqual(bad_first[-1].year, 1995)
        self.assertEqual(bad_last[0].year, 1995)
        self.assertEqual(bad_last[-1].year, 2008)
        self.assertEqual(
            sorted(row.year for row in bad_first),
            sorted(row.year for row in bad_last),
        )
        with self.assertRaisesRegex(ValidationError, "ordering must be"):
            order_sequence(historical, "random")

    def test_terminal_wealth_matches_sequence_risk_acceptance_values(self) -> None:
        rows = load_sequence_returns()
        expected = {
            "bad-first": 3_671_423.7187,
            "bad-last": 1_328_097.8624,
            "historical": 1_724_679.4704,
        }

        for ordering, expected_terminal in expected.items():
            with self.subTest(ordering=ordering):
                path = wealth_path(
                    order_sequence(rows, ordering),
                    DEFAULT_INITIAL_WEALTH,
                    DEFAULT_ANNUAL_CONTRIBUTION,
                )
                self.assertEqual(len(path), 31)
                self.assertEqual(path[0], DEFAULT_INITIAL_WEALTH)
                self.assertAlmostEqual(path[-1], expected_terminal, places=4)

    def test_without_contributions_terminal_wealth_is_order_invariant(self) -> None:
        rows = load_sequence_returns()
        for ordering in ("historical", "bad-first", "bad-last"):
            with self.subTest(ordering=ordering):
                terminal = wealth_path(
                    order_sequence(rows, ordering),
                    DEFAULT_INITIAL_WEALTH,
                    0.0,
                )[-1]
                self.assertAlmostEqual(terminal, 652_626.4483, places=4)

    def test_wealth_path_applies_contribution_after_the_return(self) -> None:
        one_year = (SequenceReturn(2000, 0.10, 0.10, 0.10),)
        path = wealth_path(one_year, 100.0, 10.0)
        self.assertEqual(path[0], 100.0)
        self.assertAlmostEqual(path[1], 120.0, places=12)

    def test_payload_exposes_metadata_provenance_and_only_source_rows(self) -> None:
        payload = build_sequence_risk_payload()

        self.assertEqual(set(payload), {"metadata", "provenance", "rows"})
        self.assertEqual(payload["metadata"]["model"], "sequence_risk")
        self.assertEqual(payload["metadata"]["source_model"], "model_b")
        self.assertEqual(payload["metadata"]["row_count"], 30)
        self.assertEqual(
            (payload["metadata"]["window_start_year"], payload["metadata"]["window_end_year"]),
            (1989, 2018),
        )
        self.assertEqual(payload["metadata"]["contribution_timing"], "end_of_year")
        self.assertEqual(payload["provenance"]["dataset_sha256"], DATASET_SHA256)
        self.assertEqual(payload["provenance"]["dataset_rows"], 91)
        self.assertEqual(len(payload["rows"]), 30)
        self.assertEqual(
            set(payload["rows"][0]),
            {"year", "stock_return", "bond_return", "portfolio_return"},
        )

    def test_get_endpoint_returns_the_read_only_contract(self) -> None:
        server = ThreadingHTTPServer(("127.0.0.1", 0), SimulationHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            request = Request(
                f"http://127.0.0.1:{server.server_port}/api/sequence-risk",
                headers={"Origin": "http://localhost:3000"},
            )
            with patch.object(SimulationHandler, "log_message"):
                with urlopen(request, timeout=5) as response:
                    payload = json.loads(response.read())
                    self.assertEqual(response.status, 200)
                    self.assertEqual(
                        response.headers["Access-Control-Allow-Origin"],
                        "http://localhost:3000",
                    )
                    self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(payload["metadata"]["row_count"], 30)
            self.assertEqual(len(payload["rows"]), 30)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
