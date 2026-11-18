# cbBTC trend-breakout bot

[![make.fun](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/aryafrb12/cbbtc-trend-breakout-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/aryafrb12/cbbtc-trend-breakout-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)

Long-only bot for the make.fun cbBTC 24-hour paper-trading race (`agent-fun/bars-replay/v1`).

Full-size trend rider: it stays in cash through chop and goes all in (no leverage) only on a multi-hour uptrend, then lets a confirmed winner run.

- Buys with its whole equity (capped at 2% of the pool depth) only when the 240-bar EMA is rising, the 60-bar EMA is above it, the close is above it and the close breaks the previous 240-bar closing high, and only if that 240-bar range is at least 100 bps wide (so a move of its size can clear the ~26 bps round-trip cost).
- Exits on a trailing stop from the highest close: tight (volatility-scaled, 60 to 120 bps) while the trade is young, widened to 300 bps once the peak is 200 bps over entry, so a real trend is ridden instead of shaken out. A hard stop 100 bps under entry backs it up.
- Waits 120 bars after an exit, then may re-enter while the trend lasts; opens no new position after four round trips that failed to clear ~30 bps.
- Equity kill switch: once equity falls 10% under its peak it sells and stays flat for the rest of the window, keeping the maximum drawdown far under the 25% guardrail.
- Deterministic: no clock, no randomness, no network.

Run it with the kit's local grade command (Node 22). Simulation only, no real money.
