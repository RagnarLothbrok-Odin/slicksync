// Signing someone in to a Jellyfin-compatible server, shared by every place a
// person can connect one: Add User, the user portal's sign-in, the admin
// sign-in on a public instance, and invitations.
//
// The browser never holds the server's access token. It sends what the person
// typed (or a Quick Connect secret), the server signs in here, and only the
// SlickSync user that results goes back.

const jfAuth = require("../providers/jellyfinAuth");

function httpError(status, message, extra = {}) {
    return Object.assign(new Error(message), { status, ...extra });
}

function sendError(res, error, fallback) {
    const status =
        Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500;
    const message = status === 500 ? fallback : error?.message || fallback;
    // A rejected server sign-in is the server saying no, not this session
    // ending - and the admin pages treat any 401 as "signed out of SlickSync".
    const sent = status === 401 || status === 403 || status === 502 ? 400 : status;
    return res.status(sent).json({
        error: message,
        message,
        ...(error?.pinNeeded ? { pinNeeded: true } : {}),
    });
}

/**
 * Sign in with what the person gave: an address plus a user name and
 * password, or an address plus an approved Quick Connect secret. Returns the
 * server's description and the sign-in.
 */
async function signInFromBody(body = {}) {
    const serverUrl = String(body.serverUrl || "").trim();
    if (!serverUrl) {
        throw httpError(400, "Enter the server address");
    }
    const probe = await jfAuth.probeServer(serverUrl);
    let login;
    let deviceId;
    if (body.quickConnectSecret) {
        deviceId = body.quickConnectDevice;
        login = await jfAuth.quickConnectAuthenticate(
            probe.serverUrl,
            String(body.quickConnectSecret),
            { deviceId }
        );
    } else {
        const username = String(body.jellyfinUsername ?? body.loginName ?? "").trim();
        if (!username) {
            throw httpError(400, "Enter the user name to sign in as");
        }
        deviceId = jfAuth.signInDeviceId(probe.serverUrl, username);
        login = await jfAuth.authenticateByName(
            probe.serverUrl,
            username,
            String(body.password ?? ""),
            { deviceId }
        );
    }
    // Before signing in, the kind is a guess from the server's name; signed in,
    // the server says which software it is, and that wins.
    const kind = await jfAuth.signedInKind(probe.serverUrl, login.token, { deviceId });
    const confirmed =
        kind && kind !== probe.kind
            ? { ...probe, kind, kindLabel: jfAuth.serverKindLabel(kind) }
            : probe;
    return { login: { ...login, serverId: login.serverId || probe.serverId }, probe: confirmed };
}

/** The columns a User (or an invite request) stores for this sign-in. */
function jellyfinFields(probe, login, encrypt, req) {
    return {
        jellyfinServerId: login.serverId || probe.serverId || null,
        jellyfinServerKind: probe.kind,
        jellyfinServerUrl: probe.serverUrl,
        jellyfinToken: encrypt(login.token, req),
        jellyfinUserId: login.userId,
        jellyfinUserName: login.userName || null,
        providerType: "jellyfin",
    };
}

/**
 * Which stored sign-ins are on the server just signed in to. A household's
 * install may reach one server by several names (a LAN address, a hostname),
 * so the id the server reports counts there as well as the address. On an
 * instance serving strangers only the address the person was added with
 * counts: the id is whatever the server at a typed-in address says it is, and
 * trusting it would let anyone run a server that claims another household's.
 * Stored addresses are the normalised ones a probe produced, and so is
 * probe.serverUrl, so that is a comparison of normalised addresses - under
 * either scheme, so a person who types the other one is still found.
 */
function serverMatch(probe, login) {
    if (jfAuth.restrictsPrivateAddresses()) {
        const rest = /^https?:\/\/(.+)$/i.exec(String(probe.serverUrl || ""))?.[1];
        if (!rest) {
            return { jellyfinServerUrl: probe.serverUrl };
        }
        // The device a sign-in presents ignores the case of the address (see
        // jellyfinAuth.deviceIdFor), so a path typed in another case is the same
        // device, and its sign-in just retired the token stored under the
        // spelling it was added with. Those rows are the ones to refresh.
        const spellings = [...new Set([rest, rest.toLowerCase()])];
        return {
            OR: spellings.flatMap((r) => [
                { jellyfinServerUrl: `https://${r}` },
                { jellyfinServerUrl: `http://${r}` },
            ]),
        };
    }
    const servers = [{ jellyfinServerUrl: probe.serverUrl }];
    if (login.serverId) {
        servers.unshift({ jellyfinServerId: login.serverId });
    }
    return { OR: servers };
}

