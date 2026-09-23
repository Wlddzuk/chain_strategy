# How to use Chain Trader

*Plain-English guide. Read once, keep for reference.*

## What this tool does — and does not do

Chain Trader watches 8 crypto markets on Hyperliquid and looks for one specific pattern (the "Chain" supply-and-demand setup). When it finds one, it builds a complete trade plan for you: Entry, Stop, Target, and position size.

**It never places orders.** You place them yourself on your exchange. The tool tells you WHEN and WHAT — you do the clicking on the exchange side.

## The screen, top to bottom

- **Now bar** (under the header): the single most important thing right now. If it says ENTRY HIT, act. If it says "Closest setup...", relax and watch.
- **Stats row**: current price, number of active plans, your risk settings, connection health, scanner status.
- **Chart**: candles plus the zones the strategy found. Toggle RSI, Bollinger Bands, EMAs with the toolbar buttons.
- **Trade Signals**: the active plans. Each card leads with a colored status strip — that strip is the only thing you need to read at a glance.
- **Setups forming**: early warnings. Price is near a zone, but nothing is confirmed yet. Watch, don't act.
- **Strategy record**: the tool's own scoreboard of how its plans would have performed. Check it weekly.
- **Recent Activity**: history of finished plans.

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

## Your daily workflow

1. Open the app, check the **Now bar** and the candle-close countdown.
2. When a **new signal** beeps, open the card. Check the status strip and "net after fees" R:R.
3. If you want the trade: click **Open Plan**, set your balance/risk, click **Accept**. Then place the SAME three orders on your exchange: Entry (limit order), Stop, Target. Use the **copy buttons** — never retype numbers by hand.
4. Tick the three checkboxes on the plan (Entry order placed / Stop set / Target set).
5. Walk away. The tool will tell you: **entry hit** (you're in), **invalidated** (cancel your exchange orders NOW), **target/stop hit** (trade over).
6. Never act on an ⚠️ ENTRY HIT card you didn't already plan — that trade is gone.
7. Check the **Strategy record** weekly. It shows how plans performed. If the record is bad over many trades, stop and re-evaluate — do not argue with your own data.

## The three golden rules

1. **INVALIDATED or MISSED = cancel your exchange orders immediately.** The setup is dead; a resting limit order can fill into a falling market.
2. **Never chase a hit Entry.** The Stop-to-Target math only works from the planned Entry.
3. **Most setups will be MISSED — that is normal.** The strategy places limit orders at retracement levels; price often runs without coming back. Missing a trade costs nothing. A bad entry costs money.

## Honest limits of this tool

- Outcomes ("would have won/lost") are based on price touches, not your real fills. Slippage, funding, and partial fills are not simulated.
- A signal is a pattern match, not a prophecy. The Strategy record tells you over time whether the pattern earns.
- If the scoreboard shows fewer than ~10 resolved plans, it is too early to judge anything.
