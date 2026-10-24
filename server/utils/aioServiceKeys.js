// Debrid keys inside AIOStreams configurations, kept in step with the Vault.
//
// When a Vault key changes - rotated by hand, a backup taking over from a
// failing key, or the original swapped back once it recovers - every addon
// carrying it is rewritten (utils/keyRotation.js). An AIOStreams
// configuration holds its debrid keys itself, in services[].credentials, so
// without this a household watching through AIOStreams kept the dead key.
//
// Opt-in per person, from their page (off by default).
//
// Only debrid service credentials that exactly match the old key are
// changed - nothing else in the configuration is touched - and only in
// configurations SlickSync holds the password for (someone added with their
// AIOStreams configuration password). Any outside change since the last look
// is reported first, and the change warning is re-baselined after, so this
// write is never reported as an outside change itself.

const {
    instanceBase,
    readConfig,
    writeConfig,
    rebaseline,
    noteOutsideChanges,
} = require("./aiostreamsConfig");

/** Swap one key for another in a configuration's debrid services. Returns the services changed. */
function replaceServiceKey(config, oldSecret, newSecret) {
    const changed = [];
    for (const svc of Array.isArray(config?.services) ? config.services : []) {
        const creds =
            svc && typeof svc.credentials === "object" && svc.credentials ? svc.credentials : null;
        if (!creds) {
            continue;
        }
        let hit = false;
        for (const [field, value] of Object.entries(creds)) {
            if (value === oldSecret) {
                creds[field] = newSecret;
                hit = true;
            }
        }
        if (hit) {
            changed.push(String(svc.id || "service"));
        }
    }
    return changed;
}

// Opt-in, per person: sync.aioRotateKeys[personId] === true. Off unless
// switched on from that person's page.
async function readSync(prisma, accountId) {
    const acc = await prisma.appAccount.findUnique({
        select: { sync: true },
        where: { id: accountId },
    });
    let cfg = acc?.sync;
    const asString = typeof cfg === "string";
    if (asString) {
        try {
            cfg = JSON.parse(cfg);
        } catch {
            cfg = {};
        }
    }
    return { asString, cfg: cfg && typeof cfg === "object" ? cfg : {} };
}

async function statusFor(prisma, accountId, userId) {
    const person = await prisma.user.findFirst({
        select: { aioConfigId: true, aioConfigPassword: true, id: true },
        where: {
            accountId,
            id: String(userId),
            jellyfinServerKind: "aiostreams",
            providerType: "jellyfin",
        },
    });
    if (!person) {
        return { available: false };
    }
    const { cfg } = await readSync(prisma, accountId);
    return {
        available: true,
        canWrite: !!(person.aioConfigId && person.aioConfigPassword),
        enabled: cfg.aioRotateKeys?.[person.id] === true,
    };
}

async function setEnabled(prisma, accountId, userId, enabled) {
    const { cfg, asString } = await readSync(prisma, accountId);
    const map = {
        ...(cfg.aioRotateKeys && typeof cfg.aioRotateKeys === "object" ? cfg.aioRotateKeys : {}),
    };
    if (enabled) {
        map[userId] = true;
    } else {
        delete map[userId];
    }
    const next = { ...cfg, aioRotateKeys: map };
    await prisma.appAccount.update({
        data: { sync: asString ? JSON.stringify(next) : next },
        where: { id: accountId },
    });
}

async function rotateInAioConfigs(prisma, decrypt, { accountId, oldSecret, newSecret }) {
    const updated = [];
    const failed = [];
    if (!(oldSecret && newSecret) || oldSecret === newSecret) {
        return { failed, updated };
    }
    const { cfg } = await readSync(prisma, accountId);
    const optedIn = Object.keys(cfg.aioRotateKeys || {}).filter(
        (id) => cfg.aioRotateKeys[id] === true
    );
    if (!optedIn.length) {
        return { failed, updated };
    }
    const people = await prisma.user.findMany({
        select: {
            accountId: true,
            aioConfigId: true,
            aioConfigPassword: true,
            id: true,
            jellyfinServerUrl: true,
            username: true,
        },
        where: {
            accountId,
            aioConfigId: { not: null },
            aioConfigPassword: { not: null },
            id: { in: optedIn },
            jellyfinServerKind: "aiostreams",
            providerType: "jellyfin",
        },
    });
    // One configuration can be reached through several people (a household).
    const seen = new Set();
    for (const person of people) {
        const key = `${instanceBase(person.jellyfinServerUrl)}|${person.aioConfigId}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        try {
            const access = {
                account: person.aioConfigId,
                password: decrypt(person.aioConfigPassword, {
                    appAccountId: person.accountId || accountId,
                }),
                serverUrl: person.jellyfinServerUrl,
            };
            const config = await readConfig(access);
            // Report anything changed elsewhere before this write is folded into the baseline.
            try {
                await noteOutsideChanges(prisma, person, config);
            } catch {
                // Unavailable optional records leave the current result in place.
            }
            const services = replaceServiceKey(config, oldSecret, newSecret);
            if (!services.length) {
                continue;
            }
            await writeConfig(access, config);
            try {
                await rebaseline(prisma, person, await readConfig(access));
            } catch {
                // Unavailable optional records leave the current result in place.
            }
            updated.push({ services, username: person.username });
        } catch (e) {
            failed.push({ error: e?.message || "unknown", username: person.username });
        }
    }
    return { failed, updated };
}

module.exports = { replaceServiceKey, rotateInAioConfigs, setEnabled, statusFor };
