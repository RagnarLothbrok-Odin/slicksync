const crypto = require("node:crypto");
const { aesGcmEncrypt, aesGcmDecrypt, getServerKey } = require("./encryption");

const API = "https://api.trakt.tv";
const PROVIDER = "trakt";
function createTraktTracking({
    encrypt: seal = (value, owner) => aesGcmEncrypt(getServerKey(), value, owner),
    decrypt: open = (value, owner) => aesGcmDecrypt(getServerKey(), value, owner),
    fetch: transport = (...args) => fetch(...args),
} = {}) {
    const locks = new Map();
    const cache = new Map();
    const cooldowns = new Map();
    const epochs = new Map();
    const error = (message, statusCode = 400) =>
        Object.assign(new Error(message), { status: statusCode });
    const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
    const identity = (person) => ({
        accountId: person.accountId || "default",
        provider: PROVIDER,
        userId: person.id,
    });
    const where = (person) => ({ accountId_userId_provider: identity(person) });
    // Personal sign-ins do not unlock the administrator's optional account DEK.
    // Bind these server-key-encrypted records to their owner with authenticated data.
    const context = (person) => `${person.accountId || "default"}:${person.id}:${PROVIDER}`;
    const encrypt = seal;
    const decrypt = open;
    const key = (person) => `${person.accountId || "default"}:${person.id}`;

    function requireNuvio(person) {
        if (person.providerType !== "nuvio") {
            throw error("Tracking services are currently available for Nuvio profiles only.", 403);
        }
    }
    function redirectUri() {
        let base;
        try {
            base = new URL(process.env.PUBLIC_APP_URL);
        } catch (cause) {
            throw Object.assign(
                error(
                    "Your administrator must configure PUBLIC_APP_URL before linking a tracking service.",
                    503
                ),
                { cause }
            );
        }
        const development =
            process.env.NODE_ENV !== "production" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
        if (
            base.username ||
            base.password ||
            (base.protocol !== "https:" && !(development && base.protocol === "http:"))
        ) {
            throw error(
                "Tracking sign-in requires an HTTPS app address. HTTP loopback is allowed only in development.",
                503
            );
        }
        return new URL("/user/settings/tracking/callback", base.origin).href;
    }
    async function clientId() {
        // Tracking has its own registration; list-import keys are not OAuth credentials.
        const configured = process.env.TRAKT_TRACKING_CLIENT_ID;
        if (configured && /^[a-zA-Z0-9_-]{10,160}$/.test(configured)) {
            return configured;
        }
        throw error("Your administrator has not configured the Trakt tracking app yet.", 503);
    }
    async function request(path, { token, client, body, method = "GET", pagination = false } = {}) {
        const response = await transport(`${API}${path}`, {
            headers: {
                "content-type": "application/json",
                "trakt-api-version": "2",
                ...(client ? { "trakt-api-key": client } : {}),
                ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            method,
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) {
            const edgeBlocked =
                response.status === 403 &&
                response.headers.get("content-type")?.includes("text/html");
            const failure = error(
                edgeBlocked
                    ? "Trakt’s network protection blocked this server request. Please try again later."
                    : response.status === 429
                      ? "Trakt is rate limiting requests. Please try again later."
                      : response.status === 420
                        ? "Your Trakt account limit has been reached. Review your connected apps and account limits."
                        : response.status === 401
                          ? "Reconnect your Trakt account."
                          : response.status === 403
                            ? "Trakt does not allow this feature for this app or account."
                            : "Trakt is temporarily unavailable.",
                response.status === 401 ? 401 : response.status === 403 ? 403 : 503
            );
            failure.providerStatus = response.status;
            failure.retryAfterMs = Math.min(
                3_600_000,
                Math.max(30_000, Number(response.headers.get("retry-after")) * 1000 || 60_000)
            );
            throw failure;
        }
        if (response.status === 204) {
            return null;
        }
        const data = await response.json();
        return pagination
            ? {
                  data,
                  pages: response.headers.has("x-pagination-page-count")
                      ? Number(response.headers.get("x-pagination-page-count"))
                      : null,
              }
            : data;
    }
    async function status(prisma, person) {
        requireNuvio(person);
        const connection = await prisma.trackingConnection.findUnique({ where: where(person) });
        let configured = true;
        try {
            await clientId();
            redirectUri();
        } catch {
            configured = false;
        }
        return {
            configured,
            connected: !!connection?.credentials,
            connectedAt: connection?.connectedAt || null,
            provider: PROVIDER,
            username: connection?.username || null,
        };
    }
    async function source(prisma, person) {
        const native = person.providerType || "stremio";
        if (native !== "nuvio" || !prisma.trackingConnection) {
            return native;
        }
        const profile = await prisma.user.findUnique({
            select: { portalPreferences: true },
            where: { id: person.id },
        });
        let preferences = {};
        try {
            preferences = JSON.parse(profile?.portalPreferences || "{}");
        } catch {
            /* Older profiles retain their connected source. */
        }
        if (preferences?.trackingSource === native) {
            return native;
        }
        if (preferences?.trackingSource === "simkl") {
            const simkl = await prisma.trackingConnection.findUnique({
                where: { accountId_userId_provider: { ...identity(person), provider: "simkl" } },
            });
            return simkl?.credentials ? "simkl" : native;
        }
        const connection = await prisma.trackingConnection.findUnique({ where: where(person) });
        return connection?.credentials ? "trakt" : native;
    }
    async function begin(prisma, person) {
        requireNuvio(person);
        const client = await clientId();
        const redirect = redirectUri();
        const verifier = crypto.randomBytes(48).toString("base64url");
        const state = crypto.randomBytes(32).toString("base64url");
        const pending = { client, redirect, verifier };
        const data = {
            pending: encrypt(JSON.stringify(pending), context(person)),
            pendingUntil: new Date(Date.now() + 600_000),
            stateHash: hash(state),
        };
        await prisma.trackingConnection.upsert({
            create: { ...identity(person), ...data },
            update: data,
            where: where(person),
        });
        const url = new URL("https://auth.trakt.tv/oauth/authorize");
        for (const [name, value] of Object.entries({
            client_id: client,
            code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
            code_challenge_method: "S256",
            redirect_uri: redirect,
            response_type: "code",
            state,
        })) {
            url.searchParams.set(name, value);
        }
        return { url: url.href };
    }
    async function complete(prisma, person, { code, state }) {
        requireNuvio(person);
        if (
            typeof code !== "string" ||
            code.length > 2048 ||
            !code ||
            typeof state !== "string" ||
            !/^[A-Za-z0-9_-]{43}$/.test(state)
        ) {
            throw error("Invalid Trakt sign-in response.");
        }
        const row = await prisma.trackingConnection.findUnique({ where: where(person) });
        if (
            !row?.pending ||
            row.stateHash !== hash(state) ||
            !row.pendingUntil ||
            row.pendingUntil.getTime() < Date.now()
        ) {
            throw error(
                "This Trakt sign-in has expired or belongs to another profile. Start again."
            );
        }
        const pending = JSON.parse(decrypt(row.pending, context(person)));
        // Claim once before exchange: parallel callbacks and replays cannot reuse a verifier.
        const claimed = await prisma.trackingConnection.updateMany({
            data: { pending: null, pendingUntil: null, stateHash: null },
            where: {
                ...identity(person),
                pendingUntil: { gt: new Date() },
                stateHash: row.stateHash,
            },
        });
        if (claimed.count !== 1) {
            throw error("This Trakt sign-in has already been used.");
        }
        const tokens = await request("/oauth/token", {
            body: {
                client_id: pending.client,
                code,
                code_verifier: pending.verifier,
                grant_type: "authorization_code",
                redirect_uri: pending.redirect,
            },
            method: "POST",
        });
        if (!(tokens?.access_token && tokens.refresh_token && Number.isFinite(tokens.expires_in))) {
            throw error("Trakt returned an incomplete sign-in response.", 502);
        }
        const profile = await request("/users/settings", {
            client: pending.client,
            token: tokens.access_token,
        });
        const externalId = profile?.user?.ids?.uuid || profile?.user?.ids?.slug;
        if (typeof externalId !== "string" || !externalId) {
            throw error("Could not identify the Trakt account.", 502);
        }
        const duplicate = await prisma.trackingConnection.findFirst({
            where: {
                accountId: person.accountId || "default",
                externalUserId: externalId,
                provider: PROVIDER,
                userId: { not: person.id },
            },
        });
        if (duplicate) {
            throw error(
                "This Trakt account is already linked to another profile in your household. Use a separate Trakt account to keep viewing separate.",
                409
            );
        }
        const credentials = {
            accessToken: tokens.access_token,
            client: pending.client,
            expiresAt: Date.now() + tokens.expires_in * 1000,
            refreshToken: tokens.refresh_token,
        };
        await prisma.trackingConnection.update({
            data: {
                connectedAt: new Date(),
                credentials: encrypt(JSON.stringify(credentials), context(person)),
                externalUserId: externalId,
                username: profile.user.username || externalId,
            },
            where: where(person),
        });
        clear(person);
        return status(prisma, person);
    }
    function clear(person) {
        const prefix = `${key(person)}:`;
        for (const name of cache.keys()) {
            if (name.startsWith(prefix)) {
                cache.delete(name);
            }
        }
        cooldowns.delete(key(person));
        epochs.set(key(person), (epochs.get(key(person)) || 0) + 1);
    }
    async function disconnect(prisma, person) {
        requireNuvio(person);
        await prisma.trackingConnection.deleteMany({ where: identity(person) });
        clear(person);
        return { success: true };
    }
    async function access(prisma, person) {
        const row = await prisma.trackingConnection.findUnique({ where: where(person) });
        if (!row?.credentials) {
            return null;
        }
        let credentials = JSON.parse(decrypt(row.credentials, context(person)));
        if (credentials.expiresAt > Date.now() + 60_000) {
            return { credentials, row };
        }
        const id = key(person);
        if (!locks.has(id)) {
            locks.set(
                id,
                (async () => {
                    const tokens = await request("/oauth/token", {
                        body: {
                            client_id: credentials.client,
                            grant_type: "refresh_token",
                            refresh_token: credentials.refreshToken,
                        },
                        method: "POST",
                    });
                    if (
                        !(
                            tokens?.access_token &&
                            tokens.refresh_token &&
                            Number.isFinite(tokens.expires_in)
                        )
                    ) {
                        throw error("Reconnect your Trakt account.", 401);
                    }
                    credentials = {
                        ...credentials,
                        accessToken: tokens.access_token,
                        expiresAt: Date.now() + tokens.expires_in * 1000,
                        refreshToken: tokens.refresh_token,
                    };
                    // A disconnect or a replacement link wins over a refresh in flight.
                    const saved = await prisma.trackingConnection.updateMany({
                        data: {
                            credentials: encrypt(JSON.stringify(credentials), context(person)),
                        },
                        where: { credentials: row.credentials, id: row.id },
                    });
                    if (saved.count !== 1) {
                        throw error("The tracking connection changed. Refresh the page.", 409);
                    }
                    return { credentials, row };
                })().finally(() => locks.delete(id))
            );
        }
        return locks.get(id);
    }
    async function read(prisma, person, resource, ttl, { ignoreSource = false } = {}) {
        if (person.providerType !== "nuvio" || !prisma.trackingConnection) {
            return { connected: false, data: null };
        }
        if (!ignoreSource) {
            const profile = await prisma.user.findUnique({
                select: { portalPreferences: true },
                where: { id: person.id },
            });
            let preferences = {};
            try {
                preferences = JSON.parse(profile?.portalPreferences || "{}");
            } catch {
                /* Default to the existing connected source for older profiles. */
            }
            if (
                preferences?.trackingSource === person.providerType ||
                preferences?.trackingSource === "simkl"
            ) {
                return { connected: false, data: null };
            }
        }
        const id = key(person);
        const cooldown = cooldowns.get(id);
        if (cooldown && cooldown.until > Date.now()) {
            throw error(cooldown.message, 503);
        }
        const epoch = epochs.get(id) || 0;
        const cacheKey = `${id}:${resource}`;
        const hit = cache.get(cacheKey);
        if (hit && hit.until > Date.now()) {
            return hit.promise;
        }
        const promise = (async () => {
            const linked = await access(prisma, person);
            if (!linked) {
                return { connected: false, data: null };
            }
            const { credentials } = linked;
            const endpoint =
                resource === "watching"
                    ? "/users/me/watching?extended=full"
                    : resource === "progress"
                      ? "/sync/playback?limit=100&extended=full"
                      : `/calendars/my/shows/${new Date().toISOString().slice(0, 10)}/33?extended=full`;
            try {
                const options = { client: credentials.client, token: credentials.accessToken };
                const data =
                    resource === "home"
                        ? await require("./traktHome").loadHomeHistory(
                              (path) => request(path, { ...options, pagination: true }),
                              await require("./dateUtils").resolveAccountTimezone(
                                  prisma,
                                  person.accountId
                              )
                          )
                        : resource === "upNext"
                          ? await require("./traktUpNext").loadUpNext((path) =>
                                request(path, { ...options, pagination: true })
                            )
                          : await request(endpoint, options);
                if ((epochs.get(id) || 0) !== epoch) {
                    throw error("The tracking connection changed. Refresh the page.", 409);
                }
                return { checkedAt: new Date().toISOString(), connected: true, data };
            } catch (failure) {
                if (failure.providerStatus === 429) {
                    cooldowns.set(id, {
                        message: failure.message,
                        until: Date.now() + failure.retryAfterMs,
                    });
                }
                throw failure;
            }
        })();
        cache.set(cacheKey, { promise, until: Date.now() + ttl });
        try {
            return await promise;
        } catch (failure) {
            if (cache.get(cacheKey)?.promise === promise) {
                cache.delete(cacheKey);
            }
            throw failure;
        }
    }

    async function check(prisma, person) {
        requireNuvio(person);
        const resources = [
            { key: "watching", label: "Playback activity", ttl: 15_000 },
            { key: "progress", label: "Continue Watching", ttl: 60_000 },
            { key: "upNext", label: "Next episodes", ttl: 300_000 },
            { key: "calendar", label: "Calendar", ttl: 300_000 },
        ];
        return Promise.all(
            resources.map(async (resource) => {
                try {
                    const result = await read(prisma, person, resource.key, resource.ttl, {
                        ignoreSource: true,
                    });
                    return {
                        available: result.connected,
                        error: result.connected ? null : "Connect a tracking service first.",
                        key: resource.key,
                        label: resource.label,
                    };
                } catch (failure) {
                    return {
                        available: false,
                        error: failure.providerStatus
                            ? failure.message
                            : "Could not refresh this Trakt source. Please try again.",
                        key: resource.key,
                        label: resource.label,
                    };
                }
            })
        );
    }
    return { begin, check, complete, disconnect, read, source, status };
}
module.exports = { ...createTraktTracking(), createTraktTracking };
