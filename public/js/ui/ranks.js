// HTML snippets for rank tags ("[HERO]"), level tags ("[12]") and rank-colored names.
// Colors live in CSS (.rank-<ID>, .lvl-<tier>) because the page's CSP forbids inline styles.
import { esc } from '../core/util.js';
import { rankById, levelTier } from '../shared/cosmetics.js';

export function rankTag(rankId) {
  const r = rankById(rankId);
  return r.tag ? `<span class="rtag rank-${r.id}">[${r.tag}]</span>` : '';
}

export function levelTag(level) {
  return `<span class="lvl lvl-${levelTier(level)}">[${level}]</span>`;
}

/** "[12] [HERO] Name" — level and badge are optional. */
export function rankedName(name, rankId, { badge = true, level = null, extraClass = '' } = {}) {
  const r = rankById(rankId);
  return `${level != null ? levelTag(level) : ''}${badge ? rankTag(r.id) : ''}<span class="rname rank-${r.id} ${extraClass}">${esc(name)}</span>`;
}
