# Retirement Protection Lab

The Retirement Protection Lab is the interactive version of the group's
retirement portfolio and insurance project. The final technical authority is
`Retirement_Portfolio_Insurance_Report_Equations.docx`. If an older workbook,
report draft, or interface label differs from that document, the equations,
calibration, assumptions, and terminology in the final equations report
control.

The public site includes three connected experiences:

- **Strategy Lab** compares all five report strategies under Model A or Model B.
- **Scenario Studio** turns participant inputs into a side-by-side Model A and
  Model B demonstration, then supports savings and starting-age what-if runs.
- **Sequence Lab** recreates the report's 1989-2018 sequence-risk example and
  shows how return order relative to recurring contributions changes the result.

## Public architecture

Model A and Model B run inside each visitor's browser in a Web Worker. The
worker keeps the interface responsive while it performs the simulation. No
Python process, localhost API, database, or always-on computer is required for
the public site.

- Model A uses the report's correlated parametric return model and calibrated
  inputs.
- Model B uses a paired stationary block bootstrap, preserving same-year stock
  and bond observations and short historical runs.
- The validated 91-row Damodaran return history from 1928-2018 is pinned in
  `data/damodaran_histretSPX_1928_2018.csv` and bundled into the public build.
- Sequence Lab uses its bundled, fixed 1989-2018 return series and does not
  depend on an external data request.
- Seeded random-number generation keeps repeated runs reproducible.

The Python implementation in `backend/` remains the reference implementation
and validation oracle. Its tests independently check equations, seeded results,
historical-data integrity, and browser-model acceptance values. It is useful
for development and audit work, but public visitors do not connect to it.

## Run locally

For the same browser-based version used by the public site, install Node.js
22.13 or newer, then run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Changes to the application source are reflected
in the local development view. Python is not required for this workflow.

To start the optional Python reference API alongside the site, install Python
3.10 or newer and run:

```bash
npm run dev:all
```

The browser application still performs its simulations in the Web Worker. The
reference API started by `dev:all` is retained for independent checks and
development comparisons.

## Verify

Run the full validation suite before presenting or publishing:

```bash
npm run lint
npm run test:all
```

`test:all` runs the Python model tests, builds the public application, and runs
the browser logic and rendered-interface tests.

## Edit and republish

The public site is generated from this editable project folder. To make a
change:

1. Edit the relevant file under `app/`, `public/`, `data/`, or `backend/`.
2. Review the change locally with `npm run dev`.
3. Run `npm run lint` and `npm run test:all`.
4. Publish a new version to the existing Retirement Protection Lab site.

Republishing updates the public link without requiring a local server to stay
running. Keep the pinned dataset and final-report calibration unchanged unless
the project team intentionally approves and documents a new source.

## Project shape

- `app/components/RetirementLab.tsx`: main Strategy Lab and shared navigation
- `app/components/ScenarioStudio.tsx`: participant scenario and what-if flow
- `app/components/SequenceLab.tsx`: fixed-order sequence-risk demonstration
- `app/components/scenarioStudioLogic.ts`: tested Scenario Studio transforms
- `app/components/sequenceLabLogic.ts`: tested sequence ordering and wealth
  transforms
- `app/lib/browser-simulation/client.ts`: browser-to-worker simulation adapter,
  cancellation, and short-lived result cache
- `app/lib/browser-simulation/simulation.worker.ts`: Web Worker entry point
- `app/lib/browser-simulation/engine.ts`: browser Model A and Model B engine
- `app/lib/browser-simulation/pythonRandom.ts`: seeded Python-compatible random
  number generator
- `app/lib/browser-simulation/historicalData.ts`: bundled and validated Model B
  data
- `app/lib/browser-simulation/sequenceRisk.ts`: bundled Sequence Lab data
- `app/api/health/route.ts`: lightweight hosted-site health response
- `backend/engine.py`: Python Model A reference implementation
- `backend/model_b.py`: Python Model B reference implementation
- `backend/sequence_risk.py`: Python sequence-risk reference calculations
- `backend/server.py`: optional local reference API
- `backend/tests/`: formula, reproducibility, data, and contract tests
- `data/`: pinned historical-return source and provenance notes
- `tests/`: browser logic, rendered interface, and model parity tests
- `public/og.png`: public link-preview image
- `.openai/hosting.json`: public-site hosting configuration

## Privacy

Participant ages, balances, contributions, targets, predictions, and scenario
choices stay in browser memory for the current page session. The lab has no
participant database, login, or form-submission endpoint, and those inputs are
not persisted by the application. Reloading or closing the page clears the
current scenario.

## Scope and limitations

Both models use nominal wealth, annual rebalancing, end-of-year contributions,
and one-year protective puts. They intentionally exclude inflation, taxes,
fees, withdrawals, and mortality, consistent with the final report's scope.
Model A uses IID constant-parameter returns. Both models hold their annual put
premium constant and exclude trading costs and bid-ask spreads.
Model B resamples the fixed 1928-2018 history and cannot represent every future
market regime. Sequence Lab is a deterministic teaching example, not a Model B
bootstrap path or a forecast.

The live interface uses fewer simulation paths than the final report so that
classroom interactions complete quickly. Results can vary with the seed and
path count. The lab is an educational model for the presentation and is not
personal financial advice or a prediction of future returns.
