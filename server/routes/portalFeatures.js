const express = require('express')
const { publicMessage } = require('../utils/publicError')
const { previewHistory } = require('../utils/portalHistory')
const PREFERENCES = { beginnerMode: false, hideSensitive: false, posterRatings: false, autoplayTrailer: false, trailerSound: false }

module.exports = ({ prisma, personAsking, decrypt, createProvider }) => {
  const router = express.Router()
  // Resolve the credential before every operation, including uploaded files.
  router.use(async (req, res, next) => {
    try {
      req.person = await personAsking(req, req.query.userId || req.body?.userId)
      next()
    } catch (error) { res.status(error.status || 401).json({ error: 'Please sign in to your own account again.' }) }
  })
  const handle = fn => async (req, res) => {
    try { await fn(req, res) } catch (error) {
      console.error('[personal-panel]', error?.message)
      res.status(error.status || 500).json({ error: publicMessage(error, 'Could not complete that request') })
    }
  }
  const scope = req => ({ accountId: req.person.accountId, userId: req.person.id })
  router.get('/preferences', handle(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.person.id }, select: { portalPreferences: true } })
    let stored = {}
    try { stored = JSON.parse(user.portalPreferences || '{}') } catch { /* Older preferences are replaced on the next save. */ }
    res.json({ ...PREFERENCES, ...stored })
  }))
  router.patch('/preferences', handle(async (req, res) => {
    const patch = req.body.preferences
    if (!patch || Object.keys(patch).some(key => !(key in PREFERENCES) || typeof patch[key] !== 'boolean')) return res.status(400).json({ error: 'Invalid display preferences' })
    // The client sends the full preference object so unrelated partial saves
    // cannot overwrite one another after a delayed response.
    if (Object.keys(patch).length !== Object.keys(PREFERENCES).length) return res.status(400).json({ error: 'Send all display preferences' })
    await prisma.user.update({ where: { id: req.person.id }, data: { portalPreferences: JSON.stringify(patch) } })
    res.json(patch)
  }))
  router.get('/devices', handle(async (req, res) => {
    const devices = await prisma.personPushSubscription.findMany({ where: scope(req), select: { id: true, label: true, userAgent: true, createdAt: true, lastSeenAt: true }, orderBy: { createdAt: 'desc' } })
    res.json({ devices })
  }))
  router.patch('/devices/:id', handle(async (req, res) => {
    if (typeof req.body.label !== 'string' || req.body.label.trim().length > 60) return res.status(400).json({ error: 'Use a name of 60 characters or fewer' })
    const result = await prisma.personPushSubscription.updateMany({ where: { ...scope(req), id: req.params.id }, data: { label: req.body.label.trim() || null } })
    if (!result.count) return res.status(404).json({ error: 'Device not found' })
    res.json({ success: true })
  }))
  router.delete('/devices/:id', handle(async (req, res) => {
    const result = await prisma.personPushSubscription.deleteMany({ where: { ...scope(req), id: req.params.id } })
    if (!result.count) return res.status(404).json({ error: 'Device not found' })
    res.json({ success: true })
  }))
  router.get('/sync-status', handle(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.person.id }, select: { lastSyncedAt: true, syncStatus: true, syncErrorMessage: true, providerConnectionErrorAt: true, providerType: true } })
    // Provider errors can contain credential-bearing URLs. Expose a helpful
    // state, while the existing operational logs retain the actual details.
    res.json({ lastSyncedAt: user.lastSyncedAt, status: user.syncStatus || 'idle', error: user.syncErrorMessage ? 'The last sync failed. Try again or ask your household administrator.' : null, connectionProblem: !!user.providerConnectionErrorAt, supported: user.providerType !== 'jellyfin' })
  }))
  router.get('/sync-plan', handle(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.person.id } })
    const account = await prisma.appAccount.findUnique({ where: { id: user.accountId }, select: { sync: true } })
    let settings = account?.sync || {}
    if (typeof settings === 'string') settings = JSON.parse(settings)
    const { computeUserSyncPlan, createManifestFingerprint } = require('../utils/sync')
    const { parseAddonIds, parseProtectedAddons, canonicalizeManifestUrl } = require('../utils/validation')
    const getAccountId = () => user.accountId
    const scopedReq = Object.assign(Object.create(req), { accountId: user.accountId, appAccountId: user.accountId })
    const plan = await computeUserSyncPlan(user, scopedReq, { prisma, getAccountId, decrypt, parseAddonIds, parseProtectedAddons, canonicalizeManifestUrl, StremioAPIClient: require('stremio-api-client').StremioAPIClient, createProvider, unsafeMode: settings.safe === false, useCustomFields: settings.useCustomFields !== false })
    if (!plan.success) return res.status(502).json({ error: 'Could not read your provider addon list. Reconnect your account or try again.' })
    const fingerprint = createManifestFingerprint(canonicalizeManifestUrl, { urlOnly: user.providerType !== 'stremio' })
    const names = items => items.map(item => item?.manifest?.name || item?.transportName || 'Addon')
    const currentKeys = new Set(plan.current.map(fingerprint)), desiredKeys = new Set(plan.desired.map(fingerprint))
    res.json({ supported: !plan.unsupported, noGroup: !!plan.noGroup, alreadySynced: plan.alreadySynced, current: names(plan.current), desired: names(plan.desired), additions: names(plan.desired.filter(item => !currentKeys.has(fingerprint(item)))), removals: names(plan.current.filter(item => !desiredKeys.has(fingerprint(item)))), updates: plan.staleManifests?.length || 0 })
  }))
  router.post('/history/preview', handle(async (req, res) => {
    if (typeof req.body.text !== 'string' || Buffer.byteLength(req.body.text) > 1024 * 1024) return res.status(400).json({ error: 'Choose a CSV or JSON file smaller than 1 MB' })
    const existing = await prisma.movieWatchHistory.findMany({ where: scope(req), select: { itemId: true } })
    let preview
    try { preview = previewHistory(req.body.text, existing.map(row => row.itemId)) } catch (error) { return res.status(400).json({ error: error.message }) }
    // The signed preview pins the exact rows and owner that were reviewed.
    const token = require('jsonwebtoken').sign({ userId: req.person.id, accountId: req.person.accountId, rows: preview.rows }, require('../utils/config').JWT_SECRET, { expiresIn: '15m', audience: 'personal-history-import' })
    res.json({ ...preview, token })
  }))
  router.post('/history/import', handle(async (req, res) => {
    let preview
    try { preview = require('jsonwebtoken').verify(req.body.token, require('../utils/config').JWT_SECRET, { audience: 'personal-history-import' }) } catch { return res.status(400).json({ error: 'Preview expired. Choose your file again.' }) }
    if (preview.userId !== req.person.id || preview.accountId !== req.person.accountId) return res.status(403).json({ error: 'This preview belongs to another account' })
    const imported = await prisma.$transaction(async tx => {
      let added = 0
      for (const row of preview.rows) {
        const where = { ...scope(req), itemId: row.itemId }
        const existing = await tx.movieWatchHistory.findUnique({ where: { accountId_userId_itemId: where } })
        if (existing) continue
        await tx.movieWatchHistory.upsert({ where: { accountId_userId_itemId: where }, create: { ...where, itemName: row.itemName, watchedAt: new Date(row.watchedAt), completed: true, profileLabel: 'Imported' }, update: {} })
        added++
      }
      return added
    }, { timeout: 30000 })
    res.json({ imported, skipped: preview.rows.length - imported })
  }))
  router.get('/discover/saved', handle(async (req, res) => { res.json({ items: await prisma.personalTitleState.findMany({ where: { ...scope(req), saved: true }, orderBy: { createdAt: 'desc' } }) }) }))
  router.put('/discover/titles/:id', handle(async (req, res) => {
    const { name, itemType, poster, saved, reaction } = req.body
    if (!/^tt\d+$/.test(req.params.id) || !['movie', 'series'].includes(itemType) || typeof name !== 'string' || name.length > 300 || typeof saved !== 'boolean' || ![null, 'like', 'dislike'].includes(reaction) || (poster !== null && (typeof poster !== 'string' || poster.length > 2048 || !/^https:\/\//.test(poster)))) return res.status(400).json({ error: 'Invalid title' })
    const data = { name, itemType, poster, saved, reaction }
    res.json(await prisma.personalTitleState.upsert({ where: { userId_itemId: { userId: req.person.id, itemId: req.params.id } }, create: { ...scope(req), itemId: req.params.id, ...data }, update: data }))
  }))
  router.get('/discover/titles/:id', handle(async (req, res) => {
    if (!/^tt\d+$/.test(req.params.id) || !['movie', 'series'].includes(req.query.type)) return res.status(400).json({ error: 'Invalid title' })
    const metadata = await require('../utils/notify').fetchMetadata(req.params.id, req.query.type, null)
    const state = await prisma.personalTitleState.findUnique({ where: { userId_itemId: { userId: req.person.id, itemId: req.params.id } } })
    res.json({ metadata, state })
  }))
  // Reuse the admin's browse/filter implementation, but never expose its
  // household mutations or recommendations through this personal router.
  const discover = require('./discover')({ prisma, getAccountId: req => req.person.accountId, decrypt })
  router.use('/discover', (req, res, next) => {
    if (req.method !== 'GET' || !/^\/(browse|search|lumiere|search-person|person\/[^/]+)$/.test(req.path)) return res.status(404).json({ error: 'Not found' })
    discover(req, res, next)
  })
  return router
}
