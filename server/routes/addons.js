const express = require("express");
const { publicMessage } = require("../utils/publicError");
const { StremioAPIClient: _StremioAPIClient } = require("stremio-api-client");
const {
    handleDatabaseError: _handleDatabaseError,
    sendError,
    createRouteHandler,
    DatabaseTransactions,
} = require("../utils/handlers");
const { findAddonById, sanitizeUrl, validateAccountContext } = require("../utils/helpers");
const { responseUtils, dbUtils } = require("../utils/routeUtils");
const { readProxyLogs } = require("../utils/proxyLogger");
const { assertSafeUrl, safeFetch, instancePolicy } = require("../utils/safeUrl");

// Every addon address is fetched by this server, so each fetch below goes
// through safeFetch: an instance serving strangers refuses internal addresses,
// a household install only refuses link-local ones (see utils/safeUrl.js), and
// a redirect is checked at every hop rather than followed blindly.
//
// What a person is told when it is the address itself that was turned away.
// Anything else (a timeout, a refused connection) is described by the caller.
function addressProblem(err, { allowPrivate } = {}) {
    switch (err?.message) {
        case "invalid url":
            return "That is not a valid web address.";
        case "unsupported protocol":
            return "Addon addresses must start with http:// or https:// (stremio:// is accepted too).";
        case "blocked host":
            return allowPrivate
                ? "That address is a link-local one (such as 169.254.x.x), which this server never connects to."
                : "That address is on a private or internal network, which this server does not connect to.";
        case "unresolvable host":
            return "That addon's address could not be found - it looks like the addon is offline or no longer exists.";
        case "too many redirects":
            return "That address redirected too many times.";
        default:
            return null;
    }
}

// In-memory manifest cache (short TTL) to avoid hammering when multiple addons share a URL
const _manifestCache = new Map(); // key: url, value: { data, ts }
const CACHE_TTL_MS = 60 * 1000;

function getCachedManifest(url) {
    const rec = _manifestCache.get(url);
    if (!rec) {
        return null;
    }
    if (Date.now() - rec.ts > CACHE_TTL_MS) {
        _manifestCache.delete(url);
        return null;
    }
    return rec.data;
}
function setCachedManifest(url, data) {
    _manifestCache.set(url, { data, ts: Date.now() });
}

const LOCAL_ADDON_URL = "http://127.0.0.1:11470/local-addon/manifest.json";

/**
 * Fills the manifest cache for many addons at once, before anything needs
 * them.
 *
 * reloadAddon fetches one manifest at a time, and an Advanced sync reloads
 * every addon in a group before it pushes anything to anyone - so a group
 * with 20 addons paid for 20 sequential round trips before the first user
 * was touched, with the whole sync sitting behind the sum of them. None of
 * those fetches depend on each other, so this issues them concurrently
 * first and the sequential reload then finds each manifest already in the
 * cache it was going to use anyway. Same requests, same 60s TTL, same
 * data - only the waiting overlaps, so the cost becomes the slowest single
 * addon rather than the total.
 *
 * Nothing here can break a sync: a URL that fails, times out or is turned
 * away as an address this server does not connect to is simply left
 * uncached, and the reload fetches it properly (and reports its error)
 * exactly as it does today. The saved addon is never touched. Already-cached
 * URLs are skipped, so calling this twice in quick succession costs nothing.
 */
