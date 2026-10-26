const crypto = require("node:crypto");
const { aesGcmEncrypt, aesGcmDecrypt, getServerKey } = require("./encryption");

const API = "https://api.simkl.com";
const PROVIDER = "simkl";
function createSimklTracking({
    encrypt: seal = (value, owner) => aesGcmEncrypt(getServerKey(), value, owner),
    decrypt: open = (value, owner) => aesGcmDecrypt(getServerKey(), value, owner),
    fetch: transport = (...args) => fetch(...args),
} = {}) {
    const locks = new Map();
    const epochs = new Map();
    const cooldowns = new Map();
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
        return new URL("/user/settings/tracking/simkl/callback", base.origin).href;
    }
    async function clientId() {
        // Tracking has its own registration; list-import keys are not OAuth credentials.
        const configured = process.env.SIMKL_TRACKING_CLIENT_ID;
        if (
            configured &&
            /^[a-zA-Z0-9_-]{1,160}$/.test(configured) &&
            process.env.SIMKL_TRACKING_CLIENT_SECRET?.trim()
        ) {
            return configured;
        }
        throw error("Your administrator has not configured the Simkl tracking app yet.", 503);
    }
    async function request(path, { token, client, body, method = "GET" } = {}) {
        if (path === "/oauth2/token" || path === "/oauth2/revoke") {
            // Server registrations authenticate every grant and revocation. Never
            // attach the application secret to ordinary media requests or URLs.
            const configuredClient = await clientId();
            if (body?.client_id !== configuredClient) {
                throw error("The Simkl registration changed. Reconnect this profile.", 409);
            }
            body = { ...body, client_secret: process.env.SIMKL_TRACKING_CLIENT_SECRET.trim() };
        }
        const rateKey = client || body?.client_id;
        const limitedUntil = cooldowns.get(rateKey) || 0;
        if (limitedUntil > Date.now()) {
            throw error("Simkl is rate limiting requests. Please try again later.", 503);
        }
        const url = new URL(path, API);
        url.searchParams.set("app-name", "slicksync");
        url.searchParams.set("app-version", require("../../package.json").version);
        if (client) {
            url.searchParams.set("client_id", client);
        }
        const response = await transport(url.href, {
            headers: {
                "content-type": "application/json",
                "user-agent": `SlickSync/${require("../../package.json").version}`,
                ...(client ? { "simkl-api-key": client } : {}),
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
                    ? "Simkl’s network protection blocked this server request. Please try again later."
                    : response.status === 429
                      ? "Simkl is rate limiting requests. Please try again later."
                      : response.status === 401
                        ? "Reconnect your Simkl account."
                        : response.status === 403
                          ? "Simkl does not allow this feature for this app or account."
                          : "Simkl is temporarily unavailable.",
                response.status === 401 ? 401 : response.status === 403 ? 403 : 503
            );
            failure.providerStatus = response.status;
            failure.retryAfterMs = Math.min(
                3_600_000,
                Math.max(30_000, Number(response.headers.get("retry-after")) * 1000 || 60_000)
            );
            if (response.status === 429) {
                cooldowns.set(rateKey, Date.now() + failure.retryAfterMs);
            }
            throw failure;
        }
        if (response.status === 204) {
            return null;
        }
        if (path === "/oauth2/revoke") {
            return null;
        }
        const data = await response.json();
        return data;
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
        const url = new URL("https://simkl.com/oauth2/authorize");
        for (const [name, value] of Object.entries({
            client_id: client,
            code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
            code_challenge_method: "S256",
            redirect_uri: redirect,
            response_type: "code",
            scope: "media:read",
            state,
        })) {
            url.searchParams.set(name, value);
        }
        return { url: url.href };
    }
    async function complete(prisma, person, { code, state, iss }) {
        requireNuvio(person);
        if (
            typeof code !== "string" ||
            code.length > 2048 ||
            !code ||
            typeof state !== "string" ||
            !/^[A-Za-z0-9_-]{43}$/.test(state)
        ) {
            throw error("Invalid Simkl sign-in response.");
        }
        if (iss !== "https://simkl.com") {
            throw error("Invalid Simkl authorization issuer.");
        }
        const row = await prisma.trackingConnection.findUnique({ where: where(person) });
        if (
            !row?.pending ||
            row.stateHash !== hash(state) ||
            !row.pendingUntil ||
            row.pendingUntil.getTime() < Date.now()
        ) {
            throw error(
                "This Simkl sign-in has expired or belongs to another profile. Start again."
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
            throw error("This Simkl sign-in has already been used.");
        }
        const tokens = await request("/oauth2/token", {
            body: {
                client_id: pending.client,
                code,
                code_verifier: pending.verifier,
                grant_type: "authorization_code",
                redirect_uri: pending.redirect,
            },
            method: "POST",
        });
        if (
            !(
                tokens?.access_token &&
                tokens.refresh_token &&
                Number.isFinite(tokens.expires_in) &&
                tokens.expires_in > 0 &&
                tokens.scope?.split(" ").includes("media:read")
            )
        ) {
            throw error("Simkl returned an incomplete sign-in response.", 502);
        }
        const profile = await request("/users/settings", {
            client: pending.client,
            token: tokens.access_token,
        });
        const externalId =
            Number.isSafeInteger(profile?.account?.id) && profile.account.id > 0
                ? String(profile.account.id)
                : null;
        if (typeof externalId !== "string" || !externalId) {
            throw error("Could not identify the Simkl account.", 502);
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
                "This Simkl account is already linked to another profile in your household. Use a separate Simkl account to keep viewing separate.",
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
                username: profile.user?.name || externalId,
            },
            where: where(person),
        });
        clear(person);
        return status(prisma, person);
    }
    function clear(person) {
        epochs.set(key(person), (epochs.get(key(person)) || 0) + 1);
    }
    async function disconnect(prisma, person) {
        requireNuvio(person);
        const row = await prisma.trackingConnection.findUnique({ where: where(person) });
        if (row?.credentials) {
            const credentials = JSON.parse(decrypt(row.credentials, context(person)));
            await request("/oauth2/revoke", {
                body: {
                    client_id: credentials.client,
                    token: credentials.refreshToken,
                    token_type_hint: "refresh_token",
                },
                method: "POST",
            });
        }
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
                    const tokens = await request("/oauth2/token", {
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
                            Number.isFinite(tokens.expires_in) &&
                            tokens.expires_in > 0
                        )
                    ) {
                        throw error("Reconnect your Simkl account.", 401);
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
    async function withAccess(prisma, person, load) {
        requireNuvio(person);
        const epoch = epochs.get(key(person)) || 0;
        const linked = await access(prisma, person);
        if (!linked) {
            throw error("Connect Simkl before using it as a source.", 409);
        }
        const { credentials, row } = linked;
        const data = await load(
            (path) => {
                if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
                    throw error("Invalid Simkl resource.");
                }
                return request(path, {
                    client: credentials.client,
                    token: credentials.accessToken,
                });
            },
            row.externalUserId,
            row.connectedAt
        );
        if ((epochs.get(key(person)) || 0) !== epoch) {
            throw error("The tracking connection changed. Refresh the page.", 409);
        }
        return data;
    }
    return { begin, complete, disconnect, status, withAccess };
}
module.exports = { ...createSimklTracking(), createSimklTracking };
