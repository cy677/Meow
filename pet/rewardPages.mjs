/** Pure pagination: stable catalogue order, bounded page index, no account mutations. */
export const REWARDS_PER_PAGE = 6;
// Compute before filtering/pagination so switching tabs cannot reveal later rewards.
export function mysteryRewardIds(rewards, owned) {
  const have=new Set(owned), hidden=new Set();let locked=0;
  for(const reward of rewards){
    if(reward.menuOnly||have.has(reward.id))continue;
    if(locked>=2)hidden.add(reward.id);
    locked++;
  }
  return hidden;
}
export function rewardPage(rewards, { category = 'all', ownedOnly = false, page = 0, size = REWARDS_PER_PAGE } = {}) {
  if (!Array.isArray(rewards)) throw new TypeError('rewards must be an array');
  if (!Number.isInteger(size) || size < 1 || size > 60) throw new RangeError('invalid page size');
  const matches = rewards.filter(r => (category === 'all' || r.category === category) && (!ownedOnly || r.owned));
  const pages = Math.max(1, Math.ceil(matches.length / size));
  const index = Math.min(pages - 1, Math.max(0, Number.isInteger(page) ? page : 0));
  return { items: matches.slice(index * size, (index + 1) * size), page: index, pages, total: matches.length };
}
