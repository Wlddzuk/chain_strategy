# Spec 5 (final) — Sound identity, voice alerts, plain-language messages, status headlines, scoreboard

## Context for the implementer

Specs 1–4 are verified live: 81/81 tests, alert center logging real events, forming-setups panel, candle countdown, would-have outcome tracking (an XRP SHORT resolved "ENTRY HIT → would have LOST −1.0R" during testing). This final spec makes the tool usable in its real operating mode: **the trader keeps one eye on this app and one eye on another chart, and acts on what the app tells them.** Everything below optimizes for glanceability and hearability by a non-native English speaker.

The three complaints driving this spec, all confirmed:
1. Sounds are anonymous. `trading-alert-runtime.tsx` has exactly TWO tones (urgent 3-note, normal 2-note) shared across 8 alert kinds, one master toggle, no volume, no voice. The trader hears ticking and cannot tell a routine "new signal" from a critical "stop hit" without looking.
2. Messages are analyst-speak. Examples currently shipped: "Target traded before the planned entry was touched", "Price-touch bookkeeping recorded a WIN", "Setup broke its origin zone", "Price is beyond the zone distal line". A trader glancing mid-trade needs action-first plain language.
3. Signal state is not glanceable. A card leads with "Fired 17h ago" (when the setup was born) while the thing that matters — is this waiting / filled / dead RIGHT NOW — is scattered in small text.

Implement in order. Task 1 and 2 are the highest value.

---

## Task 1 — Voice announcements + distinct earcons + sound settings

**File:** `src/components/trading-alert-runtime.tsx`, settings in store + `settings-panel.tsx`.

### 1a. Voice announcements (the flagship fix)
1. New setting `voiceAlertsEnabled` (default ON when alerts are on). Uses the browser's built-in `speechSynthesis` — no dependencies, no network.
2. On each alert (after the earcon), speak a short action-first phrase:
   - NEW_SIGNAL: "New setup. {Long/Short} {coin} {timeframe}."
   - APPROACHING_ENTRY: "Get ready. {coin} is near entry."
   - ENTRY_HIT: "Entry hit. {Long/Short} {coin}."
   - TARGET_HIT: "Target hit. {coin}."
   - STOP_HIT: "Stop hit. {coin}."
   - INVALIDATED (urgent only): "Setup dead. {coin}. Cancel your order."
   - MISSED and BREAK_FORMING: never spoken.
   Coin names spoken as words ("Bitcoin", "Ethereum", "Solana", "Doge", "X R P", "Avax", "Link", "Arb") via a small lookup map, falling back to the ticker.
3. Queue management: if speech is already playing, queue at most ONE more utterance; a new urgent alert (ENTRY_HIT/STOP_HIT/INVALIDATED-urgent) cancels the queue and speaks immediately (`speechSynthesis.cancel()` first). Never let a backlog of speech build up.
4. Respect the same gating as sounds (master alerts toggle, and the audio-unlock gesture is NOT required for speechSynthesis, but keep speech behind `voiceAlertsEnabled`).

### 1b. Distinct earcons per action category
Replace the two-tone system with four earcons, grouped by what the trader must DO (not by alert kind):
- **Info tick** (nothing to do): NEW_SIGNAL, BREAK_FORMING — single short soft tick, low volume.
- **Heads-up** (look at the screen soon): APPROACHING_ENTRY — two ascending notes.
- **Act now** (trade action required): ENTRY_HIT — distinctive three-note rising motif; INVALIDATED-urgent — three-note falling motif.
- **Outcome**: TARGET_HIT — short pleasant resolution (major chord arpeggio up); STOP_HIT — two low descending notes.
Keep everything Web-Audio-oscillator generated (no audio files). Each earcon ≤ 0.5s.

### 1c. Sound settings granularity
In SettingsPanel under "Alerts":
- Master sound toggle (existing), plus a **volume slider** (0–100, default 60) applied as a gain multiplier.
- Three sub-toggles: "Info sounds" (info tick), "Heads-up sounds" (approaching), "Action & outcome sounds" (always recommended on; still toggleable).
- A **"Test" button next to each sub-toggle** that plays that earcon and (if voice is on) a sample spoken phrase — this is how the trader learns which sound means what. This directly fixes "I hear noise but don't know what is going on."

## Task 2 — Plain-language, action-first message rewrite

**File:** `src/lib/alerts/trade-alert-presentation.ts` (single source — toasts, notifications, and alert log all consume it; verify SignalCard/`signal-display.ts` strings too).

Rewrite every body to: **first sentence = what to do; second sentence = why.** Target reading level: simple English, no trading-desk idiom. "Traded" as a verb for price levels, "distal line", and "bookkeeping" must not appear anywhere user-facing.

Replacement copy (use verbatim):
- NEW_SIGNAL: "Nothing to do yet. A new plan was created — it only becomes a trade if price comes back to the entry level."
- APPROACHING_ENTRY: "Get ready. Price is close to the entry level. If you want this trade, place your limit order now."
- ENTRY_HIT: "Price reached the entry level. If you placed the limit order, you should be in the trade now. Check your exchange."
- TARGET_HIT: "Price reached the take-profit level. If you are in this trade, it should have closed in profit."
- STOP_HIT: "Price reached the stop-loss level. If you are in this trade, it should have closed at a loss."
- MISSED: "Skip this one — it is too late. Price reached the target without ever coming back to the entry."
- INVALIDATED: "This setup is dead. If you placed an order for it, cancel that order now."
- BREAK_FORMING: "A setup may be forming. Wait — it is only real if the candle closes beyond the zone."
- Checklist-aware suffix (existing `hasMarkedExchangeOrders`): "You marked orders as placed on the exchange — go cancel them."

