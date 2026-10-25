const { safeFetch, instancePolicy } = require("./safeUrl");
const { buildAddonDbData } = require("./stremio");
const { decrypt, encrypt: _encrypt } = require("./encryption");

async function ensureDek(req, prisma, INSTANCE_TYPE, getAccountDek) {
    try {
        if (INSTANCE_TYPE === "public" && !req.accountDek && typeof getAccountDek === "function") {
            let dek = getAccountDek(req.appAccountId);
            if (!dek && req.appAccountId) {
                const acct = await prisma.appAccount.findUnique({
                    select: { uuid: true },
                    where: { id: req.appAccountId },
                });
                if (acct?.uuid) {
                    dek = getAccountDek(acct.uuid);
                }
            }
            if (dek) {
                req.accountDek = dek;
            }
        }
    } catch {
        // Unavailable optional records leave the current result in place.
    }
}

async function repairAddonsList(
    {
        prisma,
        INSTANCE_TYPE,
        getAccountDek,
        getDecryptedManifestUrl,
        filterManifestByResources,
        filterManifestByCatalogs,
        manifestHash: _manifestHash,
        encrypt: _encryptLocal,
    },
    req,
    addonsList
) {
    await ensureDek(req, prisma, INSTANCE_TYPE, getAccountDek);

    let updated = 0;
    let inspected = 0;

    for (const addon of addonsList) {
        inspected++;
        try {
            const addonName = addon.name || "Unknown";
            const transportUrl = getDecryptedManifestUrl(addon, req);
            if (!transportUrl) {
                continue;
            }

            const resourcesArr = (() => {
                try {
                    return addon.resources ? JSON.parse(addon.resources) : [];
                } catch {
                    return [];
                }
            })();
            const catalogsArr = (() => {
                try {
                    return addon.catalogs ? JSON.parse(addon.catalogs) : [];
                } catch {
                    return [];
                }
            })();

            // Prefer stored manifests first
            let originalManifestObj = null;
            if (addon.originalManifest) {
                try {
                    originalManifestObj = JSON.parse(decrypt(addon.originalManifest, req));
                } catch {
                    // Malformed optional data leaves the existing fallback in place.
                }
            }
            let filteredFromDb = null;
            if (addon.manifest) {
                try {
                    filteredFromDb = JSON.parse(decrypt(addon.manifest, req));
                } catch {
                    // Malformed optional data leaves the existing fallback in place.
                }
            }
            if (!originalManifestObj) {
                originalManifestObj = filteredFromDb;
            }

            const needsId =
                !addon.stremioAddonId || String(addon.stremioAddonId).toLowerCase() === "unknown";
            const needsIcon = !addon.iconUrl;
            const isEmptyResources = Array.isArray(resourcesArr) && resourcesArr.length === 0;

            // Fetch latest manifest only if necessary
            if (!originalManifestObj || needsId || needsIcon || isEmptyResources) {
                try {
                    const resp = await safeFetch(transportUrl, {}, instancePolicy());
                    if (resp.ok) {
                        originalManifestObj = await resp.json();
                    }
                } catch {
                    // Optional remote data does not prevent the current operation from completing.
                }
            }
            if (!originalManifestObj) {
                continue;
            }

            // Build filtered manifest based on current selections
            let filteredManifest = originalManifestObj;
            if (Array.isArray(resourcesArr) && resourcesArr.length > 0) {
                filteredManifest = filterManifestByResources(originalManifestObj, resourcesArr);
            }
            if (Array.isArray(catalogsArr) && catalogsArr.length > 0) {
                filteredManifest = filterManifestByCatalogs(filteredManifest, catalogsArr);
            }

            if (!(isEmptyResources || needsId || needsIcon)) {
                continue;
            }

            const dbData = buildAddonDbData(req, {
                catalogs: isEmptyResources ? undefined : catalogsArr,
                description: addon.description,
                filteredManifest,
                iconUrl: originalManifestObj?.logo,
                isActive: addon.isActive === true,
                manifestObj: originalManifestObj,
                name: addon.name,
                // When resources are empty in DB, omit inputs so builder derives from manifest
                resources: isEmptyResources ? undefined : resourcesArr,
                sanitizedUrl: transportUrl,
                stremioAddonId: originalManifestObj?.id,
                version: originalManifestObj?.version,
            });

            const updateData = {};
            if (isEmptyResources) {
                Object.assign(updateData, dbData);
            } else {
                if (needsId && dbData.stremioAddonId) {
                    updateData.stremioAddonId = dbData.stremioAddonId;
                }
                if (needsIcon && dbData.iconUrl) {
                    updateData.iconUrl = dbData.iconUrl;
                }
                if (!addon.originalManifest && dbData.originalManifest) {
                    updateData.originalManifest = dbData.originalManifest;
                }
                if (!addon.manifest && dbData.manifest) {
                    updateData.manifest = dbData.manifest;
                }
                if (!addon.manifestHash && dbData.manifestHash) {
                    updateData.manifestHash = dbData.manifestHash;
                }
            }

            if (Object.keys(updateData).length > 0) {
                await prisma.addon.update({ data: updateData, where: { id: addon.id } });
                const reasons = [];
                if (isEmptyResources) {
                    reasons.push("resources");
                }
                if (needsIcon) {
                    reasons.push("iconUrl");
                }
                if (needsId) {
                    reasons.push("stremioAddonId");
                }
                try {
                    console.log(`${addonName} - repaired: ${reasons.join(", ")}`);
                } catch {
                    // Diagnostic logging must not interrupt the operation it describes.
                }
                updated++;
            }
        } catch {
            // swallow
        }
    }

    return { inspected, updated };
}

module.exports = { repairAddonsList };
