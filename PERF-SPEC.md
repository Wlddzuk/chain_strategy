# Performance Fix Spec — chain-trader lag

## Diagnosis (context for the implementer)

The lag is NOT the chart library or data volume (500 candles is trivial). It is **React render amplification**: every WebSocket tick re-renders every component in the app multiple times, every mouse movement over the chart re-renders the entire 1,390-line Chart component, and every store update synchronously writes to localStorage.

Per WebSocket tick today: `appendCandle` (store set) + `updatePrice` (store set) + `setLastLiveUpdate` (React set) = 3 renders of the whole page tree, because every component subscribes to the whole Zustand store. Add a 1-second clock re-rendering the page root, and `setOverlay` re-rendering all of Chart on every crosshair move.

Implement the tasks below **in order**. Task 1 and 2 deliver ~90% of the win.

---

## Task 1 — Replace whole-store Zustand subscriptions with selectors (CRITICAL)

**Problem:** Every component calls `const { ... } = useTradingStore()` with no selector. In Zustand v5, no selector = subscribe to the entire store object, which changes identity on every `set()`. Every tick re-renders: Dashboard, Chart, TradeTicket, SignalCard, CoinSelector, TimeframeToggle, SettingsPanel.

**Files:**
- `src/app/dashboard/page.tsx` (lines 18–36)
- `src/components/chart.tsx` (lines 414–420)
- `src/components/trade-ticket.tsx` (~line 28)
- `src/components/signal-card.tsx` (~line 21)
- `src/components/coin-selector.tsx` (~line 6)
- `src/components/timeframe-toggle.tsx` (~line 8)
- `src/components/settings-panel.tsx` (~line 11)

**Change:** Select each value atomically:

```ts
const selectedCoin = useTradingStore((s) => s.selectedCoin);
const appendCandle = useTradingStore((s) => s.appendCandle);
```

Rules:
- One `useTradingStore(selector)` call per value. Actions are stable references in Zustand — selecting them individually never causes re-renders.
- Never select a derived object/array literal in the selector (e.g. NOT `s => ({a: s.a, b: s.b})`) — that creates a new object each call and defeats the fix. If a component genuinely needs an object pick, use `useShallow` from `zustand/react/shallow`.
- For derived lists in `dashboard/page.tsx` (`pendingSignals`, `selectedSignal`, `recentActivity`, lines 169–184): select `signals` once, derive with `useMemo` keyed on `[signals, selectedCoin, selectedTimeframe, selectedSignalId]`.
- Do not change store logic, only subscription style.

---

## Task 2 — Stop Chart re-rendering on mouse move; isolate the SVG overlay (CRITICAL)

**File:** `src/components/chart.tsx`

**Problem A:** `handleCrosshairMove` (line 656–662) calls `scheduleOverlay()` on every crosshair move. The overlay model geometry depends only on the visible time range and price scale — NOT the crosshair. Result: every mouse movement schedules `setOverlay(freshObject)` → full re-render of the entire Chart component at up to 60fps.

**Fix A:** Delete the `scheduleOverlay()` call inside `handleCrosshairMove` (line 657). Keep the hover-candle logic. Pan/zoom repositioning is already covered by `subscribeVisibleLogicalRangeChange(scheduleOverlay)` (line 663) — keep that.

**Problem B:** Even legitimate overlay updates (pan/zoom frames, ticks) re-render all of Chart because `overlay` is `useState` on the root component (line 434).

**Fix B:** Extract the `<svg>` block (lines 1233–1273) into a separate component, e.g. `ChartOverlaySvg`, that OWNS the overlay state:

```tsx
export interface OverlayHandle { setModel(model: OverlayModel): void; }

const ChartOverlaySvg = forwardRef<OverlayHandle>((_, ref) => {
    const [overlay, setOverlay] = useState<OverlayModel>(EMPTY_MODEL);
    useImperativeHandle(ref, () => ({ setModel: setOverlay }), []);
    return ( /* existing svg JSX using `overlay` */ );
});
```

In `scheduleOverlay` (line 515), replace `setOverlay(buildOverlayModel(...))` with `overlayHandleRef.current?.setModel(buildOverlayModel(...))`. Remove the `overlay` useState from the Chart root. Now per-frame pan updates re-render only the small SVG subtree.

**Problem C (minor, same file):** `hoverCandle` state (line 467) re-renders the whole Chart when the cursor crosses a candle boundary, only to update the small OHLC readout (lines 1156–1166). Optional: extract the OHLC readout into its own component with an imperative handle, same pattern as the overlay. Do this only if profiling still shows Chart re-renders on hover after Fixes A/B.

---

## Task 3 — Move the clock and live-tick timestamp out of the page root (HIGH)

**File:** `src/app/dashboard/page.tsx`

**Problem:** `setClock(Date.now())` every 1s (lines 143–146) and `setLastLiveUpdate(Date.now())` on every WS tick (line 123) both live on the Dashboard root, re-rendering the whole page. They exist only to render the "Market Data / Live Xs" card (lines 264–275).

