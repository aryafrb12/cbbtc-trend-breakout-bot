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
}

export const DEFAULT_PARAMS: Params = {
  slowSpan: 240,
  fastSpan: 60,
  breakoutBars: 180,
  minRangeBps: 60,
  volBars: 60,
  trailVolMult: 4,
  trailMinBps: 40,
  trailMaxBps: 120,
  hardStopBps: 80,
  regimeExitBps: 30,
  cooldownBars: 60,
  volTargetBps: 12,
  minWeight: 0.3,
  maxDepthFrac: 0.02,
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
  bar = -1;

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
  onClose(c: number, holding: boolean): Decision {
    const p = this.p;
    this.bar++;
    const prevClose = this.closes.length > 0 ? this.closes[this.closes.length - 1]! : null;
    if (prevClose !== null) {
      this.rets.push((c - prevClose) / prevClose);
      if (this.rets.length > p.volBars) this.rets.shift();
    }
    this.prevSlow = this.slow;
    this.slow = this.ema(this.slow, c, p.slowSpan);
    this.fast = this.ema(this.fast, c, p.fastSpan);
    // Range of the previous breakoutBars closes (excluding this one).
    const look = this.closes.slice(-p.breakoutBars);
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
    }

    const v = this.vol();
    if (this.inPos) {
      if (c > this.peak) this.peak = c;
      let trail = p.trailVolMult * v * Math.sqrt(p.volBars / 4);
      if (trail < p.trailMinBps) trail = p.trailMinBps;
      if (trail > p.trailMaxBps) trail = p.trailMaxBps;
      if (c <= this.entry * (1 - p.hardStopBps / 10_000)) return { kind: 'sell', reason: 'hard_stop' };
      if (c <= this.peak * (1 - trail / 10_000)) return { kind: 'sell', reason: 'trail' };
      if (this.slow !== null && c < this.slow * (1 - p.regimeExitBps / 10_000)) return { kind: 'sell', reason: 'regime' };
      return { kind: 'none' };
    }

    // Need a full lookback window before any entry.
    if (look.length < p.breakoutBars) return { kind: 'none' };
    if (this.bar - this.lastExitBar < p.cooldownBars) return { kind: 'none' };
    let hi = -Infinity;
    let lo = Infinity;
    for (const x of look) {
      if (x > hi) hi = x;
      if (x < lo) lo = x;
    }
    const rangeBps = ((hi - lo) / lo) * 10_000;
    const slowRising = this.prevSlow !== null && this.slow > this.prevSlow;
    const trendUp = this.fast !== null && this.fast > this.slow && c > this.slow;
    if (c > hi && rangeBps >= p.minRangeBps && slowRising && trendUp) {
      let w = v > p.volTargetBps ? p.volTargetBps / v : 1;
      if (w < p.minWeight) w = p.minWeight;
      return { kind: 'buy', weight: w };
    }
    return { kind: 'none' };
  }
}