Signal-card strings get the same treatment, e.g. the TOUCHED line becomes: "Entry was hit {age} ago and you did not approve this plan. Too late to enter — do not chase it."

**Glossary:** a small "?" button on the signals panel header and in the alert center opens a static popover with one-line plain definitions: Zone, Event (broken zone), Origin (entry zone), Entry / limit order, Stop loss, Take profit, R:R, Missed, Invalidated, "Would have won/lost". ~10 lines, hard-coded, no routing.

## Task 3 — Glanceable status headline on every signal surface

1. Every SignalCard and the plotted-plan ticket lead with ONE full-width status strip (colored background, bold, largest text on the card):
   - PENDING, price far: `⏳ WAITING — price must drop/rise {X}% to enter` (grey/blue)
   - PENDING, within approach threshold: `⚡ GET READY — price near entry` (amber)
   - APPROVED unfilled: `📋 ORDER PLAN ACTIVE — waiting for fill` (blue)
   - TOUCHED: `⚠️ ENTRY HIT {age} ago — you were not in. Do not chase.` (amber)
   - FILLED no outcome: `✅ IN TRADE (planned) — watching stop & target` (green)
   - Outcome WIN/LOSS: `🏁 CLOSED — would have WON/LOST {±X.X}R` (green/red)
2. "Fired {age} ago" demotes to small muted text next to the coin name — it describes the signal's birth, not its state, and it was actively confusing when it led the card.
3. On the chart, next to the yellow trigger dot, render a small age label ("17h") from the existing overlay text system, so the dot self-explains without the footer legend.

## Task 4 — Strategy scoreboard ("can I trust this?")

The app now records outcomes; aggregate them so the trader can watch the tool prove itself before risking money.

1. New compact card above Recent Activity: **"Strategy record"** — computed from signals with outcomes (`WIN`/`LOSS` via FILLED or TOUCHED would-have) plus MISSED counts:
   - Resolved plans: N · Would-have wins: N (X%) · Losses: N · Net R: +X.X · Missed: N
   - Windows: 7d / 30d / all, small toggle.
2. **Low-sample guard (must-have):** below 10 resolved plans, show prominently: "Too little data to judge — let the scanner watch for a few weeks first." Never show a percentage headline with fewer than 5 resolved plans (show counts only).
3. **Persistence beyond the 50-signal cap:** add a compact persisted `outcomeHistory` array ({coin, timeframe, direction, outcome, rMultiple, closedAt}, cap 500, append on outcome/MISSED transitions) so the record survives signal rotation. Scoreboard reads from it.
4. This is bookkeeping of price touches, not real fills — reuse the existing disclaimer line under the card.

## Task 5 — "Now" bar (one-eye cockpit)

A single sticky strip directly under the header, always showing the ONE most important thing, newest state wins:
1. Priority order: unacknowledged ENTRY_HIT ("⚡ ENTRY HIT — LONG BTC @ 63,927 · tap to view") > APPROACHING signal > BREAK FORMING nearest to confirming > nearest forming setup ("Closest setup: XRP 1h supply, price inside zone") > idle ("Nothing to do — next 1h candle closes in 12:03").
2. Click → `focusSignal` / switch to that market. ENTRY_HIT items stay pinned until clicked (acknowledged) or the signal resolves.
3. Own leaf component (MarketStatusCard pattern), fed from store + alert events; no page-root re-renders; countdown ticks locally at 1s.

## Task 6 — Unread-count consistency (small bug)

Observed live: bell badge showed "3 unread" while the log contained 1 entry. Likely `alertsLastSeenAt`/log persistence mismatch (badge counting events not in the persisted log, or counter not reset on hydration). Reproduce, fix, and add a test: badge count must always equal the number of visible log entries newer than `alertsLastSeenAt`.

## Out of scope (unchanged, absolute)

- No exchange connectivity or auto-trading. No strategy-math changes. No new pollers/WebSockets. No per-tick page-root re-renders. Tests/lint/typecheck under Node 22 (`nvm use`).

## Acceptance criteria

1. `npm test`, `npm run lint`, `npx tsc --noEmit` pass under Node 22; new tests for: speech queue behavior (urgent cancels queue), earcon category mapping, copy strings (no banned jargon: "distal", "bookkeeping", "traded" as level-verb), scoreboard math + low-sample guard, outcomeHistory append/cap, unread badge consistency.
2. Settings shows four sound controls with Test buttons; each Test plays a distinct, audibly different earcon; voice toggle speaks a sample phrase.
3. With the tab visible and a simulated ENTRY_HIT: earcon + spoken phrase + toast + Now-bar pin all fire; the Now bar stays pinned until clicked.
4. Every active signal card leads with a colored status strip; no card leads with "Fired X ago".
5. Scoreboard renders from recorded outcomes and refuses to show percentages below 5 resolved plans.
6. The alert bell badge always matches the log's unread rows.
