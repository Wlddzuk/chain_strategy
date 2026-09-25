# Spec 7 — One fact, one voice: consistency fixes from external UX test

## Context for the implementer

An independent UX test (Claude Desktop, live-driving the UI) found that the same fact is expressed with different numbers and different words depending on where the trader looks. Root causes are diagnosed below — fix the causes, not the symptoms. The trader reports "mixed messages" as the #1 remaining problem.

**Known FALSE POSITIVE — do not "fix":** the tester instrumented Web Audio and reported "all earcon notes play at 440 Hz". The earcon patterns in `src/lib/alerts/trade-alert-audio.ts` (EARCON_PATTERNS) are correct and scheduled properly via `oscillator.frequency.setValueAtTime(f, noteStart)`; reading `frequency.value` before the scheduled time returns the 440 default. The sounds are fine. Leave EARCON_PATTERNS and playAlertEarcon untouched.

---

## Task 1 — Single source of truth for distance-to-entry (the % drift)

**Diagnosed:** the status strip computes `|current − entry| / entryPrice` (`src/lib/ui/signal-display.ts:79`), the card body computes `(entry − current) / currentPrice` (`signal-display.ts:153`), and `trade-metrics.ts:68` and `trade-alert-events.ts` have their own variants. With price ~2% from entry this yields the observed 2.13% vs 2.08% on one card.

1. Create ONE exported function (suggest `src/lib/trading/entry-distance.ts`): `getMoveToEntryPercent(currentPrice, entryPrice)` = `((entryPrice − currentPrice) / currentPrice) × 100`. Semantics: "how far price must move from where it is now" — signed (negative = price must drop).
2. Replace EVERY distance-to-entry calculation with it: status strip, card body, "To entry" stat, Now bar, alert events (`distanceToEntryPercent`), approach-threshold checks in `signal-lifecycle.ts`, and fast-poll trigger in `scan-schedule.ts`. Delete the local formulas.
3. Approach-threshold comparisons use `Math.abs()` of the same function so behavior thresholds and displayed numbers can never diverge.
4. Test: for a fixed price/entry pair, the strip, body, and stat strings must contain the identical percentage number (assert string equality of the formatted %).

## Task 2 — Direction clarity: zone type vs trade direction

**Diagnosed:** in the Chain strategy a SUPPLY zone that breaks UPWARD produces a LONG signal — so the UI legitimately shows "LONG AVAX" next to "AVAX SUPPLY zone". Correct logic, unexplained on screen; the tester concluded the app contradicts itself.

1. Forming-setup rows state the consequence, not just the zone: "SUPPLY 6.5776–6.6065 — closes above → LONG signal · closes below = nothing". Exact template: `{ZONE TYPE} {range} — candle close beyond it fires a {LONG/SHORT} signal`. Derive direction with the same rule the strategy uses (supply break → LONG, demand break → SHORT).
2. Add one glossary line: "A zone's name (supply/demand) is not the trade direction. The BREAK of a zone decides the direction."
3. Recent Activity rows already show direction — no change there.

## Task 3 — Kill the stale NEW badge

A card can read "fired 2d ago" while wearing a NEW badge. NEW must mean new: show it only while the signal is less than 60 minutes old (constant in code). After that, no badge — the status strip carries the state.

## Task 4 — Reconcile the Active Signals count

**Diagnosed:** the header KPI counts pending signals across ALL markets/timeframes; the panel (in "This chart" mode) filters to the selected market — tester saw KPI "6" over a panel saying "No active signals".

1. KPI label becomes "Active signals (all markets)" and its number must equal the count the panel shows when "All markets" is on. One shared selector computes it — panel and KPI both consume it.
2. Panel empty state in "This chart" mode must say where the signals are: "No signals for BTC 5m — 6 active in other markets · View all" ("View all" switches the toggle to All markets).

## Task 5 — Now bar: stability and honest references

**Diagnosed:** the bar flip-flopped between "BREAK FORMING — AVAX / LINK / BTC is nearest to confirming" on successive updates, and announced "GET READY — LONG DOGE 15m" when DOGE was invisible in the panel (filtered out).

1. Hysteresis: once an item is shown, hold it ≥ 15 seconds unless a strictly higher-priority item appears (priority order unchanged). For same-priority replacement ("nearest to confirming"), switch only when the challenger is meaningfully closer (≥ 20% relative distance improvement), not on every re-sort.
2. Clicking a Now-bar item that references a signal/zone not currently visible must first switch the panel to "All markets" (and the chart to that market), then focus it. A Now-bar reference the user cannot find on click is forbidden — test this path.

## Task 6 — Sound tests must not speak; sample phrases must say they are samples

**Diagnosed bugs in `src/components/trading-alert-runtime.tsx` `handleAudioTest` (~line 160–175):**
1. After playing a SOUND-mode test earcon, the handler falls through to `speakAlert(...)` — every sound Test button also speaks. Fix: SOUND-mode requests play the earcon and return; only VOICE-mode requests speak.
2. The hardcoded sample "Entry hit. Long Bitcoin." reads as a real (and possibly wrong-direction) alert. Change `VOICE_ALERT_TEST_PHRASE` to "This is a test. Entry hit. Long Bitcoin." — and the Settings caption under the preview button to "Example phrase — not a real signal."
3. Utterance language: `createSpeechQueue` forces `lang = 'en-US'` even when the selected voice is en-GB (tester had Daniel en-GB). Set `utterance.lang` from the resolved voice's `lang` when a voice is assigned; only default to 'en-US' when no voice was resolved.

## Task 7 — One vocabulary for the three prices

Three label sets exist for the same numbers: "Entry/Stop Loss/Take Profit" (card), "Entry/Stop/Target" (ticket), "Entry/limit order · Stop loss · Take profit" (glossary). Standardize on **Entry / Stop / Target** on every card, ticket, chart label, alert body, and the guide; the glossary keeps the long synonyms as explanations ("Target — also called take profit"). Add a test that greps rendered card/ticket output for the banned label variants.

## Task 8 — Open Plan must visibly respond

Clicking "Open Plan" plots the setup and opens the ticket below the fold with zero feedback on the button itself. Fix: on click, (a) smooth-scroll the ticket into view and give it a brief highlight ring (~1.5s), (b) the button becomes "Plan open ✓" (disabled) while the ticket for that signal is open. The four look-alike actions collapse to a clear pair: **Open Plan** (primary; opens ticket + plots) and **Plot on chart** (secondary toggle; unchanged).

## Task 9 — "price 0.0% below" microcopy

When |distance| < 0.05%, forming rows must say "price at zone edge" instead of a signed 0.0%. Inside-zone rows keep "price inside zone".

## Out of scope

EARCON_PATTERNS and playAlertEarcon (see false-positive note). Strategy math. Exchange connectivity. New features of any kind — this spec only makes existing facts agree with each other. Tests/lint/typecheck under Node 22 (`nvm use`).

## Acceptance criteria

1. `npm test`, `npm run lint`, `npx tsc --noEmit` pass under Node 22.
2. For any signal at any price: the status strip, body sentence, and "To entry" stat display the SAME percentage (automated test asserts identical formatted strings).
3. Every forming row states which trade direction a break would create; no NEW badge on signals older than 60 minutes; KPI equals the All-markets panel count; the "View all" empty-state link works.
4. Sound Test buttons are silent in speech; Voice Preview says it is a test; utterance lang matches the chosen voice.
5. The Now bar never announces something that clicking cannot reveal, and holds items ≥ 15s absent a higher-priority interrupt.
6. Only "Entry / Stop / Target" appear as level labels anywhere in the UI.
