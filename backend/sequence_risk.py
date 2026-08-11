"""Deterministic sequence-of-returns inputs for the Sequence Lab.

The lab deliberately holds the investment opportunity set fixed.  It uses the
paired stock and bond observations from 1989--2018 in the pinned Model B data,
rebalances to 60% stock / 40% bonds each year, and changes only the order of
those same 30 annual portfolio returns.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
import math
from typing import Any, Literal, Sequence

from .engine import ValidationError
from .model_b import (
    DATASET_COLUMNS,
    DATASET_SOURCE_URL,
    HistoricalDataset,
    load_historical_data,
)


WINDOW_START_YEAR = 1989
WINDOW_END_YEAR = 2018
WINDOW_ROWS = WINDOW_END_YEAR - WINDOW_START_YEAR + 1
STOCK_WEIGHT = 0.60
BOND_WEIGHT = 0.40
DEFAULT_INITIAL_WEALTH = 50_000.0
DEFAULT_ANNUAL_CONTRIBUTION = 10_000.0

SequenceOrder = Literal["historical", "bad-first", "bad-last"]


@dataclass(frozen=True, slots=True)
class SequenceReturn:
    """One paired historical observation and its annually rebalanced return."""

    year: int
    stock_return: float
    bond_return: float
    portfolio_return: float


def load_sequence_returns(
    dataset: HistoricalDataset | None = None,
) -> tuple[SequenceReturn, ...]:
    """Return the validated 1989--2018 paired observations in calendar order."""

    data = load_historical_data() if dataset is None else dataset
    selected = tuple(
        row for row in data.rows if WINDOW_START_YEAR <= row.year <= WINDOW_END_YEAR
    )
    expected_years = list(range(WINDOW_START_YEAR, WINDOW_END_YEAR + 1))
    if [row.year for row in selected] != expected_years:
        raise ValidationError(
            f"sequence-risk source must contain every year {WINDOW_START_YEAR}--{WINDOW_END_YEAR}"
        )

    return tuple(
        SequenceReturn(
            year=row.year,
            stock_return=row.stock_return,
            bond_return=row.bond_return,
            portfolio_return=(
                STOCK_WEIGHT * row.stock_return + BOND_WEIGHT * row.bond_return
            ),
        )
        for row in selected
    )


def order_sequence(
    rows: Sequence[SequenceReturn],
    ordering: SequenceOrder | str,
) -> tuple[SequenceReturn, ...]:
    """Return a new tuple ordered historically, bad-first, or bad-last.

    ``bad-first`` places the lowest 60/40 portfolio returns first;
    ``bad-last`` places the highest returns first, leaving the lowest returns
    at the end.  Calendar year is the deterministic tie-breaker.
    """

    normalized = ordering.strip().lower().replace("_", "-") if isinstance(ordering, str) else ""
    if normalized == "historical":
        key = lambda row: (row.year,)
    elif normalized == "bad-first":
        key = lambda row: (row.portfolio_return, row.year)
    elif normalized == "bad-last":
        key = lambda row: (-row.portfolio_return, row.year)
    else:
        raise ValidationError("ordering must be historical, bad-first, or bad-last")
    return tuple(sorted(rows, key=key))


def wealth_path(
    rows: Sequence[SequenceReturn],
    initial_wealth: float = DEFAULT_INITIAL_WEALTH,
    annual_contribution: float = DEFAULT_ANNUAL_CONTRIBUTION,
) -> tuple[float, ...]:
    """Compound an ordered return sequence with end-of-year contributions.

    The returned tuple includes initial wealth at index zero, followed by one
    wealth value per annual return.  For return ``r_t`` the timing convention
    is ``W_t = W_(t-1) * (1 + r_t) + contribution``.
    """

    for name, value in (
        ("initial_wealth", initial_wealth),
        ("annual_contribution", annual_contribution),
    ):
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
        ):
            raise ValidationError(f"{name} must be a finite number")
        if value < 0:
            raise ValidationError(f"{name} cannot be negative")

    wealth = float(initial_wealth)
    path = [wealth]
    for row in rows:
        portfolio_return = row.portfolio_return
        if not math.isfinite(portfolio_return) or portfolio_return <= -1.0:
            raise ValidationError("portfolio returns must be finite and greater than -100%")
        wealth = wealth * (1.0 + portfolio_return) + float(annual_contribution)
        path.append(wealth)
    return tuple(path)


def build_sequence_risk_payload() -> dict[str, Any]:
    """Build the read-only Sequence Lab API response from the pinned dataset."""

    dataset = load_historical_data()
    rows = load_sequence_returns(dataset)
    return {
        "metadata": {
            "model": "sequence_risk",
            "source_model": "model_b",
            "row_count": len(rows),
            "window_start_year": WINDOW_START_YEAR,
            "window_end_year": WINDOW_END_YEAR,
            "stock_weight": STOCK_WEIGHT,
            "bond_weight": BOND_WEIGHT,
            "rebalancing": "annual",
            "contribution_timing": "end_of_year",
        },
        "provenance": {
            "dataset_path": dataset.path,
            "dataset_sha256": dataset.sha256,
            "dataset_rows": len(dataset.rows),
            "dataset_start_year": dataset.rows[0].year,
            "dataset_end_year": dataset.rows[-1].year,
            "source_url": DATASET_SOURCE_URL,
            "columns": list(DATASET_COLUMNS),
        },
        "rows": [asdict(row) for row in rows],
    }


__all__ = [
    "BOND_WEIGHT",
    "DEFAULT_ANNUAL_CONTRIBUTION",
    "DEFAULT_INITIAL_WEALTH",
    "STOCK_WEIGHT",
    "SequenceReturn",
    "WINDOW_END_YEAR",
    "WINDOW_ROWS",
    "WINDOW_START_YEAR",
    "build_sequence_risk_payload",
    "load_sequence_returns",
    "order_sequence",
    "wealth_path",
]
