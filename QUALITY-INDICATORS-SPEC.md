# Spec 3 — Setup quality filters, invalidation alerts, RSI pane, Bollinger Bands

## Context for the implementer

The alerts/lifecycle/background-scanning implementation (EXECUTION-ALERTS-SPEC.md) is verified working: 20/20 tests pass, lint and `tsc --noEmit` clean, 9 live signals across 5 coins observed with correct age labels, fill guidance, and MISSED bookkeeping. This spec fixes the problems found while testing it as a trader, plus adds two chart indicators the trader uses (RSI, Bollinger Bands).

Live evidence from 2026-07-14 19:02 driving the priorities:
- SOL LONG 1h: entry 75.44, stop 75.25 — a 0.25% stop distance, reported as R:R 1:11.8. DOGE 1h reported R:R 1:25.3. These are degenerate setups from razor-thin origin zones; round-trip taker fees on Hyperliquid (~0.07–0.09%) plus slippage consume a third of that stop distance. They currently rank equal to healthy setups and produce $41k–$59k notionals on a $10k account.
- DOGE card showed "ENTRY $0.07 / STOP LOSS $0.07" — indistinguishable levels from 2-decimal formatting.
- An APPROVED signal that dies (price through stop before entry) is INVALIDATED silently — no alert exists, while the trader's manually-placed exchange limit order is still resting.

Implement in the order below.

---

## Task 0 — Pin the runtime (environment hardening)

The repo's tooling (vitest 4, Next 16) requires Node ≥ 20.12, but the machine's default node is 18.20.8 — `npm test` crashes at startup under it (nvm has 22.19.0 available, which works).

1. Add to `package.json`: `"engines": { "node": ">=20.12" }`.
2. Create `.nvmrc` containing `22`.
3. Do not add an `engine-strict` npmrc; the engines field plus nvmrc is enough.

## Task 1 — Setup quality gate (filter degenerate signals)

**Where:** `scanForSignals` in `src/lib/trading/chain-strategy.ts` (candidate construction around lines 196–255) and new settings in `src/store/trading-store.ts`.

1. New settings (persisted, editable in SettingsPanel under a "Setup filters" section):
   - `minStopDistancePercent` — default 0.4 (percent of entry price). Candidate signals whose |entry − stop| / entry × 100 is below this are discarded before they ever become PENDING.
   - `maxRiskRewardRatio` — default 8. A computed R:R above this indicates a degenerate zone, not a great trade; discard the candidate. (Keep the existing `minRiskReward` = 2 floor.)
   - `feePercentPerSide` — default 0.045 (Hyperliquid taker approximation, user-editable).
