# Retirement simulation backend

This directory contains seeded, standard-library implementations of the
report's Model A and Model B. It requires Python 3.10 or newer and no
third-party package.

## Run the API

From the repository root:

```bash
python3 -m backend.server --port 8000
```

The browser API is:

```text
POST http://127.0.0.1:8000/api/simulate
```

It accepts a direct JSON object with snake_case fields. Omitted fields use the
workbook defaults:

```json
{
  "model": "model_b",
  "current_age": 35,
  "retirement_age": 65,
  "initial_wealth": 50000,
  "annual_contribution": 10000,
  "target_wealth": 1000000,
  "paths": 1000,
  "seed": 41001,
  "protected_years": 30
}
```

Set `model` to `model_a` for correlated parametric lognormal returns or
`model_b` for the paired 1928–2018 stationary historical-block bootstrap.
Model B also accepts `mean_block_length` (default `4`) or the equivalent
`restart_probability` (default `0.25`). Its stock and bond source is validated
against the SHA-256 fingerprint documented in `data/README.md` before a run.

The response contract is:

```text
{
  metadata: {model, seed, paths, horizon, runtime_ms, put_premium,
             bootstrap_method?, dataset_sha256?, ...},
  strategies: [
    {key, name, mean, median, shortfall_probability,
     shortfall_ci_low, shortfall_ci_high, q01, q05, q10, q90, cvar5}
  ],
  allocation_paths: [{year, age, s1, s2, s3, s4, s5}],
  fan_chart: [{year, p10, p25, p50, p75, p90}]
}
```

Only `http://localhost:3000` and `http://127.0.0.1:3000` receive CORS headers.

## Run Model A without HTTP

```bash
python3 -m backend.engine '{"paths": 5000, "seed": 42, "protected_years": 10}'
```

## Test

```bash
python3 -m unittest discover -s backend/tests -v
```

The fan chart is computed from a deterministic sample (2,000 paths by default)
while every terminal statistic uses the full requested path count. Metadata
states the fan-chart strategy and sample size so charts can label this honestly.
Both models use common random numbers across all five strategies, which makes
same-run strategy comparisons materially less noisy.
