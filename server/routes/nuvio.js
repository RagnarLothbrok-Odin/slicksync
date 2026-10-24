const { createDefaultAvatar } = require("../utils/defaultAvatar");
const express = require("express");
const { publicMessage } = require("../utils/publicError");
const {
    validateNuvioCredentials,
    refreshNuvioToken,
    parseJwtPayload,
    startNuvioTvLogin,
    pollNuvioTvLogin,
    exchangeNuvioTvLogin,
} = require("../providers/nuvioAuth");
const { createNuvioProvider } = require("../providers/nuvio");
const { resolveServerConfigForAccount } = require("../providers/supabase");

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Verify that a refresh token's JWT sub claim matches the claimed nuvioUserId.
 * Returns the refresh result (with new tokens) on success, throws on mismatch.
 */
async function verifyNuvioIdentity(claimedUserId, refreshTokenValue) {
    if (!refreshTokenValue) {
        const err = new Error("Refresh token is required for OAuth authentication");
        err.status = 400;
        throw err;
    }
    const result = await refreshNuvioToken(refreshTokenValue);
    const payload = parseJwtPayload(result.access_token);
    if (!payload || payload.sub !== claimedUserId) {
        const err = new Error("Token does not match the claimed user identity");
        err.status = 403;
        throw err;
    }
    return result;
}

// In-memory cap on pending OAuth sessions per IP to prevent anonymous Supabase user spam
const pendingOAuthSessions = new Map();
const OAUTH_SESSION_CAP = 3;
const OAUTH_SESSION_TTL_MS = 5 * 60 * 1000;

