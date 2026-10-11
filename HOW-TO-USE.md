# How to use Chain Trader

*Plain-English guide. Read once, keep for reference.*

## What this tool does — and does not do

Chain Trader watches 8 crypto markets on Hyperliquid and looks for one specific pattern (the "Chain" supply-and-demand setup). When it finds one, it builds a complete trade plan for you: Entry, Stop, Target, and position size.

**It never places orders.** You place them yourself on your exchange. The tool tells you WHEN and WHAT — you do the clicking on the exchange side.

## The screen, top to bottom

- **Now bar** (under the header): the single most important thing right now. If it says ENTRY HIT, act. If it says "Closest setup...", relax and watch. Tap the × to clear an ENTRY HIT once you have seen it.
- **Stats row**: current price with a small chart of the last 48 candles, number of active plans with the all-time strategy record underneath (tap it to open the Record tab), your risk settings, connection health, scanner status.
- **Chart**: candles plus the zones the strategy found. Toggle RSI, Bollinger Bands, EMAs with the toolbar buttons.
- **Right-hand tabs**: switch between four views instead of scrolling. **Signals** are the active plans — each card leads with a colored status strip, the only thing you need to read at a glance. **Forming** is early warnings: price is near a zone, nothing confirmed yet, watch don't act; each row is colored by the trade it would lead to, green for a long and red for a short. **Record** is the tool's own scoreboard of how its plans would have performed, in R after fees, split by timeframe, coin, and direction — check it weekly. **History** is finished plans, with filters and the R each one made after fees.

## What the status strips mean

| Strip | Meaning | What you do |
|---|---|---|
| ⏳ WAITING | Plan exists, price hasn't come back to entry | Nothing yet. Optionally place a limit order and wait. |
| ⚡ GET READY | Price is close to the entry | If you want this trade, place your limit order now. |
| 📋 ORDER PLAN ACTIVE | You approved the plan | Make sure your exchange orders match the plan. |
| ⚠️ ENTRY HIT — do not chase | Entry traded but you weren't in | Skip it. Entering late breaks the strategy's math. |
| ✅ IN TRADE (planned) | Entry filled (by plan bookkeeping) | Manage nothing — stop and target are already set. |
| 🏁 CLOSED | Plan finished, would have won or lost | Note the result. The scoreboard records it. |

## What the sounds mean

Open Settings → Alerts and press each **Test** button once so your ear learns them:

- **Soft tick** — new signal or forming setup. Information only. No action.
- **Two rising notes** — price is approaching an entry. Look at the screen soon.
- **Three-note rising melody** — ENTRY HIT. Act now if this is your trade.
- **Pleasant chord** — target hit. **Two low falling notes** — stop hit.
- **Voice** — speaks the market and action so you don't have to look at all.

## What the scanner filters out

Not every pattern becomes a signal. A setup is dropped before you ever see it when:

- **The stop is too tight** — closer than 0.8% to the entry. Fees eat too much of a small stop.
- **The reward is out of range** — less than 1:2, or above the maximum R:R.

You can change the minimum stop and the maximum R:R in Settings, under Setup filters.

## Your daily workflow

1. Open the app, check the **Now bar** and the candle-close countdown.
2. When a **new signal** beeps, open the card. Check the status strip and "net after fees" R:R.
3. If you want the trade: click **Open Plan**, set your balance/risk, click **Accept**. Then place the SAME three orders on your exchange: Entry (limit order), Stop, Target. Use the **copy buttons** — never retype numbers by hand.
4. Tick the three checkboxes on the plan (Entry order placed / Stop set / Target set).
5. Walk away. The tool will tell you: **entry hit** (you're in), **invalidated** (cancel your exchange orders NOW), **target/stop hit** (trade over).
6. Never act on an ⚠️ ENTRY HIT card you didn't already plan — that trade is gone.
7. Check the **Strategy record** weekly. It shows how plans performed after fees, and which timeframes, coins, and directions earn. If the record is bad over many trades, stop and re-evaluate — do not argue with your own data.

## The three golden rules

1. **INVALIDATED or MISSED = cancel your exchange orders immediately.** The setup is dead; a resting limit order can fill into a falling market.
2. **Never chase a hit Entry.** The Stop-to-Target math only works from the planned Entry.
3. **Most setups will be MISSED — that is normal.** The strategy places limit orders at retracement levels; price often runs without coming back. Missing a trade costs nothing. A bad entry costs money. The Record tab counts near misses: many of them suggest the entry sits too deep in the zone, which is a reason to review the strategy, not to chase.

## Honest limits of this tool

- Outcomes ("would have won/lost") are based on price touches, not your real fills. R after fees assumes Hyperliquid's base fees with a limit entry, a limit target, and a market stop; change the rates in Settings if yours differ. Slippage, funding, and partial fills are not simulated.
- A signal is a pattern match, not a prophecy. The Strategy record tells you over time whether the pattern earns.
- If the scoreboard shows fewer than ~10 resolved plans, it is too early to judge anything.

## Plain-language glossary

- **Zone** — A price area where buyers or sellers acted strongly.
- **Zone name vs direction** — A zone's name (supply/demand) is not the trade direction. The BREAK of a zone decides the direction.
- **Event** — A broken zone that confirms the market moved with strength.
- **Origin** — The entry zone where the planned limit order waits.
- **Entry** — Also called the limit order: the price where the plan becomes a trade if price comes back.
- **Stop** — Also called stop loss: the price that closes the plan to limit a loss.
- **Target** — Also called take profit: the price that closes the plan in profit.
- **R:R** — Risk to reward: how much the plan may gain for each 1R risked.
- **R after fees** — A result in R once Hyperliquid's fees are taken off: the maker fee on the entry and target, the taker fee on the stop.
- **Missed** — Price reached the target before it came back to entry, so the plan is too late.
- **Near miss** — A missed plan where price came within 0.25R of the entry before running to the target.
- **Invalidated** — The setup failed before entry and must no longer be used.
- **Would have won/lost** — A price-only result for a plan the app did not place on an exchange.
- **Planning only** — The app never sends exchange orders. You place the entry, stop, and target yourself.
- **Yellow dot** — Marks the candle that triggered the setup. It is not a fill: entry fills only if price returns to the yellow line.
