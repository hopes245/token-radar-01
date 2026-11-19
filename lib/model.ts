// The radar's scoring model, version radar-4.
//
// One snapshot in, one ranked board out. Every row is scored by the same function of the
// snapshot's own figures; no protocol name is ever special-cased.
//
// Implied value:
//
//   multiple   = the fitted curve, from live-token comparables (below)
//   growth     = clamp(change_7d, -60, 120)
//   growthMult = 1 + growth/100 * 0.5 when growth is up, 1 + growth/100 * 0.75 when down
//                (a shrinking protocol's launch value decays faster than a growing one's rises)
//   relGrowth  = clamp((growth - category median growth) / 50, -0.4, 0.4)
//   relMult    = 1 + relGrowth * 0.3
//                (a protocol outgrowing its own category is hotter than one riding its
//                category's wave; the median is the category's own, from the snapshot)
//   maturity   = 0.6 + min(age_days, 1095) / 1095 * 0.4   (unknown age: 365 days)
//   spread     = 1 + 0.03 * min(chains - 1, 10)           (how widely deployed)
//   implied    = max(1, round(tvl_usd * multiple * growthMult * relMult * maturity * spread))
//
// The multiple is a curve fitted to the traded tokens, not a flat category median. For
// every live-token protocol that records both a market cap and a TVL (exchanges aside),
// take the log of market-cap-over-TVL against the log of TVL and fit one straight line
// by least squares:
//
//   log10(mcap/TVL) = intercept + slope * log10(tvl_usd)
//
// The market pays less per TVL dollar as protocols get bigger: the fitted slope is
// negative. The curve is refitted from the snapshot on every run, so the claim is
// checkable from the snapshot alone, and it is blind-tested two ways before it is
// trusted (see fittedCurve and blindTest): leave-one-out over the comparables, and a
// time split that fits on tokens listed before 2024 and tests on the rest. Both tests
// beat the flat category median the earlier model used, and both numbers are printed
// on the dashboard. The fitted multiple is clamped to [0.01, 1.20], the winsorised
// ratio range, so no row is priced outside what the market has ever paid.
//
// Every implied value carries a band from 200 refits of the comparables (see
// bootstrapBands): the curve is refitted on resampled comparables with a fixed seed,
// so the band is the fitted multiple's uncertainty and two runs write the same bytes.
// The band is shown next to each value, and the rank range across the refits is shown
// in the detail view.
//
// Row selection: the watchlist is the floor and is always fully covered. Below the
// floor, the early radar takes pre-token protocols that pass the house's own
// watchlist exclusions (no exchange, no bridge, no liquid-staking or restaked
// product, no wrapped/staked/staking name, no exchange-prefixed name), ranked by
// implied value. A version suffix in the name (BDEX V3, Aera V2) no longer excludes
// a protocol on its own: the suffix is the protocol's own release number, and the
// category still has to pass. Protocols whose token already trades are never ranked:
// they are shown apart, with the market's own caps, as the comparables the curve is
// fitted on.
//
// "Pre-token" always means the snapshot's record shows no token (no market cap, no
// CoinGecko id, no symbol). The dashboard says "records no token", never "has no
// token": DefiLlama's record is not proof.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Every constant the model uses, shipped to the dashboard so the page recomputes identically. */
export interface ModelConstants {
  growth_weight: number;
  growth_weight_down: number;
  growth_rel_weight: number;
  growth_rel_cap: number;
  growth_rel_scale: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  prior_weight: number;
  min_comparables: number;
  ratio_floor: number;
  ratio_cap: number;
  spread_per_chain: number;
  spread_max_chains: number;
  bootstrap_refits: number;
  bootstrap_seed: number;
  verdict_farm_usd: number;
  verdict_thin_usd: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_weight_down: 0.75,
  growth_rel_weight: 0.3,
  growth_rel_cap: 0.4,
  growth_rel_scale: 50,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 1.2,
  prior_weight: 4,
  min_comparables: 3,
  ratio_floor: 0.01,
  ratio_cap: 5,
  spread_per_chain: 0.03,
  spread_max_chains: 10,
  bootstrap_refits: 200,
  bootstrap_seed: 20261114,
  verdict_farm_usd: 5_000_000,
  verdict_thin_usd: 500_000,
};

