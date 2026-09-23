# Trade Executability Spec — alerts, signal lifecycle, watchlist scanning

## Why (context for the implementer)

The Chain Strategy enters on a LIMIT order: a signal fires when a zone breaks (at candle close), and the trade fills only when price RETRACES to the origin zone's proximal line (`entryPrice`). The trader does not need to react in seconds — they need to (a) notice the signal soon after it fires, (b) know when price actually reaches the entry, and (c) know when a setup has died. The app currently does none of these.

Live evidence from 2026-07-14: a LONG BTC 1h signal (entry 62,688 / TP 63,780) stayed displayed as an active, sizeable, acceptable setup while the market price ran to 63,796 — ABOVE the take-profit — without ever retracing to entry. The setup was dead but the UI still presented it as tradeable.

Implement the four features below in order. Do NOT add exchange order execution — the app stays planning-only.

---

## Feature 1 — New-signal alert (sound + browser notification + tab flash)

**Integration point:** `scanForSignals` in `src/lib/trading/chain-strategy.ts` already returns `newSignals` in its `ScanResult`, but `runScan` in `src/store/trading-store.ts` (lines 276–312) ignores it. Use `result.newSignals` — do not re-derive "new" by diffing.

**Requirements:**
1. When `runScan` produces one or more `newSignals`, fire an alert event containing coin, timeframe, direction, entryPrice, current distance-to-entry %.
2. Alert channels, all three:
   - **Sound:** a short, distinct audio cue (generate via Web Audio API oscillator — no audio asset files). Two different tones: one for "new signal", a different, more urgent one for Feature 2's "entry touched".
   - **Browser notification** (Notification API): title like "LONG BTC 1h — entry 62,688 (−1.7% away)", shown only when the tab is not focused (`document.visibilityState !== 'visible'`). Clicking the notification focuses the tab.
   - **Tab title flash:** while there are unseen new signals, prefix the document title (e.g. "(1) Chain Trader…"); clear when the tab regains focus.
