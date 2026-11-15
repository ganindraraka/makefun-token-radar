// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value is what a token would be worth if the protocol's record stayed as it is. It follows
// only from the snapshot's own figures, and every term is stated on the page:
//
//   tvl        = tvl_usd                          (whole dollars, the protocol's own TVL)
//   flow       = clamp(change_7d, -60, 120) / 100      (seven-day growth, winsorised and scaled)
//   age        = days since listed_at, else UNKNOWN_AGE_DAYS
//
//   flowMult    = growth(flow)                    (an asymmetric, concave curve — see growthMultiplier)
//   maturityMult= MATURITY_FLOOR + min(age,YOUNG_AGE)/YOUNG_AGE x RISING   (proven protocols)
//   youthMult   = age < YOUNG_AGE ? YOUTH_BOOST + (age/YOUNG_AGE) x (1-YOUTH_BOOST) : 1
//                                                 (a small upside boost for very young singles)
//   categoryAdj = the category's capital multiple, e.g. an allocator's TVL counts less than a DEX's
//   breadthMult = 1 + CHAIN_BOOST x min(chains, CHAIN_SATURATION)/CHAIN_SATURATION
//                                                 (a protocol deployed widely is a stronger subject)
//   floorMult   = early rows just below the watchlist floor get a small lift that fades with depth
//
//   implied = round( tvl x BASE_MULTIPLE x categoryAdj x flowMult x maturityMult x youthMult
//                          x breadthMult x floorMult )
//
// BASE_MULTIPLE is near the median of live-token protocols' market cap over TVL, so an unremarkable
// pre-token protocol's implied value lands near what the market pays for a comparable live one. No
// protocol name is ever special-cased: the same function scores every row.
//
// The plan beside each row is derived from the same record: category, chains, TVL and age decide the
// action, the capital, the hold and every cost and time it states.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and a reader may reason about. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_down_weight: number;
  growth_curve: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_rise: number;
  young_age_days: number;
  youth_boost: number;
  unknown_age_days: number;
  chain_boost: number;
  chain_saturation: number;
  floor_proximity_boost: number;
  floor_proximity_span: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.22,
  growth_weight: 0.8,
  growth_down_weight: 0.55,
  growth_curve: 0.85,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.5,
  maturity_rise: 0.5,
  young_age_days: 240,
  youth_boost: 1.18,
  unknown_age_days: 300,
  chain_boost: 0.12,
  chain_saturation: 4,
  floor_proximity_boost: 0.08,
  floor_proximity_span: 0.5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
  model: {
    base_multiple: number;
    category_multiplier: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    youth_multiplier: number;
    breadth_multiplier: number;
    floor_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiplier: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  youth_multiplier: number;
  breadth_multiplier: number;
  floor_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
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
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The category's capital multiple: how much of a protocol's TVL a token would plausibly be valued
 * against. Capital that sits in a passive allocator or a staked wrapper is a weaker claim on a token
 * than a DEX's or a lending market's own book, so its TVL counts a little less; a protocol that runs
 * its own chain or an exchange-like venue counts a little more. Keyed by DefiLlama's own category
 * strings, never by a protocol's name.
 *
 * The tiers, strongest claim first, are fixed multipliers rather than sliding ones so a reader can
 * reproduce any row by hand:
 *   1.15  a chain, a CEX or a CeDeFi venue: the protocol is the settlement layer itself;
 *   1.10  a DEX, a perpetual/derivative book or a lending/CDP/stablecoin issuer:
 *         the TVL is the protocol's own risk-bearing capital;
 *   1.05  a yield venue, a liquidity manager, a prediction market or an insurance writer:
 *         the TVL is capital the protocol actively steers;
 *   1.00  everything else: BTC anchors, index products and unnamed categories (the neutral case);
 *   0.95  an RWA or payments rail: real capital, but it moves through rather than sticks;
 *   0.90  a bridge: the TVL is other people's TVL waiting to cross;
 *   0.85  a liquid-staking or restaking wrapper: a receipt of a claim that already exists;
 *   0.78  a curator or allocator: someone else's capital under a mandate, the weakest claim.
 */
export function categoryMultiplier(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c === '') return 1;
  if (c.includes('curator') || c.includes('allocator')) return 0.78;
  if (c.includes('liquid staking') || c.includes('liquid restak') || c.includes('restak') || c.includes('staking pool')) return 0.85;
  if (c.includes('canonical bridge') || c.includes('cross chain bridge') || c.includes('bridge')) return 0.9;
  if (c.includes('rwa') || c.includes('payments') || c.includes('card')) return 0.95;
  if (c.includes('insurance')) return 1.0;
  if (c.includes('chain') || c.includes('cex') || c.includes('cedefi')) return 1.15;
  if (c.includes('dex') || c.includes('perpetual') || c.includes('derivative') || c.includes('leveraged farm')) return 1.1;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('stable') || c.includes('synthetics')) return 1.1;
  if (c.includes('yield') || c.includes('farm') || c.includes('basis') || c.includes('liquidity manager') || c.includes('prediction')) return 1.05;
  return 1;
}

