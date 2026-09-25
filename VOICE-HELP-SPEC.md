# Spec 6 (final fixes) — Voice quality, in-app help page, quantity rounding

## Context for the implementer

Spec 5 is verified live and complete (152/152 tests; status strips, Now bar, scoreboard with low-sample guard, four earcons with test buttons, volume slider, plain-language copy, glossary all working). Three small items remain from the final review. This is polish — do not refactor anything else.

## Task 1 — Fix the speech voice ("old man" bug)

**Problem:** `createSpeechQueue` in `src/lib/alerts/trade-alert-audio.ts` (lines ~257–261) never sets `utterance.voice`. The browser falls back to the platform default — on macOS a dated voice like Albert/Fred, which the trader describes as "an old man talking". Rate 0.95 makes it worse.

1. **Voice selection logic** in the browser driver (`createBrowserSpeechQueue`):
   - Load voices via `speechSynthesis.getVoices()`; on Chrome the list is empty until the `voiceschanged` event — handle both (load immediately if available, otherwise subscribe once).
   - Preference order when no user choice is stored: exact-name match in this order — "Samantha", "Google US English", "Microsoft Aria Online (Natural) - English (United States)", "Microsoft Jenny Online (Natural) - English (United States)" — then any `en-US` voice whose name contains "Natural", "Premium", or "Enhanced", then any `en-US` voice, then browser default.
   - Set `utterance.rate = 1.0` (up from 0.95). Keep pitch 1.
2. **Voice picker in Settings** (Alerts section): a dropdown of available `en-*` voices (name + language), value persisted as `voiceURI` in settings (`preferredVoiceUri`, default empty = auto preference above). Next to it a **Preview button** that speaks "Entry hit. Long Bitcoin." with the selected voice at the current volume.
3. **Graceful fallback:** if the persisted `voiceURI` no longer exists (OS voice list changed), silently use the auto preference; never crash, never go mute.
4. Tests: preference-order selection against a mocked voice list; fallback when persisted URI missing; rate set to 1.0. Keep the existing queue semantics untouched (urgent-cancels-queue already tested).

## Task 2 — In-app "How to use" page

Content is already written and FINAL — embed it verbatim from `HOW-TO-USE.md` in the repo root. Do not rewrite, shorten, or "improve" the text; it was authored deliberately for a non-native reader.

1. A "How to use" button (book icon) in the header next to the alerts bell opens a full-height modal/drawer rendering the guide.
2. Render the markdown content (compile it to JSX at build time or hardcode the structure — do NOT add a markdown-parsing runtime dependency; hand-translating the .md into a static component is fine and preferred).
3. The table (status strips) must render as a real table; the sound list as a list. Keep the app's existing typography.
4. First-visit nudge: if the user has never opened the guide (persisted flag `hasSeenGuide`), show a small pulsing dot on the book icon until first open. No forced onboarding modal.

## Task 3 — Exchange-realistic quantity rounding

**Problem:** plan quantities print raw floats — live example: "DOGE quantity 189307.173606". Exchanges reject or truncate such precision; copying it is friction.

1. Hyperliquid's `info` API (`type: "meta"`) returns `szDecimals` per asset. Fetch once at startup in `src/lib/api/hyperliquid-client.ts` (same pattern as existing calls), cache in the store as `sizeDecimals: Record<string, number>`, refresh silently on failure with fallback below.
2. Round displayed and copied quantities DOWN (floor, never round up — never suggest a bigger position than the risk math allows) to the asset's `szDecimals`.
3. Fallback when meta is unavailable: qty ≥ 1000 → 0 decimals; ≥ 1 → 2 decimals; < 1 → 4 significant digits.
4. The copy button copies the rounded raw number. Position notional/margin/risk displays stay as-is (dollar values).
5. Tests: rounding is floor-based; fallback tiers; copy output matches display.

## Out of scope

Everything else. No strategy changes, no new alert kinds, no exchange connectivity. Tests/lint/typecheck under Node 22 (`nvm use`).

## Acceptance criteria

1. `npm test`, `npm run lint`, `npx tsc --noEmit` pass under Node 22.
2. On macOS Chrome, with default settings, spoken alerts use Samantha or Google US English — not Albert/Fred. The Settings voice picker lists voices, previews them, persists the choice, and survives the chosen voice disappearing.
3. The header shows a book icon; it opens the guide rendering HOW-TO-USE.md content verbatim, table included; the first-visit dot clears after opening.
4. No plan card or copy buffer ever shows more decimals than the asset's Hyperliquid `szDecimals`; DOGE-sized quantities show whole numbers.
