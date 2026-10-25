// Stremio-related functions
const { StremioAPIClient } = require("stremio-api-client");

/**
 * Validate Stremio auth key by calling official API
 */
async function validateStremioAuthKey(authKey) {
    // 1) Try via official client: request('getUser') and require email
    try {
        const client = new StremioAPIClient({ authKey, endpoint: "https://api.strem.io" });
        if (client && typeof client.request === "function") {
            const userRes = await client.request("getUser");
            if (userRes?.email) {
                let addons = [];
                try {
                    const addonsRes = await client.request("addonCollectionGet", {});
                    const rawAddons = addonsRes?.addons ?? addonsRes ?? [];
                    addons = Array.isArray(rawAddons) ? rawAddons : Object.values(rawAddons || {});
                } catch {
                    addons = [];
                }
                return { addons, user: userRes };
            }
            const err = new Error("Missing user email");
            err.code = 1;
            throw err;
        }
    } catch (e) {
        const msg = (e && (e.message || e.error || "")) || "";
        if (/session does not exist|invalid/i.test(msg) || e.code === 1) {
            const err = new Error("Invalid or expired Stremio auth key");
            err.code = 1;
            throw err;
        }
        // fall through to HTTP fallback
    }

    // 2) Fallback to HTTP pullUser to verify session
    const resp = await fetch("https://api.strem.io/api/pullUser", {
        body: JSON.stringify({ authKey }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
        const msg = (data && (data.message || data.error)) || `HTTP ${resp.status}`;
        const err = new Error(msg);
        throw err;
    }
    if (data && (data.code === 1 || /session does not exist/i.test(String(data.message || "")))) {
        const err = new Error("Invalid or expired Stremio auth key");
        err.code = 1;
        throw err;
    }
    if (data?.user?.email) {
        return { addons: [], user: data.user };
    }
    const err = new Error("Could not validate auth key (no user email)");
    err.code = 1;
    throw err;
}

/**
 * Filter out Stremio default addons
 */
function filterDefaultAddons(addons, unsafeMode = false) {
    // In unsafe mode, don't filter out any addons - treat all as regular addons
    if (unsafeMode) {
        return addons;
    }

    const defaultAddons = {
        ids: ["com.linvo.cinemeta", "org.stremio.local"],
        manifestUrls: [
            "http://127.0.0.1:11470/local-addon/manifest.json",
            "https://v3-cinemeta.strem.io/manifest.json",
        ],
        names: ["Cinemeta", "Local Files"],
    };

    return addons.filter((addon) => {
        const name = addon.name || addon.manifest?.name || "";
        const id = addon.id || addon.manifest?.id || "";
        const manifestUrl = addon.manifestUrl || addon.manifest?.manifestUrl || "";
        return !(
            defaultAddons.names.includes(name) ||
            defaultAddons.ids.includes(id) ||
            defaultAddons.manifestUrls.includes(manifestUrl)
        );
    });
}

/**
 * Build addon DB data consistently
 */
function buildAddonDbData(req, params) {
    const { encrypt } = require("./encryption");
    const { manifestUrlHmac, manifestHash, manifestHmac } = require("./hashing");
    const { getAccountId } = require("./helpers");
    const {
        name,
        description,
        sanitizedUrl,
        manifestObj, // full/original manifest
        filteredManifest, // filtered manifest to persist as current (optional)
        iconUrl,
        version,
        stremioAddonId,
        isActive = true,
        resources: resourcesInput, // optional explicit resources array (names)
        catalogs: catalogsInput, // optional explicit catalogs array ({type,id})
        customLogo, // optional custom logo URL (stored but applied at runtime)
    } = params;

    const urlPlain = String(sanitizedUrl || "").trim();
    const encUrl = encrypt(urlPlain, req);
    const encOriginal = manifestObj ? encrypt(JSON.stringify(manifestObj), req) : null;
    const manifestToPersist = filteredManifest || manifestObj || null;
    const encFiltered = manifestToPersist ? encrypt(JSON.stringify(manifestToPersist), req) : null;
    // Prefer per-account HMAC for stored manifestUrlHash; legacy/global is only for fallback reads
    const urlHmac = manifestUrlHmac(req, urlPlain);
    const mHash = manifestToPersist
        ? manifestHash(manifestToPersist)
        : manifestObj
          ? manifestHash(manifestObj)
          : null;
    const _mHmac = manifestToPersist
        ? manifestHmac(req, manifestToPersist)
        : manifestObj
          ? manifestHmac(req, manifestObj)
          : null;

    const resources = (() => {
        try {
            let names = [];
            if (Array.isArray(resourcesInput)) {
                names = resourcesInput
                    .map((r) => (typeof r === "string" ? r : r && (r.name || r.type)))
                    .filter(Boolean);
            } else {
                const src = Array.isArray(manifestToPersist?.resources)
                    ? manifestToPersist.resources
                    : Array.isArray(manifestObj?.resources)
                      ? manifestObj.resources
                      : [];
                names = src
                    .map((r) => (typeof r === "string" ? r : r && (r.name || r.type)))
                    .filter(Boolean);
            }

            // Auto-add "search" resource if any catalog has search functionality
            const catalogsToCheck =
                catalogsInput || manifestToPersist?.catalogs || manifestObj?.catalogs || [];
            const hasSearchCatalog =
                Array.isArray(catalogsToCheck) &&
                catalogsToCheck.some((c) => c?.extra?.some((e) => e.name === "search"));
            if (hasSearchCatalog && !names.includes("search")) {
                names.push("search");
            }

            return names.length ? JSON.stringify(names) : null;
        } catch {
            return null;
        }
    })();

    const catalogs = (() => {
        try {
            if (Array.isArray(catalogsInput)) {
                // Preserve search field if present (for UI state tracking)
                const compact = catalogsInput
                    .map((c) => {
                        if (typeof c === "string") {
                            // Legacy string format
                            return { id: c, search: false, type: c };
                        }
                        if (Array.isArray(c) && c.length >= 2) {
                            // Tuple format: [type, id, search]
                            return { id: c[1], search: c[2] || false, type: c[0] };
                        }
                        if (c && typeof c === "object" && c.type && c.id) {
                            // Object format: { type, id, search? }
                            // Check for search in extra array if search field not explicitly set
                            const hasSearchExtra = c.extra?.some((e) => e.name === "search");
                            return {
                                id: c.id,
                                search: c.search || hasSearchExtra || false,
                                type: c.type,
                            };
                        }
                        return null;
                    })
                    .filter((c) => c?.type && c.id);
                return compact.length ? JSON.stringify(compact) : null;
            }
            const src = Array.isArray(manifestToPersist?.catalogs)
                ? manifestToPersist.catalogs
                : Array.isArray(manifestObj?.catalogs)
                  ? manifestObj.catalogs
                  : [];
            const compact = src
                .map((c) => {
                    // Check for search in extra array
                    const hasSearchExtra = c.extra?.some((e) => e.name === "search");
                    return { id: c.id, search: hasSearchExtra || false, type: c.type };
                })
                .filter((c) => c.type && c.id);
            return compact.length ? JSON.stringify(compact) : null;
        } catch {
            return null;
        }
    })();

    return {
        accountId: getAccountId(req),
        catalogs,
        customLogo: customLogo?.trim() ? customLogo.trim() : null,
        description: description || manifestObj?.description || "",
        iconUrl: iconUrl || manifestObj?.logo || null,
        isActive,
        manifest: encFiltered,
        manifestHash: mHash, // content hash of filtered/original
        manifestUrl: encUrl,
        manifestUrlHash: urlHmac,
        name,
        originalManifest: encOriginal,
        resources,
        stremioAddonId: stremioAddonId || manifestObj?.id || null,
        version: version || manifestObj?.version || null,
    };
}

module.exports = {
    buildAddonDbData,
    filterDefaultAddons,
    validateStremioAuthKey,
};