export const MODEL_VERSION = 'radar-4';

/** Cap on early rows below the watchlist floor; the board holds watchlist + early rows. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's median seven-day growth, from every protocol in it that reports one. */
export interface CategoryGrowth {
  category: string;
  median: number;
  reporters: number;
}

/** A farm step before it is flattened to the board's one string per step. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The per-row breakdown the detail view shows: every factor behind the implied value. */
export interface ModelBreakdown {
  category_multiple: number;
  category_comparables: number;
  category_median: number;
  global_median: number;
  category_growth_median: number | null;
  growth_vs_category: number;
  growth_pct: number;
  growth_multiplier: number;
  growth_relative_multiplier: number;
  maturity_multiplier: number;
  diversification_multiplier: number;
  age_days: number | null;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  rank_low: number;
  rank_high: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

/** The dashboard's compact row: the figures plus the breakdown, farm steps regenerated in-page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  rank_low: number;
  rank_high: number;
  category_multiple: number;
  category_comparables: number;
  category_median: number;
  growth_vs_category: number;
  on_watchlist: boolean;
  growth_multiplier: number;
  growth_relative_multiplier: number;
  maturity_multiplier: number;
  diversification_multiplier: number;
}

/** One fitted curve: log10(mcap/TVL) = intercept + slope * log10(tvl_usd). */
export interface FittedCurve {
  intercept: number;
  slope: number;
  comparables: number;
  r2: number;
}

/** The blind test: how the fitted curve does out of sample, against the flat median. */
export interface BlindTest {
  loo_n: number;
  loo_median: number;
  loo_flat_median: number;
  split_n: number;
  split_median: number;
  split_flat_median: number;
}

/** The snapshot accounted for, all 758 protocols, so the reader can check the coverage. */
export interface Coverage {
  total: number;
  traded: number;
  watchlist: number;
  early: number;
  versioned_admitted: number;
  excluded_below: number;
  excluded_above: number;
}

/** A live-token protocol, shown apart with the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median: number;
  fit: FittedCurve;
  validation: BlindTest;
  coverage: Coverage;
  growth_medians: CategoryGrowth[];
  category_tvl_medians: CategoryGrowth[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why a snapshot file is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is unusable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list; the caller guarantees at least one value. */
export function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A protocol records no token when the snapshot carries no market cap, id or symbol for it. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** One live-token protocol the curve is fitted on: its TVL, its market-cap-over-TVL ratio, its listing date and its category. */
export interface ComparablePoint {
  tvl_usd: number;
  ratio: number;
  listed_at: string | null;
  category: string | null;
}

/**
 * The comparable set: live-token protocols with a usable market cap and TVL, exchanges left
 * out, each ratio winsorised to [ratio_floor, ratio_cap]. Returns the global median ratio
 * and one point per comparable, in snapshot order.
 */
export function comparables(snapshot: Snapshot, model: ModelConstants): { globalMedian: number; points: ComparablePoint[] } {
  const points: ComparablePoint[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.category === 'CEX') continue;
    if (p.mcap_usd === null || p.tvl_usd <= 0 || p.mcap_usd <= 0) continue;
    points.push({
      tvl_usd: p.tvl_usd,
      ratio: Math.min(model.ratio_cap, Math.max(model.ratio_floor, p.mcap_usd / p.tvl_usd)),
      listed_at: p.listed_at,
      category: p.category,
    });
  }
  const globalMedian = points.length > 0 ? median(points.map((pt) => pt.ratio)) : 0.25;
  return { globalMedian, points };
}