async function prewarmManifests(urls, { concurrency = 6, timeoutMs = 8000 } = {}) {
    const pending = [
        ...new Set(
            (urls || []).filter(
                (u) => typeof u === "string" && /^https?:\/\//i.test(u) && u !== LOCAL_ADDON_URL
            )
        ),
    ].filter((u) => !getCachedManifest(u));
    if (pending.length === 0) {
        return { attempted: 0, warmed: 0 };
    }

    const policy = instancePolicy();
    let warmed = 0;
    let cursor = 0;
    const worker = async () => {
        while (cursor < pending.length) {
            const url = pending[cursor++];
            try {
                const res = await safeFetch(
                    url,
                    { signal: AbortSignal.timeout(timeoutMs) },
                    policy
                );
                if (!res.ok) {
                    continue;
                }
                const data = await res.json();
                if (data && typeof data === "object") {
                    setCachedManifest(url, data);
                    warmed++;
                }
            } catch {
                /* left for the real reload to hit and report */
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
    return { attempted: pending.length, warmed };
}

// Shared helper function to reload a single addon
async function reloadAddon(
    prisma,
    getAccountId,
    addonId,
    req,
    {
        filterManifestByResources,
        filterManifestByCatalogs,
        encrypt,
        decrypt,
        getDecryptedManifestUrl,
        manifestHash,
        silent = false,
    },
    autoSelectNewElements = true
) {
    // Find the addon (scope to account to avoid cross-account mismatches)
    const addon = await prisma.addon.findFirst({
        where: { accountId: getAccountId(req), id: addonId },
    });

    if (!addon) {
        throw new Error("Addon not found");
    }

    if (!silent) {
        console.log(`🔄 Reload addon ${addon.name}`);
    }

    if (!addon.isActive) {
        throw new Error("Addon is disabled");
    }

    if (!addon.manifestUrl) {
        throw new Error("Addon has no manifest URL");
    }

    // Found addon

    // Resolve decrypted transport URL
    const transportUrl = getDecryptedManifestUrl(addon, req);
    if (!transportUrl) {
        throw new Error("Failed to resolve addon URL");
    }

    // Skip reloading for local development addons
    if (transportUrl === LOCAL_ADDON_URL) {
        if (!silent) {
            console.log(`⏭️  Skipping reload for local addon URL: ${transportUrl}`);
        }
        return {
            diffs: {
                addedCatalogs: [],
                addedResources: [],
                removedCatalogs: [],
                removedResources: [],
            },
            message: "Skipped local addon reload",
            skipped: true,
        };
    }

    // Decrypted transport URL resolved

    // Fetch the latest manifest
    let manifestData = null;
    // Prepare diff containers to return
    let addedRes = [];
    let removedRes = [];
    let addedCat = [];
    let removedCat = [];
    // Module-level cache to avoid hammering same manifest URL
    const cacheKey = transportUrl;
    const cached = getCachedManifest(cacheKey);
    if (cached) {
        manifestData = cached;
    } else {
        // An address this server will not connect to makes the addon unreachable
        // for this pass, the same as one that does not answer: it throws before
        // anything below touches the saved addon, and every caller already
        // carries on to the next addon when a reload throws.
        const policy = instancePolicy();
        try {
            const manifestResponse = await safeFetch(transportUrl, {}, policy);
            if (!manifestResponse.ok) {
                throw new Error(`HTTP ${manifestResponse.status}: ${manifestResponse.statusText}`);
            }
            manifestData = await manifestResponse.json();
            setCachedManifest(cacheKey, manifestData);
        } catch (e) {
            console.error("❌ Failed to fetch manifest:", e.message);
            throw new Error(
                `Failed to fetch addon manifest: ${addressProblem(e, policy) || e.message}`,
                { cause: e }
            );
        }
    }

    // 1. Save current selections from DB
    // Load current selections from DB

    const savedResources = (() => {
        try {
            const parsed = addon.resources ? JSON.parse(addon.resources) : [];
            // Saved resources parsed
            return parsed;
        } catch (e) {
            console.log("❌ Error parsing saved resources:", e.message);
            return [];
        }
    })();
    const savedCatalogs = (() => {
        try {
            const parsed = addon.catalogs ? JSON.parse(addon.catalogs) : [];
            // Saved catalogs parsed
            return parsed;
        } catch (e) {
            console.log("❌ Error parsing saved catalogs:", e.message);
            return [];
        }
    })();

    // Detect uninitialized selections: both empty but addon has an originalManifest
    // This means the addon was imported without proper resource/catalog data (a known bug).
    // Treat as "select all" so reload fixes these addons.
    const isUninitializedSelections =
        savedResources.length === 0 && savedCatalogs.length === 0 && addon.originalManifest;

    // 2. Get all available resources and catalogs from fresh manifest
    // Process fresh manifest
    const manifestResources = Array.isArray(manifestData?.resources) ? manifestData.resources : [];
    const manifestCatalogs = Array.isArray(manifestData?.catalogs) ? manifestData.catalogs : [];

    // Fresh manifest parsed

    // Check if there are any search catalogs
    const hasSearchCatalogs = manifestCatalogs.some((catalog) =>
        catalog.extra?.some((extra) => extra.name === "search")
    );
    // Has search catalogs computed

    // 3. RESET FIRST: Select all resources and catalogs (like reset button)
    // Create reset selections
    const resetResources = [
        ...manifestResources.map(
            (r) => (typeof r === "string" ? r : r.name) // Handle both strings and objects
        ),
    ];
    if (hasSearchCatalogs && !resetResources.includes("search")) {
        resetResources.push("search");
    }
    // Reset resources computed

    const resetCatalogs = manifestCatalogs.map((c) => ({
        id: c.id,
        search: c.extra?.some((extra) => extra.name === "search") || false,
        type: c.type,
    }));
    // Reset catalogs computed

    // 4. REAPPLY: Preserve user selections and only auto-select truly new items
    // Debug summary removed (noise)

    // Get original manifest to determine what was available before
    let originalResources = [];
    let originalCatalogs = [];
    try {
        if (addon.originalManifest) {
            // Decrypt the original manifest first
            const decryptedOriginalManifest = JSON.parse(decrypt(addon.originalManifest, req));
            const originalManifestData = decryptedOriginalManifest;
            const originalManifestResources = Array.isArray(originalManifestData?.resources)
                ? originalManifestData.resources
                : [];
            const originalManifestCatalogs = Array.isArray(originalManifestData?.catalogs)
                ? originalManifestData.catalogs
                : [];

            // Extract resource names (handle both strings and objects)
            originalResources = originalManifestResources.map((r) =>
                typeof r === "string" ? r : r.name
            );

            // Extract catalog info (preserve name so removals can show it)
            originalCatalogs = originalManifestCatalogs.map((c) => ({
                id: c.id,
                name: c.name,
                type: c.type,
            }));
        }
    } catch (e) {
        console.log("⚠️ Could not parse original manifest:", e.message);
    }

    // Diff logs (availability changes between original manifest and freshly fetched manifest)
    try {
        // IMPORTANT: compare raw manifest resources, not our derived selections
        const freshResourcesRaw = (Array.isArray(manifestResources) ? manifestResources : [])
            .map((r) => (typeof r === "string" ? r : r?.name))
            .filter(Boolean);
        const originalResSet = new Set((originalResources || []).filter(Boolean));
        const newResSet = new Set(freshResourcesRaw);
        addedRes = [...newResSet].filter((k) => !originalResSet.has(k));
        removedRes = [...originalResSet].filter((k) => !newResSet.has(k));

        // Compare catalogs on raw manifest too (ignore our computed search flag)
        const toKey = (c) => `${c?.type || ""}:${c?.id || ""}`;
        const _originalCatalogsRaw = Array.isArray(manifestCatalogs) ? [] : []; // placeholder to keep structure clear
        const originalCatSet = new Set((originalCatalogs || []).map(toKey));
        const freshCatalogsRaw = (Array.isArray(manifestCatalogs) ? manifestCatalogs : []).map(
            (c) => ({ id: c?.id, name: c?.name, type: c?.type })
        );
        const newCatSet = new Set(freshCatalogsRaw.map(toKey));
        const addedCatKeys = [...newCatSet].filter((k) => !originalCatSet.has(k));
        const removedCatKeys = [...originalCatSet].filter((k) => !newCatSet.has(k));

        // Pretty labels: show type:name for catalogs
        // Prefer "Name (type)" label
        const labelFor = (c) => `${(c?.name || c?.id || "").toString()} (${c?.type || ""})`;
        const freshLabelByKey = new Map(freshCatalogsRaw.map((c) => [toKey(c), labelFor(c)]));
        const originalLabelByKey = new Map(
            (Array.isArray(originalCatalogs) ? originalCatalogs : []).map((c) => [
                toKey(c),
                labelFor(c),
            ])
        );
        addedCat = addedCatKeys.map((k) => freshLabelByKey.get(k) || k);
        removedCat = removedCatKeys.map((k) => originalLabelByKey.get(k) || k);

        if (
            (addedRes.length || removedRes.length || addedCat.length || removedCat.length) &&
            !silent
        ) {
            const parts = [];
            if (addedRes.length) {
                parts.push(`+resources: ${addedRes.join(", ")}`);
            }
            if (removedRes.length) {
                parts.push(`-resources: ${removedRes.join(", ")}`);
            }
            if (addedCat.length) {
                parts.push(`+catalogs: ${addedCat.join(", ")}`);
            }
            if (removedCat.length) {
                parts.push(`-catalogs: ${removedCat.join(", ")}`);
            }
            if (parts.length) {
                console.log(`🧩 ${addon.name} diffs → ${parts.join(" | ")}`);
            }
        }
    } catch {}

    // Original manifest summary removed

    // Keep only saved selections that still exist in the fresh manifest
    const validResources = savedResources.filter((r) => resetResources.includes(r));
    const validCatalogs = savedCatalogs.filter((c) =>
        resetCatalogs.some((reset) => reset.type === c.type && reset.id === c.id)
    );

    // Valid preserved selections computed

    // 5. Handle auto-selection of truly new elements
    let finalResources = validResources;
    let finalCatalogs = validCatalogs;

    if (isUninitializedSelections) {
        // Uninitialized selections detected: addon was imported without proper resource/catalog data.
        // Select all available resources and catalogs from the fresh manifest.
        if (!silent) {
            console.log(
                `🔧 ${addon.name}: uninitialized selections detected, selecting all resources and catalogs`
            );
        }
        finalResources = [...resetResources];
        finalCatalogs = [...resetCatalogs];
    } else if (autoSelectNewElements) {
        // Auto-selecting new elements

        // Find resources that exist in fresh manifest but were NOT in original manifest
        // This excludes items that were previously unselected by the user
        const trulyNewResources = resetResources.filter(
            (r) => !(originalResources.includes(r) || savedResources.includes(r))
        );
        // New resources auto-selected

        // Find catalogs that exist in fresh manifest but were NOT in original manifest
        // This excludes catalogs that were previously unselected by the user
        const trulyNewCatalogs = resetCatalogs.filter(
            (fresh) =>
                !originalCatalogs.some((orig) => orig.type === fresh.type && orig.id === fresh.id)
        );
        // New catalogs auto-selected

        // Combine preserved + truly new selections
        finalResources = [...validResources, ...trulyNewResources];
        finalCatalogs = [...validCatalogs, ...trulyNewCatalogs];
    }

    // Final selections computed

    // Apply filtering using final resources/catalogs
    let filtered = manifestData;
    if (Array.isArray(finalResources) || Array.isArray(finalCatalogs)) {
        try {
            if (Array.isArray(finalResources) && finalResources.length > 0) {
                filtered = filterManifestByResources(manifestData, finalResources);
            }

            // Apply catalog filtering if catalogs are provided
            if (Array.isArray(finalCatalogs) && finalCatalogs.length > 0 && filtered) {
                // Convert tuples to objects for filtering
                const catalogObjects = finalCatalogs.map((c) => {
                    if (Array.isArray(c) && c.length >= 2) {
                        return { id: c[1], search: c[2] === undefined ? false : c[2], type: c[0] };
                    }
                    return c;
                });
                filtered = filterManifestByCatalogs(filtered, catalogObjects);
            }
        } catch (e) {
            console.error("Error filtering manifest on reload:", e);
            filtered = manifestData;
        }
    }

    // Update the addon using the same logic as the update endpoint
    // Note: customLogo is preserved in DB and applied at runtime in sync.js
    const previousManifestHash = addon.manifestHash || null;
    const updatedAddon = await prisma.addon.update({
        data: {
            catalogs: JSON.stringify(
                finalCatalogs
                    .map((c) => ({ id: c.id, search: c.search, type: c.type }))
                    .filter(
                        (c, index, arr) =>
                            arr.findIndex((item) => item.type === c.type && item.id === c.id) ===
                            index
                    )
            ),
            // Preserve customLogo
            customLogo: addon.customLogo,
            description: addon.description, // preserve description
            iconUrl: manifestData?.logo || addon.iconUrl || null,
            manifest: encrypt(JSON.stringify(filtered), req),
            manifestHash: manifestHash(filtered),
            name: addon.name, // preserve name
            // Store encrypted manifests (original untouched, filtered current)
            originalManifest: encrypt(JSON.stringify(manifestData), req),
            // Store final selections (validated + optionally auto-selected new elements)
            resources: JSON.stringify(finalResources),
            version: manifestData?.version || addon.version,
        },
        where: {
            accountId: getAccountId(req),
            id: addonId,
        },
    });

    return {
        addon: {
            description: updatedAddon.description,
            iconUrl: updatedAddon.iconUrl,
            id: updatedAddon.id,
            name: updatedAddon.name,
            status: updatedAddon.isActive ? "active" : "inactive",
            url: updatedAddon.manifestUrl,
            version: updatedAddon.version,
        },
        // Whether the manifest now stored differs from the one stored before -
        // what the groups carrying this addon need to know.
        changed: previousManifestHash !== (updatedAddon.manifestHash || null),
        diffs: {
            addedCatalogs: addedCat,
            addedResources: addedRes,
            removedCatalogs: removedCat,
            removedResources: removedRes,
        },
        success: true,
    };
}

// Export a function that returns the router, allowing dependency injection
module.exports = ({
    prisma,
    getAccountId,
    decrypt,
    encrypt,
    getDecryptedManifestUrl,
    scopedWhere,
    INSTANCE_TYPE,
    manifestHash,
    filterManifestByResources,
    filterManifestByCatalogs,
    manifestUrlHmac,
}) => {
    const router = express.Router();
    // Same rule as instancePolicy() in utils/safeUrl.js, read from the type this
    // router was built with.
    const addressPolicy = { allowPrivate: INSTANCE_TYPE !== "public" };
    // PUT /api/addons/reorder - bulk update addon display order (drag-and-drop)
    router.put("/reorder", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const { orderedIds } = req.body || {};
            if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
                return res.status(400).json({ error: "orderedIds is required" });
            }
            // Confirm every id actually belongs to this account before touching anything
            const existing = await prisma.addon.findMany({
                select: { id: true },
                where: { accountId, id: { in: orderedIds } },
            });
            if (existing.length !== orderedIds.length) {
                return res
                    .status(400)
                    .json({ error: "One or more addons do not belong to this account" });
            }
            await Promise.all(
                orderedIds.map((id, index) =>
                    prisma.addon.update({ data: { position: index }, where: { id } })
                )
            );
            res.json({ success: true });
        } catch (error) {
            console.error("Error reordering addons:", error);
            res.status(500).json({ error: "Failed to reorder addons" });
        }
    });

    // ---- Custom tags (drag-to-recategorize on the Addons page) --------------
    // Freeform user-defined tags, one per addon, parallel to Vault's category
    // field. The tag CATALOG (available names) lives in AppAccount.sync as a
    // simple string array — same storage pattern as custom themes — rather
    // than a dedicated table, since a tag is just a label with no other
    // properties. Registered here, before the generic GET/DELETE /:id routes
    // below, so "/tags" isn't swallowed as an :id.

    async function readAddonTags(accountId) {
        const acc = await prisma.appAccount.findUnique({
            select: { sync: true },
            where: { id: accountId },
        });
        let cfg = acc?.sync;
        if (typeof cfg === "string") {
            try {
                cfg = JSON.parse(cfg);
            } catch {
                cfg = null;
            }
        }
        const tags =
            cfg && typeof cfg === "object" && Array.isArray(cfg.addonCustomTags)
                ? cfg.addonCustomTags
                : [];
        return tags.filter((t) => typeof t === "string" && t.trim());
    }

    async function writeAddonTags(accountId, tags) {
        const acc = await prisma.appAccount.findUnique({
            select: { sync: true },
            where: { id: accountId },
        });
        let cfg = acc?.sync;
        if (typeof cfg === "string") {
            try {
                cfg = JSON.parse(cfg);
            } catch {
                cfg = null;
            }
        }
        const base = cfg && typeof cfg === "object" ? cfg : {};
        const next = { ...base, addonCustomTags: tags };
        try {
            await prisma.appAccount.update({ data: { sync: next }, where: { id: accountId } });
        } catch {
            await prisma.appAccount.update({
                data: { sync: JSON.stringify(next) },
                where: { id: accountId },
            });
        }
    }

    // Per-tag colors — a separate name->hex map alongside the tag catalog
    // rather than upgrading the catalog to objects, so the existing
    // string-array dedupe/match logic above (and every client consumer typed
    // against string[]) doesn't need to change at all. Keyed by the tag's
    // canonical catalog name (case as originally created).
    async function readAddonTagColors(accountId) {
        const acc = await prisma.appAccount.findUnique({
            select: { sync: true },
            where: { id: accountId },
        });
        let cfg = acc?.sync;
        if (typeof cfg === "string") {
            try {
                cfg = JSON.parse(cfg);
            } catch {
                cfg = null;
            }
        }
        const colors =
            cfg &&
            typeof cfg === "object" &&
            cfg.addonTagColors &&
            typeof cfg.addonTagColors === "object"
                ? cfg.addonTagColors
                : {};
        const clean = {};
        for (const [name, color] of Object.entries(colors)) {
            if (
                typeof name === "string" &&
                typeof color === "string" &&
                /^#[0-9a-fA-F]{6}$/.test(color)
            ) {
                clean[name] = color;
            }
        }
        return clean;
    }

    async function writeAddonTagColors(accountId, colors) {
        const acc = await prisma.appAccount.findUnique({
            select: { sync: true },
            where: { id: accountId },
        });
        let cfg = acc?.sync;
        if (typeof cfg === "string") {
            try {
                cfg = JSON.parse(cfg);
            } catch {
                cfg = null;
            }
        }
        const base = cfg && typeof cfg === "object" ? cfg : {};
        const next = { ...base, addonTagColors: colors };
        try {
            await prisma.appAccount.update({ data: { sync: next }, where: { id: accountId } });
        } catch {
            await prisma.appAccount.update({
                data: { sync: JSON.stringify(next) },
                where: { id: accountId },
            });
        }
    }

    // GET /api/addons/health-alerts — recent online<->offline transitions
    // (fired by utils/addonHealthCheck.js's poller) for the notification bell.
    // Must be before /:id.
    router.get("/health-alerts", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            if (!accountId) {
                return res.status(401).json({ error: "Unauthorized" });
            }
            const days = Math.min(90, Math.max(1, Number.parseInt(req.query.days, 10) || 14));
            const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
            const alerts = await prisma.addonHealthAlert.findMany({
                orderBy: { createdAt: "desc" },
                take: 50,
                where: { accountId, createdAt: { gte: since } },
            });
            res.json(alerts);
        } catch (error) {
            console.error("Error fetching addon health alerts:", error);
            res.status(500).json({ error: "Failed to fetch addon health alerts" });
        }
    });

    // GET /api/addons/tags — the tag catalog for this account, plus each
    // tag's color (only entries with a color set are present in tagColors).
    router.get("/tags", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const [tags, tagColors] = await Promise.all([
                readAddonTags(accountId),
                readAddonTagColors(accountId),
            ]);
            res.json({ tagColors, tags });
        } catch (error) {
            console.error("Error fetching addon tags:", error);
            res.status(500).json({ error: "Failed to fetch addon tags" });
        }
    });

    // PUT /api/addons/tags/:name/color — set (hex string) or clear (null) a
    // tag's color. Matches the catalog case-insensitively but stores under
    // the catalog's own canonical casing, same resolution rule /:id/tag uses.
    router.put("/tags/:name/color", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const target = decodeURIComponent(req.params.name || "").trim();
            const { color } = req.body || {};
            const tags = await readAddonTags(accountId);
            const canonical = tags.find((t) => t.toLowerCase() === target.toLowerCase());
            if (!canonical) {
                return res.status(404).json({ error: "Unknown tag" });
            }
            if (color !== null && (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color))) {
                return res
                    .status(400)
                    .json({ error: "color must be a #rrggbb hex string or null" });
            }
            const colors = await readAddonTagColors(accountId);
            if (color === null) {
                delete colors[canonical];
            } else {
                colors[canonical] = color;
            }
            await writeAddonTagColors(accountId, colors);
            res.json({ tagColors: colors });
        } catch (error) {
            console.error("Error setting addon tag color:", error);
            res.status(500).json({ error: "Failed to set addon tag color" });
        }
    });

    // POST /api/addons/tags — create a new tag name. Case-insensitive dedupe.
    router.post("/tags", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
            if (!name) {
                return res.status(400).json({ error: "name is required" });
            }
            if (name.length > 40) {
                return res.status(400).json({ error: "Tag name is too long (max 40 characters)" });
            }
            const tags = await readAddonTags(accountId);
            if (tags.some((t) => t.toLowerCase() === name.toLowerCase())) {
                return res.status(409).json({ error: "A tag with that name already exists" });
            }
            const next = [...tags, name];
            await writeAddonTags(accountId, next);
            res.status(201).json({ tags: next });
        } catch (error) {
            console.error("Error creating addon tag:", error);
            res.status(500).json({ error: "Failed to create addon tag" });
        }
    });

    // DELETE /api/addons/tags/:name — remove a tag from the catalog AND clear
    // it off any addon currently carrying it (case-insensitive match), so no
    // addon is left pointing at a tag that no longer exists in the picker.
    router.delete("/tags/:name", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const target = decodeURIComponent(req.params.name || "")
                .trim()
                .toLowerCase();
            const tags = await readAddonTags(accountId);
            const next = tags.filter((t) => t.toLowerCase() !== target);
            await writeAddonTags(accountId, next);
            // Drop the deleted tag's color entry too, if it had one.
            const colors = await readAddonTagColors(accountId);
            const colorKey = Object.keys(colors).find((k) => k.toLowerCase() === target);
            if (colorKey) {
                delete colors[colorKey];
                await writeAddonTagColors(accountId, colors);
            }
            // SQLite has no case-insensitive updateMany filter, so match in JS:
            // fetch every tagged addon and clear the ones whose tag matches (ci).
            const affected = await prisma.addon.findMany({
                select: { customTag: true, id: true },
                where: { accountId, customTag: { not: null } },
            });
            await Promise.all(
                affected
                    .filter((a) => (a.customTag || "").toLowerCase() === target)
                    .map((a) =>
                        prisma.addon.update({ data: { customTag: null }, where: { id: a.id } })
                    )
            );
            res.json({ tags: next });
        } catch (error) {
            console.error("Error deleting addon tag:", error);
            res.status(500).json({ error: "Failed to delete addon tag" });
        }
    });

    // PUT /api/addons/:id/tag — set or clear (tag: null) an addon's tag.
    // Accepts any non-empty string that currently exists in the catalog, or
    // null to untag; doesn't silently auto-create so the picker (tag pills)
    // stays the single source of truth for what tags exist.
    router.put("/:id/tag", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const { id } = req.params;
            const { tag } = req.body || {};
            const addon = await prisma.addon.findFirst({ where: { accountId, id } });
            if (!addon) {
                return res.status(404).json({ error: "Addon not found" });
            }

            if (tag === null || tag === undefined) {
                await prisma.addon.update({ data: { customTag: null }, where: { id } });
                return res.json({ customTag: null });
            }
            if (typeof tag !== "string" || !tag.trim()) {
                return res.status(400).json({ error: "tag must be a non-empty string or null" });
            }
            const catalog = await readAddonTags(accountId);
            const match = catalog.find((t) => t.toLowerCase() === tag.trim().toLowerCase());
            if (!match) {
                return res.status(400).json({ error: "Unknown tag — create it first" });
            }
            await prisma.addon.update({ data: { customTag: match }, where: { id } });
            res.json({ customTag: match });
        } catch (error) {
            console.error("Error setting addon tag:", error);
            res.status(500).json({ error: "Failed to set addon tag" });
        }
    });

    // ---- Protect / unprotect (drag onto the "Protected" filter tab) ---------
    // Protection is tracked account-wide by addon NAME across every user's own
    // `protectedAddons` list (see routes/users.js's /:id/protect-addon) — there
    // is no single "this addon is protected" field on Addon itself. Dragging
    // an addon onto Protected therefore protects it for EVERY user in the
    // account (matching the default-addon behavior, which is also name-based
    // and account-wide), not just users currently assigned to it. This also
    // fixes GET /api/addons's isProtected field below, which was previously
    // never populated (always false) — the Protected tab/count were dead.
    const DEFAULT_PROTECTED_NAMES = [
        "Cinemeta",
        "Local Files",
        "Local Files (without catalog support)",
    ];

    router.post("/:id/protect", async (req, res) => {
        try {
            const accountId = getAccountId(req) || "default";
            const { id } = req.params;
            const wantProtected = req.body?.protected !== false;
            const addon = await prisma.addon.findFirst({ where: { accountId, id } });
            if (!addon) {
                return res.status(404).json({ error: "Addon not found" });
            }

            const isDefaultAddon = DEFAULT_PROTECTED_NAMES.some((n) =>
                (addon.name || "").includes(n)
            );
            if (isDefaultAddon && !wantProtected && req.query.unsafe !== "true") {
                return res.status(403).json({
                    error: "This addon is protected by default and cannot be unprotected in safe mode",
                    isDefaultAddon: true,
                });
            }

            const users = await prisma.user.findMany({
                select: { id: true, protectedAddons: true },
                where: { accountId },
            });
            const targetNorm = (addon.name || "").trim().toLowerCase();
            await Promise.all(
                users.map(async (u) => {
                    let list = [];
                    try {
                        list = u.protectedAddons ? JSON.parse(u.protectedAddons) : [];
                    } catch {
                        list = [];
                    }
                    if (!Array.isArray(list)) {
                        list = [];
                    }
                    const has = list.some(
                        (n) => typeof n === "string" && n.trim().toLowerCase() === targetNorm
                    );
                    if (wantProtected && !has) {
                        await prisma.user.update({
                            data: { protectedAddons: JSON.stringify([...list, addon.name]) },
                            where: { id: u.id },
                        });
                    } else if (!wantProtected && has) {
                        const next = list.filter(
                            (n) => !(typeof n === "string" && n.trim().toLowerCase() === targetNorm)
                        );
                        await prisma.user.update({
                            data: { protectedAddons: JSON.stringify(next) },
                            where: { id: u.id },
                        });
                    }
                })
            );

            res.json({ isProtected: wantProtected });
        } catch (error) {
            console.error("Error toggling addon protection:", error);
            res.status(500).json({ error: "Failed to toggle addon protection" });
        }
    });

    // Get all addons
    router.get("/", async (req, res) => {
        try {
            const _whereScope = getAccountId(req) ? { accountId: getAccountId(req) } : {};
            const addons = await prisma.addon.findMany({
                // return all addons, both active and inactive
                include: {
                    backupAddon: true,
                    groupAddons: {
                        include: {
                            group: {
                                include: {
                                    _count: {
                                        select: {
                                            addons: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                orderBy: [{ position: "asc" }, { id: "asc" }],
                where: scopedWhere(req, {}),
            });

            // isProtected is account-wide by addon NAME (see the /:id/protect
            // handler's comment) — build the set of every protected name across
            // every user once, rather than per-addon, to avoid N+1 queries.
            const protectedNameSet = await (async () => {
                try {
                    const users = await prisma.user.findMany({
                        select: { protectedAddons: true },
                        where: { accountId: getAccountId(req) },
                    });
                    const set = new Set();
                    for (const u of users) {
                        let list = [];
                        try {
                            list = u.protectedAddons ? JSON.parse(u.protectedAddons) : [];
                        } catch {
                            list = [];
                        }
                        if (Array.isArray(list)) {
                            for (const n of list) {
                                if (typeof n === "string") {
                                    set.add(n.trim().toLowerCase());
                                }
                            }
                        }
                    }
                    return set;
                } catch {
                    return new Set();
                }
            })();

            // Who is active, read once - not one query per addon.
            const activeUserIds = new Set(
                (
                    await prisma.user.findMany({
                        select: { id: true },
                        where: { accountId: getAccountId(req), isActive: true },
                    })
                ).map((u) => u.id)
            );

            const transformedAddons = await Promise.all(
                addons.map(async (addon) => {
                    // Filter groupAddons to only include those from the current account
                    const currentAccountId = getAccountId(req);
                    const filteredGroupAddons = addon.groupAddons.filter(
                        (ga) => ga.group && ga.group.accountId === currentAccountId
                    );

                    // Calculate total users across all groups that contain this addon (only from current account)
                    let totalUsers = 0;

                    if (filteredGroupAddons && filteredGroupAddons.length > 0) {
                        // Get all unique user IDs from all groups that contain this addon
                        const allUserIds = new Set();

                        for (const groupAddon of filteredGroupAddons) {
                            if (groupAddon.group?.userIds) {
                                try {
                                    const userIds = JSON.parse(groupAddon.group.userIds);
                                    if (Array.isArray(userIds)) {
                                        userIds.forEach((userId) => {
                                            allUserIds.add(userId);
                                        });
                                    }
                                } catch (e) {
                                    console.error("Error parsing group userIds for addon:", e);
                                }
                            }
                        }

                        // Count active users
                        for (const userId of allUserIds) {
                            if (activeUserIds.has(userId)) {
                                totalUsers++;
                            }
                        }
                    }

                    // Decrypted once, used three times below.
                    let manifestUrl = null;
                    try {
                        manifestUrl = getDecryptedManifestUrl(addon, req);
                    } catch {
                        manifestUrl = null;
                    }

                    return {
                        accountId: addon.accountId,
                        backupAddon: addon.backupAddon
                            ? (() => {
                                  // Decrypt manifest for backup addon
                                  let backupManifest = null;
                                  try {
                                      if (addon.backupAddon.manifest) {
                                          const dec = decrypt(addon.backupAddon.manifest, req);
                                          backupManifest =
                                              typeof dec === "string" ? JSON.parse(dec) : dec;
                                      }
                                  } catch {
                                      // Malformed optional data leaves the existing fallback in place.
                                  }

                                  return {
                                      customLogo: addon.backupAddon.customLogo,
                                      iconUrl: addon.backupAddon.iconUrl,
                                      id: addon.backupAddon.id,
                                      isActive: addon.backupAddon.isActive,
                                      isOnline: addon.backupAddon.isOnline,
                                      manifest: backupManifest,
                                      name: addon.backupAddon.name,
                                      version: addon.backupAddon.version,
                                  };
                              })()
                            : null,
                        // Backup info
                        backupAddonId: addon.backupAddonId,
                        catalogs: (() => {
                            try {
                                return addon.catalogs ? JSON.parse(addon.catalogs) : [];
                            } catch {
                                return [];
                            }
                        })(),
                        customLogo: addon.customLogo || null,
                        customTag: addon.customTag || null,
                        description: addon.description,
                        groups: filteredGroupAddons.length,
                        hasBackup: !!addon.backupAddon,
                        healthCheckError: addon.healthCheckError,
                        healthConfig: (() => {
                            try {
                                return addon.healthConfig ? JSON.parse(addon.healthConfig) : null;
                            } catch {
                                return null;
                            }
                        })(),
                        iconUrl: addon.iconUrl,
                        id: addon.id,
                        // Health check info
                        isOnline: addon.isOnline,
                        isProtected: protectedNameSet.has((addon.name || "").trim().toLowerCase()),
                        lastHealthCheck: addon.lastHealthCheck,
                        manifestUrl,
                        name: addon.name,
                        // Proxy info
                        proxyEnabled: addon.proxyEnabled || false,
                        proxyManifestUrl:
                            addon.proxyEnabled && addon.proxyUuid
                                ? `${req.protocol}://${req.get("host")}/proxy/${addon.proxyUuid}/manifest.json`
                                : null,
                        proxyUuid: addon.proxyUuid || null,
                        resources: (() => {
                            try {
                                return addon.resources ? JSON.parse(addon.resources) : [];
                            } catch {
                                return [];
                            }
                        })(),
                        status: addon.isActive ? "active" : "inactive",
                        stremioAddonId: addon.stremioAddonId,
                        url: manifestUrl, // Keep both for compatibility
                        users: totalUsers,
                        vaultified: (manifestUrl || "").includes("{{vault:"),
                        version: addon.version,
                    };
                })
            );

            res.json(transformedAddons);
        } catch (error) {
            console.error("Error fetching addons:", error);
            res.status(500).json({ message: "Failed to fetch addons" });
        }
    });

    // Enable addon (set isActive=true)
    router.put("/:id/enable", async (req, res) => {
        try {
            const { id } = req.params;

            // Validate addon exists
            const addon = await dbUtils.findEntity(prisma, "addon", id, getAccountId(req));
            if (!addon) {
                return responseUtils.notFound(res, "Addon");
            }

            // Update addon
            const updated = await dbUtils.updateEntity(
                prisma,
                "addon",
                id,
                { isActive: true },
                getAccountId(req)
            );

            return responseUtils.success(
                res,
                {
                    description: updated.description,
                    groups: 0,
                    id: updated.id,
                    name: updated.name,
                    status: updated.isActive ? "active" : "inactive",
                    url: getDecryptedManifestUrl(updated, req),
                    users: 0,
                    version: updated.version,
                },
                "Addon enabled successfully"
            );
        } catch (error) {
            console.error("Error enabling addon:", error);
            return responseUtils.internalError(res, error.message);
        }
    });

    // Disable addon (soft disable, stays in DB and groups)
    router.put("/:id/disable", async (req, res) => {
        try {
            const { id } = req.params;

            // Validate addon exists
            const addon = await dbUtils.findEntity(prisma, "addon", id, getAccountId(req));
            if (!addon) {
                return responseUtils.notFound(res, "Addon");
            }

            // Update addon
            const updated = await dbUtils.updateEntity(
                prisma,
                "addon",
                id,
                { isActive: false },
                getAccountId(req)
            );

            return responseUtils.success(
                res,
                {
                    description: updated.description,
                    groups: 0,
                    id: updated.id,
                    name: updated.name,
                    status: updated.isActive ? "active" : "inactive",
                    url: getDecryptedManifestUrl(updated, req),
                    users: 0,
                    version: updated.version,
                },
                "Addon disabled successfully"
            );
        } catch (error) {
            console.error("Error disabling addon:", error);
            return responseUtils.internalError(res, error.message);
        }
    });

    // Toggle addon status (enable/disable)
    router.patch("/:id/toggle-status", async (req, res) => {
        try {
            const { id } = req.params;
            const { isActive } = req.body;

            // Validate addon exists
            const addon = await dbUtils.findEntity(prisma, "addon", id, getAccountId(req));
            if (!addon) {
                return responseUtils.notFound(res, "Addon");
            }

            // Update addon
            const updated = await dbUtils.updateEntity(
                prisma,
                "addon",
                id,
                { isActive },
                getAccountId(req)
            );

            return responseUtils.success(
                res,
                {
                    description: updated.description,
                    groups: 0,
                    id: updated.id,
                    name: updated.name,
                    status: updated.isActive ? "active" : "inactive",
                    url: getDecryptedManifestUrl(updated, req),
                    users: 0,
                    version: updated.version,
                },
                `Addon ${isActive ? "enabled" : "disabled"} successfully`
            );
        } catch (error) {
            console.error("Error toggling addon status:", error);
            return responseUtils.internalError(res, error.message);
        }
    });

    // PATCH /api/addons/:id/health-ignore - hide this addon's offline state
    // from the Health page's Attention list/notifications (a known, accepted
    // failure the admin doesn't want repeated pinging about), without
    // touching isActive or anything the manifest-refreshing PUT /:id route does.
    router.patch("/:id/health-ignore", async (req, res) => {
        try {
            const { id } = req.params;
            const { healthIgnored } = req.body;

            const addon = await dbUtils.findEntity(prisma, "addon", id, getAccountId(req));
            if (!addon) {
                return responseUtils.notFound(res, "Addon");
            }

            const updated = await dbUtils.updateEntity(
                prisma,
                "addon",
                id,
                { healthIgnored: !!healthIgnored },
                getAccountId(req)
            );
            return responseUtils.success(res, {
                healthIgnored: updated.healthIgnored,
                id: updated.id,
            });
        } catch (error) {
            console.error("Error updating addon health-ignore state:", error);
            return responseUtils.internalError(res, error.message);
        }
    });

    // Per-addon health-check overrides (Addon.healthConfig; consumed by
    // utils/addonHealthCheck.js): custom probe URL, consecutive-failure
    // threshold before an offline transition, per-addon check interval.
    // Sending an empty/null body value for a field clears it; all three
    // cleared stores NULL (back to pure defaults).
    router.patch("/:id/health-config", async (req, res) => {
        try {
            const { id } = req.params;
            const addon = await dbUtils.findEntity(prisma, "addon", id, getAccountId(req));
            if (!addon) {
                return responseUtils.notFound(res, "Addon");
            }

            const { probeUrl, failureThreshold, intervalMinutes } = req.body || {};
            const cfg = {};
            if (probeUrl !== undefined && probeUrl !== null && String(probeUrl).trim() !== "") {
                const trimmed = String(probeUrl).trim();
                if (!/^https?:\/\/.+/i.test(trimmed)) {
                    return responseUtils.badRequest(res, "Probe URL must be an http(s) URL");
                }
                cfg.probeUrl = trimmed;
            }
            if (
                failureThreshold !== undefined &&
                failureThreshold !== null &&
                failureThreshold !== ""
            ) {
                const n = Math.floor(Number(failureThreshold));
                if (!Number.isFinite(n) || n < 1 || n > 10) {
                    return responseUtils.badRequest(
                        res,
                        "Failure threshold must be between 1 and 10"
                    );
                }
                if (n > 1) {
                    cfg.failureThreshold = n;
                }
            }
            if (
                intervalMinutes !== undefined &&
                intervalMinutes !== null &&
                intervalMinutes !== ""
            ) {
                const n = Math.floor(Number(intervalMinutes));
                if (!Number.isFinite(n) || n < 5 || n > 1440) {
                    return responseUtils.badRequest(
                        res,
                        "Check interval must be between 5 and 1440 minutes"
                    );
                }
                cfg.intervalMinutes = n;
            }

            const healthConfig = Object.keys(cfg).length > 0 ? JSON.stringify(cfg) : null;
            const updated = await dbUtils.updateEntity(
                prisma,
                "addon",
                id,
                { healthConfig },
                getAccountId(req)
            );
            return responseUtils.success(res, {
                healthConfig: healthConfig ? cfg : null,
                id: updated.id,
            });
        } catch (error) {
            console.error("Error updating addon health config:", error);
            return responseUtils.internalError(res, error.message);
        }
    });

    // Create new addon
    router.post("/", async (req, res) => {
        try {
            const {
                url,
                name,
                description,
                customLogo,
                groupIds,
                manifestData: providedManifestData,
                catalogs,
                resources,
            } = req.body;

            if (!url) {
                return responseUtils.badRequest(res, "Addon URL is required");
            }

            // Validate account context
            const accountValidation = validateAccountContext(req, INSTANCE_TYPE === "public");
            if (!accountValidation.isValid) {
                return sendError(res, 401, accountValidation.error);
            }

            // Use centralized URL sanitization
            const sanitizedUrl = sanitizeUrl(url);
            if (!sanitizedUrl) {
                return responseUtils.badRequest(res, "Invalid URL provided");
            }

            const _lowerUrl = sanitizedUrl.toLowerCase();

            // A SlickTrax url belongs to ONE user - the token in the path is that
            // user's feed. Added here it would become a shared addon, and
            // assigning it to a group would push one person's Continue Watching
            // and Watchlist onto everyone else's devices. It also would not
            // survive: sync owns SlickTrax placement per user and drops any trax
            // url that is not the current one for that user. So this is refused
            // with the actual way in rather than accepted and then quietly undone
            // (reported live: "I add it and it never shows up on my user").
            if (
                /\/trax\/[a-f0-9]{16,}\//i.test(sanitizedUrl) ||
                /\/trax\/[a-f0-9]{16,}\/manifest\.json$/i.test(sanitizedUrl)
            ) {
                const traxUser = await prisma.user
                    .findFirst({
                        select: { id: true, traxToken: true, username: true },
                        where: { accountId: getAccountId(req) },
                    })
                    .catch(() => null);
                return res.status(400).json({
                    hint: traxUser?.username
                        ? `Open the user page for ${traxUser.username} and use the SlickTrax Addon row.`
                        : undefined,
                    message:
                        "That is a SlickTrax address, which belongs to a single user rather than the shared addon list. Turn it on from that user's page (Watch-Tracking Integrations -> SlickTrax Addon -> Enable) and their next sync installs it for them. Adding it here would share one person's Continue Watching and Watchlist with everyone in the group.",
                });
            }

            // A SlickTrax url belongs to ONE user - the token in the path is that
            // user's feed. Added here it would become a shared addon, and
            // assigning it to a group would push one person's Continue Watching
            // and Watchlist onto everyone else's devices. It also would not
            // survive: sync owns SlickTrax placement per user and drops any trax
            // url that is not the current one for that user. So this is refused
            // with the actual way in rather than accepted and then quietly undone
            // (reported live: "I add it and it never shows up on my user").
            if (
                /\/trax\/[a-f0-9]{16,}\//i.test(sanitizedUrl) ||
                /\/trax\/[a-f0-9]{16,}\/manifest\.json$/i.test(sanitizedUrl)
            ) {
                const traxUser = await prisma.user
                    .findFirst({
                        select: { id: true, traxToken: true, username: true },
                        where: { accountId: getAccountId(req) },
                    })
                    .catch(() => null);
                return res.status(400).json({
                    hint: traxUser?.username
                        ? `Open the user page for ${traxUser.username} and use the SlickTrax Addon row.`
                        : undefined,
                    message:
                        "That is a SlickTrax address, which belongs to a single user rather than the shared addon list. Turn it on from that user's page (Watch-Tracking Integrations -> SlickTrax Addon -> Enable) and their next sync installs it for them. Adding it here would share one person's Continue Watching and Watchlist with everyone in the group.",
                });
            }

            // The address is checked whether or not the browser already sent the
            // manifest: it is what every later reload and health check will fetch.
            // A name this server cannot look up is let through here - when it has
            // to fetch the manifest itself the fetch below reports that, and when
            // the browser supplied it nothing needs resolving yet.
            try {
                await assertSafeUrl(sanitizedUrl, addressPolicy);
            } catch (e) {
                if (e?.message !== "unresolvable host") {
                    return res.status(400).json({
                        message: `Could not add this addon. ${addressProblem(e, addressPolicy) || "That address cannot be used."}`,
                    });
                }
            }

            // Use provided manifest data if available, otherwise fetch it
            let manifestData = providedManifestData;
            if (!manifestData) {
                // The old message here always blamed the URL ("the add-on URL may be
                // incorrect"), which is usually wrong and sends people off checking a
                // URL that is perfectly fine. The realistic failures are the addon
                // being gone, or the addon's host refusing THIS SERVER specifically -
                // Cloudflare-fronted addons commonly 403 a datacenter IP while
                // working fine from a home connection. Confirmed live: torrentio and
                // thepiratebay-plus both 403 from two different VPS hosts while
                // cinemeta returns 200 from the same machines.
                try {
                    const resp = await safeFetch(sanitizedUrl, {}, addressPolicy);
                    if (!resp.ok) {
                        const detail =
                            resp.status === 403 || resp.status === 401
                                ? `The addon refused the request (HTTP ${resp.status}). Some addons block servers/VPS IPs even though they work from a normal browser - this is set by the addon, not by SlickSync.`
                                : resp.status === 404
                                  ? 'The addon returned "not found" (HTTP 404). Check the URL, or the addon may no longer exist.'
                                  : `The addon responded with HTTP ${resp.status}.`;
                        return res
                            .status(400)
                            .json({ message: `Could not add this addon. ${detail}` });
                    }
                    manifestData = await resp.json();
                } catch (e) {
                    const msg = String(e?.message || "");
                    const detail =
                        addressProblem(e, addressPolicy) ||
                        (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)
                            ? "That addon's address could not be found - it looks like the addon is offline or no longer exists."
                            : /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|timeout|aborted/i.test(
                                    msg
                                )
                              ? "Could not reach that addon (it did not respond). It may be down or temporarily unavailable."
                              : /JSON|Unexpected token/i.test(msg)
                                ? "That address did not return a valid addon manifest."
                                : `Could not reach that addon: ${msg}`);
                    return res.status(400).json({ message: `Could not add this addon. ${detail}` });
                }
            }

            // Note: we build dbData after we compute filtered/resources/catalogs further below

            // The duplicate check is by name, and the request does not always
            // carry one. The browser pre-fetches the manifest to fill it in, which
            // it can only do when the addon's own CORS policy allows it - and a
            // page served over https cannot fetch an http:// manifest at all. Every
            // one of those arrived here with no name and died on name.trim(),
            // giving a 500 that reads as "SlickSync will not let me add this
            // addon" when the URL is fine and the server fetches it perfectly well
            // (reported live against a SlickTrax manifest URL). So the name is
            // settled AFTER the fetch, from the manifest the server just read -
            // which is the more trustworthy source of the two anyway.
            const effectiveName =
                typeof name === "string" && name.trim()
                    ? name.trim()
                    : typeof manifestData?.name === "string" && manifestData.name.trim()
                      ? manifestData.name.trim()
                      : "Unknown";

            const existingByName = await prisma.addon.findFirst({
                where: {
                    accountId: getAccountId(req),
                    name: effectiveName,
                },
            });

            if (existingByName) {
                if (existingByName.isActive) {
                    // Addon with this name already exists and is active
                    return res
                        .status(409)
                        .json({ message: "Addon with this name already exists." });
                }
                // Reactivate and refresh meta for inactive record
                const reactivated = await prisma.addon.update({
                    data: {
                        description:
                            description ||
                            manifestData?.description ||
                            existingByName.description ||
                            "",
                        iconUrl: manifestData?.logo || existingByName.iconUrl || null, // Store logo URL from manifest
                        isActive: true,
                        // Use provided name or manifest name when reactivating
                        name: name?.trim()
                            ? name.trim()
                            : manifestData?.name || existingByName.name,
                        stremioAddonId: manifestData?.id || existingByName.stremioAddonId || null,
                        version: manifestData?.version || existingByName.version || null,
                    },
                    select: {
                        description: true,
                        id: true,
                        isActive: true,
                        manifestUrl: true,
                        name: true,
                        version: true,
                    },
                    where: {
                        accountId: getAccountId(req),
                        id: existingByName.id,
                    },
                });

                // Handle group assignments for reactivated addon
                const assignedGroups = [];
                if (groupIds && Array.isArray(groupIds) && groupIds.length > 0) {
                    try {
                        // Create group addon relationships
                        for (const groupId of groupIds) {
                            try {
                                // Check if relationship already exists
                                const existingGroupAddon = await prisma.groupAddon.findFirst({
                                    where: {
                                        addonId: reactivated.id,
                                        groupId,
                                    },
                                });

                                if (!existingGroupAddon) {
                                    // Get the next available position for this group
                                    const maxPosition = await prisma.groupAddon.aggregate({
                                        _max: { position: true },
                                        where: {
                                            groupId,
                                            position: { not: null },
                                        },
                                    });
                                    const nextPosition = (maxPosition._max.position ?? -1) + 1;

                                    await prisma.groupAddon.create({
                                        data: {
                                            addonId: reactivated.id,
                                            groupId,
                                            isEnabled: true,
                                            position: nextPosition,
                                        },
                                    });
                                    assignedGroups.push(groupId);
                                }
                            } catch (groupError) {
                                console.error(
                                    `Error assigning addon to group ${groupId}:`,
                                    groupError
                                );
                            }
                        }
                    } catch (error) {
                        console.error("Error handling group assignments:", error);
                    }
                }

                return res.json({
                    addon: {
                        customLogo: reactivated.customLogo,
                        description: reactivated.description,
                        groups: assignedGroups.length,
                        iconUrl: reactivated.iconUrl,
                        id: reactivated.id,
                        name: reactivated.name,
                        status: reactivated.isActive ? "active" : "inactive",
                        url: getDecryptedManifestUrl(reactivated, req),
                        users: 0,
                        version: reactivated.version,
                    },
                    assignedGroups,
                    message: "Addon reactivated successfully",
                });
            }

            // Filter manifest according to selected resources
            let filtered = manifestData;
            if (Array.isArray(manifestData?.resources) && manifestData.resources.length > 0) {
                filtered = filterManifestByResources(manifestData, manifestData.resources);
            }

            // Extract simplified resources and catalogs for storage
            const _simplifiedResources = (() => {
                try {
                    const src =
                        Array.isArray(resources) && resources.length > 0
                            ? resources
                            : Array.isArray(manifestData?.resources)
                              ? manifestData.resources
                              : [];
                    return src
                        .map((r) => {
                            if (typeof r === "string") {
                                return r;
                            }
                            if (r && typeof r === "object" && r.name) {
                                return r.name;
                            }
                            return null;
                        })
                        .filter(Boolean);
                } catch {
                    return [];
                }
            })();

            const _simplifiedCatalogs = (() => {
                try {
                    // Use the UI state (catalogs parameter) if available, otherwise fall back to manifest data
                    const src =
                        Array.isArray(catalogs) && catalogs.length > 0
                            ? catalogs
                            : Array.isArray(manifestData?.catalogs)
                              ? manifestData.catalogs
                              : [];

                    const processedCatalogs = [];

                    for (const catalog of src) {
                        if (!(catalog?.type && catalog?.id)) {
                            continue;
                        }

                        // Check if catalog has search functionality enabled in UI state
                        const hasSearch = catalog?.extra?.some((extra) => extra.name === "search");
                        const hasOtherExtras = catalog?.extra?.some(
                            (extra) => extra.name !== "search"
                        );
                        const isEmbeddedSearch = hasSearch && hasOtherExtras;
                        const isStandaloneSearch = hasSearch && !hasOtherExtras;

                        if (isStandaloneSearch) {
                            // Standalone search catalog: add with original ID (no suffix)
                            // Set search: true for search catalogs (matching reset behavior)
                            processedCatalogs.push({
                                id: catalog.id,
                                search: true, // Search catalogs should have search enabled by default
                                type: catalog.type,
                            });
                        } else if (isEmbeddedSearch) {
                            // Embedded search catalog: add both original and search versions
                            // Set search: true for the main catalog if it has search extra (matching reset behavior)
                            processedCatalogs.push({
                                id: catalog.id,
                                search: true, // Embedded search catalogs should have search enabled by default
                                type: catalog.type,
                            });
                            processedCatalogs.push({
                                id: `${catalog.id}-embed-search`,
                                search: false, // This is the embedded search version, search is always false
                                type: catalog.type,
                            });
                        } else {
                            // Regular catalog: add as-is
                            processedCatalogs.push({
                                id: catalog.id,
                                search: false, // Regular catalogs don't have search
                                type: catalog.type,
                            });
                        }
                    }

                    return processedCatalogs;
                } catch {
                    return [];
                }
            })();

            // Centralize DB data build (consistent with repair and elsewhere)
            // Use raw catalogs from manifest (with extra arrays) so buildAddonDbData can detect search
            const rawCatalogs =
                Array.isArray(catalogs) && catalogs.length > 0
                    ? catalogs
                    : Array.isArray(manifestData?.catalogs)
                      ? manifestData.catalogs
                      : [];

            const { buildAddonDbData } = require("../utils/stremio");
            const dbData = buildAddonDbData(req, {
                // Don't pass resources - let buildAddonDbData auto-detect from catalogs
                catalogs: rawCatalogs,
                customLogo: customLogo?.trim() ? customLogo.trim() : null,
                description,
                filteredManifest: filtered,
                iconUrl: manifestData?.logo,
                isActive: true,
                manifestObj: manifestData,
                name: effectiveName,
                sanitizedUrl,
                stremioAddonId: manifestData?.id,
                version: manifestData?.version,
            });

            // Create new addon using centralized builder
            const newAddon = await prisma.addon.create({ data: dbData });

            // Handle group assignments for new addon
            const assignedGroups = [];
            if (groupIds && Array.isArray(groupIds) && groupIds.length > 0) {
                try {
                    // Create group addon relationships
                    for (const groupId of groupIds) {
                        try {
                            // Get the next available position for this group
                            const maxPosition = await prisma.groupAddon.aggregate({
                                _max: { position: true },
                                where: {
                                    groupId,
                                    position: { not: null },
                                },
                            });
                            const nextPosition = (maxPosition._max.position ?? -1) + 1;

                            await prisma.groupAddon.create({
                                data: {
                                    addonId: newAddon.id,
                                    groupId,
                                    isEnabled: true,
                                    position: nextPosition,
                                },
                            });
                            assignedGroups.push(groupId);
                        } catch (groupError) {
                            console.error(`Error assigning addon to group ${groupId}:`, groupError);
                        }
                    }
                } catch (error) {
                    console.error("Error handling group assignments:", error);
                }
            }

            res.status(201).json({
                addon: {
                    catalogs: (() => {
                        try {
                            return newAddon.catalogs ? JSON.parse(newAddon.catalogs) : [];
                        } catch {
                            return [];
                        }
                    })(),
                    customLogo: newAddon.customLogo,
                    description: newAddon.description,
                    groups: assignedGroups.length,
                    iconUrl: newAddon.iconUrl,
                    id: newAddon.id,
                    name: newAddon.name,
                    resources: (() => {
                        try {
                            return newAddon.resources ? JSON.parse(newAddon.resources) : [];
                        } catch {
                            return [];
                        }
                    })(),
                    status: newAddon.isActive ? "active" : "inactive",
                    url: getDecryptedManifestUrl(newAddon, req),
                    users: 0,
                    version: newAddon.version,
                },
                assignedGroups,
                message: "Addon created successfully",
            });
        } catch (error) {
            console.error("Error creating addon:", error);
            if (error.code === "P2002") {
                // If unique constraint (likely manifestUrl) tripped, return a friendly conflict
                return res.status(409).json({ message: "Addon already exists." });
            }
            res.status(500).json({
                error: publicMessage(error, "Failed to create addon"),
                message: "Failed to create addon",
            });
        }
    });

    // Reload addon manifest and update content
    // A reload that changed an addon is followed by a sync of every group
    // carrying it, so the accounts get the new manifest now rather than at
    // the next scheduled pass. Runs after the reply, one sync per group,
    // best-effort: a group that fails to sync is logged, the others still
    // run, and the reload itself already succeeded.
    async function syncGroupsCarrying(addonIds, req) {
        try {
            const rows = await prisma.groupAddon.findMany({
                select: { groupId: true },
                where: { addonId: { in: addonIds } },
            });
            const groupIds = [...new Set(rows.map((r) => r.groupId))];
            if (groupIds.length === 0) {
                return;
            }
            const { syncGroupUsers } = require("./groups");
            if (typeof syncGroupUsers !== "function") {
                return;
            }
            for (const groupId of groupIds) {
                try {
                    await syncGroupUsers(prisma, getAccountId, scopedWhere, decrypt, groupId, req);
                } catch (e) {
                    console.warn(`Post-reload sync of group ${groupId} failed:`, e?.message);
                }
            }
        } catch (e) {
            console.warn("Post-reload group sync skipped:", e?.message);
        }
    }

    router.post("/:id/reload", async (req, res) => {
        try {
            const { id } = req.params;
            const { autoSelectNewElements = true } = req.body; // Default to true to auto-select truly new elements

            // Use the shared reload helper function
            const result = await reloadAddon(
                prisma,
                getAccountId,
                id,
                req,
                {
                    decrypt,
                    encrypt,
                    filterManifestByCatalogs,
                    filterManifestByResources,
                    getDecryptedManifestUrl,
                    manifestHash,
                },
                autoSelectNewElements
            );

            res.json({
                addon: result.addon,
                changed: !!result?.changed,
                message: result?.changed
                    ? "Addon reloaded - its groups are syncing"
                    : "Addon reloaded successfully",
            });
            if (result?.changed) {
                syncGroupsCarrying([id], req);
            }
        } catch (error) {
            console.error("Error reloading addon:", error);

            // Handle specific error cases
            if (error.message === "Addon not found") {
                return responseUtils.notFound(res, "Addon");
            }
            if (error.message === "Addon is disabled") {
                return responseUtils.badRequest(res, "Addon is disabled");
            }
            if (error.message === "Addon has no manifest URL") {
                return responseUtils.badRequest(res, "Addon has no manifest URL");
            }
            if (error.message === "Failed to resolve addon URL") {
                return responseUtils.badRequest(res, "Failed to resolve addon URL");
            }
            if (error.message.includes("Failed to fetch addon manifest")) {
                return responseUtils.badRequest(res, "Failed to fetch addon manifest");
            }

            return responseUtils.internalError(res, error?.message || "Failed to reload addon");
        }
    });

    // Delete addon
    // POST /api/addons/:id/move-to-vault - convert an addon into a tracked Vault credential,
    // removing it from active addon management (same cascade behavior as a normal delete —
    // group associations are removed, not blocked, matching the existing delete endpoint).
    router.post("/:id/move-to-vault", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const { id } = req.params;
            const { category } = req.body || {};

            const VAULT_CATEGORIES = [
                "debrid",
                "usenet_provider",
                "usenet_indexer",
                "stremio",
                "nuvio",
                "metadata",
                "ai",
                "vpn",
                "aiostreams",
                "custom",
            ];
            if (!(category && VAULT_CATEGORIES.includes(category))) {
                return res
                    .status(400)
                    .json({ error: `category must be one of: ${VAULT_CATEGORIES.join(", ")}` });
            }

            const addon = await findAddonById(prisma, id, accountId);
            if (!addon) {
                return res.status(404).json({ error: "Addon not found" });
            }

            const decryptedUrl = getDecryptedManifestUrl(addon, req);
            if (!decryptedUrl) {
                return res
                    .status(500)
                    .json({ error: "Failed to decrypt this addon's manifest URL" });
            }

            const groupCount = await prisma.groupAddon.count({ where: { addonId: id } });

            const maxPositionEntry = await prisma.vaultEntry.findFirst({
                orderBy: { position: "desc" },
                select: { position: true },
                where: { accountId, category },
            });
            const nextPosition = (maxPositionEntry?.position ?? -1) + 1;

            const vaultEntry = await prisma.vaultEntry.create({
                data: {
                    accountId,
                    category,
                    dashboardUrl: decryptedUrl,
                    encryptedSecret: encrypt(decryptedUrl, req),
                    name: addon.name,
                    position: nextPosition,
                    secretLabel: "Manifest URL",
                    testConfig: JSON.stringify({
                        authMode: "none",
                        expectStatus: 200,
                        method: "GET",
                        url: decryptedUrl,
                    }),
                    testType: "generic_http",
                },
            });

            const dbTransactions = new DatabaseTransactions(prisma);
            await dbTransactions.deleteAddonWithRelations(id, accountId);

            res.json({ removedFromGroups: groupCount, success: true, vaultEntryId: vaultEntry.id });
        } catch (error) {
            console.error("Error moving addon to vault:", error);
            res.status(500).json({ error: "Failed to move addon to vault" });
        }
    });

    router.delete(
        "/:id",
        createRouteHandler(async (req, res) => {
            const { id } = req.params;
            const accountId = getAccountId(req);

            // Ensure addon exists
            const existing = await findAddonById(prisma, id, accountId);
            if (!existing) {
                return sendError(res, 404, "Addon not found");
            }

            // Archive to Trash before the delete so this is undoable - see
            // utils/trash.js. Archive-only here (not archiveAndDelete): the
            // transaction below also tears down group assignments and related rows,
            // and a plain delete would leave those behind. A failed archive must not
            // block the delete the user asked for, so it degrades to a normal
            // (non-undoable) delete rather than erroring.
            let trashId = null;
            try {
                const { archive } = require("../utils/trash");
                trashId = (await archive(prisma, accountId, "addon", id)).id;
            } catch (e) {
                console.error("[Trash] Archive failed, deleting without undo:", e?.message);
            }

            // Use centralized database transaction
            const dbTransactions = new DatabaseTransactions(prisma);
            await dbTransactions.deleteAddonWithRelations(id, accountId);

            res.json({ message: "Addon deleted successfully", trashId });
        })
    );

    // Clone addon endpoint
    router.post("/:id/clone", async (req, res) => {
        try {
            const { id } = req.params;

            // Find the original addon
            const originalAddon = await prisma.addon.findFirst({
                where: {
                    accountId: getAccountId(req),
                    id,
                },
            });

            if (!originalAddon) {
                return res.status(404).json({ message: "Addon not found" });
            }

            // Find unique name for the clone
            const baseCloneName = `${originalAddon.name} (Copy)`;
            let cloneName = baseCloneName;
            let copyNumber = 1;

            while (true) {
                const nameExists = await prisma.addon.findFirst({
                    where: {
                        accountId: getAccountId(req),
                        name: cloneName,
                    },
                });

                if (!nameExists) {
                    break;
                }

                cloneName =
                    copyNumber === 1
                        ? `${originalAddon.name} (Copy)`
                        : `${originalAddon.name} (Copy #${copyNumber})`;
                copyNumber++;
            }

            // Create a clone with a modified name
            const clonedAddon = await prisma.addon.create({
                data: {
                    accountId: getAccountId(req),
                    catalogs: originalAddon.catalogs,
                    description: originalAddon.description,
                    iconUrl: originalAddon.iconUrl,
                    isActive: true, // Clone as active by default
                    manifest: originalAddon.manifest,
                    manifestHash: originalAddon.manifestHash,
                    manifestUrl: originalAddon.manifestUrl,
                    manifestUrlHash: originalAddon.manifestUrlHash, // Copy the hash
                    name: cloneName,
                    originalManifest: originalAddon.originalManifest, // Copy the original manifest
                    resources: originalAddon.resources,
                    stremioAddonId: originalAddon.stremioAddonId,
                    version: originalAddon.version,
                },
            });

            // Clone group associations
            if (originalAddon.groups && originalAddon.groups.length > 0) {
                await prisma.addon.update({
                    data: {
                        groups: {
                            connect: originalAddon.groups.map((groupId) => ({ id: groupId })),
                        },
                    },
                    where: { id: clonedAddon.id },
                });
            }

            res.json({
                addon: clonedAddon,
                message: "Addon cloned successfully",
            });
        } catch (error) {
            console.error("Error cloning addon:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to clone addon"),
                message: "Failed to clone addon",
            });
        }
    });

    // Get individual addon details
    router.get("/:id", async (req, res) => {
        try {
            const { id } = req.params;

            const addon = await prisma.addon.findFirst({
                include: {
                    backupAddon: {
                        include: {
                            backupAddon: {
                                include: {
                                    backupAddon: {
                                        include: {
                                            backupAddon: {
                                                include: {
                                                    backupAddon: true,
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    groupAddons: {
                        include: {
                            group: {
                                include: {
                                    _count: {
                                        select: {
                                            addons: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                // Scoped to the account: on a shared instance the id in the URL is
                // the only thing identifying this row, so without it one account
                // could read or change another's by id.
                where: { accountId: getAccountId(req), id },
            });

            if (!addon) {
                return res.status(404).json({ error: "Addon not found" });
            }

            // Filter groupAddons to only include those from the current account
            const currentAccountId = getAccountId(req);
            const filteredGroupAddons = addon.groupAddons.filter(
                (ga) => ga.group && ga.group.accountId === currentAccountId
            );

            // Calculate total users across all groups that have this addon (only from current account)
            const totalUsers = filteredGroupAddons.reduce(
                (sum, groupAddon) => sum + (groupAddon.group._count.users || 0),
                0
            );

            // Recursively build backup chain data
            const buildBackupChain = (backupAddon) => {
                if (!backupAddon) {
                    return null;
                }

                // Decrypt manifest for this backup addon
                let backupManifest = null;
                try {
                    if (backupAddon.manifest) {
                        const dec = decrypt(backupAddon.manifest, req);
                        backupManifest = typeof dec === "string" ? JSON.parse(dec) : dec;
                    }
                } catch {
                    // Malformed optional data leaves the existing fallback in place.
                }

                return {
                    backupAddon: buildBackupChain(backupAddon.backupAddon),
                    customLogo: backupAddon.customLogo,
                    iconUrl: backupAddon.iconUrl,
                    id: backupAddon.id,
                    isActive: backupAddon.isActive,
                    isOnline: backupAddon.isOnline,
                    lastHealthCheck: backupAddon.lastHealthCheck,
                    manifest: backupManifest,
                    name: backupAddon.name,
                    version: backupAddon.version,
                };
            };

            const backupData = buildBackupChain(addon.backupAddon);

            const transformedAddon = {
                backupAddon: backupData,
                // Backup info
                backupAddonId: addon.backupAddonId,
                catalogs: (() => {
                    try {
                        return addon.catalogs ? JSON.parse(addon.catalogs) : [];
                    } catch {
                        return [];
                    }
                })(),
                category: addon.category || "Other",
                createdAt: addon.createdAt,
                customLogo: addon.customLogo || null,
                description: addon.description,
                groups: filteredGroupAddons.map((ga) => ({
                    id: ga.group.id,
                    name: ga.group.name,
                })),
                healthCheckError: addon.healthCheckError,
                healthConfig: (() => {
                    try {
                        return addon.healthConfig ? JSON.parse(addon.healthConfig) : null;
                    } catch {
                        return null;
                    }
                })(),
                iconUrl: addon.iconUrl || null,
                id: addon.id,
                // Health check info
                isOnline: addon.isOnline,
                lastHealthCheck: addon.lastHealthCheck,
                // include manifest details for UI configuration (resources/types/etc.)
                manifest: (() => {
                    let manifestObj = null;
                    try {
                        if (addon.manifest) {
                            manifestObj = JSON.parse(decrypt(addon.manifest, req));
                        }
                    } catch {
                        // Malformed optional data leaves the existing fallback in place.
                    }
                    // Always return an object to avoid null checks client-side
                    if (!manifestObj) {
                        manifestObj = {
                            catalogs: [],
                            description: addon.description || "",
                            id: addon.stremioAddonId || addon.name || "unknown",
                            logo: addon.iconUrl || null,
                            name: addon.name || "Unknown",
                            resources: (() => {
                                try {
                                    return addon.resources ? JSON.parse(addon.resources) : [];
                                } catch {
                                    return [];
                                }
                            })(),
                            types: [],
                            version: addon.version || "unknown",
                        };
                    }
                    return manifestObj;
                })(),
                name: addon.name,
                originalManifest: (() => {
                    try {
                        if (addon.originalManifest) {
                            return JSON.parse(decrypt(addon.originalManifest, req));
                        }
                    } catch {
                        // Malformed optional data leaves the existing fallback in place.
                    }
                    return null;
                })(),
                // Proxy info
                proxyEnabled: addon.proxyEnabled || false,
                proxyManifestUrl:
                    addon.proxyEnabled && addon.proxyUuid
                        ? `${req.protocol}://${req.get("host")}/proxy/${addon.proxyUuid}/manifest.json`
                        : null,
                proxyUuid: addon.proxyUuid || null,
                resources: (() => {
                    try {
                        return addon.resources ? JSON.parse(addon.resources) : [];
                    } catch {
                        return [];
                    }
                })(),
                status: addon.isActive ? "active" : "inactive",
                updatedAt: addon.updatedAt,
                url: (() => {
                    try {
                        if (addon.manifestUrl) {
                            return decrypt(addon.manifestUrl, req);
                        }
                    } catch {}
                    return addon.manifestUrl;
                })(),
                users: totalUsers,
                vaultified: (() => {
                    try {
                        return (getDecryptedManifestUrl(addon, req) || "").includes("{{vault:");
                    } catch {
                        return false;
                    }
                })(),
                version: addon.version,
            };

            res.json(transformedAddon);
        } catch (error) {
            console.error("Error fetching addon details:", error);
            res.status(500).json({ error: "Failed to fetch addon details" });
        }
    });

    // Get addon health check history
    router.get("/:id/health-history", async (req, res) => {
        try {
            const { id } = req.params;
            const { limit = "50" } = req.query;

            // Check if addon exists
            const addon = await prisma.addon.findFirst({
                select: { id: true, name: true },
                where: { accountId: getAccountId(req), id },
            });

            if (!addon) {
                return res.status(404).json({ error: "Addon not found" });
            }

            // Get health history
            const history = await prisma.addonHealthHistory.findMany({
                orderBy: { checkedAt: "desc" },
                select: {
                    checkedAt: true,
                    error: true,
                    id: true,
                    isOnline: true,
                    responseTimeMs: true,
                },
                take: Number.parseInt(limit, 10) || 50,
                where: { addonId: id },
            });

            res.json({
                addonId: id,
                addonName: addon.name,
                history: history.map((h) => ({
                    checkedAt: h.checkedAt,
                    error: h.error,
                    id: h.id,
                    isOnline: h.isOnline,
                    responseTimeMs: h.responseTimeMs,
                })),
            });
        } catch (error) {
            console.error("Error fetching addon health history:", error);
            res.status(500).json({ error: "Failed to fetch health history" });
        }
    });

    // AI incident summary - turns a run of raw health-check rows into one
    // plain-English paragraph instead of making an admin read a timestamped
    // log to piece together what happened. Only worth generating when there's
    // an actual incident to explain (at least MIN_OFFLINE_FOR_SUMMARY offline
    // rows in the most recent HISTORY_WINDOW checks) - a clean history has
    // nothing to summarize, and this endpoint returns null rather than an AI
    // call forcing a "everything's fine!" filler sentence. Silently null (not
    // an error) when no AI key is configured, same as every other optional
    // AI-backed field in this codebase.
    const MIN_OFFLINE_FOR_SUMMARY = 2;
    const HISTORY_WINDOW = 30;
    router.get("/:id/health-summary", async (req, res) => {
        try {
            const { id } = req.params;
            const addon = await prisma.addon.findFirst({
                select: { accountId: true, id: true, name: true },
                where: { accountId: getAccountId(req), id },
            });
            if (!addon) {
                return res.status(404).json({ error: "Addon not found" });
            }

            const history = await prisma.addonHealthHistory.findMany({
                orderBy: { checkedAt: "desc" },
                select: { checkedAt: true, error: true, isOnline: true },
                take: HISTORY_WINDOW,
                where: { addonId: id },
            });

            const offlineCount = history.filter((h) => !h.isOnline).length;
            if (offlineCount < MIN_OFFLINE_FOR_SUMMARY) {
                return res.json({ summary: null });
            }

            const { resolveAiCredentials, callAiText } = require("../utils/nlCatalog");
            const creds = await resolveAiCredentials(prisma, addon.accountId, decrypt);
            if (!creds) {
                return res.json({ summary: null });
            }

            // Oldest-first for the prompt - a timeline reads more naturally in
            // chronological order than the newest-first order the table itself uses.
            const timeline = [...history]
                .reverse()
                .map((h) => {
                    const when = new Date(h.checkedAt).toISOString();
                    return h.isOnline
                        ? `${when}: online`
                        : `${when}: offline${h.error ? ` (${h.error})` : ""}`;
                })
                .join("\n");

            const prompt = `You're summarizing a Stremio/Nuvio addon's recent health-check log for a self-hosted admin dashboard. Addon: "${addon.name}". Write ONE short paragraph (2-3 sentences, plain English, no markdown) covering: what broke, roughly when/how often, and whether it's currently back up. Log (oldest first):\n${timeline}`;

            let summary = null;
            try {
                summary = await callAiText(prompt, creds, { maxTokens: 120, timeoutMs: 6000 });
            } catch {
                return res.json({ summary: null }); // best-effort - the raw log below is still there either way
            }

            res.json({ summary });
        } catch (error) {
            console.error("Error generating addon health summary:", error);
            res.status(500).json({ error: "Failed to generate health summary" });
        }
    });

    // Get addon backup status
    router.get("/:id/backup", async (req, res) => {
        try {
            const { id } = req.params;

            const addon = await prisma.addon.findFirst({
                select: {
                    backupAddon: {
                        select: {
                            id: true,
                            isActive: true,
                            isOnline: true,
                            lastHealthCheck: true,
                            name: true,
                        },
                    },
                    backupAddonId: true,
                    id: true,
                    name: true,
                },
                where: { accountId: getAccountId(req), id },
            });

            if (!addon) {
                return res.status(404).json({ error: "Addon not found" });
            }

            res.json({
                addonId: addon.id,
                addonName: addon.name,
                backupAddon: addon.backupAddon,
                backupAddonId: addon.backupAddonId,
            });
        } catch (error) {
            console.error("Error fetching addon backup:", error);
            res.status(500).json({ error: "Failed to fetch backup" });
        }
    });

    // Link an existing addon as backup
    router.put("/:id/backup", async (req, res) => {
        try {
            const { id } = req.params;
            const { backupAddonId } = req.body;

            if (!backupAddonId) {
                return res.status(400).json({ error: "Backup addon ID is required" });
            }

            if (backupAddonId === id) {
                return res.status(400).json({ error: "An addon cannot be its own backup" });
            }

            // Get primary addon
            const primaryAddon = await prisma.addon.findFirst({
                where: { accountId: getAccountId(req), id },
            });

            if (!primaryAddon) {
                return res.status(404).json({ error: "Addon not found" });
            }

            // Check for circular references - ensure backup doesn't eventually point back to primary
            async function wouldCreateCircularReference(startId, targetId, depth = 0) {
                if (depth > 10) {
                    return false; // Safety limit
                }

                const addon = await prisma.addon.findFirst({
                    select: { backupAddonId: true },
                    where: { accountId: getAccountId(req), id: startId },
                });

                if (!addon?.backupAddonId) {
                    return false;
                }
                if (addon.backupAddonId === targetId) {
                    return true;
                }

                return wouldCreateCircularReference(addon.backupAddonId, targetId, depth + 1);
            }

            const hasCircularRef = await wouldCreateCircularReference(backupAddonId, id);
            if (hasCircularRef) {
                return res.status(400).json({ error: "Cannot create circular backup chain" });
            }

            // Verify the backup addon exists and belongs to same account
            const backupAddon = await prisma.addon.findFirst({
                select: {
                    description: true,
                    iconUrl: true,
                    id: true,
                    isActive: true,
                    isOnline: true,
                    lastHealthCheck: true,
                    name: true,
                    version: true,
                },
                where: {
                    accountId: primaryAddon.accountId,
                    id: backupAddonId,
                },
            });

            if (!backupAddon) {
                return res.status(404).json({ error: "Backup addon not found" });
            }

            // Link backup to primary
            await prisma.addon.update({
                data: { backupAddonId: backupAddon.id },
                where: { id },
            });

            res.json({
                backupAddon: {
                    id: backupAddon.id,
                    isActive: backupAddon.isActive,
                    isOnline: backupAddon.isOnline,
                    name: backupAddon.name,
                },
                message: "Backup linked successfully",
            });
        } catch (error) {
            console.error("Error linking backup:", error);
            res.status(500).json({ error: publicMessage(error, "Failed to link backup") });
        }
    });

    // Remove addon backup (unlink)
    router.delete("/:id/backup", async (req, res) => {
        try {
            const { id } = req.params;

            const primaryAddon = await prisma.addon.findFirst({
                where: { accountId: getAccountId(req), id },
            });

            if (!primaryAddon) {
                return res.status(404).json({ error: "Addon not found" });
            }

            if (!primaryAddon.backupAddonId) {
                return res.status(404).json({ error: "No backup configured for this addon" });
            }

            // Unlink backup from primary (but keep the backup addon in DB)
            await prisma.addon.update({
                data: { backupAddonId: null },
                where: { id },
            });

            res.json({ message: "Backup unlinked successfully" });
        } catch (error) {
            console.error("Error unlinking backup:", error);
            res.status(500).json({ error: publicMessage(error, "Failed to unlink backup") });
        }
    });

    // Check which addon in the chain is currently active (would be used for sync)
    router.get("/:id/backup/active", async (req, res) => {
        try {
            const { id } = req.params;

            // Fetch the addon with its backup chain
            const addon = await prisma.addon.findFirst({
                select: {
                    backupAddon: {
                        select: {
                            backupAddon: {
                                select: {
                                    backupAddon: {
                                        select: {
                                            backupAddonId: true,
                                            id: true,
                                            isActive: true,
                                            isOnline: true,
                                            lastHealthCheck: true,
                                            manifestUrl: true,
                                            name: true,
                                        },
                                    },
                                    backupAddonId: true,
                                    id: true,
                                    isActive: true,
                                    isOnline: true,
                                    lastHealthCheck: true,
                                    manifestUrl: true,
                                    name: true,
                                },
                            },
                            backupAddonId: true,
                            id: true,
                            isActive: true,
                            isOnline: true,
                            lastHealthCheck: true,
                            manifestUrl: true,
                            name: true,
                        },
                    },
                    backupAddonId: true,
                    id: true,
                    isActive: true,
                    isOnline: true,
                    lastHealthCheck: true,
                    manifestUrl: true,
                    name: true,
                },
                where: { accountId: getAccountId(req), id },
            });

            if (!addon) {
                return res.status(404).json({ error: "Addon not found" });
            }

            // Traverse the chain to find which addon would be used
            // Logic: Use the first online addon in the chain, or the last one if all offline
            const chain = [];
            let current = addon;
            let depth = 0;
            const maxDepth = 10;

            while (current && depth < maxDepth) {
                chain.push({
                    id: current.id,
                    isActive: current.isActive,
                    isOnline: current.isOnline,
                    lastHealthCheck: current.lastHealthCheck,
                    name: current.name,
                });

                // Check if online - if so, this is the active one
                if (current.isOnline && current.isActive !== false) {
                    break;
                }

                // Move to backup
                current = current.backupAddon;
                depth++;
            }

            // The active addon is the last one in the chain (either first online, or last offline)
            const activeAddon = chain.at(-1);
            const isUsingBackup = activeAddon.id !== addon.id;

            res.json({
                activeAddon,
                chain,
                isUsingBackup,
                message: isUsingBackup
                    ? `Using backup: ${activeAddon.name}`
                    : `Using primary addon: ${activeAddon.name}`,
                totalChainLength: chain.length,
            });
        } catch (error) {
            console.error("Error checking active backup:", error);
            res.status(500).json({ error: "Failed to check active backup" });
        }
    });

    // Update addon
    router.put("/:id", async (req, res) => {
        try {
            const { id } = req.params;
            const {
                name,
                description,
                url,
                version,
                groupIds,
                resources,
                catalogs,
                iconUrl,
                customLogo,
            } = req.body;

            // Check if addon exists
            const existingAddon = await prisma.addon.findFirst({
                include: { groupAddons: true },
                where: {
                    accountId: getAccountId(req),
                    id,
                },
            });

            console.log(
                "🔍 Found existing addon:",
                existingAddon
                    ? {
                          accountId: existingAddon.accountId,
                          id: existingAddon.id,
                          name: existingAddon.name,
                      }
                    : "null"
            );

            if (!existingAddon) {
                return res.status(404).json({ error: "Addon not found" });
            }

            // If URL is provided, validate scheme and fetch manifest to refresh fields
            let manifestData = null;
            let nextUrl;
            let derivedName = null;
            let derivedDescription = null;
            let derivedVersion = null;
            let derivedIconUrl = null;
            let derivedResources = null;
            let derivedCatalogs = null;

            // Check for duplicate name conflict BEFORE any database changes
            let _nameConflictResolved = false;

            if (url !== undefined) {
                // Same trimming and stremio:// handling as adding an addon, and the
                // same refusal of anything that is not a web address.
                const sanitizedUrl = sanitizeUrl(String(url));
                if (!sanitizedUrl) {
                    return res.status(400).json({ message: "Invalid URL provided" });
                }

                nextUrl = sanitizedUrl;
                try {
                    console.log(`🔍 Fetching manifest for updated URL: ${sanitizedUrl}`);
                    const resp = await safeFetch(sanitizedUrl, {}, addressPolicy);
                    if (!resp.ok) {
                        return res.status(400).json({
                            message:
                                "Failed to fetch addon manifest. The add-on URL may be incorrect.",
                        });
                    }
                    manifestData = await resp.json();

                    // Extract ALL metadata from manifest - manifest is the single source of truth
                    derivedName = manifestData?.name || null;
                    derivedDescription = manifestData?.description ?? manifestData?.desc ?? null;
                    derivedVersion = manifestData?.version ?? manifestData?.addonVersion ?? null;
                    derivedIconUrl =
                        manifestData?.logo ??
                        manifestData?.icon ??
                        manifestData?.images?.logo ??
                        null;
                    derivedResources = Array.isArray(manifestData?.resources)
                        ? manifestData.resources
                        : [];
                    derivedCatalogs = Array.isArray(manifestData?.catalogs)
                        ? manifestData.catalogs
                        : [];

                    console.log(
                        `🔍 Manifest fetched: name="${derivedName}", version="${derivedVersion}", iconUrl="${derivedIconUrl}"`
                    );
                } catch (e) {
                    const problem = addressProblem(e, addressPolicy);
                    return res.status(400).json({
                        message: problem
                            ? `Failed to fetch addon manifest. ${problem}`
                            : "Failed to fetch addon manifest. The add-on URL may be incorrect.",
                    });
                }

                // Check for name conflict with other addons (when URL changes, name comes from manifest)
                if (derivedName) {
                    const existingWithSameName = await prisma.addon.findFirst({
                        where: {
                            accountId: getAccountId(req),
                            id: { not: id }, // Exclude current addon
                            name: derivedName,
                        },
                    });
                    if (existingWithSameName) {
                        // Append a suffix to make it unique
                        derivedName = `${derivedName} (${Date.now().toString(36)})`;
                        _nameConflictResolved = true;
                        console.log(
                            `🔍 Name conflict resolved by appending suffix: "${derivedName}"`
                        );
                    }
                }
            }

            // If resources or catalogs provided without URL change, re-derive manifest from originalManifest
            let filtered = null;
            if ((resources !== undefined || catalogs !== undefined) && !manifestData) {
                try {
                    console.log(
                        "🔍 Resources/catalogs updated without URL change. existingAddon.originalManifest exists:",
                        !!existingAddon.originalManifest
                    );

                    // Get the original manifest (unfiltered) to re-filter from
                    let original = null;
                    try {
                        if (existingAddon.originalManifest) {
                            original = JSON.parse(decrypt(existingAddon.originalManifest, req));
                            console.log(
                                "🔍 Successfully decrypted originalManifest, has resources:",
                                Array.isArray(original?.resources)
                            );
                        }
                    } catch (e) {
                        console.error("🔍 Error decrypting originalManifest:", e.message);
                    }

                    // Fallback: if no originalManifest, use decrypted current manifest
                    if (!original) {
                        try {
                            if (existingAddon.manifest) {
                                original = JSON.parse(decrypt(existingAddon.manifest, req));
                                console.log(
                                    "🔍 Fallback to current manifest, has resources:",
                                    Array.isArray(original?.resources)
                                );
                            }
                        } catch (e) {
                            console.error("🔍 Error decrypting current manifest:", e.message);
                        }
                    }

                    if (original) {
                        // Always set filtered when we have original manifest
                        if (Array.isArray(original.resources)) {
                            // Use provided resources if available, otherwise fall back to currently saved resources
                            const savedResources = (() => {
                                try {
                                    return existingAddon.resources
                                        ? JSON.parse(existingAddon.resources)
                                        : [];
                                } catch {
                                    return [];
                                }
                            })();
                            const selected = Array.isArray(resources) ? resources : savedResources;

                            console.log(
                                "🔍 Filtering from original manifest with resources:",
                                selected
                            );
                            filtered = filterManifestByResources(original, selected) || {
                                ...original,
                                addonCatalogs: [],
                                catalogs: [],
                            };
                            console.log(
                                "🔍 Filtered manifest has catalogs:",
                                Array.isArray(filtered?.catalogs)
                                    ? filtered.catalogs.length
                                    : "no catalogs"
                            );
                        } else {
                            // No resources in original, use original as base
                            filtered = original;
                            console.log("🔍 Using original manifest as base (no resources)");
                        }

                        // Note: Catalog filtering will be done after database update
                    } else if (Array.isArray(resources)) {
                        // If no original manifest available, create a minimal filtered manifest
                        const names = resources
                            .map((r) => (typeof r === "string" ? r : r && (r.name || r.type)))
                            .filter(Boolean);
                        console.log(
                            "🔍 No original manifest, creating minimal filtered manifest with resources:",
                            names
                        );
                        filtered = {
                            addonCatalogs: names.includes("addon_catalog") ? [] : [],
                            catalogs: names.includes("catalog") ? [] : [],
                            description: existingAddon.description || null,
                            id: existingAddon.name || "unknown.addon",
                            name: existingAddon.name || "Unknown",
                            resources: names,
                            version: existingAddon.version || null,
                        };
                    }
                } catch (e) {
                    console.error("Error filtering manifest from original:", e);
                }
            }
            // Note: When URL changes (manifestData exists), we don't need filtering - we use the full manifest directly

            // Update addon
            // When manifestData exists (URL changed), manifest is the single source of truth for all metadata
            // Note: customLogo is stored in DB and applied at runtime in sync.js (like custom names)
            const updatedAddon = await prisma.addon.update({
                data: {
                    // When URL changed: use manifest-derived values for most fields, but keep original name
                    // Unless the name is explicitly provided in the request
                    ...(manifestData
                        ? {
                              catalogs: JSON.stringify(
                                  derivedCatalogs.map((c) => ({
                                      id: c?.id || "unknown",
                                      search: c?.extra?.some((e) => e.name === "search") || false,
                                      type: c?.type || "unknown",
                                  }))
                              ),
                              description: derivedDescription ?? existingAddon.description ?? "",
                              iconUrl: derivedIconUrl ?? existingAddon.iconUrl ?? null,
                              // Manifest provides most fields, but preserve original name unless explicitly changed
                              name: name ? name.trim() : existingAddon.name,
                              // Resources and catalogs come from manifest (client selections don't apply to new addon identity)
                              resources: JSON.stringify(
                                  derivedResources
                                      .map((r) => (typeof r === "string" ? r : r?.name || r?.type))
                                      .filter(Boolean)
                              ),
                              version: derivedVersion ?? existingAddon.version ?? null,
                          }
                        : {
                              // No URL change - use client-provided values
                              ...(name !== undefined && { name: name.trim() }),
                              ...(description !== undefined && { description }),
                              ...(version !== undefined && { version }),
                              ...(iconUrl !== undefined && { iconUrl }),
                              ...(resources !== undefined && {
                                  resources: JSON.stringify(
                                      Array.isArray(resources)
                                          ? resources
                                                .map((r) => {
                                                    if (typeof r === "string") {
                                                        return r;
                                                    }
                                                    if (r && typeof r === "object" && r.name) {
                                                        return r.name;
                                                    }
                                                    return null;
                                                })
                                                .filter(Boolean)
                                          : []
                                  ),
                              }),
                              ...(catalogs !== undefined && {
                                  catalogs: JSON.stringify(
                                      Array.isArray(catalogs)
                                          ? catalogs
                                                .map((c) => {
                                                    // Handle tuple format: [type, id, search]
                                                    if (Array.isArray(c) && c.length >= 2) {
                                                        return {
                                                            id: c[1],
                                                            search: c[2] || false,
                                                            type: c[0],
                                                        };
                                                    }
                                                    // Handle object format: { type, id, search }
                                                    if (
                                                        c &&
                                                        typeof c === "object" &&
                                                        c.type &&
                                                        c.id
                                                    ) {
                                                        return {
                                                            id: c.id,
                                                            search: c.search || false,
                                                            type: c.type,
                                                        };
                                                    }
                                                    return null;
                                                })
                                                .filter(Boolean)
                                          : []
                                  ),
                              }),
                          }),
                    ...(nextUrl && {
                        manifestUrl: encrypt(nextUrl, req),
                        manifestUrlHash: manifestUrlHmac(req, nextUrl),
                    }),
                    ...(manifestData && {
                        manifest: encrypt(JSON.stringify(manifestData), req),
                        manifestHash: manifestHash(manifestData),
                        // When URL changes, store the full manifest as both original and filtered
                        originalManifest: encrypt(JSON.stringify(manifestData), req),
                    }),
                    // Update manifest when only resources or catalogs are changed (without URL change)
                    ...((resources !== undefined || catalogs !== undefined) &&
                        !manifestData &&
                        filtered && {
                            manifest: encrypt(JSON.stringify(filtered), req),
                            manifestHash: manifestHash(filtered),
                            // Keep originalManifest as is when only resources/catalogs change
                            originalManifest: existingAddon.originalManifest,
                        }),
                    // Update customLogo if provided (stored in DB, applied at runtime in sync.js)
                    ...(customLogo !== undefined && {
                        customLogo: customLogo?.trim() ? customLogo.trim() : null,
                    }),
                },
                where: {
                    accountId: getAccountId(req),
                    id,
                },
            });

            // Handle group assignments
            if (groupIds !== undefined) {
                // Remove existing group associations
                await prisma.groupAddon.deleteMany({
                    where: { addonId: id },
                });

                // Add new group associations
                if (Array.isArray(groupIds) && groupIds.length > 0) {
                    for (const groupId of groupIds) {
                        await prisma.groupAddon.create({
                            data: {
                                addonId: id,
                                groupId,
                            },
                        });
                    }
                }
            }

            // Apply catalog filtering using database state if catalogs were updated (only when URL not changed)
            if (catalogs !== undefined && filtered && !manifestData) {
                // Read catalogs from database to get the correct search state
                const updatedAddonWithCatalogs = await prisma.addon.findFirst({
                    select: { catalogs: true },
                    where: { accountId: getAccountId(req), id },
                });

                let databaseCatalogs = [];
                if (updatedAddonWithCatalogs?.catalogs) {
                    try {
                        databaseCatalogs = JSON.parse(updatedAddonWithCatalogs.catalogs);
                    } catch (e) {
                        console.log("🔍 Failed to parse database catalogs:", e);
                    }
                }

                console.log("🔍 Using database catalogs for filtering:", databaseCatalogs);
                console.log(
                    "🔍 Database catalogs type:",
                    typeof databaseCatalogs,
                    "isArray:",
                    Array.isArray(databaseCatalogs)
                );
                if (Array.isArray(databaseCatalogs) && databaseCatalogs.length > 0) {
                    console.log("🔍 First database catalog:", databaseCatalogs[0]);
                }

                filtered = filterManifestByCatalogs(filtered, databaseCatalogs);
                console.log(
                    "🔍 After catalog filtering, manifest has catalogs:",
                    Array.isArray(filtered?.catalogs) ? filtered.catalogs.length : "no catalogs"
                );

                // Update the manifest in the database with the filtered version
                await prisma.addon.update({
                    data: {
                        manifest: encrypt(JSON.stringify(filtered), req),
                        manifestHash: manifestHash(filtered),
                    },
                    where: { id },
                });
            }

            res.json({
                addon: {
                    customLogo: updatedAddon.customLogo,
                    description: updatedAddon.description,
                    groups: 0,
                    iconUrl: updatedAddon.iconUrl,
                    id: updatedAddon.id,
                    name: updatedAddon.name,
                    status: updatedAddon.isActive ? "active" : "inactive",
                    url: getDecryptedManifestUrl(updatedAddon, req),
                    users: 0,
                    version: updatedAddon.version,
                },
                message: "Addon updated successfully",
            });
        } catch (error) {
            console.error("Error updating addon:", error);
            res.status(500).json({
                details: publicMessage(error, "Failed to update addon"),
                error: "Failed to update addon",
            });
        }
    });

    // Reload all addons
    router.post("/reload-all", async (req, res) => {
        try {
            const allAddons = await prisma.addon.findMany({
                select: { id: true, isActive: true, manifestUrl: true },
                where: scopedWhere(req, {}),
            });
            const addons = allAddons.filter((a) => a.isActive && !!a.manifestUrl);

            if (addons.length === 0) {
                return res.json({
                    failedCount: 0,
                    message: "No active addons found to reload",
                    reloadedCount: 0,
                    total: 0,
                });
            }

            let reloadedCount = 0;
            let failedCount = 0;
            const changedIds = [];

            for (const addon of addons) {
                try {
                    const result = await reloadAddon(prisma, getAccountId, addon.id, req, {
                        decrypt,
                        encrypt,
                        filterManifestByCatalogs,
                        filterManifestByResources,
                        getDecryptedManifestUrl,
                        manifestHash,
                        silent: true,
                    });
                    if (result?.changed) {
                        changedIds.push(addon.id);
                    }
                    reloadedCount++;
                } catch (error) {
                    console.error(`Failed to reload addon ${addon.id}:`, error);
                    failedCount++;
                }
            }

            if (changedIds.length > 0) {
                syncGroupsCarrying(changedIds, req);
            }
            res.json({
                failed: failedCount,
                message: `Reloaded ${reloadedCount} addons successfully, ${failedCount} failed`,
                reloaded: reloadedCount,
                total: addons.length,
            });
        } catch (error) {
            console.error("Error reloading all addons:", error);
            res.status(500).json({
                error: publicMessage(error, "Failed to reload all addons"),
                message: "Failed to reload all addons",
            });
        }
    });

    // Enable proxy for addon - generates UUID and enables proxy access
    router.post("/:id/proxy/enable", async (req, res) => {
        try {
            const { id } = req.params;
            const crypto = require("node:crypto");

            // Validate addon exists and belongs to account
            const addon = await dbUtils.findEntity(prisma, "addon", id, getAccountId(req));
            if (!addon) {
                return responseUtils.notFound(res, "Addon");
            }

            // Generate a new UUID if one doesn't exist
            const proxyUuid = addon.proxyUuid || crypto.randomUUID();

            // Update addon with proxy enabled
            const updated = await dbUtils.updateEntity(
                prisma,
                "addon",
                id,
                {
                    proxyEnabled: true,
                    proxyUuid,
                },
                getAccountId(req)
            );

            const proxyManifestUrl = `${req.protocol}://${req.get("host")}/proxy/${proxyUuid}/manifest.json`;

            return responseUtils.success(
                res,
                {
                    id: updated.id,
                    name: updated.name,
                    proxyEnabled: true,
                    proxyManifestUrl,
                    proxyUuid,
                },
                "Proxy enabled successfully"
            );
        } catch (error) {
            console.error("Error enabling proxy:", error);
            return responseUtils.internalError(res, error.message);
        }
    });

    // ==================== VAULT-INJECTED CONFIGS ====================
    // POST /:id/vaultify - replace this addon's embedded secrets with
    // {{vault:<entryId>}} placeholders and turn on the proxy, so the real key
    // never again appears in the stored URL, any synced manifest, or any
    // device. See utils/vaultInjection.js for scope (raw-URL secrets only in
    // v1; base64-buried ones are reported, not converted).
    router.post("/:id/vaultify", async (req, res) => {
        try {
            const { id } = req.params;
            const accountId = getAccountId(req);
            const addon = await prisma.addon.findFirst({ where: { accountId, id } });
            if (!addon) {
                return responseUtils.notFound(res, "Addon");
            }

            // Auto-install needs a base the account's devices can reach; without
            // one, sync would push an unfetchable placeholder URL. Refuse up
            // front rather than create that state. The toggle route for the
            // SlickTrax addon records observedBaseUrl on the same reasoning.
            // The admin reaching this route opened SlickSync from the address their
            // devices use - learned, like on any admin visit (utils/ownAddress.js) -
            // but never one only this server knows (a container's name, localhost).
            const own = require("../utils/ownAddress");
            const reqBase = own.requestBase(req);
            if (require("../utils/streamGate").deviceReachable(reqBase)) {
                await own.learn(prisma, accountId, reqBase).catch(() => undefined);
            }
            const base = await own.publicBase(prisma, accountId);
            if (!base) {
                return res.status(400).json({
                    error: "SlickSync doesn’t know the address your devices reach it at yet. Open this page from that address (not localhost), or set PUBLIC_APP_URL.",
                });
            }

            const url = getDecryptedManifestUrl(addon, req);
            if (!url) {
                return res.status(500).json({ error: "Could not read this addon's URL" });
            }

            const {
                insertPlaceholders,
                findBase64BuriedSecrets,
                hasVaultPlaceholders,
            } = require("../utils/vaultInjection");
            if (hasVaultPlaceholders(url)) {
                return res.status(400).json({ error: "This addon is already vault-injected" });
            }

            const rawEntries = await prisma.vaultEntry.findMany({
                where: { accountId, isActive: true },
            });
            const entries = rawEntries
                .map((e) => {
                    let secret = "";
                    try {
                        secret = decrypt(e.encryptedSecret, req);
                    } catch {
                        secret = "";
                    }
                    return { id: e.id, name: e.name, secret };
                })
                .filter((e) => e.secret);

            const { url: nextUrl, used } = insertPlaceholders(url, entries);
            const buried = findBase64BuriedSecrets(url, entries);

            if (used.length === 0) {
                return res.status(400).json({
                    buriedEntryNames: buried
                        .map((id) => entries.find((e) => e.id === id)?.name)
                        .filter(Boolean),
                    error:
                        buried.length > 0
                            ? "This addon's key sits inside an encoded config blob, which vault-injection does not convert yet. Rotation propagation still covers it fully."
                            : "No Vault secret appears in this addon's URL. Add the key to the Vault first, or it may already use a different credential.",
                });
            }

            const proxyUuid = addon.proxyUuid || crypto.randomUUID();
            await prisma.addon.update({
                data: {
                    manifestUrl: encrypt(nextUrl, req),
                    manifestUrlHash: manifestUrlHmac(req, nextUrl),
                    proxyEnabled: true,
                    proxyUuid,
                },
                where: { id: addon.id },
            });

            const usedNames = used
                .map((uid) => entries.find((e) => e.id === uid)?.name)
                .filter(Boolean);
            return responseUtils.success(
                res,
                {
                    entries: usedNames,
                    note: "Users pick up the proxy URL on their next sync. From then on, rotating these Vault entries needs no rewrite and no re-sync at all.",
                    proxyManifestUrl: `${base}/proxy/${proxyUuid}/manifest.json`,
                    vaultified: true,
                },
                `Keys now live only in the Vault (${usedNames.join(", ")})`
            );
        } catch (error) {
            console.error("Error vaultifying addon:", error);
            return responseUtils.internalError(res, error.message);
        }
    });

    // POST /:id/unvaultify - resolve placeholders back to the CURRENT secrets
    // and store the plain URL again. Proxy stays enabled (turning it off is
    // the existing proxy/disable route's job, and the plain URL works either
    // way).
    router.post("/:id/unvaultify", async (req, res) => {
        try {
            const { id } = req.params;
            const accountId = getAccountId(req);
            const addon = await prisma.addon.findFirst({ where: { accountId, id } });
            if (!addon) {
                return responseUtils.notFound(res, "Addon");
            }

            const url = getDecryptedManifestUrl(addon, req);
            const {
                hasVaultPlaceholders,
                resolvePlaceholders,
            } = require("../utils/vaultInjection");
            if (!(url && hasVaultPlaceholders(url))) {
                return res.status(400).json({ error: "This addon is not vault-injected" });
            }
            // Verify every referenced entry still resolves BEFORE storing anything:
            // writing a URL with a silently-emptied secret over a working
            // placeholder URL would break the addon while looking like success.
            const { PLACEHOLDER_RE } = require("../utils/vaultInjection");
            const ids = [...new Set([...url.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))];
            const live = await prisma.vaultEntry.findMany({
                where: { accountId, id: { in: ids }, isActive: true },
            });
            const resolvable = new Set(
                live
                    .filter((e) => {
                        try {
                            return !!decrypt(e.encryptedSecret, req);
                        } catch {
                            return false;
                        }
                    })
                    .map((e) => e.id)
            );
            const dead = ids.filter((i) => !resolvable.has(i));
            if (dead.length > 0) {
                return res.status(409).json({
                    error: "A referenced Vault entry no longer resolves - fix or recreate it before un-injecting",
                });
            }
            const resolved = await resolvePlaceholders(prisma, accountId, url, (v) =>
                decrypt(v, req)
            );
            await prisma.addon.update({
                data: {
                    manifestUrl: encrypt(resolved, req),
                    manifestUrlHash: manifestUrlHmac(req, resolved),
                },
                where: { id: addon.id },
            });
            return responseUtils.success(
                res,
                { vaultified: false },
                "Addon URL restored with the current secrets"
            );
        } catch (error) {
            console.error("Error un-vaultifying addon:", error);
            return responseUtils.internalError(res, error.message);
        }
    });

    // Disable proxy for addon - keeps UUID but disables access
    router.post("/:id/proxy/disable", async (req, res) => {
        try {
            const { id } = req.params;

            // Validate addon exists and belongs to account
            const addon = await dbUtils.findEntity(prisma, "addon", id, getAccountId(req));
            if (!addon) {
                return responseUtils.notFound(res, "Addon");
            }

            // Update addon with proxy disabled (keep UUID for potential re-enable)
            const updated = await dbUtils.updateEntity(
                prisma,
                "addon",
                id,
                {
                    proxyEnabled: false,
                },
                getAccountId(req)
            );

            return responseUtils.success(
                res,
                {
                    id: updated.id,
                    name: updated.name,
                    proxyEnabled: false,
                    proxyUuid: updated.proxyUuid,
                },
                "Proxy disabled successfully"
            );
        } catch (error) {
            console.error("Error disabling proxy:", error);
            return responseUtils.internalError(res, error.message);
        }
    });

    // Regenerate proxy UUID - generates a new UUID (invalidates old links)
    router.post("/:id/proxy/regenerate", async (req, res) => {
        try {
            const { id } = req.params;
            const crypto = require("node:crypto");

            // Validate addon exists and belongs to account
            const addon = await dbUtils.findEntity(prisma, "addon", id, getAccountId(req));
            if (!addon) {
                return responseUtils.notFound(res, "Addon");
            }

            // Generate a new UUID
            const proxyUuid = crypto.randomUUID();

            // Update addon with new UUID
            const updated = await dbUtils.updateEntity(
                prisma,
                "addon",
                id,
                {
                    proxyEnabled: addon.proxyEnabled, // Keep current enabled state
                    proxyUuid,
                },
                getAccountId(req)
            );

            const proxyManifestUrl = updated.proxyEnabled
                ? `${req.protocol}://${req.get("host")}/proxy/${proxyUuid}/manifest.json`
                : null;

            return responseUtils.success(
                res,
                {
                    id: updated.id,
                    name: updated.name,
                    proxyEnabled: updated.proxyEnabled,
                    proxyManifestUrl,
                    proxyUuid,
                },
                "Proxy UUID regenerated successfully"
            );
        } catch (error) {
            console.error("Error regenerating proxy UUID:", error);
            return responseUtils.internalError(res, error.message);
        }
    });

    // GET /addons/:id/proxy-logs - Get proxy request logs for an addon
    router.get("/:id/proxy-logs", async (req, res) => {
        try {
            const { id } = req.params;
            const { limit = "100", offset = "0" } = req.query;

            // Validate addon exists and belongs to account
            const addon = await dbUtils.findEntity(prisma, "addon", id, getAccountId(req));
            if (!addon) {
                return responseUtils.notFound(res, "Addon");
            }

            // Read proxy logs from file for this addon
            const { logs, total } = await readProxyLogs({
                addonId: id,
                limit: Number.parseInt(limit, 10),
                offset: Number.parseInt(offset, 10),
            });

            return responseUtils.success(res, {
                limit: Number.parseInt(limit, 10),
                logs,
                offset: Number.parseInt(offset, 10),
                total,
            });
        } catch (error) {
            console.error("Error fetching proxy logs:", error);
            return responseUtils.internalError(res, error.message);
        }
    });

    // GET /proxy-logs - Get ALL proxy request logs (admin only)
    router.get("/proxy-logs/all", async (req, res) => {
        try {
            const { limit = "100", offset = "0", addonId } = req.query;

            // Read all proxy logs from file (optionally filtered by addonId)
            const { logs, total } = await readProxyLogs({
                addonId: addonId || null,
                limit: Number.parseInt(limit, 10),
                offset: Number.parseInt(offset, 10),
            });

            return responseUtils.success(res, {
                limit: Number.parseInt(limit, 10),
                logs,
                offset: Number.parseInt(offset, 10),
                total,
            });
        } catch (error) {
            console.error("Error fetching all proxy logs:", error);
            return responseUtils.internalError(res, error.message);
        }
    });

    return router;
};

// Export the reloadAddon helper function for use by other modules
module.exports.reloadAddon = reloadAddon;
module.exports.prewarmManifests = prewarmManifests;
