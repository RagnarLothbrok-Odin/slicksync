/**
 * Nuvio authentication — Supabase email/password login and JWT refresh.
 * Module-level functions, not on the provider instance.
 * Used at connection time (invitations, user login), not during sync.
 */

const { resolveConfig, backendFetch } = require("./supabase");

// Every exported function below takes an optional serverConfig so an
// account can point Nuvio at its own backend. resolveConfig() falls back to
// the env vars and then the public defaults, so omitting it behaves exactly
// as before - which is why these stayed optional trailing parameters rather
// than a required first argument.

async function validateNuvioCredentials(email, password, serverConfig) {
    const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = resolveConfig(serverConfig);
    const url = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
    const res = await backendFetch(
        url,
        {
            body: JSON.stringify({ email, password }),
            headers: {
                apikey: SUPABASE_ANON_KEY,
                "content-type": "application/json",
            },
            method: "POST",
        },
        serverConfig
    );

    if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        let detail = bodyText;
        try {
            detail =
                JSON.parse(bodyText)?.error_description || JSON.parse(bodyText)?.msg || bodyText;
        } catch {
            // Malformed optional data leaves the existing fallback in place.
        }
        console.error(`Nuvio auth failed (${res.status}): ${detail}`);
        const err = new Error(detail || "Authentication failed");
        err.status = res.status;
        throw err;
    }

    const data = await res.json();
    return {
        tokens: {
            refreshToken: data.refresh_token,
        },
        user: {
            email: data.user?.email,
            id: data.user?.id,
        },
    };
}

async function refreshNuvioToken(refreshToken, serverConfig) {
    const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = resolveConfig(serverConfig);
    const url = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
    const res = await backendFetch(
        url,
        {
            body: JSON.stringify({ refresh_token: refreshToken }),
            headers: {
                apikey: SUPABASE_ANON_KEY,
                "content-type": "application/json",
            },
            method: "POST",
        },
        serverConfig
    );

    if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        let detail = bodyText;
        try {
            detail =
                JSON.parse(bodyText)?.error_description || JSON.parse(bodyText)?.msg || bodyText;
        } catch {
            // Malformed optional data leaves the existing fallback in place.
        }
        console.error(`Nuvio token refresh failed (${res.status}): ${detail}`);
        const err = new Error(detail || "Token refresh failed");
        err.status = res.status;
        throw err;
    }

    const data = await res.json();
    return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
    };
}

function isTokenExpired(jwt) {
    if (!jwt) {
        return true;
    }
    try {
        const parts = jwt.split(".");
        if (parts.length !== 3) {
            return true;
        }
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
        if (!payload.exp) {
            return true;
        }
        // Expire 60 seconds early to avoid race conditions
        return payload.exp - 60 < Date.now() / 1000;
    } catch {
        return true;
    }
}

// --- TV Login (Device Authorization) Flow ---

const crypto = require("node:crypto");

function parseJwtPayload(jwt) {
    try {
        const parts = jwt.split(".");
        if (parts.length !== 3) {
            return null;
        }
        return JSON.parse(Buffer.from(parts[1], "base64").toString());
    } catch {
        return null;
    }
}

async function startNuvioTvLogin(serverConfig) {
    const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = resolveConfig(serverConfig);
    // Step 0: Create anonymous Supabase session
    const signupRes = await backendFetch(
        `${SUPABASE_URL}/auth/v1/signup`,
        {
            body: JSON.stringify({ data: { tv_client: "slicksync" } }),
            headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
            method: "POST",
        },
        serverConfig
    );
    if (!signupRes.ok) {
        const bodyText = await signupRes.text().catch(() => "");
        console.error(`Nuvio anonymous signup failed (${signupRes.status}): ${bodyText}`);
        throw new Error("Failed to start Nuvio login session");
    }
    const signupData = await signupRes.json();
    const anonToken = signupData.access_token;

    // Step 1: Start TV login session
    const deviceNonce = crypto.randomUUID();
    const startRes = await backendFetch(
        `${SUPABASE_URL}/rest/v1/rpc/start_tv_login_session`,
        {
            body: JSON.stringify({
                p_device_name: "SlickSync",
                p_device_nonce: deviceNonce,
                p_redirect_base_url: "https://nuvio.tv/tv-login",
            }),
            headers: {
                apikey: SUPABASE_ANON_KEY,
                authorization: `Bearer ${anonToken}`,
                "content-type": "application/json",
            },
            method: "POST",
        },
        serverConfig
    );
    if (!startRes.ok) {
        const bodyText = await startRes.text().catch(() => "");
        console.error(`Nuvio TV login start failed (${startRes.status}): ${bodyText}`);
        throw new Error("Failed to start Nuvio login session");
    }
    const startData = await startRes.json();
    const session = Array.isArray(startData) ? startData[0] : startData;

    return {
        anonToken,
        code: session.code,
        deviceNonce,
        expiresAt: session.expires_at,
        pollIntervalSeconds: session.poll_interval_seconds || 3,
        webUrl: session.web_url,
    };
}

async function pollNuvioTvLogin(code, deviceNonce, anonToken, serverConfig) {
    const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = resolveConfig(serverConfig);
    const res = await backendFetch(
        `${SUPABASE_URL}/rest/v1/rpc/poll_tv_login_session`,
        {
            body: JSON.stringify({ p_code: code, p_device_nonce: deviceNonce }),
            headers: {
                apikey: SUPABASE_ANON_KEY,
                authorization: `Bearer ${anonToken}`,
                "content-type": "application/json",
            },
            method: "POST",
        },
        serverConfig
    );
    if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        console.error(`Nuvio TV login poll failed (${res.status}): ${bodyText}`);
        throw new Error("Failed to poll Nuvio login session");
    }
    const data = await res.json();
    const result = Array.isArray(data) ? data[0] : data;
    return {
        expiresAt: result.expires_at,
        pollIntervalSeconds: result.poll_interval_seconds || 3,
        status: result.status,
    };
}

async function exchangeNuvioTvLogin(code, deviceNonce, anonToken, serverConfig) {
    const { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY } = resolveConfig(serverConfig);
    const res = await backendFetch(
        `${SUPABASE_URL}/functions/v1/tv-logins-exchange`,
        {
            body: JSON.stringify({ code, device_nonce: deviceNonce }),
            headers: {
                apikey: SUPABASE_ANON_KEY,
                authorization: `Bearer ${anonToken}`,
                "content-type": "application/json",
            },
            method: "POST",
        },
        serverConfig
    );
    if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        console.error(`Nuvio TV login exchange failed (${res.status}): ${bodyText}`);
        throw new Error("Failed to complete Nuvio login");
    }
    const data = await res.json();
    const payload = parseJwtPayload(data.access_token);
    return {
        accessToken: data.access_token,
        expiresIn: data.expires_in,
        refreshToken: data.refresh_token,
        user: {
            email: payload?.email || null,
            id: payload?.sub || null,
        },
    };
}

module.exports = {
    exchangeNuvioTvLogin,
    isTokenExpired,
    parseJwtPayload,
    pollNuvioTvLogin,
    refreshNuvioToken,
    startNuvioTvLogin,
    validateNuvioCredentials,
};