/**
 * A server retires a user's previous token for a device the moment that
 * device signs in again, and SlickSync signs a server user in from one
 * device (see jellyfinAuth.signInDeviceId). So after any successful sign-in,
 * every SlickSync row holding the same server user - in any household, a
 * merged-in login, a pending invite request, a household profile - must take
 * the fresh token, or the one it holds has just stopped working. Found the
 * hard way: a second Add User for someone already added signed them out.
 *
 * Call it the moment the sign-in succeeds, before anything that can turn the
 * person away: the server has retired the old token whatever happens next.
 *
 * Which rows are "the same server user" is serverMatch's to say, and that is
 * what keeps this safe: the sign-in comes from a server the caller named, and
 * what it says about itself (its id, the ids in its reply) is whatever it
 * likes. Each row is sealed for its own household.
 */
async function rememberSignIn(prisma, encrypt, probe, login) {
    const sealed = (accountId) => encrypt(login.token, { appAccountId: accountId || "default" });
    try {
        const match = serverMatch(probe, login);
        // On an instance serving strangers, a row that never held a sign-in has
        // nothing the server could have retired, and nothing proves its address
        // and user id were ever signed in to - so it is not handed one.
        const held = jfAuth.restrictsPrivateAddresses() ? { jellyfinToken: { not: null } } : {};
        const where = { jellyfinUserId: login.userId, ...match, ...held };
        const users = await prisma.user.findMany({
            select: {
                accountId: true,
                id: true,
                jellyfinServerKind: true,
                jellyfinServerUrl: true,
                providerConnectionError: true,
                providerConnectionErrorAt: true,
                providerType: true,
                username: true,
            },
            where: { providerType: "jellyfin", ...where },
        });
        for (const u of users) {
            await prisma.user.update({
                data: {
                    jellyfinToken: sealed(u.accountId),
                    providerConnectionError: null,
                    providerConnectionErrorAt: null,
                },
                where: { id: u.id },
            });
            // A sign-in that had stopped working is fixed by this one - from a
            // Reconnect, or the person signing in on their own page. Say so, as
            // the activity monitor would once it read them again.
            if (u.providerConnectionErrorAt) {
                await require("./connectionAlerts")
                    .onConnectionRecovered(prisma, u.accountId || "default", u)
                    .catch(() => undefined);
            }
        }
        // A stored credential has no household column; whose it is follows from
        // the person it belongs to.
        const credentials = await prisma.userProviderCredential.findMany({
            select: { id: true, userId: true },
            where: { providerType: "jellyfin", ...where },
        });
        if (credentials.length) {
            const owners = await prisma.user.findMany({
                select: { accountId: true, id: true },
                where: { id: { in: credentials.map((c) => c.userId) } },
            });
            const household = new Map(owners.map((o) => [o.id, o.accountId]));
            for (const c of credentials) {
                await prisma.userProviderCredential.update({
                    data: { jellyfinToken: sealed(household.get(c.userId)) },
                    where: { id: c.id },
                });
            }
        }
        const requests = await prisma.inviteRequest.findMany({
            select: { accountId: true, id: true },
            where: { providerType: "jellyfin", status: "pending", ...where },
        });
        for (const r of requests) {
            await prisma.inviteRequest.update({
                data: { jellyfinToken: sealed(r.accountId) },
                where: { id: r.id },
            });
        }
        // A household profile of someone on the same server (utils/jellyfinProfiles.js).
        const owners = await prisma.user.findMany({
            select: { id: true },
            where: { providerType: "jellyfin", ...match, ...held },
        });
        if (owners.length) {
            const profiles = await prisma.jellyfinProfile.findMany({
                select: { accountId: true, id: true },
                where: {
                    jellyfinUserId: login.userId,
                    ownerUserId: { in: owners.map((o) => o.id) },
                    ...(jfAuth.restrictsPrivateAddresses() ? { token: { not: null } } : {}),
                },
            });
            for (const p of profiles) {
                await prisma.jellyfinProfile.update({
                    data: { needsPin: false, token: sealed(p.accountId) },
                    where: { id: p.id },
                });
            }
        }
    } catch (e) {
        console.warn(
            "[Jellyfin] Could not hand the fresh sign-in to everyone holding it:",
            e?.message
        );
    }
}

/**
 * Whether a token really is this server user's on this server: the server
 * itself, reached the way any address on an instance serving strangers is
 * (public addresses only, redirects included), says whose it is.
 */
async function signInProven(serverUrl, token, userId, { timeoutMs = 8000 } = {}) {
    const url = jfAuth.normalizeServerUrl(serverUrl);
    if (!url || typeof token !== "string" || !token || !userId) {
        return false;
    }
    try {
        const me = await jfAuth.currentUser(url, token, { checkAddress: true, timeoutMs });
        return me.userId === String(userId).replace(/-/g, "").toLowerCase();
    } catch {
        return false;
    }
}