/** Least squares on log10(ratio) against log10(tvl_usd), over the comparable points. */
export function fitCurve(points: ComparablePoint[]): FittedCurve {
  const n = points.length;
  if (n < 2) return { intercept: Math.log10(0.25), slope: 0, comparables: n, r2: 0 };
  let sx = 0;
  let sy = 0;
  for (const pt of points) {
    sx += Math.log10(pt.tvl_usd);
    sy += Math.log10(pt.ratio);
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (const pt of points) {
    const dx = Math.log10(pt.tvl_usd) - mx;
    sxx += dx * dx;
    sxy += dx * (Math.log10(pt.ratio) - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (const pt of points) {
    const y = Math.log10(pt.ratio);
    const pred = intercept + slope * Math.log10(pt.tvl_usd);
    ssRes += (y - pred) * (y - pred);
    ssTot += (y - my) * (y - my);
  }
  return { intercept, slope, comparables: n, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
}

/** The fitted multiple at one TVL, clamped to the winsorised ratio range. */
export function curveMultiple(tvlUsd: number, fit: FittedCurve, model: ModelConstants): number {
  const raw = Math.pow(10, fit.intercept + fit.slope * Math.log10(Math.max(1, tvlUsd)));
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
}

/**
 * The flat predictor the fitted curve is measured against: the earlier model's category
 * median, shrunk toward the global median with prior weight 4, on the training points.
 */
export function flatPrediction(points: ComparablePoint[], category: string | null, model: ModelConstants): number {
  const ratios = points.map((pt) => pt.ratio);
  const gm = ratios.length > 0 ? median(ratios) : 0.25;
  const cat = points.filter((pt) => (pt.category ?? 'Other') === (category ?? 'Other')).map((pt) => pt.ratio);
  const m = cat.length >= model.min_comparables ? (cat.length * median(cat) + model.prior_weight * gm) / (cat.length + model.prior_weight) : gm;
  return Math.log10(Math.min(model.multiple_cap, Math.max(model.multiple_floor, m)));
}

/** Median absolute log10 error of a predictor over the points, leave-one-out. */
function looMedian(points: ComparablePoint[], predict: (train: ComparablePoint[], held: ComparablePoint) => number): number {
  if (points.length < 2) return 0;
  const errs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const train = points.slice(0, i).concat(points.slice(i + 1));
    const held = points[i]!;
    errs.push(Math.abs(predict(train, held) - Math.log10(held.ratio)));
  }
  return median(errs);
}

/**
 * The blind test, run before the curve is trusted. Leave-one-out over every comparable:
 * the fitted curve against the flat category median. And a time split: fit on the tokens
 * listed before 2024-01-01, test on the ones listed after. Both report the median
 * absolute log10 error; smaller is a better price.
 */
export function blindTest(points: ComparablePoint[], model: ModelConstants): BlindTest {
  const curveLoo = looMedian(points, (train, held) => {
    const fit = fitCurve(train);
    return fit.intercept + fit.slope * Math.log10(held.tvl_usd);
  });
  const flatLoo = looMedian(points, (train, held) => flatPrediction(train, held.category, model));
  const dated = points.filter((pt) => pt.listed_at !== null);
  const train = dated.filter((pt) => (pt.listed_at as string) < '2024-01-01');
  const test = dated.filter((pt) => (pt.listed_at as string) >= '2024-01-01');
  let splitMedian = 0;
  let splitFlat = 0;
  if (train.length >= 2 && test.length > 0) {
    const fit = fitCurve(train);
    const errs = test.map((pt) => Math.abs(fit.intercept + fit.slope * Math.log10(pt.tvl_usd) - Math.log10(pt.ratio)));
    splitMedian = median(errs);
    const flatErrs = test.map((pt) => Math.abs(flatPrediction(train, pt.category, model) - Math.log10(pt.ratio)));
    splitFlat = median(flatErrs);
  }
  return { loo_n: points.length, loo_median: curveLoo, loo_flat_median: flatLoo, split_n: test.length, split_median: splitMedian, split_flat_median: splitFlat };
}

/** A seeded generator, so the bootstrap refits are the same on every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Per-category medians from every protocol in the category: seven-day growth (only
 * protocols that report one) and TVL. The growth median is the baseline the model's
 * category-relative factor measures a protocol against; the TVL median is the context
 * the detail view shows next to the protocol's own TVL.
 */
export function categoryMedians(snapshot: Snapshot): { growth: CategoryGrowth[]; tvl: CategoryGrowth[] } {
  const growthBy = new Map<string, number[]>();
  const tvlBy = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    const cat = p.category ?? 'Other';
    if (typeof p.change_7d === 'number' && Number.isFinite(p.change_7d)) {
      const list = growthBy.get(cat) ?? [];
      list.push(p.change_7d);
      growthBy.set(cat, list);
    }
    if (p.tvl_usd > 0) {
      const list = tvlBy.get(cat) ?? [];
      list.push(p.tvl_usd);
      tvlBy.set(cat, list);
    }
  }
  const byName = (a: CategoryGrowth, b: CategoryGrowth): number => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0);
  const growth = [...growthBy.entries()]
    .map(([category, values]) => ({ category, median: median(values), reporters: values.length }))
    .sort(byName);
  const tvl = [...tvlBy.entries()]
    .map(([category, values]) => ({ category, median: median(values), reporters: values.length }))
    .sort(byName);
  return { growth, tvl };
}

/** A category's median seven-day growth, or null when no protocol in it reports one. */
export function growthMedianFor(category: string | null, growthMedians: CategoryGrowth[]): number | null {
  const found = growthMedians.find((g) => g.category === (category ?? 'Other'));
  return found === undefined ? null : found.median;
}

/** A category's median TVL, or null when the category holds no protocol with a TVL. */
export function tvlMedianFor(category: string | null, tvlMedians: CategoryGrowth[]): number | null {
  const found = tvlMedians.find((g) => g.category === (category ?? 'Other'));
  return found === undefined ? null : found.median;
}

/** The implied value and every factor behind it, for one protocol. */
export function scoreProtocol(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: FittedCurve,
  globalMedian: number,
  growthMedians: CategoryGrowth[],
  model: ModelConstants,
): { implied: number; breakdown: ModelBreakdown } {
  const age = ageDays(asOf, protocol.listed_at);
  const multiple = curveMultiple(protocol.tvl_usd, fit, model);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const weight = growthPct >= 0 ? model.growth_weight : model.growth_weight_down;
  const growthMult = 1 + (growthPct / 100) * weight;
  const catGrowth = growthMedianFor(protocol.category, growthMedians);
  const vsCategory = catGrowth === null ? 0 : growthPct - catGrowth;
  const relClamped = Math.min(model.growth_rel_cap, Math.max(-model.growth_rel_cap, vsCategory / model.growth_rel_scale));
  const relMult = 1 + relClamped * model.growth_rel_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const spreadMult = 1 + model.spread_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.spread_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * relMult * maturityMult * spreadMult));
  return {
    implied,
    breakdown: {
      category_multiple: multiple,
      category_comparables: fit.comparables,
      category_median: globalMedian,
      global_median: globalMedian,
      category_growth_median: catGrowth,
      growth_vs_category: vsCategory,
      growth_pct: growthPct,
      growth_multiplier: growthMult,
      growth_relative_multiplier: relMult,
      maturity_multiplier: maturityMult,
      diversification_multiplier: spreadMult,
      age_days: age,
    },
  };
}