/** The five multipliers and the implied value one protocol gets under `model`. */
export interface ValueParts {
  implied: number;
  categoryMult: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  youthMult: number;
  breadthMult: number;
  floorMult: number;
  age: number | null;
}

/**
 * The growth multiplier: an asymmetric, concave curve over clamped seven-day change.
 *
 *   - Concave (GROWTH_CURVE < 1): a 20% week is worth much more than a 2% one, but a 120% week is
 *     not worth six times a 20% one. TVL prints at the extremes are usually one deposit or one
 *     withdrawal, so the curve keeps its shape through the middle and flattens at the ends.
 *   - Asymmetric (GROWTH_DOWN_WEIGHT < GROWTH_WEIGHT): a fall of x% costs less than a rise of x%
 *     earns. A protocol whose TVL dipped in a rough week is not thereby a worse subject; a protocol
 *     whose TVL is being used more is. The downside leg is deliberately gentler.
 *
 * growthPct is signed; the curve applies sign(s) x |pct|^curve, kept continuous through 0.
 */
export function growthMultiplier(growthPct: number, model: ModelConstants): number {
  const magnitude = Math.pow(Math.abs(growthPct) / 100, model.growth_curve);
  const weight = growthPct >= 0 ? model.growth_weight : model.growth_down_weight;
  return 1 + Math.sign(growthPct) * magnitude * weight;
}

/**
 * The chain-breadth multiplier: a small, saturating lift for a protocol deployed on more chains.
 *
 *   breadthMult = 1 + CHAIN_BOOST x min(chains, CHAIN_SATURATION) / CHAIN_SATURATION
 *
 * A protocol live on several chains has more places to be used, so a little more claim on a future
 * token. It saturates at CHAIN_SATURATION because past a handful of chains the extra deployments
 * are often thin copies, and a protocol with no named chain gets the neutral multiplier.
 */
export function chainBreadthMultiplier(chains: string[], model: ModelConstants): number {
  if (chains.length === 0) return 1;
  const spread = Math.min(chains.length, model.chain_saturation) / model.chain_saturation;
  return 1 + model.chain_boost * spread;
}

/**
 * The floor-proximity multiplier: a small lift for an early row sitting just below the watchlist floor.
 *
 *   depth  = (floor_usd - tvl_usd) / floor_usd          (how far below the floor, in floor units)
 *   floorMult = 1 + FLOOR_PROXIMITY_BOOST x clamp(1 - depth / SPAN, 0, 1)
 *
 * A protocol just under $50M of TVL is nearly what the house's rule would have kept, and it is the
 * kind of protocol a reader can actually farm now; one far below the floor is earlier and riskier.
 * Watchlist rows (at or above the floor, depth <= 0) get the full lift, so the term never reorders
 * the coverage rows among themselves; it only lifts the near-floor early rows over the deep ones.
 */
export function floorProximityMultiplier(tvlUsd: number, floorUsd: number, model: ModelConstants): number {
  if (floorUsd <= 0) return 1;
  const depth = (floorUsd - tvlUsd) / floorUsd;
  const nearness = Math.min(1, Math.max(0, 1 - depth / model.floor_proximity_span));
  return 1 + model.floor_proximity_boost * nearness;
}

export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants, floorUsd = 0): ValueParts {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = growthMultiplier(growthPct, model);

  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.young_age_days) / model.young_age_days) * model.maturity_rise;

  // A very young protocol is still on its launch curve: a small upside boost that fades to 1 as it
  // ages. An unknown age gets the boost only if its listed_at was absent (treated as young).
  const youthMult = ageForModel < model.young_age_days ? model.youth_boost + (ageForModel / model.young_age_days) * (1 - model.youth_boost) : 1;

  const categoryMult = categoryMultiplier(protocol.category);
  const breadthMult = chainBreadthMultiplier(protocol.chains, model);
  const floorMult = floorProximityMultiplier(protocol.tvl_usd, floorUsd, model);
  const base = protocol.tvl_usd * model.base_multiple * categoryMult;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * youthMult * breadthMult * floorMult));
  return { implied, categoryMult, growthPct, growthMult, maturityMult, youthMult, breadthMult, floorMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const parts = impliedValue(p, snapshot.as_of, model, snapshot.floor_usd);
    return { p, ...parts };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      category_multiplier: s.categoryMult,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      youth_multiplier: s.youthMult,
      breadth_multiplier: s.breadthMult,
      floor_multiplier: s.floorMult,
      age_days: s.age,
    },
    farm_steps: planStrings(s.p, s.age, s.implied),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A comma list of the protocol's chains, capped, for a step's wording. */
