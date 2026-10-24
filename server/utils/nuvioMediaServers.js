// "Their servers in Nuvio": a person who has both a Nuvio sign-in and a
// Jellyfin-compatible one (a real Jellyfin, or the media server AIOStreams or
// AIOMetadata runs) can have that server put in their Nuvio profile, so every
// Nuvio app they open lists it without anyone signing in on the device.
//
// Nuvio keeps a profile's servers as one list (sync_pull_media_servers /
// sync_push_media_servers, whole-list replace). SlickSync only ever owns the
// entry whose id starts with OUR_PREFIX: every write pulls the list first and
// keeps everything else exactly as it was - a server they added in Nuvio
// themselves stays.
//
// Nuvio is given a sign-in of its own, never SlickSync's: SlickSync starts a
// Quick Connect on the server and approves it with the person's sign-in, so
// signing Nuvio out (or removing the server there) can't sign SlickSync out.
// Turning it off removes the entry and signs that sign-in out again.

const crypto = require("node:crypto");
const {
    jfRequest,
    deviceIdFor,
    quickConnectInitiate,
    quickConnectAuthenticate,
    serverKindLabel,
    signOut,
} = require("../providers/jellyfinAuth");

const OUR_PREFIX = "slicksync-";
// What the server's device list calls Nuvio's sign-in, so it isn't mistaken
// for SlickSync's own (signing that one out would cut SlickSync off).
const NUVIO_DEVICE_NAME = "Nuvio (via SlickSync)";
const MAX_SERVERS = 16;

const isOurs = (entry) => typeof entry?.id === "string" && entry.id.startsWith(OUR_PREFIX);

function entryId(serverId, jellyfinUserId) {
    return (
        OUR_PREFIX +
        crypto.createHash("sha1").update(`${serverId}|${jellyfinUserId}`).digest("hex").slice(0, 24)
    );
}

// Jellyfin's CollectionType -> the kinds Nuvio takes.
function libraryKind(collectionType) {
    const t = String(collectionType || "").toLowerCase();
    if (t === "movies") {
        return "movie";
    }
    if (t === "tvshows") {
        return "series";
    }
    if (t === "boxsets") {
        return "collection";
    }
    return "mixed";
}

/**
 * The person's two sign-ins, as rows createProvider takes: the Nuvio one and
 * the Jellyfin-compatible one, each either their own or the one a merge gave
 * them (UserProviderCredential). Null for a side they don't have.
 */
async function signInsFor(prisma, userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        return null;
    }
    const credentials = await prisma.userProviderCredential
        .findMany({ where: { userId } })
        .catch(() => []);
    let nuvio = null;
    let jellyfin = null;
    if (user.providerType === "nuvio") {
        nuvio = { profileId: user.nuvioProfileId || 1, row: user };
    }
    if (user.providerType === "jellyfin") {
        jellyfin = user;
    }
    for (const c of credentials) {
        if (!nuvio && c.providerType === "nuvio" && c.nuvioRefreshToken) {
            nuvio = {
                profileId: 1,
                row: {
                    ...user,
                    __persistNuvioRefreshToken: async (encrypted) => {
                        await prisma.userProviderCredential.update({
                            data: { nuvioRefreshToken: encrypted },
                            where: { id: c.id },
                        });
                    },
                    nuvioProfileId: 1,
                    nuvioRefreshToken: c.nuvioRefreshToken,
                    nuvioUserId: c.nuvioUserId,
                    providerType: "nuvio",
                },
            };
        }
        if (!jellyfin && c.providerType === "jellyfin") {
            jellyfin = c;
        }
    }
    if (
        jellyfin &&
        !(jellyfin.jellyfinServerUrl && jellyfin.jellyfinUserId && jellyfin.jellyfinToken)
    ) {
        jellyfin = null;
    }
    return { jellyfin, nuvio, user };
}

function describeServer(jellyfin) {
    return {
        kind: jellyfin.jellyfinServerKind || "jellyfin",
        kindLabel: serverKindLabel(jellyfin.jellyfinServerKind),
        userName: jellyfin.jellyfinUserName || null,
    };
}

