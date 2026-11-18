// Regime-aware breakout bot for the make.fun btc-race (agent-fun/bars-replay/v1), long only on CBBTC.
// The decision logic lives in strategy.ts; this file wires it to the protocol through the kit's SDK
// shim (vendor/makefun-bars.ts, a byte-identical copy). Every batch's bar is fed to the strategy,
// warm-up bars included; orders are sent only outside the warm-up.

import { BPS, runBars, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';
import { Strategy, DEFAULT_PARAMS } from './strategy.ts';

/** Max slippage from the latest close a fill may take (modelled slippage + impact count toward it). */
const BUY_SLIPPAGE_BPS = 60;
/** Exits must go through: a wide cap, still refusing a fill into an empty pool. */
const SELL_SLIPPAGE_BPS = 300;

const strategies = new Map<string, Strategy>();

await runBars({
  onBatch(state, batch) {
    const orders: (BuyInput | SellInput)[] = [];
    for (const bar of batch.bars) {
      let s = strategies.get(bar.symbol);
      if (s === undefined) {
        s = new Strategy(DEFAULT_PARAMS);
        strategies.set(bar.symbol, s);
      }
      const held = state.positions.get(bar.symbol);
      const d = s.onClose(Number(bar.c), held !== undefined && held.qty > 0n);
      if (state.warmingUp) continue;
      if (d.kind === 'sell' && held !== undefined && held.qty > 0n) {
        orders.push({ side: 'sell', symbol: bar.symbol, qty: held.qty, max_slippage_bps: SELL_SLIPPAGE_BPS });
      } else if (d.kind === 'buy' && held === undefined && state.positions.size < state.hello.caps.max_open_positions) {
        const { caps, fees } = state.hello;
        let notional = (state.equity * BigInt(Math.floor(d.weight * 10_000))) / BPS;
        const byWeight = state.weightRoom(bar.symbol);
        if (notional > byWeight) notional = byWeight;
        const depth = state.depthAt(bar.symbol);
        if (depth !== null && depth.length > 0) {
          let dmin = depth[0]!;
          for (const x of depth) if (x < dmin) dmin = x;
          const byDepth = (dmin * BigInt(Math.floor(s.p.maxDepthFrac * 10_000))) / BPS;
          if (notional > byDepth) notional = byDepth;
        }
        if (notional > state.cash) notional = state.cash;
        if (notional >= BigInt(fees.min_notional_quote_units) && orders.length < caps.max_orders_per_bar) {
          orders.push({ side: 'buy', symbol: bar.symbol, notional_quote_units: notional, max_slippage_bps: BUY_SLIPPAGE_BPS });
        }
      }
    }
    return orders;
  },
});
