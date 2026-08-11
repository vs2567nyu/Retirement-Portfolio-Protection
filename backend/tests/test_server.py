from __future__ import annotations

import json
import os
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from backend.server import (
    PRODUCTION_ORIGIN_ENV,
    SimulationHandler,
    ThreadingHTTPServer,
)


class ServerDeploymentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), SimulationHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def _request(
        self,
        path: str,
        *,
        method: str = "GET",
        origin: str | None = None,
        payload: dict | None = None,
    ):
        headers = {"Origin": origin} if origin else {}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(
            f"{self.base_url}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        return urlopen(request, timeout=5)

    def test_github_pages_origin_is_allowed(self) -> None:
        with patch.object(SimulationHandler, "log_message"):
            with self._request(
                "/api/health",
                origin="https://vs2567nyu.github.io",
            ) as response:
                payload = json.loads(response.read())

        self.assertEqual(response.status, 200)
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(
            response.headers["Access-Control-Allow-Origin"],
            "https://vs2567nyu.github.io",
        )

    def test_lookalike_origin_is_not_allowed(self) -> None:
        with patch.object(SimulationHandler, "log_message"):
            with self._request(
                "/api/health",
                origin="https://vs2567nyu.github.io.attacker.example",
            ) as response:
                response.read()

        self.assertIsNone(response.headers["Access-Control-Allow-Origin"])

    def test_exact_configured_production_origin_is_allowed(self) -> None:
        with patch.dict(
            os.environ,
            {PRODUCTION_ORIGIN_ENV: "https://presentation.example/"},
        ):
            with patch.object(SimulationHandler, "log_message"):
                with self._request(
                    "/api/health",
                    origin="https://presentation.example",
                ) as response:
                    response.read()

        self.assertEqual(
            response.headers["Access-Control-Allow-Origin"],
            "https://presentation.example",
        )

    def test_configured_origin_with_a_path_is_rejected(self) -> None:
        with patch.dict(
            os.environ,
            {PRODUCTION_ORIGIN_ENV: "https://presentation.example/not-an-origin"},
        ):
            with patch.object(SimulationHandler, "log_message"):
                with self._request(
                    "/api/health",
                    origin="https://presentation.example",
                ) as response:
                    response.read()

        self.assertIsNone(response.headers["Access-Control-Allow-Origin"])

    def test_preflight_allows_head_for_github_pages(self) -> None:
        with patch.object(SimulationHandler, "log_message"):
            with self._request(
                "/api/simulate",
                method="OPTIONS",
                origin="https://vs2567nyu.github.io",
            ) as response:
                response.read()

        self.assertEqual(response.status, 204)
        self.assertEqual(
            response.headers["Access-Control-Allow-Methods"],
            "GET, HEAD, POST, OPTIONS",
        )

    def test_head_health_returns_headers_without_a_body(self) -> None:
        with patch.object(SimulationHandler, "log_message"):
            with self._request("/api/health", method="HEAD") as response:
                body = response.read()

        self.assertEqual(response.status, 200)
        self.assertEqual(body, b"")
        self.assertGreater(int(response.headers["Content-Length"]), 0)

    def test_head_unknown_route_is_404_instead_of_501(self) -> None:
        with patch.object(SimulationHandler, "log_message"):
            with self.assertRaises(HTTPError) as raised:
                self._request("/", method="HEAD")

        self.assertEqual(raised.exception.code, 404)

    def test_direct_payload_rejects_oversized_model_a_before_dispatch(self) -> None:
        with patch("backend.server.simulate_model_a") as simulate:
            with patch.object(SimulationHandler, "log_message"):
                with self.assertRaises(HTTPError) as raised:
                    self._request(
                        "/api/simulate",
                        method="POST",
                        payload={"model": "model_a", "paths": 100_001},
                    )

        error_payload = json.loads(raised.exception.read())
        self.assertEqual(raised.exception.code, 400)
        self.assertEqual(error_payload["error"]["type"], "validation_error")
        self.assertIn("100,000", error_payload["error"]["message"])
        simulate.assert_not_called()

    def test_wrapped_payload_rejects_oversized_model_b_before_dispatch(self) -> None:
        with patch("backend.server.simulate_model_b") as simulate:
            with patch.object(SimulationHandler, "log_message"):
                with self.assertRaises(HTTPError) as raised:
                    self._request(
                        "/api/simulate",
                        method="POST",
                        payload={
                            "scenario": {
                                "model": "model_b",
                                "paths": 100_001,
                            }
                        },
                    )

        error_payload = json.loads(raised.exception.read())
        self.assertEqual(raised.exception.code, 400)
        self.assertEqual(error_payload["error"]["type"], "validation_error")
        self.assertIn("100,000", error_payload["error"]["message"])
        simulate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
