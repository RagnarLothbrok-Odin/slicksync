// What a copy would change: one source's watch state against one
// destination's, title by title. Pure - the adapters read both sides into
// the shape below and write back exactly what this returns.
//
// A side's state is a Map of title key -> {
//   id,               // the title's own id: tt123, tmdb:603, kitsu:46676
//   type,             // 'movie' | 'series'
//   name, poster,
//   watchedAt,        // movie: when it was finished (ms), else null
//   episodes,         // series: Map 's:e' -> watchedAt (ms or 0)
//   resume,           // { season, episode, position, duration, at } | null
//   inLibrary,        // in their library / watchlist
//   lastActivity,     // ms - for "Since"
// }
//
// Never backwards: a destination already further along keeps what it has.

const FINISHED = 0.9

const epKey = (s, e) => `${s}:${e}`
const epOrder = (k) => k.split(':').map(Number)
const later = (a, b) => {
  const [as, ae] = epOrder(a)
  const [bs, be] = epOrder(b)
  return as > bs || (as === bs && ae > be)
}

function lastEpisode(title) {
  let last = null
  for (const k of title?.episodes?.keys() || []) if (!last || later(k, last)) last = k
  return last
}

/** How far a series has got: its newest finished episode, or a resume point past it. */
function furthest(title) {
  const last = lastEpisode(title)
  const r = title?.resume
  if (r && r.season != null && r.episode != null) {
    const rk = epKey(r.season, r.episode)
    if (!last || later(rk, last)) return { key: rk, resume: true }
  }
  return last ? { key: last, resume: false } : null
}

// text: what that side has, in words. state + pct drive the avatar on the
// page's poster cards: a tick for watched, a ring filled to the resume point.
function describe(title) {
  if (!title) return { text: 'Not watched', none: true, state: 'none' }
  const r = title.resume
  const left = r && r.duration > 0 ? Math.max(0, Math.round((r.duration - r.position) / 60000)) : null
  const pct = r && r.duration > 0 ? Math.min(99, Math.max(1, Math.round((r.position / r.duration) * 100))) : null
  const partial = (text) => ({ text, state: 'partial', ...(pct != null ? { pct } : {}) })
  if (title.type === 'movie') {
    if (title.watchedAt != null) return { text: 'Watched', state: 'watched' }
    if (r) return partial(left != null ? `Stopped · ${left} min left` : 'Started')
    return { text: 'Not watched', none: true, state: 'none' }
  }
  const n = title.episodes?.size || 0
  const f = furthest(title)
  if (f?.resume) {
    const [s, e] = epOrder(f.key)
    return partial(left != null ? `S${s} E${e} · ${left} min left` : `S${s} E${e} started`)
  }
  if (f) {
    const [s, e] = epOrder(f.key)
    return { text: n > 1 ? `${n} episodes · up to S${s} E${e}` : `S${s} E${e} finished`, state: 'watched' }
  }
  if (title.watchedAt != null) return { text: 'Marked watched', state: 'watched' }
  return { text: 'Not watched', none: true, state: 'none' }
}

