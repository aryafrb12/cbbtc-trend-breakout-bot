// Regime-aware breakout strategy for one asset on 1-minute bars, long only.
//
// Design goals (fees ~26 bps per round trip, so trade rarely and only on large moves):
//   - Regime filter: only go long while the slow trend (EMA of `slowSpan` closes) is rising and the
//     close sits above it.
//   - Entry trigger: the close breaks above the highest close of the previous `breakoutBars` bars,
//     and that range is wide enough (`minRangeBps`) that a move of its size clears the costs.
//   - Exit: a trailing stop from the highest close since entry, its width scaled by recent
//     volatility (clamped to [trailMinBps, trailMaxBps]), a hard stop `hardStopBps` under entry,
//     or the close falling under the slow EMA by `regimeExitBps`.
//   - Cooldown of `cooldownBars` after any exit, so whipsaws do not churn fees.
//   - Size: a fraction of equity that shrinks when volatility is high, capped so the order's own
//     price impact on the pool depth stays small.
// Everything is plain float64 arithmetic on + - * / and Math.sqrt (correctly rounded), so the same
// bars always give the same decisions.

export interface Params {
  slowSpan: number;
  fastSpan: number;
  breakoutBars: number;
  minRangeBps: number;
  volBars: number;
  trailVolMult: number;
  trailMinBps: number;
  trailMaxBps: number;
  hardStopBps: number;
  regimeExitBps: number;
  cooldownBars: number;
  /** Target per-bar volatility (bps); above it the position is scaled down proportionally. */
  volTargetBps: number;
  minWeight: number;
  /** Max order notional as a fraction of the pool depth at the latest close. */
  maxDepthFrac: number;
  /** Circuit breaker: no new entry after this many losing round trips. */
  maxLosses: number;
  /** Multi-hour trend filter: the close must be at least trendMinBps above the close trendBars ago. */
  trendBars: number;
  trendMinBps: number;
  /** Equity kill switch: once equity falls this fraction under its peak, sell and never trade again. */
  ddStopFrac: number;
  /** Let winners run: once the peak close is widenAfterBps over entry, the trail becomes wideTrailBps. */
  widenAfterBps: number;
  wideTrailBps: number;
}

export const DEFAULT_PARAMS: Params = {
  slowSpan: 240,
  fastSpan: 60,
  breakoutBars: 240,
  minRangeBps: 100,
  volBars: 60,
  trailVolMult: 4,
  trailMinBps: 60,
  trailMaxBps: 120,
  hardStopBps: 100,
  regimeExitBps: 1000,
  cooldownBars: 120,
  // Full size on every entry: the race rewards the right tail, not a smooth curve.
  volTargetBps: 1e9,
  minWeight: 1,
  maxDepthFrac: 0.02,
  maxLosses: 4,
  trendBars: 0,
  trendMinBps: 0,
  ddStopFrac: 0.1,
  widenAfterBps: 200,
  wideTrailBps: 300,
};

export type Decision = { kind: 'none' } | { kind: 'buy'; weight: number } | { kind: 'sell'; reason: string };

export class Strategy {
  readonly p: Params;
  closes: number[] = [];
  slow: number | null = null;
  fast: number | null = null;
  prevSlow: number | null = null;
  /** Squared one-bar log-ish returns (simple returns) for the vol window. */
  rets: number[] = [];
  inPos = false;
  entry = 0;
  peak = 0;
  lastExitBar = -1_000_000;
  /** Close of the bar the exit was decided on, to score the round trip. */
  exitClose = 0;
  losses = 0;
  bar = -1;
  /** Long history of closes for the trend filter (trendBars + 1 kept). */
  hist: number[] = [];
  peakEquity = 0;
  /** Set once the equity kill switch fires: flat for the rest of the window. */
  halted = false;

  constructor(p: Params = DEFAULT_PARAMS) {
    this.p = p;
  }

  private ema(prev: number | null, x: number, span: number): number {
    if (prev === null) return x;
    return prev + (2 / (span + 1)) * (x - prev);
  }