module.exports = ({ prisma, getAccountId, encrypt, decrypt }) => {
    const router = express.Router();

    // "Sign in a Nuvio TV": the TV (or computer) shows a code; typed into the
    // person page, SlickSync looks it up with that person's Nuvio sign-in so
    // the right device can be confirmed, then approves it. The device lands in
    // their Nuvio account and asks which profile - the same as approving it
    // from Nuvio's own website.
    const deviceCode = (raw) =>
        String(raw || "")
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");
    const nuvioPerson = async (req) => {
        const user = await prisma.user.findFirst({
            where: {
                accountId: getAccountId(req),
                id: String(req.params.id),
                providerType: "nuvio",
            },
        });
        if (!user) {
            const err = new Error("Person not found");
            err.status = 404;
            throw err;
        }
        const { makeCreateProvider } = require("../providers");
        return makeCreateProvider({ encrypt, getAccountId, prisma })(user, { decrypt, req });
    };
    const deviceAnswer = (row) => ({
        deviceName: row?.device_name || null,
        deviceType: row?.device_type || null,
        expiresAt: row?.expires_at || null,
    });
    const sendDeviceError = (res, error, fallback) => {
        const status = error?.status && error.status < 500 ? error.status : 502;
        res.status(status).json({
            error: status === 404 ? "Person not found" : publicMessage(error, fallback),
        });
    };

    router.post("/users/:id/device-login/lookup", async (req, res) => {
        try {
            const code = deviceCode(req.body?.code);
            if (code.length !== 6) {
                return res.status(400).json({ error: "Type the 6-character code the TV shows" });
            }
            const row = await (await nuvioPerson(req)).getDeviceLogin(code);
            if (!row?.success) {
                return res.status(400).json({
                    error: "That code didn't work - it lasts 5 minutes, so check the TV and try again",
                });
            }
            res.json({ success: true, ...deviceAnswer(row) });
        } catch (error) {
            sendDeviceError(res, error, "Could not look that code up");
        }
    });

    router.post("/users/:id/device-login/approve", async (req, res) => {
        try {
            const code = deviceCode(req.body?.code);
            if (code.length !== 6) {
                return res.status(400).json({ error: "Type the 6-character code the TV shows" });
            }
            const row = await (await nuvioPerson(req)).approveDeviceLogin(code);
            if (!row?.success) {
                return res.status(400).json({
                    error: "That code didn't work - it lasts 5 minutes, so check the TV and try again",
                });
            }
            res.json({ success: true, ...deviceAnswer(row) });
        } catch (error) {
            sendDeviceError(res, error, "Could not sign the device in");
        }
    });

    // "Their servers in Nuvio" (utils/nuvioMediaServers.js).
    const mediaServerDeps = (req) => {
        const { makeCreateProvider } = require("../providers");
        return {
            createProvider: makeCreateProvider({ encrypt, getAccountId, prisma }),
            decrypt,
            req,
        };
    };
    const ownPerson = async (req) => {
        const person = await prisma.user.findFirst({
            select: { id: true },
            where: { accountId: getAccountId(req), id: String(req.params.id) },
        });
        if (!person) {
            const err = new Error("Person not found");
            err.status = 404;
            throw err;
        }
        return person.id;
    };

    router.get("/users/:id/media-servers", async (req, res) => {
        try {
            const id = await ownPerson(req);
            res.json(
                await require("../utils/nuvioMediaServers").describe(
                    prisma,
                    mediaServerDeps(req),
                    id
                )
            );
        } catch (error) {
            sendDeviceError(res, error, "Could not read their servers");
        }
    });

    router.put("/users/:id/media-servers", async (req, res) => {
        try {
            const id = await ownPerson(req);
            const mediaServers = require("../utils/nuvioMediaServers");
            await mediaServers.setEnabled(
                prisma,
                mediaServerDeps(req),
                id,
                req.body?.enabled === true
            );
            res.json(await mediaServers.describe(prisma, mediaServerDeps(req), id));
        } catch (error) {
            sendDeviceError(res, error, "Could not update their servers in Nuvio");
        }
    });

    // Validate Nuvio credentials
    router.post("/validate", async (req, res) => {
        try {
            const { email, password } = req.body;

            if (!(email && password)) {
                return res
                    .status(400)
                    .json({ error: "Email and password are required", valid: false });
            }

            const result = await validateNuvioCredentials(email, password);
            res.json({
                user: {
                    email: result.user.email,
                    id: result.user.id,
                },
                valid: true,
            });
        } catch (error) {
            const msg = String(error?.message || "").toLowerCase();
            if (
                msg.includes("invalid login") ||
                msg.includes("invalid email") ||
                msg.includes("wrong password")
            ) {
                res.json({ error: "Invalid email or password", valid: false });
            } else {
                console.error("Nuvio validation error:", error?.message);
                res.json({ error: "Failed to validate credentials", valid: false });
            }
        }
    });

    // Connect a user to Nuvio (store encrypted refresh token)
    router.post("/connect", async (req, res) => {
        try {
            const { userId, email, password, refreshToken: oauthRefreshToken } = req.body;
            const oauthNuvioUserId = req.body.providerUserId;

            if (!userId) {
                return res.status(400).json({ error: "userId is required" });
            }

            let nuvioUserId, nuvioEmail, refreshToken;

            if (oauthNuvioUserId && oauthRefreshToken) {
                // OAuth reconnection — verify token matches claimed identity
                if (!UUID_V4_RE.test(oauthNuvioUserId)) {
                    return res.status(400).json({ error: "Invalid user ID format" });
                }
                const verified = await verifyNuvioIdentity(oauthNuvioUserId, oauthRefreshToken);
                nuvioUserId = oauthNuvioUserId;
                nuvioEmail = email;
                refreshToken = verified.refresh_token || oauthRefreshToken;
            } else if (email && password) {
                // Credentials reconnection
                const result = await validateNuvioCredentials(email, password);
                nuvioUserId = result.user.id;
                nuvioEmail = result.user.email;
                refreshToken = result.tokens.refreshToken;
            } else {
                return res
                    .status(400)
                    .json({ error: "Either email+password or OAuth tokens are required" });
            }

            // Reconnecting someone already on Nuvio means the same Nuvio account:
            // signing in as a different one by mistake would quietly move their
            // tracking and addons onto someone else's.
            const existing = await prisma.user.findFirst({
                select: { nuvioUserId: true, providerType: true, username: true },
                where: { accountId: getAccountId(req), id: userId },
            });
            if (!existing) {
                return res.status(404).json({ error: "User not found" });
            }
            if (
                existing.providerType === "nuvio" &&
                existing.nuvioUserId &&
                existing.nuvioUserId !== nuvioUserId
            ) {
                return res.status(409).json({
                    error: `That's a different Nuvio account from the one ${existing.username || "this person"} uses - sign in with theirs`,
                });
            }

            const encryptedRefreshToken = encrypt(refreshToken, req);

            await prisma.user.update({
                data: {
                    email: nuvioEmail || email,
                    isActive: true,
                    nuvioRefreshToken: encryptedRefreshToken,
                    nuvioUserId,
                    // Signed in again: the "needs reconnecting" warning goes now,
                    // not at the next check.
                    providerConnectionError: null,
                    providerConnectionErrorAt: null,
                    providerType: "nuvio",
                    stremioAuthKey: null,
                },
                where: { accountId: getAccountId(req), id: userId },
            });

            res.json({
                success: true,
                user: {
                    email: nuvioEmail || email,
                    id: nuvioUserId,
                },
            });
        } catch (error) {
            console.error("Nuvio connect error:", error.message);
            if (error.status && error.status >= 400 && error.status < 500) {
                return res
                    .status(error.status)
                    .json({ error: publicMessage(error, "Something went wrong") });
            }
            res.status(500).json({ error: "Failed to connect to Nuvio" });
        }
    });

    // Connect via credentials or OAuth (validate + optionally create user)
    router.post("/connect-authkey", async (req, res) => {
        try {
            const {
                email,
                password,
                username,
                groupName,
                colorIndex,
                create,
                refreshToken: oauthRefreshToken,
            } = req.body;
            // Which of the account's profiles this user will manage. Nuvio numbers
            // them from 1, and 1 is the primary - the only one that existed here
            // before, so anything missing or unusable means the primary.
            const requestedProfile = Number(req.body.nuvioProfileId);
            const profileIndex =
                Number.isInteger(requestedProfile) && requestedProfile > 0 ? requestedProfile : 1;
            const oauthNuvioUserId = req.body.providerUserId;

            let nuvioUserId;
            let nuvioEmail;
            let refreshToken;

            if (oauthNuvioUserId && !password) {
                // OAuth path — verify token matches claimed identity
                if (!UUID_V4_RE.test(oauthNuvioUserId)) {
                    return res.status(400).json({ error: "Invalid user ID format" });
                }
                const verified = await verifyNuvioIdentity(oauthNuvioUserId, oauthRefreshToken);
                nuvioUserId = oauthNuvioUserId;
                nuvioEmail = email;
                refreshToken = verified.refresh_token || oauthRefreshToken;
            } else {
                // Credentials path — validate with Nuvio
                if (!(email && password)) {
                    return res.status(400).json({ error: "Email and password are required" });
                }
                const result = await validateNuvioCredentials(email, password);
                nuvioUserId = result.user.id;
                nuvioEmail = result.user.email;
                refreshToken = result.tokens.refreshToken;
            }

            if (!create) {
                return res.json({
                    providerType: "nuvio",
                    providerUserId: nuvioUserId,
                    success: true,
                    user: { email: nuvioEmail, id: nuvioUserId },
                });
            }

            // Create user in DB
            const accountId = getAccountId(req);
            const normalizedEmail = nuvioEmail?.toLowerCase?.() || email.toLowerCase();

            // Check if user already exists (scoped to provider type)
            // The same Nuvio account can be added once per profile, so identity is
            // the account plus the profile rather than the account alone.
            const existingUser = await prisma.user.findFirst({
                where: {
                    accountId,
                    email: normalizedEmail,
                    nuvioProfileId: profileIndex,
                    providerType: "nuvio",
                },
            });
            if (existingUser) {
                return res.status(409).json({
                    message:
                        profileIndex === 1
                            ? "User already exists"
                            : `That profile has already been added as ${existingUser.username}`,
                });
            }

            // A profile marked as using the primary's addons has no list of its own
            // to manage - whatever the primary syncs is what it shows. Adding it as
            // its own user would present a second addon list that silently does
            // nothing, so it is refused with an explanation instead.
            if (profileIndex !== 1) {
                let profiles = [];
                try {
                    const probe = createNuvioProvider({
                        profileId: profileIndex,
                        refreshToken,
                        resolveServerConfig: prisma
                            ? () => resolveServerConfigForAccount(prisma, accountId || "default")
                            : undefined,
                        userId: nuvioUserId,
                    });
                    profiles = await probe.getProfiles();
                } catch (e) {
                    return res.status(502).json({
                        error: `Could not read this account's profiles: ${publicMessage(e, "unknown error")}`,
                    });
                }
                const match = (profiles || []).find(
                    (pr) => Number(pr.profile_index ?? pr.profileIndex) === profileIndex
                );
                if (!match) {
                    return res
                        .status(400)
                        .json({ error: "That profile no longer exists on this Nuvio account" });
                }
                if (match.uses_primary_addons === true) {
                    return res.status(400).json({
                        error: `"${match.name || `Profile ${profileIndex}`}" is set to use the primary profile's addons, so it has no list of its own. Turn that off in Nuvio first, or manage it through the primary profile.`,
                    });
                }
            }

            // Determine username
            let finalUsername = username || normalizedEmail.split("@")[0];
            const baseUsername = finalUsername;
            let attempt = 0;
            while (await prisma.user.findFirst({ where: { accountId, username: finalUsername } })) {
                attempt++;
                if (attempt > 100) {
                    return res.status(409).json({
                        error: "Unable to generate unique username. Please specify a different username.",
                    });
                }
                finalUsername = `${baseUsername}${attempt}`;
            }

            // Encrypt refresh token (null for OAuth-only users until first provider use)
            const encryptedRefreshToken = refreshToken ? encrypt(refreshToken, req) : null;

            // Find or create group
            let groupId = null;
            if (groupName) {
                const group = await prisma.group.findFirst({
                    where: { accountId, name: groupName },
                });
                groupId = group?.id || null;
            }

            // Create user
            const newUser = await prisma.user.create({
                data: {
                    accountId,
                    avatarUrl: createDefaultAvatar(),
                    colorIndex: colorIndex || 0,
                    email: normalizedEmail,
                    isActive: true,
                    nuvioProfileId: profileIndex,
                    nuvioRefreshToken: encryptedRefreshToken,
                    nuvioUserId,
                    providerType: "nuvio",
                    username: finalUsername,
                },
            });

            // Add to group if specified - only a group of this household.
            if (groupId) {
                const members = require("../utils/helpers/database");
                await members.withMembershipLock(accountId, () =>
                    members.moveIntoGroup(prisma, accountId, newUser.id, groupId)
                );
            }

            res.json({
                nuvioProfileId: profileIndex,
                providerType: "nuvio",
                providerUserId: nuvioUserId,
                success: true,
                user: { email: normalizedEmail, id: newUser.id, username: finalUsername },
            });
        } catch (error) {
            console.error("Nuvio connect-authkey error:", error.message);
            if (error.status && error.status >= 400 && error.status < 500) {
                return res
                    .status(error.status)
                    .json({ error: publicMessage(error, "Something went wrong") });
            }
            res.status(500).json({ error: "Failed to validate Nuvio credentials" });
        }
    });

    // --- Nuvio OAuth (TV Login) Flow ---

    // Start a new Nuvio OAuth session
    router.post("/start-oauth", async (req, res) => {
        try {
            // Cap pending sessions per IP to prevent anonymous Supabase user spam
            const ip = req.ip;
            const currentSessions = pendingOAuthSessions.get(ip) || 0;
            if (currentSessions >= OAUTH_SESSION_CAP) {
                return res.status(429).json({
                    error: "Too many pending OAuth sessions. Please complete or wait for existing sessions to expire.",
                });
            }

            const result = await startNuvioTvLogin();
            pendingOAuthSessions.set(ip, currentSessions + 1);
            setTimeout(() => {
                const c = pendingOAuthSessions.get(ip) || 0;
                if (c <= 1) {
                    pendingOAuthSessions.delete(ip);
                } else {
                    pendingOAuthSessions.set(ip, c - 1);
                }
            }, OAUTH_SESSION_TTL_MS);
            res.json(result);
        } catch (error) {
            console.error("Nuvio start-oauth error:", error?.message);
            res.status(500).json({ error: "Failed to start Nuvio OAuth" });
        }
    });

    // Poll an existing Nuvio OAuth session
    router.post("/poll-oauth", async (req, res) => {
        try {
            const { code, deviceNonce, anonToken } = req.body;
            if (!(code && deviceNonce && anonToken)) {
                return res
                    .status(400)
                    .json({ error: "code, deviceNonce, and anonToken are required" });
            }
            const result = await pollNuvioTvLogin(code, deviceNonce, anonToken);
            res.json(result);
        } catch (error) {
            console.error("Nuvio poll-oauth error:", error?.message);
            res.status(500).json({ error: "Failed to poll Nuvio OAuth" });
        }
    });

    // Exchange approved OAuth session for tokens
    router.post("/exchange-oauth", async (req, res) => {
        try {
            const { code, deviceNonce, anonToken } = req.body;
            if (!(code && deviceNonce && anonToken)) {
                return res
                    .status(400)
                    .json({ error: "code, deviceNonce, and anonToken are required" });
            }
            const result = await exchangeNuvioTvLogin(code, deviceNonce, anonToken);
            // Release one pending session slot for this IP
            const ip = req.ip;
            const c = pendingOAuthSessions.get(ip) || 0;
            if (c <= 1) {
                pendingOAuthSessions.delete(ip);
            } else {
                pendingOAuthSessions.set(ip, c - 1);
            }
            res.json({
                refreshToken: result.refreshToken,
                success: true,
                user: result.user,
            });
        } catch (error) {
            console.error("Nuvio exchange-oauth error:", error?.message);
            res.status(500).json({ error: "Failed to exchange Nuvio OAuth" });
        }
    });

    return router;
};