/**
 * What an imported file says about Jellyfin sign-ins is only kept once the
 * server vouches for it (an import onto an instance serving strangers). A
 * file can claim any address and user id; a token that the server at that
 * address says belongs to that user is the one thing it cannot make up.
 *
 * `users` are the file's people, as decrypted by the export. Returns, per
 * person, the normalised address when the person's sign-in is proven (else
 * null), and per household profile whether its own token is proven against
 * its owner's address. At most `max` servers are asked, `limit` at a time;
 * anything past that counts as unproven and the person reconnects.
 */
async function proveImportedSignIns(users, { limit = 4, max = 200 } = {}) {
    const list = Array.isArray(users) ? users : [];
    const personUrl = new Map();
    const profileProven = new Map();
    let budget = max;
    const jobs = [];
    const queue = (job) => {
        if (budget <= 0) {
            return;
        }
        budget -= 1;
        jobs.push(job);
    };
    for (const u of list) {
        if (!u || typeof u !== "object") {
            continue;
        }
        personUrl.set(u, null);
        queue(async () => {
            if (await signInProven(u.jellyfinServerUrl, u.jellyfinToken, u.jellyfinUserId)) {
                personUrl.set(u, jfAuth.normalizeServerUrl(u.jellyfinServerUrl));
            }
        });
    }
    const run = async () => {
        let next = 0;
        const worker = async () => {
            while (next < jobs.length) {
                const job = jobs[next++];
                try {
                    await job();
                } catch {}
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
        jobs.length = 0;
        next = 0;
    };
    await run();
    for (const u of list) {
        const profiles =
            u &&
            typeof u === "object" &&
            u.jellyfinHousehold &&
            Array.isArray(u.jellyfinHousehold.profiles)
                ? u.jellyfinHousehold.profiles
                : [];
        const ownerUrl = personUrl.get(u);
        for (const p of profiles) {
            if (!p || typeof p !== "object") {
                continue;
            }
            profileProven.set(p, false);
            if (!(ownerUrl && p.token)) {
                continue;
            }
            queue(async () => {
                if (await signInProven(ownerUrl, String(p.token), p.jellyfinUserId)) {
                    profileProven.set(p, true);
                }
            });
        }
    }
    await run();
    return { personUrl, profileProven };
}

/** The SlickSync user already holding this server user, in one account. */
async function findJellyfinUser(prisma, accountId, login, probe) {
    return prisma.user.findFirst({
        where: {
            accountId,
            jellyfinUserId: login.userId,
            providerType: "jellyfin",
            ...serverMatch(probe, login),
        },
    });
}

/** What a picker shows for a server, without anything secret. */
function describeProbe(probe) {
    return {
        display: jfAuth.displayServer(probe.serverUrl),
        kind: probe.kind,
        kindLabel: probe.kindLabel,
        pinSignIn: probe.pinSignIn,
        quickConnect: probe.quickConnect,
        serverName: probe.serverName,
        serverUrl: probe.serverUrl,
        users: probe.users,
        version: probe.version,
    };
}

/**
 * The steps that come before signing in - checking an address and running
 * Quick Connect - which touch no SlickSync data. Mounted on each router that
 * signs people in, under `prefix`.
 */
function mountSignInSteps(router, prefix = "") {
    router.post(`/${prefix}probe`, async (req, res) => {
        try {
            const probe = await jfAuth.probeServer(req.body?.serverUrl);
            res.json(describeProbe(probe));
        } catch (error) {
            sendError(res, error, "Could not reach the server");
        }
    });

    router.post(`/${prefix}quick-connect`, async (req, res) => {
        try {
            const probe = await jfAuth.probeServer(req.body?.serverUrl);
            if (!probe.quickConnect) {
                throw httpError(400, "Quick Connect is turned off on this server");
            }
            const started = await jfAuth.quickConnectInitiate(probe.serverUrl);
            res.json({
                code: started.code,
                device: started.deviceId,
                secret: started.secret,
                serverUrl: probe.serverUrl,
            });
        } catch (error) {
            sendError(res, error, "Could not start Quick Connect");
        }
    });

    router.post(`/${prefix}quick-connect-status`, async (req, res) => {
        try {
            const serverUrl = jfAuth.normalizeServerUrl(req.body?.serverUrl);
            if (!(serverUrl && req.body?.secret)) {
                throw httpError(400, "serverUrl and secret are required");
            }
            const status = await jfAuth.quickConnectStatus(serverUrl, String(req.body.secret), {
                deviceId: req.body?.device,
            });
            res.json(status);
        } catch (error) {
            if (error?.status === 404) {
                return res.json({ authenticated: false, expired: true });
            }
            sendError(res, error, "Could not check Quick Connect");
        }
    });
}

module.exports = {
    describeProbe,
    findJellyfinUser,
    httpError,
    jellyfinFields,
    mountSignInSteps,
    proveImportedSignIns,
    rememberSignIn,
    sendError,
    serverMatch,
    signInFromBody,
    signInProven,
};