const clock = (ms) => {
  const m = Math.max(1, Math.round((ms || 0) / 60000))
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m` : `${m} m`
}

// The one thing worth saying about a title on its card, beyond its group:
// how many episodes are added, or where it picks up. Plain marks say nothing.
function detailOf(changes) {
  if (!changes) return null
  const parts = []
  const eps = changes.addEpisodes?.length || 0
  if (eps) parts.push(`${eps} episode${eps === 1 ? '' : 's'}`)
  const r = changes.resume
  if (r) parts.push(r.season != null && r.episode != null ? `S${r.season} E${r.episode} from ${clock(r.position)}` : `from ${clock(r.position)}`)
  return parts.join(' · ') || null
}

/**
 * One title's changes, or why there are none.
 * outcome: 'copy' | 'there' | 'further'
 */
function planTitle(src, dst, { watched = true, resume = true, library = false, sinceMs = 0 } = {}) {
  const changes = {}
  let behind = false // the destination is ahead on something the source has

  if (watched) {
    if (src.type === 'movie') {
      if (src.watchedAt != null && (src.watchedAt || Infinity) >= sinceMs) {
        if (dst?.watchedAt == null) changes.markWatched = { at: src.watchedAt || null }
      }
    } else if (!src.episodes?.size && src.watchedAt != null) {
      // A whole show marked watched with no episodes (Nuvio does this, and
      // for live channels it is all there is).
      if ((src.watchedAt || Infinity) >= sinceMs && dst?.watchedAt == null && !dst?.episodes?.size) changes.markWatched = { at: src.watchedAt || null }
    } else if (src.episodes?.size) {
      const add = []
      for (const [k, at] of src.episodes) {
        if (dst?.episodes?.has(k)) continue
        if (sinceMs && at && at < sinceMs) continue
        const [season, episode] = epOrder(k)
        add.push({ season, episode, at: at || null })
      }
      if (add.length) changes.addEpisodes = add.sort((a, b) => a.season - b.season || a.episode - b.episode)
    }
  }

  if (resume && src.resume && (!sinceMs || (src.resume.at || 0) >= sinceMs)) {
    const r = src.resume
    if (src.type === 'movie') {
      const dstDone = dst?.watchedAt != null || changes.markWatched
      if (dstDone) behind = behind || dst?.watchedAt != null
      else if (!dst?.resume || dst.resume.position < r.position) changes.resume = { ...r }
      else if (dst.resume.position > r.position) behind = true
    } else if (r.season != null && r.episode != null) {
      const rk = epKey(r.season, r.episode)
      const dstAt = furthest(dst)
      const sameEpisode = dst?.resume && dst.resume.season === r.season && dst.resume.episode === r.episode
      // A resume point older than the source's own finished episodes is
      // left behind there too - nothing to copy, and nothing to report.
      if (!furthest(src)?.resume) { /* skip */ }
      else if (dst?.episodes?.has(rk)) behind = true
      else if (sameEpisode) {
        if (dst.resume.position < r.position) changes.resume = { ...r }
        else if (dst.resume.position > r.position) behind = true
      } else if (!dstAt || later(rk, dstAt.key)) changes.resume = { ...r }
      else behind = true
    }
  }

  if (library && src.inLibrary && !dst?.inLibrary) changes.addLibrary = true

  if (Object.keys(changes).length) return { outcome: 'copy', changes }
  return { outcome: behind ? 'further' : 'there', changes: null }
}

// Whether a title has anything of the kinds being copied - with resume
// points switched off, a title that only has one isn't listed at all.
function relevant(t, opts) {
  return (opts.watched !== false && (t.watchedAt != null || (t.episodes?.size || 0) > 0)) ||
    (opts.resume !== false && !!t.resume) ||
    (!!opts.library && !!t.inLibrary)
}

/**
 * Every source title with its outcome. `unmatched` are source titles with no
 * id the destination can use ("need a match"); `missing` (a real Jellyfin
 * destination) are titles its library doesn't have.
 */
function plan(source, dest, opts = {}, { isPresent = null } = {}) {
  const items = []
  const sinceMs = opts.sinceMs || 0
  for (const [key, src] of source) {
    if (!relevant(src, opts)) continue
    if (sinceMs && (src.lastActivity || 0) < sinceMs) continue
    const base = { key, id: src.id, type: src.type, name: src.name || null, poster: src.poster || null, from: describe(src) }
    if (!src.id) { items.push({ ...base, outcome: 'match', to: { text: 'Couldn’t tell which title', none: true }, changes: null }); continue }
    if (isPresent && !isPresent(src)) { items.push({ ...base, outcome: 'missing', to: { text: 'Not on that server', none: true }, changes: null }); continue }
    const dst = dest.get(key) || null
    const p = planTitle(src, dst, opts)
    items.push({ ...base, outcome: p.outcome, to: describe(dst), changes: p.changes, detail: detailOf(p.changes) })
  }
  items.sort((a, b) => (source.get(b.key)?.lastActivity || 0) - (source.get(a.key)?.lastActivity || 0))
  const count = (o) => items.filter((i) => i.outcome === o).length
  return {
    items,
    totals: { found: items.length, copy: count('copy'), there: count('there'), further: count('further'), match: count('match'), missing: count('missing') },
  }
}

module.exports = { plan, planTitle, describe, detailOf, furthest, epKey, FINISHED }