**Fix:** Create a `MarketStatusCard` component that owns both pieces of state:
- Move the 1-second `setInterval` into it.
- For `lastLiveUpdate`: pass a mutable ref (`lastLiveUpdateRef`) from Dashboard down; the WS `onCandle` callback writes `lastLiveUpdateRef.current = Date.now()` (no React state). `MarketStatusCard` reads the ref inside its 1-second tick — 1s granularity is exactly what the label displays anyway.
- Pass `connectionStatus` as a prop (it changes rarely; keeping it as Dashboard state is fine).
- Move `liveAgeSeconds` / `isFresh` / `marketStatusLabel` computation (lines 185–191) into the new component.

---

## Task 4 — Debounce zustand persist writes (HIGH)

**File:** `src/store/trading-store.ts`

**Problem:** `persist` runs `partialize` + `JSON.stringify` + synchronous `localStorage.setItem` on EVERY `set()` — i.e. multiple times per second on every candle tick — even though the persisted fields (coin, timeframe, settings, decided signals) change rarely.

**Fix:** Provide a custom debounced storage to `persist`:

```ts
import { createJSONStorage } from 'zustand/middleware';

function debouncedStorage(delayMs = 1000): Storage {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: { key: string; value: string } | null = null;
    const flush = () => {
        if (pending) localStorage.setItem(pending.key, pending.value);
        pending = null; timer = null;
    };
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', flush);
    return {
        getItem: (k) => localStorage.getItem(k),
        removeItem: (k) => localStorage.removeItem(k),
        setItem: (key, value) => {
            pending = { key, value };
            if (!timer) timer = setTimeout(flush, delayMs);
        },
    } as Storage;
}
```

Wire it in the persist options: `storage: createJSONStorage(() => debouncedStorage())`. Guard for SSR (`typeof window === 'undefined'` → return a no-op storage). Keep `partialize`, `version`, and `merge` unchanged.

---

## Task 5 — Gate and incrementalize EMA computation (MEDIUM)

**File:** `src/components/chart.tsx`, candles effect (lines 703–761)

**Problem:** `calculateEma(candles, 20)` and `calculateEma(candles, 50)` (lines 724–725) map over all 500 candles on every tick, even when both EMA toggles are off, and even on the incremental path where only the last point is used.

**Fix:**
- Keep last EMA values in refs: `ema20Ref`, `ema50Ref` (number | null) plus the last candle time they correspond to.
- Full path (`setData`): compute full arrays ONLY when `showEma20` / `showEma50` respectively is true; always seed the refs from the last computed value (or compute the seed lazily on first toggle-on by running `calculateEma` once).
- Incremental path (`series.update`): compute the next EMA point arithmetically from the ref: `ema = (close - prev) * k + prev`; only call `emaSeries.update` when that series is visible. When the update is for the same still-forming bar (same `time`), recompute from the previous CLOSED bar's EMA, not from the forming bar's previous value — store `emaAtLastClosedBar` in the ref for this.
- When the user toggles an EMA on after it was off, run `calculateEma` once and `setData` it (add this to the visibility effect at lines 682–686).

---

## Task 6 — Coalesce WebSocket updates to one flush per animation frame (MEDIUM)

**Files:** `src/lib/api/hyperliquid-ws.ts` (onmessage, lines 102–126) or the subscriber in `src/app/dashboard/page.tsx` (lines 117–126)

**Problem:** Each WS message can contain several candle updates; each triggers `appendCandle` + `updatePrice` immediately. Bursts cause redundant back-to-back renders.

**Fix (do it in the dashboard subscriber, keep the WS lib dumb):** Buffer the latest candle per `time` bucket in a ref; schedule a single `requestAnimationFrame` that flushes: one `appendCandle` per distinct candle time (closed bars must ALL be flushed in order — never drop a closed bar, only coalesce successive updates of the same forming bar), then one `updatePrice` with the final close. Cancel the rAF on effect cleanup. `isClosed` semantics must be preserved exactly (the auto-scan in `appendCandle` depends on it).

---

## Task 7 — Delete dead code (LOW)

- `src/lib/api/binance-ws.ts` is imported by nothing. Delete the file.

## Explicitly NOT in scope (do not "improve" these)

- `runScan` stays synchronous on the main thread — it runs only on candle close, not per tick. Leave it.
- Chart full remount via `key={coin-timeframe}` in `dashboard/page.tsx` (line 328) is intentional. Leave it.
- `appendCandle`'s immutable array rebuild is cheap (500 refs). Leave it.
- Do not add React.memo everywhere; the selector fix makes it unnecessary. Only the extracted components from Tasks 2–3 matter.
- Do not touch the trading logic in `src/lib/trading/*`.

## Acceptance criteria

1. `npm run test` and `npm run lint` pass; `npm run build` succeeds.
2. With React DevTools Profiler ("Highlight updates when components render") on a live BTC 5m feed:
   - Mouse idle: only the chart canvas, the Current Price stat, and (once per second) the MarketStatusCard update. Dashboard root, SignalCard list, toolbars must NOT flash on ticks.
   - Moving the mouse over the chart: no Chart-root re-renders (OHLC readout / hover excepted).
   - Panning the chart: only the overlay SVG child re-renders.
3. Chrome Performance panel, 10s recording on a live feed: no `localStorage.setItem` more often than ~1/sec; no long tasks > 50ms attributable to React commits from ticks.
4. Behavior unchanged: signals still appear on candle close, zones/drawings/fibs render identically, persistence still restores coin/timeframe/settings/decided signals after reload, live equity fetch unchanged.
