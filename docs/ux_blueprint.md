# Retirement Strategy Lab: UX/Product Blueprint

## Product decision and first slice

Build the first presentation-ready vertical slice as a single **Strategy Lab** screen: a presenter changes the investor or protection assumptions, runs one seeded Monte Carlo simulation, and compares all five strategies on growth and downside. It should work end to end with **Model A · Parametric** before broader experiments are added.

Model B may appear in the model switcher, but it must remain disabled with `Historical data pending verification` until the exact 91-row paired 1928–2018 stock/bond dataset and premium convention are source-locked. Do not simulate Model B from invented or approximate data.

### Audience and job

- **Primary audience:** professor, classmates, and financially literate reviewers who need to understand the result in under a minute, not operate a research terminal.
- **Primary operator:** one presenter on a laptop/projector.
- **Secondary audience:** a reviewer exploring scenarios after the presentation.
- **Decision question:** “For this investor, how do allocation and put protection change expected terminal wealth and downside risk?”
- **First-slice success:** the untouched screen communicates the baseline answer; a user can alter one assumption, rerun, and explain why the result changed without consulting the spreadsheet.

## One-screen hierarchy

Target a 1440×900 laptop/projector viewport with no page scroll in Presenter mode.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Brand + “Retirement Strategy Lab”   Story 4/9   Presenter mode   Methodology │ 64
├───────────────────┬──────────────────────────────────────────────────────────┤
│ SCENARIO          │ Question + generated comparison sentence                │
│ Investor preset   ├──────────────────────────────────────────────────────────┤
│ Ages              │ Mean wealth │ Miss-target chance │ 5th pct │ Worst-5% avg│
│ Wealth/contrib.   ├───────────────────────────────┬──────────────────────────┤
│ Target            │ Terminal wealth range         │ Chance of missing target │
│ Return model      │ by strategy                   │ by strategy + 95% MC CI  │
│ Protection years  │ q5 to median/mean to q90      │                          │
│ Paths + seed      ├───────────────────────────────┴──────────────────────────┤
│ [Run simulation]  │ Focus strategy / comparator / view-data controls         │
├───────────────────┴──────────────────────────────────────────────────────────┤
│ Model · N · seed · common paths · horizon · parameter/data version · runtime│ 36
└──────────────────────────────────────────────────────────────────────────────┘
```

The control rail is 288 px. The result area uses the remaining width. The question/verdict band is concise, the four metric cards form one row, and the charts use a 7/5 column split. “Methodology” opens a drawer; it does not compete with the main story.

## Controls and defaults

### Visible controls

| Control | Type | Default | Allowed behavior |
|---|---|---:|---|
| Investor preset | Select | `Age 35 · Growth stage` | Presets: Age 35 ($50k), Age 50 ($300k), Age 60 ($700k), and Custom. All retire at 65, contribute $10k, and target $1m. |
| Current age | Number + slider | `35` | Integer 18–79; must be below retirement age. |
| Retirement age | Number + slider | `65` | Integer 19–80; horizon is derived and displayed. |
| Starting wealth | Currency input | `$50,000` | $0–$10m; step $10k. |
| Annual contribution | Currency input | `$10,000` | $0–$250k; step $1k; label says `End-of-year contribution`. |
| Retirement target | Currency input | `$1,000,000` | $50k–$20m; step $50k. Recomputes target-based metrics from stored terminal wealth without generating new paths. |
| Return model | Segmented control | `Model A · Parametric` | Second choice: `Model B · Historical blocks`; disabled until the verified dataset is present. |
| Put protection | Number + slider | `Final 20 years` | Integer 0 through the horizon; helper text: `90% strike; annual one-year puts`. |
| Simulation paths | Select | `20,000 · Live` | 5k, 20k, 50k. High-precision 300k–400k runs belong to a later background-run action. |
| Seed | Number input | `41001` | Integer; label this as the app’s reproducible default, not a recovered report seed. |
| Run simulation | Primary button | N/A | Explicit run only. Button changes to progress/cancel while computing. |

Below the charts, two compact selects change presentation without rerunning: **Focus strategy** defaults to `Growth 80/20 + 90% put`; **Compare with** defaults to `Growth 80/20`.

Use these audience-facing strategy names consistently; retain IDs only in tooltips or exports:

1. Growth 80/20 (`S1`)
2. Balanced 60/40 (`S2`)
3. Conservative 40/60 (`S3`)
4. Age-based glide path (`S4`, equity weight = clamp(110 − age, 20%, 80%))
5. Growth 80/20 + 90% put (`S5`)

### Advanced assumptions drawer

Collapsed by default: equity drift `10.88%`, equity volatility `19.05%`, bond drift `4.97%`, bond volatility `7.12%`, stock/bond correlation `−0.026`, risk-free rate `3.43%`, and strike/spot `90%`. Display the resulting Model A premium (`about 2.39%` with source precision) as an output, not an independently editable input. `Common paths across strategies` is on and locked in Presenter mode.

Provide `Reset to report baseline` and `Reset market assumptions` as separate actions so a presenter cannot accidentally erase the investor scenario while adjusting model parameters.

## Result hierarchy and exact language

The result header is a neutral question: **“How does put protection change this investor’s outcome?”** Under it, generate one evidence-bound sentence:

> “In this run, Growth 80/20 + 90% put changed worst-5% average terminal wealth by {signed $delta} and mean terminal wealth by {signed $delta} versus Growth 80/20.”

If a paired difference is smaller than its declared Monte Carlo uncertainty, replace “changed” with **“was statistically indistinguishable at this run size”**. Never call a strategy “optimal” unless an objective is named and the uncertainty/plateau is shown.

### Hero metrics

Each card shows the focus-strategy value, a signed delta versus the selected comparator, and a one-line definition.

1. **Mean terminal wealth**: dollar value; sublabel `Average across simulated paths`.
2. **Chance of missing the $1.0M target**: percentage plus 95% Monte Carlo interval; comparison delta in percentage points.
3. **5th-percentile terminal wealth**: dollar value; tooltip: `Only 5% of simulated outcomes ended below this amount.`
4. **Worst-5% average terminal wealth**: dollar value; tooltip: `Average terminal wealth among the worst 5% of simulated outcomes.`

Do **not** use `5% VaR` anywhere in the interface. In downloads, name the fields `terminal_wealth_p05` and `terminal_wealth_cvar05`; a data dictionary may note that the workbook used “5% VaR” for the former. `Shortfall probability` may appear in methodology, but the main interface says `Chance of missing the target`.

## First-slice charts

### 1. Terminal wealth range by strategy

- **Question:** How do typical and downside outcomes differ across strategies?
- **Form:** horizontal interval plot in fixed S1–S5 semantic order.
- **Encoding:** line from 5th to 90th percentile; filled marker at median; open marker at mean; vertical dark-neutral reference line at the selected target. Start the dollar axis at zero.
- **Labels:** direct strategy names; compact `$0.8M` tick formatting; exact values in tooltip. Subtitle: `Terminal wealth; N={paths}; nominal dollars`.
- **Interaction:** hover/focus reveals q5, median, mean, q90, worst-5% average, and miss-target chance. Clicking a row makes it the focus strategy without rerunning.

### 2. Chance of missing the target by strategy

- **Question:** Which strategy is least likely to finish below the selected target?
- **Form:** horizontal dot-and-whisker plot, fixed S1–S5 order.
- **Encoding:** dot = estimated probability; whisker = 95% Monte Carlo interval; zero-based percentage axis. Set the upper bound to at least 25%, expanding in 5-point increments when needed.
- **Labels:** direct percent beside each dot. Subtitle: `P(terminal wealth < {target}); 95% Monte Carlo interval`.
- **Interaction:** hover/focus repeats numerator (`paths below target`) and denominator (`N`). Changing only the target updates this chart and the target reference line immediately, with a `Recomputed from same paths` chip.

Both charts expose an accessible `View data table` drawer containing strategy, allocation rule, mean, median, q5, q90, worst-5% average, miss-target count, probability, and interval. Chart titles remain descriptive; interpretation stays in the result sentence.

## Interaction and state rules

- Do not reproduce Excel’s volatile `RAND()` behavior. Inputs that alter paths mark results `Inputs changed · Run to update`; old results remain visible but dimmed until the explicit run.
- Target-only changes derive metrics from the stored terminal-wealth paths and do not consume a new seed. Focus/comparator selection is also instant.
- Every run uses the same random draws across all five strategies. A separate `Resample` action generates a new seed and asks for confirmation in Presenter mode.
- While running, show percent progress, elapsed time, and `Cancel`; never freeze the controls without feedback.
- Hover and keyboard focus cross-highlight the same strategy in cards and both charts. Selection persists after pointer exit.
- Disable impossible states inline: `Current age must be below retirement age`; protection years cannot exceed the horizon; correlation must remain −1 to 1.
- Provide stable empty/error states: `No completed run`, `Run cancelled; previous results preserved`, and `Simulation failed; inputs and last valid results preserved`.
- Report benchmark numbers, when added, receive a visible `Published report benchmark` badge and never masquerade as the current live run.

## Run provenance and trust

Keep a persistent footer on screen and include the same fields in every CSV/JSON export:

`Model A · N=20,000 · seed=41001 · common paths on · 30-year horizon · parameters: workbook v4.1/report v3 · run 0.8s · 2:14:08 PM`

For Model B, append: `paired annual returns 1928–2018 · 91 observations · mean block=4.0 · data SHA-256 …`. The methodology drawer gives definitions, premium convention, end-of-year contribution timing, annual rebalancing, and source versions. Always show a compact caveat: **“Educational simulation · nominal dollars · excludes inflation, taxes, fees, withdrawals, and mortality.”**

## Responsive and Presenter behavior

- **≥1200 px:** fixed control rail and single-screen layout above.
- **768–1199 px:** controls move into a left drawer; charts stack; provenance remains sticky.
- **<768 px:** single column, two cards per row then one below 420 px, sticky `Run simulation`, chart rows remain legible without horizontal page scrolling, and the data table is the full-detail fallback.
- **Presenter mode:** optimized for 16:9 at 1280×720 and 1440×900; body type at least 18 px, chart labels at least 15 px, advanced controls hidden, seed locked, baseline reset always visible, tooltips pinned on click, and story navigation supports Left/Right arrow keys.
- Honor `prefers-reduced-motion`; animations are short crossfades/position transitions and never required to understand a change. Full-screen entry must be optional because browser/projector policies vary.

## Color and accessibility

- Light canvas `#F7F8FA`, surface `#FFFFFF`, ink `#172033`, secondary text `#5D6678`, border/grid `#D8DEE8`.
- Comparator/base strategy: blue `#2457D6`; protected focus: orange `#A94F00`; other strategies: neutral `#7B8495`. Use blue/orange only for those stable meanings.
- Never use green/red alone for “better/worse.” Deltas always include `+`/`−`, words such as `higher/lower`, and directional icons. Financial desirability depends on the metric, so color must not imply that a higher value is always good.
- Distinguish mean from median with open versus filled markers; distinguish focus/comparator with marker shape, outline, and direct label as well as color. Charts must remain interpretable in grayscale.
- Meet WCAG 2.2 AA contrast, expose visible 3 px keyboard focus rings, use semantic form labels, announce completed/cancelled runs through an `aria-live` region, and provide 44×44 px minimum touch targets.
- Avoid gradients, decorative chart backgrounds, tiny legends, and unexplained abbreviations. Currency and percent formatting must be consistent across cards, charts, tooltips, and exports.

