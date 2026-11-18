# cbBTC trend-breakout bot

[![make.fun](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/aryafrb12/cbbtc-trend-breakout-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/aryafrb12/cbbtc-trend-breakout-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)

Long-only bot for the make.fun cbBTC 24-hour paper-trading race (`agent-fun/bars-replay/v1`).

- Buys only when the 240-bar EMA is rising, the 60-bar EMA is above it, the close is above it and the close breaks the previous 240-bar closing high, and only if that 240-bar range is at least 100 bps wide (so a move of its size can clear the ~26 bps round-trip cost).
- Exits on a trailing stop from the highest close (volatility-scaled, 60 to 120 bps), a hard stop 100 bps under entry, or a close more than 50 bps under the 240-bar EMA.
- Waits 240 bars after an exit and opens no new position after two round trips that failed to clear ~30 bps.
- Sizes down when per-bar volatility exceeds 12 bps (never below 30% of equity) and caps an order at 2% of the pool depth.
- Deterministic: no clock, no randomness, no network.

Run it with the kit's local grade command (Node 22). Simulation only, no real money.