function chainsOf(p: SnapshotProtocol): string {
  if (p.chains.length === 0) return 'its main chain';
  if (p.chains.length === 1) return p.chains[0]!;
  if (p.chains.length === 2) return `${p.chains[0]} and ${p.chains[1]}`;
  return `${p.chains[0]}, ${p.chains[1]} and ${p.chains.length - 2} more`;
}

/** How much capital one farm position needs, from the protocol's own TVL and yield profile. */
function capitalFor(p: SnapshotProtocol): number {
  const t = p.tvl_usd;
  if (t >= 5_000_000_000) return 300;
  if (t >= 1_000_000_000) return 200;
  if (t >= 250_000_000) return 150;
  if (t >= 50_000_000) return 100;
  if (t >= 10_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 90;
  if (age < 240) return 75;
  if (age < 500) return 60;
  if (age < 900) return 45;
  return 30;
}

/** Gas, in whole dollars, a step of one transaction costs on the protocol's first chain. */
function gasFor(p: SnapshotProtocol): number {
  const chain = (p.chains[0] ?? '').toLowerCase();
  if (chain === 'ethereum') return 12;
  if (chain.includes('bitcoin') || chain.includes('bsquared') || chain.includes('babylon') || chain.includes('core')) return 6;
  if (chain === 'solana') return 3;
  return 3;
}

/**
 * The category's one action, its specific instrument and its own wording. Derived from DefiLlama's
 * category string and the protocol's chains, never from a hand-written list of protocol names.
 */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Allocate $${capital} of USDC into a ${name} vault on ${chain}, once you read what it holds and who its curator is.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name}'s market on ${chain}, then borrow a small amount against it and repay it, so the position counts as real use.`;
  if (c.includes('liquid staking') || c.includes('liquid restak')) return `Mint $${capital} of ${name}'s liquid staking token on ${chain} and hold the receipt, then restake it once if the pool is open.`;
  if (c.includes('restak') || c.includes('staking pool')) return `Restake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('canonical bridge') || c.includes('cross chain bridge') || c.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} through ${name}, use the bridged funds in one app, then bridge a little of it back.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} into ${name}'s deepest pool on ${chain}, hold the LP receipt, and claim the fees weekly.`;
  if (c.includes('yield') && c.includes('aggregat')) return `Deposit $${capital} of USDC into ${name}'s best vault on ${chain} and keep the shares.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s main strategy on ${chain} and keep the position for the full season.`;
  if (c.includes('basis')) return `Put $${capital} into ${name}'s basis or delta-neutral vault on ${chain} and hold through at least one funding cycle.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option') || c.includes('synthetic')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain}, open one small beta-neutral position, and close it once.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}, then resolve it.`;
  if (c.includes('stable') || c.includes('cdp manager')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it through the season.`;
  if (c.includes('rwa') || c.includes('index')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain}, hold it, and redeem a little at the end.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy to the end of the season.`;
  if (c.includes('payments') || c.includes('card')) return `Move $${capital} through ${name}'s payment rail on ${chain} in a few small transfers and count them.`;
  if (c.includes('chain') || c.includes('governance') || c.includes('launchpad')) return `Bridge $${capital} to ${name} on ${chain}, use one app there, and keep the wallet active across the season.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open through the season.`;
}

/** The plan's six concrete steps for one protocol, each an action with a cost and a time. */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number): FarmStep[] {
  const chain = chainOf(p);
  const chainsList = chainsOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(p);
  const action = actionFor(p, capital, chain);
  const ageWords = age === null ? 'an unlisted record' : `${age} days`;
  const upside = implied >= 1_000_000_000 ? 'a large' : implied >= 100_000_000 ? 'a real' : 'an early';
  return [
    {
      text: `Set up a fresh wallet for ${p.name} alone, seed it with about $${gas * 4} for gas, and keep its seed phrase offline. The model ranks it ${upside} implied value, so keep this and any other farm in separate wallets.`,
      cost: `about $${gas * 4} of gas to move in`,
      time: '10 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas for the first transaction`,
      time: '20 minutes to set up',
    },
    {
      text: `Use the protocol once more each week from the same wallet, on ${chainsList}: a swap, a deposit, a borrow or a claim, small enough to cost little.`,
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position at least ${hold} days, so its activity falls in more than one DefiLlama snapshot; the protocol has run ${ageWords} with no token on record.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only through the link the protocol publishes; never pay, sign a blind message or share a seed to claim.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Record the wallet address, each date and every transaction hash in one farm log so the position can be repeated or unwound, and check ${chain} fees before moving out.`,
      cost: 'nothing but the log',
      time: '10 minutes',
    },
  ];
}

/** The plan's steps as the gate's strings: 3 to 12, each 20 to 600 characters once trimmed. */
function planStrings(p: SnapshotProtocol, age: number | null, implied: number): string[] {
  return farmSteps(p, age, implied).map(stepText);
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
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
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiplier: row.model.category_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    youth_multiplier: row.model.youth_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    floor_multiplier: row.model.floor_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
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
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

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
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