## Nine-step presentation roadmap

| Story step | Product module | Main evidence/interaction |
|---:|---|---|
| 1 | **Investor & assumptions** | Investor preset, allocation-over-age chart, methodology and parameter estimates. |
| 2 | **Sequence Lab** | Reorder the same returns “bad early” versus “bad late” and animate the wealth-path divergence. |
| 3 | **Return Model Explorer** | Compare Model A with verified Model B: annual-return shape, joint stock/bond crash behavior, and fitted-versus-empirical assumptions. |
| 4 | **Strategy Lab**, first slice | Five-strategy scorecard, terminal-wealth range, miss-target risk, and Model A/Model B switch when verified. |
| 5 | **Protection trade-off** | Put cost/benefit deltas, target sweep, and protection-versus-unprotected comparison. |
| 6 | **Matched-mean test** | Solve the static equity weight that matches protected-strategy mean wealth; show the opposite Model A/Model B downside verdict without overstating precision. |
| 7 | **Timing optimizer** | Sweep final protection years `k`; select objective (miss-target chance, q1/q5, worst-5% average, or CRRA certainty equivalent); show plateaus, not only one winning year. |
| 8 | **Stress Lab** | Equity-weight × k heatmap, block-length sensitivity, historical crisis replay, and parameter/contribution tornado. |
| 9 | **Conditional conclusion** | Model-dependent takeaway, limitations, source/provenance summary, and export of the selected scenario. |

Keep Steps 1–3 explanatory, Steps 4–8 interactive, and Step 9 explicit about what the model does not establish. The same global scenario state, metric definitions, provenance strip, and strategy colors must carry through every module.

## Definition of done for the slice

- The baseline screen answers the decision question before interaction.
- A seeded Model A run updates all strategies, cards, charts, tooltips, table, and provenance from one result payload.
- Target-only recomputation and focus/comparator selection do not rerun paths.
- Values reconcile across cards, charts, accessible table, and export.
- The screen works at 1440×900 and 1280×720 without presentation scrolling or clipped labels.
- Keyboard-only navigation, reduced-motion mode, and a grayscale check pass.
- No UI label calls fifth-percentile wealth “VaR,” and no Model B result appears before its data and pricing method are verified.