3. **Settings** (add to `SettingsPanel`, persist in the store's `settings` via the existing `partialize`): master alerts on/off, sound on/off, browser notifications on/off. Notification toggle requests permission on enable and reflects denied state.
4. **Audio unlock constraint:** browsers block audio until a user gesture. Arm the AudioContext on the first click anywhere (one-time listener). If a signal fires before the context is unlocked, still show the notification and title flash; skip only the sound.
5. Never alert for signals restored from persistence or already-pending signals re-emitted by a rescan (`newSignals` semantics already guarantee this — rely on it, and add a store-level guard that the same signal id alerts at most once per session).

## Feature 2 — Entry-touch and setup-death detection (live price watcher)

**Problem:** nothing compares live price to pending signals. The trader never learns when the limit level is hit, and dead setups linger forever.

**Integration point:** live price already flows through `updatePrice` in `src/store/trading-store.ts` on every WebSocket tick for the selected coin, and through `updatePrices` every 15s for all coins (REST mids in `src/app/dashboard/page.tsx`).

**Requirements:**
1. On every price update, evaluate all PENDING and APPROVED signals for that coin (all timeframes):
   - **Approaching:** price within 0.25% of `entryPrice` (threshold configurable in settings) and moving toward it → one-time "approaching entry" alert per signal.
   - **Entry touched:** for LONG, price <= entryPrice; for SHORT, price >= entryPrice. PENDING signals → new status `TOUCHED` (add to the `ChainSignal['status']` union in `src/lib/trading/types.ts`). APPROVED signals → status `FILLED` with a recorded `filledAt` timestamp. Both fire the urgent alert tone + notification "ENTRY HIT — LONG BTC @ 62,688".
   - **Setup death (missed):** price reaches `takeProfit` BEFORE entry was ever touched → status `MISSED` (new status). Remove from the active signals panel; show in Recent Activity. No alert sound needed; a silent notification is fine.
   - **Stop-through:** price crosses `stopLoss` before entry touched → the existing candle-close invalidation will usually catch this, but add the live check too → `INVALIDATED`.
2. FILLED signals continue to be watched: TP reached → record outcome `WIN` with timestamp; stop reached → outcome `LOSS`. Store outcome on the signal (new optional field, e.g. `outcome` + `closedAt`) and show it in Recent Activity with the R multiple achieved. This is bookkeeping of the plan, not exchange state — label it as such in the UI ("based on price touches, not your actual fills").
3. All status transitions must survive reload for decided signals: extend the persistence `partialize` filter (trading-store.ts lines 413–416) to include the new statuses (`TOUCHED`, `MISSED`, FILLED-with-outcome).
4. Status priority map `signalStatusPriority` (trading-store.ts lines 98–104) must be extended for the new statuses so `mergeSignals` keeps the most-progressed one.
5. Update every UI switch on status: SignalCard badge, Recent Activity badge (dashboard page lines 389–392), TradeTicket accepted banner. A TOUCHED signal's card must clearly say the entry already traded ("Entry was hit Xm ago — do not chase") instead of presenting it as fresh.

## Feature 3 — Background watchlist scanning (all coins, not just the one on screen)

**Problem:** `runScan` scans ONLY `selectedCoin` + `selectedTimeframe`, and the auto-scan in `appendCandle` (trading-store.ts lines 216–223) gates on the selection. A signal on any of the other 7 coins is never generated, so alerts alone don't make the watchlist tradeable.

**Requirements:**
1. A background scan loop, independent of what's displayed: for every coin in `availableCoins` and for a configurable set of scan timeframes (default: the currently selected timeframe plus 1h; full set 5m/15m/1h/4h selectable in settings — mind rate limits below):
   - At each candle close for that timeframe (aligned to the timeframe boundary + ~5s grace), fetch the latest ~200-candle snapshot via the existing `getCandleSnapshot` in `src/lib/api/hyperliquid-client.ts` (do NOT open 8 extra WebSockets), fetch 1h HTF candles when scanning 5m/15m (same pattern as `fetchCandles` in dashboard page lines 76–86), and run `scanForSignals` with the stored per-coin/timeframe strategy state.
   - Feed results through the same store path as `runScan` so signals, states, and Feature 1 alerts work identically. Refactor `runScan` into a parameterized `scanMarket(coin, timeframe)` that both the UI button and the background loop call.
2. **Rate limiting:** stagger snapshot fetches (e.g. 300ms apart), never fetch a coin+timeframe more than once per candle close, and pause background scanning while the tab is hidden EXCEPT keep the price watcher (Feature 2) running off the 15s mids poll. On tab refocus, run a catch-up scan sweep.
3. The Trade Signals panel currently filters to the selected coin+timeframe (dashboard page lines 169–174). Add an "All markets" toggle above the panel (default ON once background scanning exists) so signals from other coins are visible; clicking a signal for another coin switches `selectedCoin`/`selectedTimeframe` to plot it.
4. Feature 2's entry watcher must cover background-scanned signals using the 15s `getAllMids` poll (already running) — tighten that poll to 5s when any pending signal is within 0.5% of its entry.

## Feature 4 — Signal age and trigger-marker clarity

1. SignalCard and TradeTicket show relative age: "fired 3m ago / 2h ago", derived from `createdAt`, updating at most once per minute (do not add a per-second re-render).
2. The yellow trigger dot and dashed purple trigger line on the chart get a legend entry or tooltip: the dot marks WHERE the setup triggered (break-candle close time at the entry price). Add a small caption in the plotted-setup footer (chart.tsx lines 1307–1314): "Dot = setup trigger. Entry fills only if price returns to the yellow line."
3. Show on the card whether price is currently ABOVE or BELOW entry and which direction fills it (e.g. "needs −1.7% retrace to fill").

## Explicitly out of scope

- No exchange order placement, no private keys, no auto-trading.
- No changes to the strategy math in `src/lib/trading/*` other than the `ChainSignal` type/status extensions described above.
- Don't replace the REST mids poll with per-coin WebSockets.

## Acceptance criteria

1. `npm run test`, `npm run lint`, `npm run build` pass; existing tests for chain-strategy and risk-calculator untouched and green.
2. With the app open on BTC 1h and a signal generated on any other watchlist coin at its candle close: a sound plays (after first user gesture), a notification appears if the tab is unfocused, the title flashes, and the signal is visible in the All-markets panel.
3. Simulating a price feed where price touches a pending signal's entry: status flips to TOUCHED within one price update, urgent tone plays, card re-labels itself as "entry hit".
4. Simulating price reaching TP without touching entry: signal becomes MISSED, leaves the active panel, appears in Recent Activity. (This is the exact live scenario observed on 2026-07-14.)
5. Alert preferences persist across reload; denying notification permission degrades gracefully to sound + title flash.
6. No regression of the performance work: alerts and watchers must not add per-tick React re-renders (evaluate price-vs-signal checks inside the store/watcher module, not in components).