/** The house's watchlist exclusions, applied to early rows: no exchange, bridge, staked or wrapped product. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a pre-token protocol below the floor may join the early radar. */
export function isEarlyCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

/** The ranked board: every watchlist slug, plus the strongest early candidates by implied value. */
/**
 * The band and rank range for every row, from refitting the curve on resampled comparables.
 * Each refit draws the same number of points with replacement from the comparables, using
 * a fixed seed, so the band is identical on every run. A row's band is the 10th to 90th
 * percentile of its implied value across the refits; its rank range is its best and worst
 * rank across them.
 */
function bootstrapBands(
  scored: { p: SnapshotProtocol; score: { implied: number; breakdown: ModelBreakdown } }[],
  points: ComparablePoint[],
  model: ModelConstants,
): Map<string, { low: number; high: number; rankLow: number; rankHigh: number }> {
  const refits: FittedCurve[] = [];
  const rand = mulberry32(model.bootstrap_seed);
  for (let b = 0; b < model.bootstrap_refits; b++) {
    const sample: ComparablePoint[] = [];
    for (let i = 0; i < points.length; i++) sample.push(points[Math.floor(rand() * points.length)]!);
    refits.push(fitCurve(sample));
  }
  const perRow = new Map<string, number[]>();
  const rankLists: Map<string, number>[] = [];
  for (const fit of refits) {
    const vals = scored.map(({ p, score }) => {
      const mult = curveMultiple(p.tvl_usd, fit, model);
      const implied = Math.max(
        1,
        Math.round(
          p.tvl_usd *
            mult *
            score.breakdown.growth_multiplier *
            score.breakdown.growth_relative_multiplier *
            score.breakdown.maturity_multiplier *
            score.breakdown.diversification_multiplier,
        ),
      );
      return { slug: p.slug, implied };
    });
    const order = [...vals].sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const ranks = new Map<string, number>();
    order.forEach((v, i) => ranks.set(v.slug, i + 1));
    rankLists.push(ranks);
    for (const v of vals) {
      const list = perRow.get(v.slug) ?? [];
      list.push(v.implied);
      perRow.set(v.slug, list);
    }
  }
  const out = new Map<string, { low: number; high: number; rankLow: number; rankHigh: number }>();
  for (const { p } of scored) {
    const vals = [...(perRow.get(p.slug) ?? [])].sort((a, b) => a - b);
    const n = vals.length;
    const low = n > 0 ? vals[Math.floor(0.1 * (n - 1))]! : 0;
    const high = n > 0 ? vals[Math.floor(0.9 * (n - 1))]! : 0;
    let rankLow = Infinity;
    let rankHigh = 0;
    for (const ranks of rankLists) {
      const r = ranks.get(p.slug) ?? 0;
      if (r < rankLow) rankLow = r;
      if (r > rankHigh) rankHigh = r;
    }
    out.set(p.slug, { low, high, rankLow, rankHigh });
  }
  return out;
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { globalMedian, points } = comparables(snapshot, model);
  const fit = fitCurve(points);
  const { growth: growthMedians } = categoryMedians(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isEarlyCandidate(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of, fit, globalMedian, growthMedians, model) }))
    .sort((a, b) => b.score.implied - a.score.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const { p } of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const score = scoreProtocol(p, snapshot.as_of, fit, globalMedian, growthMedians, model);
    return { p, score };
  });
  scored.sort((a, b) => b.score.implied - a.score.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const bands = bootstrapBands(scored, points, model);
  return scored.map(({ p, score }, i) => {
    const band = bands.get(p.slug) ?? { low: score.implied, high: score.implied, rankLow: i + 1, rankHigh: i + 1 };
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      age_days: score.breakdown.age_days,
      implied_value_usd: score.implied,
      implied_low_usd: band.low,
      implied_high_usd: band.high,
      rank_low: band.rankLow,
      rank_high: band.rankHigh,
      model: score.breakdown,
      farm_steps: farmPlan(p, score.breakdown.age_days, score.implied, band.low, model).map(flattenStep),
    };
  });
}