function rowFor(entry) {
    return {
        enabled: entry.enabled !== false,
        fromSlickSync: isOurs(entry),
        id: entry.id,
        name: entry.name || entry.address || "Server",
        userName: entry.user_name || null,
    };
}

/**
 * What the tile shows: whether it can be used here, whether it is on, and
 * the profile's server list as Nuvio has it now.
 */
async function describe(prisma, { createProvider, decrypt, req }, userId) {
    const found = await signInsFor(prisma, userId);
    if (!found) {
        const err = new Error("Person not found");
        err.status = 404;
        throw err;
    }
    const { user, nuvio, jellyfin } = found;
    const base = {
        available: !!(nuvio && jellyfin),
        enabled: user.nuvioMediaServers === true,
        hasNuvio: !!nuvio,
        readError: null,
        server: jellyfin ? describeServer(jellyfin) : null,
        servers: [],
    };
    if (!nuvio) {
        return base;
    }
    try {
        const list = await createProvider(nuvio.row, { decrypt, req }).getMediaServers(
            nuvio.profileId
        );
        base.servers = list.map(rowFor);
    } catch {
        base.readError = "Could not read their servers from Nuvio right now";
    }
    return base;
}

/** Nuvio's own sign-in on the server: a Quick Connect approved with the person's sign-in. */
async function signInForNuvio(jellyfin, personToken) {
    const url = jellyfin.jellyfinServerUrl;
    const qc = await quickConnectInitiate(url, { deviceName: NUVIO_DEVICE_NAME });
    try {
        await jfRequest(url, `/QuickConnect/Authorize?code=${encodeURIComponent(qc.code)}`, {
            deviceId: deviceIdFor(url, jellyfin.jellyfinUserId),
            method: "POST",
            token: personToken,
        });
    } catch (e) {
        if (e.status === 401 || e.status === 403) {
            throw Object.assign(
                new Error(
                    "The server turned down the sign-in for Nuvio - Quick Connect may be off on it"
                ),
                { status: 400 }
            );
        }
        throw e;
    }
    const signedIn = await quickConnectAuthenticate(url, qc.secret, {
        deviceId: qc.deviceId,
        deviceName: NUVIO_DEVICE_NAME,
    });
    if (signedIn.userId !== String(jellyfin.jellyfinUserId).replace(/-/g, "").toLowerCase()) {
        await signOut(url, signedIn.token, { deviceId: qc.deviceId });
        throw Object.assign(new Error("The server signed Nuvio in as someone else"), {
            status: 502,
        });
    }
    return signedIn;
}

async function librariesFor(jellyfin, token) {
    const data = await jfRequest(
        jellyfin.jellyfinServerUrl,
        `/Users/${encodeURIComponent(jellyfin.jellyfinUserId)}/Views`,
        {
            deviceId: deviceIdFor(jellyfin.jellyfinServerUrl, jellyfin.jellyfinUserId),
            token,
        }
    );
    const items = Array.isArray(data?.Items) ? data.Items : [];
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const id = String(item?.Id || "").trim();
        if (!id || seen.has(id) || out.length >= 500) {
            continue;
        }
        seen.add(id);
        out.push({
            id: id.slice(0, 256),
            kind: libraryKind(item?.CollectionType),
            name: String(item?.Name || "").slice(0, 256),
            selected: true,
        });
    }
    return out;
}

async function serverIdentity(jellyfin) {
    let info = null;
    try {
        info = await jfRequest(jellyfin.jellyfinServerUrl, "/System/Info/Public");
    } catch {}
    const serverId = jellyfin.jellyfinServerId || info?.Id || null;
    if (!serverId) {
        throw Object.assign(new Error("Could not reach their server"), { status: 502 });
    }
    const kind = jellyfin.jellyfinServerKind || "jellyfin";
    const name = kind === "jellyfin" ? info?.ServerName || "Jellyfin" : serverKindLabel(kind);
    return { name: String(name).slice(0, 256), serverId: String(serverId) };
}

/**
 * Turn it on (put their server in their Nuvio profile, or refresh it) or off
 * (take SlickSync's entry out again). Their own servers are never touched.
 */