  /** Per-bar volatility in bps over the last volBars returns. */
  vol(): number {
    const n = this.rets.length;
    if (n === 0) return 0;
    let s = 0;
    for (const r of this.rets) s += r * r;
    return Math.sqrt(s / n) * 10_000;
  }

  /** Feed one close; returns the decision for an order filled at the next open. */
  onClose(c: number, holding: boolean, equity = 0): Decision {
    const p = this.p;
    this.bar++;
    this.hist.push(c);
    if (this.hist.length > p.trendBars + 1) this.hist.shift();
    if (equity > this.peakEquity) this.peakEquity = equity;
    if (!this.halted && equity > 0 && equity <= this.peakEquity * (1 - p.ddStopFrac)) this.halted = true;
    const prevClose = this.closes.length > 0 ? this.closes[this.closes.length - 1]! : null;
    if (prevClose !== null) {
      this.rets.push((c - prevClose) / prevClose);
      if (this.rets.length > p.volBars) this.rets.shift();
    }
    this.prevSlow = this.slow;
    this.slow = this.ema(this.slow, c, p.slowSpan);
    this.fast = this.ema(this.fast, c, p.fastSpan);
    // Range of the previous breakoutBars closes (excluding this one).
    const lookLen = Math.min(this.closes.length, p.breakoutBars);
    this.closes.push(c);
    if (this.closes.length > p.breakoutBars + 1) this.closes.shift();

    // Keep our own view in sync with the account (a refused order leaves us where we were).
    if (holding && !this.inPos) {
      this.inPos = true;
      this.entry = c;
      this.peak = c;
    } else if (!holding && this.inPos) {
      this.inPos = false;
      this.lastExitBar = this.bar;
      // A round trip that did not clear ~30 bps of costs counts as a loss.
      if (this.exitClose < this.entry * 1.003) this.losses++;
    }

    const v = this.vol();
    if (this.inPos) {
      if (c > this.peak) this.peak = c;
      let trail = p.trailVolMult * v * Math.sqrt(p.volBars / 4);
      if (trail < p.trailMinBps) trail = p.trailMinBps;
      if (trail > p.trailMaxBps) trail = p.trailMaxBps;
      if (this.peak >= this.entry * (1 + p.widenAfterBps / 10_000) && p.wideTrailBps > trail) trail = p.wideTrailBps;
      let reason = '';
      if (this.halted) reason = 'equity_dd';
      else if (c <= this.entry * (1 - p.hardStopBps / 10_000)) reason = 'hard_stop';
      else if (c <= this.peak * (1 - trail / 10_000)) reason = 'trail';
      else if (this.slow !== null && c < this.slow * (1 - p.regimeExitBps / 10_000)) reason = 'regime';
      if (reason === '') return { kind: 'none' };
      this.exitClose = c;
      return { kind: 'sell', reason };
    }

    // Need a full lookback window before any entry.
    if (lookLen < p.breakoutBars) return { kind: 'none' };
    if (this.bar - this.lastExitBar < p.cooldownBars) return { kind: 'none' };
    if (this.losses >= p.maxLosses || this.halted) return { kind: 'none' };
    if (p.trendBars > 0) {
      if (this.hist.length <= p.trendBars) return { kind: 'none' };
      if (c < this.hist[0]! * (1 + p.trendMinBps / 10_000)) return { kind: 'none' };
    }
    const slowRising = this.prevSlow !== null && this.slow > this.prevSlow;
    const trendUp = this.fast !== null && this.fast > this.slow && c > this.slow;
    if (!slowRising || !trendUp) return { kind: 'none' };
    // The previous breakoutBars closes: every kept close but this one.
    let hi = -Infinity;
    let lo = Infinity;
    const n = this.closes.length - 1;
    for (let i = n - lookLen; i < n; i++) {
      const x = this.closes[i]!;
      if (x > hi) hi = x;
      if (x < lo) lo = x;
    }
    const rangeBps = ((hi - lo) / lo) * 10_000;
    if (c > hi && rangeBps >= p.minRangeBps) {
      let w = v > p.volTargetBps ? p.volTargetBps / v : 1;
      if (w < p.minWeight) w = p.minWeight;
      return { kind: 'buy', weight: w };
    }
    return { kind: 'none' };
  }
}