// ---------------------------------------------------------------- farm plans

/** FNV-1a hash: picks a phrasing variant deterministically from the slug. Identical in the page. */
export function hashSlug(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One playbook: the category keywords it matches, and its two protocol-specific actions. */
interface Playbook {
  keys: string[];
  main: string;
  second: string;
}

/**
 * The playbook table. ${name}, ${capital} and ${chain} are filled from the protocol's own
 * record. The dashboard's script carries this same table, so the plan the page shows is the
 * plan board.json carries, word for word.
 */
const PLAYBOOKS: Playbook[] = [
  {
    keys: ['lend', 'cdp', 'collateral'],
    main: 'Supply $${capital} of USDC to ${name} on ${chain} and keep the position supplied.',
    second: 'Borrow a small amount against the supplied collateral and repay it within the week, so both sides of the market show activity.',
  },
  {
    keys: ['index'],
    main: "Buy $${capital} of ${name}'s index token on ${chain} and hold it.",
    second: "Check the index's rebalance once and add a small amount after it, keeping the position whole.",
  },
  {
    keys: ['dex'],
    main: "Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position open.",
    second: 'Route one swap through ${name} on ${chain} each week, keeping the receipt in the same wallet.',
  },
  {
    keys: ['yield', 'farm', 'leveraged'],
    main: "Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares.",
    second: "Claim and re-deposit the vault's yield once, so the position compounds instead of sitting idle.",
  },
  {
    keys: ['deriv', 'perpetual', 'option', 'interest rate', 'synthetic'],
    main: 'Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.',
    second: 'Close and reopen the hedge once a week at a different size, keeping total exposure under $${capital}.',
  },
  {
    keys: ['rwa'],
    main: "Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.",
    second: "Check the asset's backing report once a month and keep the holding through at least one reporting cycle.",
  },
  {
    keys: ['stak', 'restak'],
    main: "Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.",
    second: 'Restake or delegate the receipt once, where the protocol offers it, and leave the position staked.',
  },
  {
    keys: ['bridge'],
    main: 'Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside its app.',
    second: 'Bridge a second, smaller amount back a week later so the route shows two-way use.',
  },
  {
    keys: ['prediction'],
    main: 'Fund $${capital} on ${name} and take one position in its most liquid market.',
    second: 'Take a second position in a different market the following week and hold both to resolution.',
  },
  {
    keys: ['curator', 'allocator'],
    main: 'Deposit $${capital} into a ${name} vault on ${chain} and keep the shares for the full hold.',
    second: "Review the vault's allocation report once and move a small amount between its strategies if it allows it.",
  },
  {
    keys: ['stable'],
    main: 'Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.',
    second: 'Redeem a small test amount and re-mint it, confirming the peg mechanism works from your wallet.',
  },
  {
    keys: ['insurance'],
    main: 'Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.',
    second: "Read the policy's claim conditions once and keep the cover through the full hold period.",
  },
  {
    keys: ['chain'],
    main: "Bridge $${capital} to ${chain} through ${name}'s own route and use one native app on the chain.",
    second: "Stake a small amount of the chain's native asset through ${name} and keep it staked.",
  },
  {
    keys: ['basis'],
    main: "Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open through one funding cycle.",
    second: 'Check the funding rate once a week and keep the position while the basis stays positive.',
  },
  {
    keys: ['anchor btc', 'decentralized btc'],
    main: 'Deposit $${capital} of BTC into ${name} on ${chain} and hold the receipt token.',
    second: 'Check the backing and redemption route once, then keep the position through the full hold.',
  },
  {
    keys: ['payment'],
    main: 'Spend $${capital} through ${name} on ${chain} for a real payment and keep the receipt in the farming wallet.',
    second: 'Make a second, smaller payment the following week so the wallet shows repeat use.',
  },
  {
    keys: ['liquidity manager'],
    main: "Deposit $${capital} of USDC into a ${name} managed position on ${chain} and keep the shares.",
    second: "Check the manager's rebalance once and leave the position in place through it.",
  },
  {
    keys: ['otc'],
    main: 'Complete one $${capital} trade through ${name} on ${chain} and keep the settlement receipt.',
    second: 'Make a second, smaller trade the following week from the same wallet.',
  },
  {
    keys: ['privacy'],
    main: 'Use $${capital} through ${name} on ${chain} for one private transaction and keep the receipt.',
    second: 'Repeat the same action once the following week from the same wallet.',
  },
  {
    keys: ['governance'],
    main: 'Deposit $${capital} into ${name} on ${chain} and vote once on an open proposal.',
    second: 'Vote on a second proposal the following week and keep the position through the hold.',
  },
  {
    keys: ['card issuer', 'crypto card'],
    main: 'Order and fund a $${capital} card through ${name} and make one real purchase with it.',
    second: 'Make a second purchase the following week and keep the card funded through the hold.',
  },
  {
    keys: ['cedefi'],
    main: 'Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.',
    second: 'Check the yield report once and keep the deposit through one full reporting cycle.',
  },
  {
    keys: ['nft'],
    main: 'Buy one ${name} listing worth about $${capital} on ${chain} and hold it in the farming wallet.',
    second: 'List or trade once more the following week so the wallet shows repeat activity.',
  },
  {
    keys: ['launchpad'],
    main: 'Stake $${capital} through ${name} on ${chain} to qualify for its next launch and keep the stake.',
    second: 'Join one launch allocation and hold the allocation through the full hold.',
  },
  {
    keys: ['ai agents', 'decentralized ai'],
    main: 'Pay $${capital} for one agent run through ${name} on ${chain} and keep the receipt.',
    second: 'Run a second, different agent task the following week from the same wallet.',
  },
];

const DEFAULT_PLAYBOOK: Playbook = {
  keys: [],
  main: 'Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.',
  second: 'Make one more deposit or interaction the following week so the wallet shows repeat use.',
};

/** The playbook a category falls in: first keyword match wins, else the default. */
function playbookFor(category: string | null): Playbook {
  const c = (category ?? '').toLowerCase();
  for (const book of PLAYBOOKS) {
    if (book.keys.some((key) => c.includes(key))) return book;
  }
  return DEFAULT_PLAYBOOK;
}

/** Fill a playbook template from the protocol's own record. */
function fill(template: string, name: string, capital: number, chain: string): string {
  return template.replaceAll('${name}', name).replaceAll('${capital}', String(capital)).replaceAll('${chain}', chain);
}

/** The capital one farm position needs, from the protocol's TVL tier. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/** The hold that spans more than one snapshot: younger protocols get a longer window. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Gas estimates by the protocol's first chain: Ethereum mainnet costs more than the rest. */
function gasFor(chain: string): { setup: number; weekly: number } {
  return chain === 'Ethereum' ? { setup: 12, weekly: 4 } : { setup: 3, weekly: 1 };
}

const CADENCE: string[] = [
  'Make one qualifying action each week: a deposit, a borrow, a swap or a vote, from the same wallet.',
  "Return once a week and repeat the main action at a smaller size, so the wallet's activity spans several snapshots.",
];

const CLOSING: string[] = [
  "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
  "When the hold ends, check the protocol's own rewards page first, and claim only through the link it publishes.",
];

/**
 * A protocol's eight-step farm plan, derived from its own record: category, first chain, TVL
 * tier and age. Two steps vary their phrasing by a hash of the slug, so neighbouring rows do
 * not read as copies. Every step carries what it costs and how long it takes.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null, implied: number, impliedLow: number, model: ModelConstants = MODEL): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const hold = holdFor(age);
  const gas = gasFor(chain);
  const book = playbookFor(p.category);
  const variant = hashSlug(p.slug) % 2;
  const cost = planCost(p, age);
  const total = cost.capital + cost.gas;
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'nothing to set up; under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `Move $${capital} of USDC plus gas to ${chain} and confirm it lands in the farming wallet.`,
      cost: `about $${gas.setup} of gas to move the funds`,
      time: '10 minutes',
    },
    {
      text: fill(book.main, p.name, capital, chain),
      cost: `$${capital} of capital and about $${gas.setup} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: fill(book.second, p.name, capital, chain),
      cost: `about $${gas.setup} of gas`,
      time: '10 minutes',
    },
    {
      text: CADENCE[variant]!,
      cost: `about $${gas.weekly} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Check ${p.name}'s own points or rewards page once a month and note any new quest or snapshot date.`,
      cost: 'nothing; the page is free to read',
      time: '5 minutes a month',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: CLOSING[variant]!,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: nettingStep(p, age, implied, impliedLow, model),
      cost: `$${fmtInt(total)} in all`,
      time: '1 minute to read',
    },
  ];
}

/** Whole dollars with thousands separators, the same in Node and in the page. */
export function fmtInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The farm verdict, from the low end of the value band: what the prize is worth even pessimistically. */
export function verdictFor(impliedLow: number, model: ModelConstants): 'FARM' | 'THIN' | 'SKIP' {
  if (impliedLow >= model.verdict_farm_usd) return 'FARM';
  if (impliedLow >= model.verdict_thin_usd) return 'THIN';
  return 'SKIP';
}

/** The plan's total cost: the capital plus all the gas the hold takes. */
export function planCost(p: SnapshotProtocol, age: number | null): { capital: number; gas: number; hold: number } {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const hold = holdFor(age);
  const gas = gasFor(chain);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  return { capital, gas: gas.setup * 3 + gas.weekly * weeks, hold };
}

/**
 * The ninth step: the plan netted to the dollar. Total cost against the implied value,
 * what the tokens received must be worth to break even, and a verdict from the low end
 * of the band. The verdict is about prize size, not cost: the cost is small next to
 * every row's value, so what matters is whether even the pessimistic value is a prize.
 */
export function nettingStep(p: SnapshotProtocol, age: number | null, implied: number, impliedLow: number, model: ModelConstants): string {
  const cost = planCost(p, age);
  const total = cost.capital + cost.gas;
  const verdict = verdictFor(impliedLow, model);
  const reason = verdict === 'FARM' ? 'even the low end is a prize worth the cost' : verdict === 'THIN' ? 'the low end is modest, so keep the position small' : 'the low end is too small to chase';
  return (
    `Netting: $${fmtInt(cost.capital)} of capital plus about $${fmtInt(cost.gas)} of gas, $${fmtInt(total)} in all, ` +
    `against an implied value of $${fmtInt(implied)} (low end $${fmtInt(impliedLow)}). ` +
    `The plan pays for itself if the tokens you receive are worth $${fmtInt(total)}. ` +
    `Verdict: ${verdict}, ${reason}.`
  );
}
/** One step as the board's single string, kept inside the gate's 20..600 characters. */
export function flattenStep(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

// ---------------------------------------------------------------- live set

/** Live-token protocols by market cap, exchanges aside, with the ratio the curve is fitted on. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? p.mcap_usd / p.tvl_usd : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    rank_low: row.rank_low,
    rank_high: row.rank_high,
    category_multiple: row.model.category_multiple,
    category_comparables: row.model.category_comparables,
    category_median: row.model.category_median,
    growth_vs_category: row.model.growth_vs_category,
    on_watchlist: onWatchlist,
    growth_multiplier: row.model.growth_multiplier,
    growth_relative_multiplier: row.model.growth_relative_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    diversification_multiplier: row.model.diversification_multiplier,
  };
}

/** A versioned product name, the pattern the earlier model excluded and this one admits. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The snapshot accounted for, all of it: every protocol is traded, on the watchlist,
 * ranked early, excluded below the floor, or excluded above it. The five numbers must
 * add to the total; the board's coverage line prints them so the reader can check.
 */
export function coverageOf(snapshot: Snapshot, board: BoardRow[]): Coverage {
  const watchlist = new Set(snapshot.watchlist);
  let traded = 0;
  let watchlistN = 0;
  let excludedBelow = 0;
  let excludedAbove = 0;
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) {
      traded++;
    } else if (watchlist.has(p.slug)) {
      watchlistN++;
    } else if (p.tvl_usd >= snapshot.floor_usd) {
      excludedAbove++;
    } else if (!isEarlyCandidate(p)) {
      excludedBelow++;
    }
  }
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const versionedAdmitted = board.filter((r) => !watchlist.has(r.slug) && VERSIONED_NAME.test(r.name)).length;
  return {
    total: snapshot.protocols.length,
    traded,
    watchlist: watchlistN,
    early,
    versioned_admitted: versionedAdmitted,
    excluded_below: excludedBelow,
    excluded_above: excludedAbove,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { globalMedian, points } = comparables(snapshot, model);
  const fit = fitCurve(points);
  const validation = blindTest(points, model);
  const coverage = coverageOf(snapshot, board);
  const { growth: growthMedians, tvl: tvlMedians } = categoryMedians(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_median: globalMedian,
    fit,
    validation,
    coverage,
    growth_medians: growthMedians,
    category_tvl_medians: tvlMedians,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- input

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

// ---------------------------------------------------------------- gate self-check

/** Why a board is not one the gate will take, or null when it passes every row of the gate. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `row ${i + 1} carries rank ${board[i]!.rank}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
