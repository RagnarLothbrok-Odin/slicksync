// "Chris just added Nuvio - bring the 1,896 titles they've watched on
// Stremio over to it?" On the person page, when their newest sign-in was
// added in the last two weeks and holds little next to an older one. Gone
// once it's dismissed (per sign-in) or once a copy fills it.
//
// Reading both sides costs what a preview costs, so the answer is kept for a
// few minutes per person.

const NEW_FOR_MS = 14 * 24 * 60 * 60 * 1000
const CACHE_MS = 10 * 60 * 1000
const FEW = 0.1 // the new one holds under a tenth of the other's titles

const cache = new Map() // userId -> { at, value }

function parse(json) {
  try { return JSON.parse(json) } catch { return [] }
}

async function offerFor(prisma, deps, accountId, userId, now = Date.now()) {
  const hit = cache.get(userId)
  if (hit && now - hit.at < CACHE_MS) return hit.value
  const value = await compute(prisma, deps, accountId, userId, now).catch(() => null)
  cache.set(userId, { at: now, value })
  return value
}

async function compute(prisma, deps, accountId, userId, now) {
  const user = await prisma.user.findFirst({ where: { id: userId, accountId }, select: { id: true, username: true, providerType: true, createdAt: true, nuvioProfileId: true } })
  if (!user) return null
  const creds = await prisma.userProviderCredential.findMany({ where: { userId }, select: { providerType: true, createdAt: true } }).catch(() => [])
  if (!creds.length) return null
  const signIns = [
    { provider: user.providerType || 'stremio', at: new Date(user.createdAt).getTime() },
    ...creds.map((c) => ({ provider: c.providerType, at: new Date(c.createdAt).getTime() })),
  ].sort((a, b) => b.at - a.at)
  const newest = signIns[0]
  if (now - newest.at > NEW_FOR_MS) return null
  const setting = await prisma.watchSyncSetting.findUnique({ where: { userId } }).catch(() => null)
  if (parse(setting?.dismissedOffers).includes(newest.provider)) return null

  const watchCopy = require('./index')
  const sides = await watchCopy.sides(prisma, deps, accountId, userId)
  // A sign-in's own place: its first profile (the person's own on Nuvio).
  const place = (provider) => {
    const s = sides.find((x) => x.provider === provider)
    if (!s) return null
    if (provider === 'nuvio' && s.profiles.length) return (s.profiles.find((p) => p.side === `nuvio:${user.nuvioProfileId || 1}`) || s.profiles[0]).side
    return s.profiles.length ? s.profiles[0].side : s.side
  }
  const toSide = place(newest.provider)
  if (!toSide) return null
  const count = async (side) => {
    const r = await watchCopy.readSide(prisma, deps, accountId, userId, side)
    return [...r.read.state.values()].filter((t) => t.id && (t.watchedAt != null || t.episodes?.size || t.resume)).length
  }
  const toCount = await count(toSide)
  let best = null
  for (const s of signIns.slice(1)) {
    const side = place(s.provider)
    if (!side) continue
    const n = await count(side).catch(() => 0)
    if (!best || n > best.count) best = { provider: s.provider, side, count: n }
  }
  if (!best || best.count === 0 || toCount >= best.count * FEW) return null
  const label = (provider) => sides.find((x) => x.provider === provider)?.name || provider
  return {
    name: user.username,
    to: { provider: newest.provider, kind: sides.find((x) => x.provider === newest.provider)?.kind || newest.provider, side: toSide, label: label(newest.provider) },
    from: { provider: best.provider, side: best.side, label: label(best.provider), count: best.count },
  }
}

async function dismiss(prisma, accountId, userId, provider) {
  const setting = await prisma.watchSyncSetting.findUnique({ where: { userId } }).catch(() => null)
  const list = [...new Set([...parse(setting?.dismissedOffers), String(provider || '')])].filter(Boolean)
  await prisma.watchSyncSetting.upsert({
    where: { userId },
    create: { userId, accountId, enabled: false, dismissedOffers: JSON.stringify(list) },
    update: { dismissedOffers: JSON.stringify(list) },
  })
  cache.delete(userId)
}

function forget(userId) {
  if (userId) cache.delete(userId)
  else cache.clear()
}

module.exports = { offerFor, dismiss, forget, NEW_FOR_MS }
