"""Minimal local JSON API for the retirement simulation.

Run from the repository root with::

    python3 -m backend.server --port 8000

The implementation uses only the Python standard library because FastAPI is
not installed in the current workspace runtime.  The wire contract is the same
contract a future FastAPI adapter would expose.
"""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from typing import Any

from .engine import ValidationError, simulate_model_a
from .model_b import simulate_model_b
from .sequence_risk import build_sequence_risk_payload


ALLOWED_ORIGINS = {
    "http://localhost:3000",
    "http://127.0.0.1:3000",
}
MAX_REQUEST_BYTES = 1_000_000


class SimulationHandler(BaseHTTPRequestHandler):
    """Serve health checks and seeded Model A / Model B simulations."""

    server_version = "RetirementSimulation/1.0"

    def _cors_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        return origin if origin in ALLOWED_ORIGINS else None

    def _send_json(self, status: HTTPStatus, payload: Any) -> None:
        encoded = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        allowed_origin = self._cors_origin()
        if allowed_origin:
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        origin = self._cors_origin()
        if not origin:
            self._send_json(
                HTTPStatus.FORBIDDEN,
                {"error": {"type": "cors_error", "message": "origin is not allowed"}},
            )
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path.rstrip("/") == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "service": "retirement-simulation",
                    "models": ["model_a", "model_b"],
                },
            )
            return
        if self.path.rstrip("/") == "/api/sequence-risk":
            try:
                result = build_sequence_risk_payload()
            except ValidationError as error:
                self._send_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    {"error": {"type": "data_validation_error", "message": str(error)}},
                )
                return
            self._send_json(HTTPStatus.OK, result)
            return
        self._send_json(
            HTTPStatus.NOT_FOUND,
            {"error": {"type": "not_found", "message": "route not found"}},
        )

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self.path.rstrip("/") != "/api/simulate":
            self._send_json(
                HTTPStatus.NOT_FOUND,
                {"error": {"type": "not_found", "message": "route not found"}},
            )
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = -1
        if content_length < 0 or content_length > MAX_REQUEST_BYTES:
            self._send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": {"type": "request_too_large", "message": "invalid request size"}},
            )
            return

        try:
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body or b"{}")
            # Accept either the direct snake_case contract or {"scenario": {...}}
            # to make browser clients easy to integrate.
            if isinstance(payload, dict) and set(payload) == {"scenario"}:
                payload = payload["scenario"]
            requested_model = payload.get("model", "model_a") if isinstance(payload, dict) else "model_a"
            if requested_model in ("model_a", "a", "Model A"):
                result = simulate_model_a(payload)
            elif requested_model in ("model_b", "b", "Model B"):
                result = simulate_model_b(payload)
            else:
                raise ValidationError("model must be model_a or model_b")
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": {"type": "invalid_json", "message": "body must be valid JSON"}},
            )
            return
        except ValidationError as error:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": {"type": "validation_error", "message": str(error)}},
            )
            return
        except Exception as error:  # pragma: no cover - last-resort API boundary
            self.log_error("simulation failed: %s", error)
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": {"type": "simulation_error", "message": "simulation failed"}},
            )
            return

        self._send_json(HTTPStatus.OK, result)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the local retirement simulation API")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    arguments = parser.parse_args()
    server = ThreadingHTTPServer((arguments.host, arguments.port), SimulationHandler)
    print(f"Retirement simulation API listening on http://{arguments.host}:{arguments.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping API")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
