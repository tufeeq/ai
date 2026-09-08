import fs from 'node:fs';

const FEED = process.argv[2] || 'tag/data/tagit-signal-feed.json';
const POLICY = process.argv[3] || 'tag/data/tagit-opportunity-policy.json';

const feed = JSON.parse(fs.readFileSync(FEED, 'utf8'));
const policy = JSON.parse(fs.readFileSync(POLICY, 'utf8'));
const rules = policy.livePromotionIntegrity || {};
const items = Array.isArray(feed.items) ? feed.items : [];
const activeSessions = new Set(['pre-market', 'regular', 'after-hours']);
const session = String(feed.session || 'unknown').toLowerCase();

const violations = [];
if (feed.sessionConsistent === false && items.some(x => ['WATCH','DISCOVER'].includes(String(x.state||'').toUpperCase()))) {
  violations.push(`feed: actionable/discovery states emitted while sessionConsistent=false (${feed.rawSession} -> ${session})`);
}
for (const item of items) {
  const state = String(item.state || '').toUpperCase();
  if (state === 'DISCOVER' && item.liquidityRadarEligible !== true) {
    violations.push(`${item.symbol}: DISCOVER without liquidityRadarEligible=true`);
  }
  if (state !== 'WATCH') continue;
  if (rules.watchRequiresExecutionVerified && item.executionVerified !== true) violations.push(`${item.symbol}: WATCH without executionVerified=true`);
  if (rules.watchRequiresHealthySource && feed.sourceHealthy !== true) violations.push(`${item.symbol}: WATCH while sourceHealthy!=true`);
  if (rules.watchRequiresActiveSession && !activeSessions.has(session)) violations.push(`${item.symbol}: WATCH outside active session (${session})`);
  if (rules.fallbackDiscoveryMayNotPromoteToWatch && feed.fallbackMode) violations.push(`${item.symbol}: WATCH emitted from fallbackMode=${feed.fallbackMode}`);
  if (item.liquidityWatchEligible !== true) violations.push(`${item.symbol}: WATCH without liquidityWatchEligible=true`);
  if (item?.liquidity?.volume != null && item.liquidity.volume < (item?.liquidity?.sessionThresholds?.watchVol ?? 0)) violations.push(`${item.symbol}: WATCH below absolute share-volume threshold`);
  if (item?.liquidity?.dollarVolume != null && item.liquidity.dollarVolume < (item?.liquidity?.sessionThresholds?.watchDollar ?? 0)) violations.push(`${item.symbol}: WATCH below dollar-volume threshold`);
}

const fallbackUnverified = Boolean(feed.fallbackMode) && feed.executionVerified !== true;
if (fallbackUnverified) for (const item of items) {const state=String(item.state||'').toUpperCase();if(['WATCH','DISCOVER'].includes(state)) violations.push(`${item.symbol}: ${state} emitted from execution-unverified fallback feed`);}

const summary = {
  feed: FEED, session, rawSession: feed.rawSession || null, sessionConsistent: feed.sessionConsistent ?? null,
  sourceHealthy: Boolean(feed.sourceHealthy), fallbackMode: feed.fallbackMode || null,
  total: items.length,
  watch: items.filter(x => String(x.state).toUpperCase() === 'WATCH').length,
  discover: items.filter(x => String(x.state).toUpperCase() === 'DISCOVER').length,
  verifiedWatch: items.filter(x => String(x.state).toUpperCase() === 'WATCH' && x.executionVerified === true).length,
  liquidityRejected: items.filter(x => x.liquidityRadarEligible === false).length,
  violations
};
console.log(JSON.stringify(summary, null, 2));
if (violations.length) process.exit(1);
