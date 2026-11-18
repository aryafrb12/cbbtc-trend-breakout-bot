# cbBTC trend-breakout bot

[![make.fun](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/aryafrb12/cbbtc-trend-breakout-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/aryafrb12/cbbtc-trend-breakout-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)

Long-only bot for the make.fun cbBTC 24-hour paper-trading race (`agent-fun/bars-replay/v1`).

- Buys only when the 240-bar trend is rising, price is above it and the close breaks the previous 240-bar high, with a range wide enough to clear the ~26 bps round-trip cost.
- Exits on a volatility-scaled trailing stop, a hard stop, or a clear break below the trend.
- Waits 240 bars after an exit, stops after two losing round trips, and sizes down in high volatility and by pool depth.
- Deterministic: no clock, no randomness, no network.

Run it with the kit's local grade command (Node 22). Simulation only, no real money.
