# Retirement Protection Lab

Interactive presentation model based on `Retirement_Simulation_v4_1.xlsx` and
`Final_Report_CONSOLIDATED_v3.docx`.

The live model includes reproducible implementations of both report engines:
Model A's correlated parametric returns and Model B's paired historical block
bootstrap. Both models run all five workbook strategies through one local JSON
API and one interactive comparison screen.

The separate **Scenario Studio** section turns anonymous classroom inputs into
a guided demonstration. It converts weekly savings to the report's annual
year-end contribution, asks the audience to predict a winner, compares Model A
and Model B with the same assumptions and seed, and offers on-demand “save $25
more per week” and “start five years later” experiments. Participant inputs are
kept in memory only and are not persisted.

The **Sequence Lab** recreates the report's 1989–2018 sequence-risk example as
an audience prediction and reveal. It holds the same 30 annually rebalanced
60/40 returns fixed, compares historical, bad-first, and bad-last orderings,
and lets the class switch year-end contributions off to see terminal wealth
become order-invariant.

Model B uses the validated 91-row 1928–2018 Damodaran stock, T-bill, and
Treasury dataset pinned in `data/`. Its empirical 90% protective-put premium
reproduces the report's 2.5644% result.

## Run locally

Prerequisites: Node.js 22.13+ and Python 3.10+.

```bash
npm install
npm run dev:all
```

Open `http://localhost:3000`. The launcher starts both the Python calculation
engine on port 8000 and the presentation interface on port 3000. Stop both with
`Control-C`.

### One-click presentation launcher on macOS

Double-click `Open Retirement Lab.command` in Finder. It builds the production
site, registers both local services with macOS, verifies that they are healthy,
and opens the lab in the browser. macOS restarts either service if it exits and
starts them again when you log in, so the terminal window can be closed safely.
Double-click `Stop Retirement Lab.command` to stop the lab and disable automatic
startup. Build logs are kept in `.local-runtime/`. The lightweight always-on
copy and service logs are stored under
`~/Library/Application Support/RetirementLab`; the editable project remains in
this folder.

For development in separate terminals:

```bash
python3 -m backend.server --port 8000
npm run dev
```

## Verify

```bash
npm run test:all
```

This runs the deterministic financial-model tests, builds the web application,
and checks the server-rendered presentation shell.

## Project shape

- `backend/engine.py`: seeded Model A simulation and shared metrics
- `backend/model_b.py`: validated historical data, paired stationary bootstrap,
  empirical put pricing, and seeded Model B simulation
- `backend/server.py`: local browser API
- `backend/sequence_risk.py`: pinned 1989–2018 60/40 sequence-risk dataset and
  deterministic wealth-path calculations
- `backend/tests/`: formula, reproducibility, and contract tests
- `data/`: pinned historical-return source and provenance notes
- `app/components/RetirementLab.tsx`: interactive Strategy Lab
- `app/components/ScenarioStudio.tsx`: anonymous classroom interview,
  prediction, dual-model reveal, and what-if experience
- `app/components/scenarioStudioLogic.ts`: tested Scenario Studio payload,
  ranking, conversion, and comparison transformations
- `app/components/SequenceLab.tsx`: audience prediction, sequence comparison,
  contribution toggle, and exact data table
- `app/components/sequenceLabLogic.ts`: validated return ordering and
  deterministic wealth-path transformations
- `app/globals.css`: responsive presentation design
- `docs/ux_blueprint.md`: first-slice interaction and presentation roadmap

## Current scope

Both models use nominal wealth, annual rebalancing, end-of-year contributions,
and one-year protective puts. They intentionally exclude inflation, taxes,
fees, withdrawals, and mortality, matching the supplied project scope. Model B
resamples paired stock/bond years in stationary blocks with a report-default
mean block length of four years.
