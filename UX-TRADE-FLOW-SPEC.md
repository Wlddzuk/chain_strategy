# Spec 4 — Live trading UX: alert center, trade story, setup buildup, copy-to-exchange

## Context for the implementer

Specs 1–3 are verified working (perf, alerts/lifecycle/background scanning, quality gate, RSI pane, Bollinger Bands). This spec fixes how the app FEELS to trade with, based on a live walkthrough on 2026-07-15. The trader's experience today:

- A beep plays while they look at the app and **nothing on screen explains it**. OS notifications are (correctly) suppressed when the tab is visible, and there is no in-app toast or alert history. The sound is currently information-free unless you happen to be staring at the signals panel.
- Signals appear **fully formed, after the fact** ("the yellow dot came an hour ago"). The strategy state already contains forward-looking data — ACTIVE supply/demand zones per market — but none of it is surfaced before a signal fires. The trader wants to see setups *building*.
- When a signal is plotted, the chart shows generic "nearby zones", not THIS trade's zones. Nothing marks which band is the ORIGIN (where the limit order rests) or the EVENT (the break that created the signal). The Chain story — the reason to trust the trade — is invisible.
- A TOUCHED signal ("Entry was hit 16h ago — do not chase") has no Dismiss button and no further lifecycle: it squats in the panel's top slot forever. Live example: XRP SHORT touched 16h ago, still pinned.
- To act on a plan, the trader retypes entry/stop/TP/quantity into the exchange by hand — transcription-error territory.

Reference pattern for Task 1: TradingView's "Alerts log" side panel — a familiar, proven UX for exactly this problem.

Implement in order. Tasks 1–3 are the core value.

---

## Task 1 — In-app alert center (fix the anonymous beeps)

All alerts already flow through a single choke point: `emitTradeAlert` in `src/lib/alerts/trade-alert-events.ts`. Build on that.

1. **Alert log in the store**: keep the last 100 `TradeAlertEvent`s in the Zustand store (`alertLog: TradeAlertEvent[]`, plus `alertsLastSeenAt: number`). Persist only the last 20 and `alertsLastSeenAt`. Capture every emitted alert — simplest is to append to the store inside the same code paths that call `emitTradeAlert`, or have `TradingAlertRuntime` (which already subscribes to the event) dispatch a store action. Either way, both the lifecycle path and the scan path must land in the log.
2. **Bell icon in the header** (next to Settings) with an unread badge = count of log entries newer than `alertsLastSeenAt`. Clicking opens a dropdown/side panel listing alerts newest-first: kind badge (NEW / APPROACHING / ENTRY HIT / MISSED / INVALIDATED), coin + timeframe + direction, price, relative time ("4m ago" — reuse `formatRelativeAge` from `src/lib/ui/signal-display.ts`). Opening the panel sets `alertsLastSeenAt`.
3. **Clicking an alert row** calls the existing `focusSignal(signalId)` store action (switches coin/timeframe, selects, and plots the signal). If the signal no longer exists, disable the row with muted styling.
4. **In-app toasts when the tab IS visible**: for every alert (respecting `alertsEnabled`), show a toast in the top-right of the viewport: kind, coin/direction, one-line body (reuse the notification copy already in `TradingAlertRuntime`). Auto-dismiss after 8s, max 3 stacked (oldest drops), click → `focusSignal` + dismiss. When the tab is hidden, keep current OS-notification behavior and skip toasts. Build the toast host as its own component mounted once in the dashboard — no library, no portal gymnastics; respect the perf architecture (toast state local to the host component, fed by the same event subscription, zero re-renders of the rest of the app).
5. **Outcome alerts (new kinds)**: the lifecycle sets `outcome: WIN/LOSS` on FILLED signals silently. Add `TARGET_HIT` and `STOP_HIT` alert kinds emitted on that transition — these are the most important beeps in the whole app for someone tracking a live plan. Urgent tone for STOP_HIT, normal for TARGET_HIT. Include them in the log, toasts, and notifications.

## Task 2 — The trade's story on the chart (plotted-signal zones)

**Files:** `src/components/chart.tsx`, `src/components/chart-overlay-svg.tsx` (overlay model builder).

1. When a signal is plotted, ALWAYS render that signal's own two zones as bands, **independent of the zones toggle** and independent of the "relevant zones" proximity selection (the origin zone can be far from current price and currently doesn't render at all):
   - `signal.originZone`: brighter fill than normal zones, labeled **"ORIGIN — entry zone"**. The existing yellow ENTRY price line is this zone's proximal line; the band makes the relationship visible.
   - `signal.eventZone`: muted/hatched fill, labeled **"EVENT — broken zone"**.
2. Phase annotation, minimal: the existing dashed trigger line gets a small label **"break confirmed"** near its top. Together with the two labeled bands and the entry line, the Chain sequence (zone → break → origin → limit) reads directly off the chart. Do not add numbered balloons or arrows — keep it clean.
3. Add one legend line to the plotted-setup footer: "EVENT = broken zone that proved momentum · ORIGIN = zone your limit rests in".
4. The generic zones toggle (Layers3 button) behavior is unchanged, but default `showZones` to **true** for new users (store initial state) — a supply/demand tool hiding its zones by default is the wrong default. Existing persisted preference wins.

## Task 3 — Setup buildup: watch panel, break-forming state, candle countdown