async function setEnabled(prisma, { createProvider, decrypt, req }, userId, enabled) {
    const found = await signInsFor(prisma, userId);
    if (!found) {
        throw Object.assign(new Error("Person not found"), { status: 404 });
    }
    const { nuvio, jellyfin } = found;
    if (!nuvio) {
        throw Object.assign(new Error("They have no Nuvio sign-in"), { status: 409 });
    }
    const nuvioProvider = createProvider(nuvio.row, { decrypt, req });
    const list = await nuvioProvider.getMediaServers(nuvio.profileId);
    const ours = list.filter(isOurs);
    const theirs = list.filter((e) => !isOurs(e));
    const accountKey = { appAccountId: found.user.accountId || "default" };

    if (!enabled) {
        if (ours.length) {
            await nuvioProvider.setMediaServers(nuvio.profileId, theirs);
        }
        for (const entry of ours) {
            if (entry.address && entry.token) {
                await signOut(entry.address, entry.token);
            }
        }
        await prisma.user.update({ data: { nuvioMediaServers: false }, where: { id: userId } });
        return { removed: ours.length };
    }

    if (!jellyfin) {
        throw Object.assign(new Error("They have no Jellyfin, AIOStreams or AIOMetadata sign-in"), {
            status: 409,
        });
    }
    const personToken = decrypt(jellyfin.jellyfinToken, accountKey);
    const { serverId, name } = await serverIdentity(jellyfin);
    const id = entryId(serverId, jellyfin.jellyfinUserId);
    const remoteUserId = String(jellyfin.jellyfinUserId).replace(/-/g, "").toLowerCase();

    // Keep Nuvio's sign-in when the entry is already there for this user and
    // still works; otherwise give Nuvio a new one.
    const existing = ours.find((e) => e.id === id && e.remote_user_id === remoteUserId && e.token);
    let token = null;
    if (existing) {
        try {
            await jfRequest(jellyfin.jellyfinServerUrl, "/Users/Me", {
                timeoutMs: 8000,
                token: existing.token,
            });
            token = existing.token;
        } catch {}
    }
    if (!token) {
        token = (await signInForNuvio(jellyfin, personToken)).token;
    }

    const libraries = await librariesFor(jellyfin, personToken);
    const entry = {
        address: jellyfin.jellyfinServerUrl,
        enabled: existing ? existing.enabled !== false : true,
        id,
        libraries:
            existing && Array.isArray(existing.libraries) && existing.libraries.length
                ? // Keep which libraries they turned off in Nuvio; new ones come in on.
                  libraries.map((l) => ({
                      ...l,
                      selected: existing.libraries.find((o) => o.id === l.id)?.selected ?? true,
                  }))
                : libraries,
        name,
        provider_id: "jellyfin",
        remote_server_id: serverId,
        remote_user_id: remoteUserId,
        token,
        use_catalog_metadata: existing ? existing.use_catalog_metadata === true : false,
        user_name: jellyfin.jellyfinUserName || name,
    };
    // The same server and user added by hand in Nuvio would be a duplicate,
    // which Nuvio refuses - SlickSync's entry takes its place.
    const keep = theirs.filter(
        (e) =>
            !(
                e.provider_id === "jellyfin" &&
                e.remote_server_id === serverId &&
                e.remote_user_id === remoteUserId
            )
    );
    if (keep.length + 1 > MAX_SERVERS) {
        throw Object.assign(
            new Error(`Their Nuvio profile already has ${MAX_SERVERS} servers, the most it holds`),
            { status: 409 }
        );
    }
    await nuvioProvider.setMediaServers(nuvio.profileId, [...keep, entry]);

    // An older entry of SlickSync's for a sign-in they no longer have.
    for (const old of ours) {
        if (old.id !== id && old.address && old.token) {
            await signOut(old.address, old.token);
        }
    }
    await prisma.user.update({ data: { nuvioMediaServers: true }, where: { id: userId } });
    return { added: name };
}

module.exports = {
    describe,
    entryId,
    isOurs,
    libraryKind,
    NUVIO_DEVICE_NAME,
    OUR_PREFIX,
    setEnabled,
    signInsFor,
};