2. Pass these through `ScanOptions` the same way `minRiskReward` flows today. Filtering happens in the strategy layer so background scans and manual scans behave identically. Add unit tests: a candidate with 0.2% stop distance is rejected; one with R:R 30 is rejected; boundary values pass.
3. **Fee-aware net R:R display** (display only — do not change the strategy's gross R:R math): SignalCard and TradeTicket show, next to the existing R:R, "net ≈ 1:X after fees" where net risk = stop distance + 2×feePercentPerSide and net reward = target distance − 2×feePercentPerSide (as % of entry). If net R:R < 1.5, render it in the warning color.
4. **Notional sanity warning:** in SignalCard and TradeTicket, when `positionDetails.notionalValue > accountEquity × leverage` OR margin > 50% of equity, show a one-line warning ("Position exceeds safe sizing for this account") — do not block, this is planning software.
5. Existing already-generated signals in persisted state are NOT retro-filtered; the gate applies to new candidates only.

## Task 2 — INVALIDATED / CANCEL-YOUR-ORDER alerts

**Problem:** `TradeAlertKind` (`src/lib/alerts/trade-alert-events.ts`) has no INVALIDATED kind. Two code paths silently kill signals:
- Live path: `evaluateSignalLifecycle` (`src/store/signal-lifecycle.ts` lines ~79–82) transitions PENDING/APPROVED → INVALIDATED with no alert.
- Scan path: `scanForSignals` marks PENDING signals INVALIDATED at candle close (chain-strategy.ts lines ~85–99) — these never touch the alert system.

**Requirements:**
1. Add `INVALIDATED` to `TradeAlertKind` with notification copy: title "INVALIDATED — {direction} {coin} {timeframe}", body "Setup broke its origin zone. If you placed an exchange order for this plan, cancel it." Play the urgent tone (same as ENTRY_HIT) **only when the dying signal was APPROVED or TOUCHED or FILLED-without-outcome** — a trader may have real orders/positions. For PENDING signals, keep it silent (title-flash/notification only), matching MISSED behavior.
2. Live path: emit the alert in `evaluateSignalLifecycle` on the INVALIDATED transition.
3. Scan path: `scanForSignals` must report which previously-PENDING/APPROVED signals it invalidated (extend `ScanResult` with `invalidatedSignals: ChainSignal[]`), and `scanMarket` in the store emits the same alert kind for any that were APPROVED. Add tests for both paths.
4. Same treatment for MISSED when the signal was APPROVED (today MISSED is always silent): if status was APPROVED, use the urgent tone and the "cancel your exchange order" body line.

## Task 3 — Adaptive price formatting (sub-dollar coins)

**Problem:** SignalCard, TradeTicket levels, Recent Activity, and notification text format with `maximumFractionDigits: 2`; DOGE (~$0.075) renders entry and stop identically as "$0.07".

1. Create one shared `formatPrice(price)` in `src/lib/ui/` (move/generalize the one inside `chart.tsx`): ≥ $10 → 2 decimals; $0.1–$10 → 4 decimals; < $0.1 → 5 significant digits.
2. Replace every price rendering in SignalCard, TradeTicket, signals panel, Recent Activity, alert notification titles/bodies, and chart footer with the shared formatter. Chart axis formatting stays as lightweight-charts default.
3. Test: DOGE-scale prices (0.07543 vs 0.07481) must render distinguishably everywhere.

## Task 4 — Signal ranking and noise control

**Problem:** 9 concurrent cards ordered by creation time; the closest-to-entry (most actionable) setup can be buried last.

1. Sort the active signals panel by actionability: signals within the approach threshold first, then ascending absolute distance-to-entry; tie-break newest first.
2. Add a small header line on each card group or a badge when |distance| > 3%: de-emphasize the card (reduced opacity) and label "far from entry". Value configurable as `farFromEntryPercent`, default 3.
3. TOUCHED cards always sort to the top with their existing "do not chase" label.
4. No pagination; keep it simple.

## Task 5 — RSI pane (trader-requested)

The strategy already computes RSI(14) for divergence detection (`src/lib/trading/rsi-divergence.ts`). Surface it on the chart so the trader can verify the "RSI DIV" badge visually.

1. Toggleable indicator button "RSI" in the chart top toolbar next to EMA 20/EMA 50, default off, hotkey not required.
2. Render RSI(14) of the displayed candles as a LineSeries in a **separate pane** using lightweight-charts v5's panes API (`chart.addSeries(..., paneIndex)` / panes API in v5.1 — the volume histogram stays in the main pane as today). Pane height ≈ 25% of chart. Reuse `calculateRSI` from rsi-divergence.ts — do not duplicate the math.
3. Draw horizontal guide lines at 30 and 70 (createPriceLine on the RSI series, dashed, muted color).
4. Respect the perf architecture: compute the RSI array only when the toggle is on; on incremental candle updates, recompute only the affected tail (RSI needs the running average — keep the previous averages in a ref, same pattern as the EMA refs).
5. When the plotted signal has `hasRsiDivergence`, and the RSI pane is visible, mark the divergence: the two RSI pivot points connected by a line on the RSI pane, and the two price pivots connected on the main pane. `ChainSignal` does not carry the divergence points — extend the signal with an optional `divergence` field ({ pricePoint1, pricePoint2, rsiPoint1, rsiPoint2 } indices/values as in the existing `RsiDivergence` type) populated at scan time when divergence boosts confidence. Persisting it is fine (small).

## Task 6 — Bollinger Bands overlay (trader-requested)

1. Toggleable indicator button "BB" next to RSI. Default off.
2. Standard Bollinger Bands: 20-period SMA middle band, upper/lower at ±2 standard deviations, computed on closes. Period and multiplier live in code constants (not settings UI) for now.
3. Render as three LineSeries on the MAIN pane (muted single color, middle band dashed, thin 1px lines; no fill area — lightweight-charts has no band fill primitive without custom series, don't build one).
4. Perf: compute only when visible; incremental updates recompute only the last point from the trailing 20-candle window (no full-array recompute per tick).
5. Bollinger values are display-only — they must NOT feed the strategy or signal generation.

## Task 7 (optional, low priority) — near-duplicate setups

Two XRP LONG 1h signals with entries ~0.1% apart were displayed simultaneously (different origin zones, nearly identical trade plans). In `mergeSignals`' open-plan dedupe (`getTradePlanKey`), consider plans identical when entry, stop, and target each match within 0.15% relative tolerance, keeping the newer signal. Add a test. Skip this task if the tolerance risks merging genuinely distinct setups on volatile sub-dollar coins — reviewer's call.

## Out of scope (do not touch)

- No exchange order execution; the app stays planning-only.
- No changes to zone-marking or Chain-phase logic beyond the quality-gate filters in Task 1 and the optional divergence field in Task 5.
- No new WebSockets; polling/scanning architecture stays as is.
- Do not regress the perf architecture: all new indicator computation must be gated on visibility and incremental per tick (the EMA-ref pattern in chart.tsx is the template).

## Acceptance criteria

1. `npm test`, `npm run lint`, `npx tsc --noEmit` pass under Node 22 (`nvm use`). New tests cover: quality-gate rejections, INVALIDATED alert emission on both paths, adaptive formatting, ranking order, RSI incremental correctness (compare against full recompute), Bollinger last-point incremental correctness.
2. No degenerate signal (stop distance < configured minimum, or R:R above the cap) appears after a fresh scan sweep.
3. An APPROVED signal whose stop trades before entry produces an urgent notification telling the trader to cancel their exchange order.
4. DOGE-scale prices are distinguishable on every surface.
5. RSI pane and BB overlay toggle on/off without console errors, survive coin/timeframe switches, and add zero computation while hidden (verify: no RSI/BB code in the per-tick path when toggles are off).
6. Signals panel lists closest-to-entry setups first; TOUCHED on top.