This is the trader's main request: see setups BEFORE the signal exists. All data already exists in `strategyStates[coin][timeframe].zones` (status ACTIVE) maintained by background scanning — no new scanning, no strategy changes.

1. **"Forming" watch panel**: a collapsible section in the signals column (below active signals, above Recent Activity) titled "Setups forming". One row per scanned market where an ACTIVE zone lies within 5% of current price: "SOL 1h · DEMAND 74.90–75.20 · price 1.2% above". Sort by proximity ascending; show at most the nearest zone per coin+timeframe; max ~8 rows. Row click: switch to that market with zones shown. Rows re-evaluate on the existing price updates — derive with a memoized selector, not a new poller, and keep it out of the per-tick React path (compute in a small component subscribed to `prices` + `strategyStates`).
2. **Break-forming indicator (provisional, display-only)**: for each watch row, if the CURRENT forming candle trades beyond the zone's distal line right now, the row escalates: badge "BREAK FORMING", text "confirms if the {tf} candle closes beyond {distal} — closes in {mm:ss}". Requirements:
   - This never creates a signal, never marks the zone EVENT, never touches strategy state. It is a live comparison of the latest price/forming candle against zone boundaries, computed at render time.
   - Optional alert kind `BREAK_FORMING` behind a settings toggle, **default OFF** (forming candles cross levels back and forth; this alert is noisy by nature and must be opt-in). At most one alert per zone per candle period.
3. **Candle-close countdown**: in the chart header next to the timeframe badge, show "closes in 23:14" for the selected timeframe (drift-corrected from wall clock, updating once per second inside its own small component — the MarketStatusCard pattern; do NOT put a ticking state on the chart or page root). Tooltip/subtext: "Signals confirm only when the candle closes." This teaches the strategy's rhythm and answers "when should I look".

## Task 4 — Copy-to-exchange (kill retyping errors)

The app stays planning-only; these features only reduce friction in manually mirroring a plan to the exchange.

1. **Copy buttons**: a small copy icon next to Entry, Stop, Target, and quantity values in TradeTicket and SignalCard. Copies the raw number (full precision, no $ or commas — exchange inputs want `63927`, not `$63,927.00`). Brief inline confirmation (icon swap to checkmark, 1.5s).
2. **"Copy plan" button** on TradeTicket: puts a plain-text order summary on the clipboard: direction, coin, entry, stop, target, quantity, notional, R:R — one line per field. For pasting into notes/journal/messages.
3. **Execution checklist on APPROVED plans**: three checkboxes on the ticket — "Limit order placed", "Stop set", "Take-profit set" — stored on the signal (optional `executionChecklist` field), persisted. Purely manual bookkeeping so the trader knows what they've already done on the exchange. When an APPROVED plan with any box checked gets INVALIDATED or MISSED, the alert body must append: "You marked exchange orders as placed — cancel them."

## Task 5 — Resolve the TOUCHED dead-end

**Problem:** `WATCHED_UNFILLED_STATUSES` in `src/store/signal-lifecycle.ts` covers only PENDING/APPROVED. A TOUCHED signal (entry traded, plan not approved) is never watched again, has no outcome, cannot be dismissed (SignalCard hides the Dismiss button for it), and permanently occupies the top of the ranked list.

1. Continue watching TOUCHED signals with the same TP/stop logic used for FILLED: on target → `outcome: 'WIN'`; on stop → `outcome: 'LOSS'` (semantics: "what the plan would have done"; the existing Recent Activity disclaimer already covers this). Once an outcome is set, the signal leaves the active panel and appears in Recent Activity as "ENTRY HIT → would have WON/LOST".
2. Add a Dismiss button to TOUCHED cards (transitions to CANCELLED, existing flow).
3. Auto-archive: a TOUCHED signal with no outcome after 48h moves to Recent Activity as ENTRY HIT (stale). Constant in code, not a setting.

## Out of scope (do not touch)

- No exchange connectivity, order routing, or auto-trading — planning-only stays absolute.
- No changes to zone-marking, Chain-phase, or quality-gate logic in `src/lib/trading/*` (Task 5's lifecycle change lives in `signal-lifecycle.ts`, which is store-layer).
- No new WebSockets or pollers — every new surface derives from data already flowing.
- Do not regress the perf architecture: no per-tick re-renders of the page/chart root; every ticking or per-price-update UI lives in its own leaf component (MarketStatusCard is the template).

## Acceptance criteria

1. `npm test`, `npm run lint`, `npx tsc --noEmit` pass under Node 22. New tests: alert-log capture from both emission paths, TOUCHED→outcome transitions, break-forming boundary logic (forming candle beyond distal vs not), countdown boundary math.
2. With the tab visible, every audible beep has a synchronous visual: a toast appears within the same second, and the bell badge increments. Clicking either lands on the exact signal.
3. Plotting any signal renders its ORIGIN and EVENT bands with labels even when the zones toggle is off and the origin zone is >5% from price.
4. A market whose forming candle is trading beyond an active zone's distal line shows BREAK FORMING with a live countdown; when the candle closes back inside, the badge clears without any alert (default settings).
5. The XRP-style stuck card cannot recur: a TOUCHED signal either resolves to an outcome, is dismissed, or auto-archives at 48h.
6. Copy buttons yield exchange-pasteable raw numbers; the checklist state survives reload; an invalidated plan with checked boxes warns about cancelling exchange orders.
