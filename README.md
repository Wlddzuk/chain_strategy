# Chain Trader

A browser-based Hyperliquid market scanner and trade-planning dashboard built with Next.js 16, React 19, Zustand, and Lightweight Charts.

The app watches BTC, ETH, SOL, DOGE, XRP, AVAX, LINK, and ARB across 5m, 15m, 1h, and 4h candles. It detects supply/demand engulfing structures, confirmed zone breaks, origin entries, and opposing-zone targets. The dashboard includes drawing tools, RSI/Bollinger/EMA overlays, risk-capped position sizing, alerts, a glossary, and a usage guide.

**Accepting a plan does not send an exchange order.** This repository contains read-only market/account API calls. Entries and outcomes are inferred from observed prices, not verified exchange fills.

## Run locally

Use Node 22.22.2 or a newer supported release (see `package.json`). With nvm:

```sh
nvm install
nvm use
npm ci
npm run dev
```

Open [the dashboard](http://localhost:3000/dashboard). No credentials or environment variables are required for public market data. A public wallet address can optionally populate account equity; never enter a seed phrase or private key.

## Automatic startup on macOS

A per-user LaunchAgent keeps the production server available at `http://127.0.0.1:3000/dashboard`. It starts when you log in and restarts if the server exits. Terminal and Codex do not need to remain open. The Mac must be awake, and the dashboard tab must be open for the browser-based signal scanner to run.

The installer uses the Node executable available when it is run. To reinstall after moving the project or changing Node installations:

```sh
python3 scripts/install-macos-service.py
```

Build before installing if `.next/BUILD_ID` does not exist. Stop any separately started server on port 3000 before first installation. Logs are in `~/Library/Logs/ChainTrader/`.

To stop automatic startup:

```sh
launchctl bootout "gui/$(id -u)/com.chaintrader.dashboard"
launchctl disable "gui/$(id -u)/com.chaintrader.dashboard"
```

To update the running application after source changes, stop the service, run `npm run build`, then rerun the installer. Do not rebuild `.next` while the service is serving it.

## Checks

```sh
npm test
npm run lint
npm run build
npm run start
```

Vitest covers strategy rules, signal lifecycle, risk calculations, chart indicators/refreshes, API parsing, socket recovery, and React interactions. API calls are mocked in tests. The production build also type-checks the application.

## Data and persistence

- REST snapshots seed history; a WebSocket updates the selected chart.
- Background scans run after configured candle closes, pace requests, and retry transient failures after 30 seconds.
- Requests time out after 15 seconds. Initial-load failures retry automatically. Silent sockets reconnect.
- Settings, accepted decisions, checklists, and compact outcome history are stored in this browser's local storage. Newly accepted plans retain the equity, risk, and leverage used when accepted. Older saved plans without those fields use current defaults.
- Market candles and unaccepted setups are not persisted. Timestamps identify signals consistently across rolling history windows.
- Closed candles confirm signals. Target selection uses zones available at the trigger, and historical setups that already reached entry or target are not advertised as fresh plans.

## Risk Desk handoff

Open a signal’s **Open Plan** ticket, then select **Open in Risk Desk**. Your private [Hyperliquid Risk Desk](https://hyperliquid-risk-desk.wldukdz.chatgpt.site/) receives a draft with the coin, direction, timeframe, entry, stop, final target, equity, risk percentage and leverage. Review it before choosing **Log open trade**. This records a journal entry, not an exchange order.

Risk Desk applies its own fee settings, so its calculated quantity can differ from the monitor’s gross-risk quantity. Imported equity/risk apply only to the draft and do not overwrite the journal balance or global settings. Importing does not log automatically, and the same plan ID cannot be logged twice. The journal retains the planned target for later review.

The URL fragment carries the draft in the browser; wallet data and credentials are excluded. Risk Desk validates the draft and removes the fragment after import. If a sign-in prompt interrupts the handoff, finish signing in, then return to the monitor and click **Open in Risk Desk** again. This is a one-way handoff; edits and journal outcomes do not sync back to the monitor.

## Practical limits

The scanner is not an always-on service. It pauses background candle sweeps when the page is hidden, and stops when the tab is closed or the computer sleeps. Sampled quotes can miss touches between updates. The strategy record uses full-target gross R; it excludes fees, funding, slippage, liquidation, and partial exits. Its scores are heuristics, not calibrated win probabilities.

See [HOW-TO-USE.md](HOW-TO-USE.md) for the user guide and [AUDIT-2026-09-07.md](AUDIT-2026-09-07.md) for the audit findings and follow-up work.
