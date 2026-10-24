const { createDefaultAvatar } = require("../utils/defaultAvatar");
const express = require("express");
const { publicMessage } = require("../utils/publicError");
const { StremioAPIStore, StremioAPIClient: _StremioAPIClient } = require("stremio-api-client");
const {
    handleStremioError,
    handleDatabaseError: _handleDatabaseError,
    StremioAPIUtils,
} = require("../utils/handlers");
const { validateStremioAuthKey } = require("../utils/stremio");
const { validateStremioCredentials, sanitizeUrl: _sanitizeUrl } = require("../utils/helpers");

module.exports = ({ prisma, getAccountId, encrypt, decrypt, assignUserToGroup, INSTANCE_TYPE }) => {
    const router = express.Router();

    // A name nobody in this account has yet: the one asked for, else the
    // account's own, with a number on the end when someone already has it.
    const freeUsername = async (accountId, wanted) => {
        const base =
            String(wanted || "").trim() || `user_${Math.random().toString(36).slice(2, 8)}`;
        let name = base;
        for (
            let n = 1;
            await prisma.user.findFirst({
                select: { id: true },
                where: { accountId, username: name },
            });
            n++
        ) {
            if (n > 100) {
                throw Object.assign(new Error("Could not pick a free name - type one in"), {
                    status: 409,
                });
            }
            name = `${base}${n}`;
        }
        return name;
    };

    // Validate Stremio credentials
    router.post("/validate", async (req, res) => {
        try {
            const { email, password } = req.body;

            // Use centralized validation
            const validation = validateStremioCredentials(email, password);
            if (!validation.isValid) {
                return res.status(400).json({
                    error: validation.errors.join(", "),
                    valid: false,
                });
            }

            // Use centralized Stremio API store creation
            const { store: apiStore, tempStorage } = StremioAPIUtils.createAPIStore();

            // Try to authenticate with Stremio
            let authResult;
            let _lastErr;
            for (const attempt of [
                () => apiStore.login({ email, password }),
                () => apiStore.login(email, password),
            ]) {
                try {
                    authResult = await attempt();
                    _lastErr = null;
                    break;
                } catch (e) {
                    _lastErr = e;
                }
            }

            if (authResult && (apiStore.authKey || tempStorage.auth)) {
                res.json({ valid: true });
            } else {
                res.json({ error: "Invalid Stremio credentials", valid: false });
            }
        } catch (error) {
            console.error("Stremio validation error:", error);

            // Check for specific error types
            const msg = String(error?.message || "").toLowerCase();
            if (msg.includes("passphrase") || msg.includes("wrong password")) {
                res.json({ error: "Invalid password", valid: false });
            } else if (
                msg.includes("no such user") ||
                msg.includes("user not found") ||
                msg.includes("invalid email")
            ) {
                res.json({ error: "Invalid email", valid: false });
            } else if (error.message?.includes("network")) {
                res.json({ error: "Network error - please try again", valid: false });
            } else {
                res.json({ error: "Failed to validate credentials", valid: false });
            }
        }
    });

    // Register a new Stremio account
    router.post("/register", async (req, res) => {
        try {
            const { email, password, username, groupName, colorIndex } = req.body;
            if (!(email && password)) {
                return res
                    .status(400)
                    .json({ message: email ? "Password is required" : "Invalid email" });
            }
            if (typeof password !== "string" || password.length < 4) {
                return res.status(400).json({ message: "Password must be at least 4 characters" });
            }

            // Temporary storage for StremioAPIStore
            const tempStorage = {};
            const apiStore = new StremioAPIStore({
                endpoint: "https://api.strem.io",
                storage: {
                    getJSON: (key) => tempStorage[key] || null,
                    setJSON: (key, value) => {
                        tempStorage[key] = value;
                    },
                },
            });

            // Perform registration
            // Support both possible signatures just in case
            let lastErr;
            for (const attempt of [
                () => apiStore.register({ email, password }),
                () => apiStore.register(email, password),
            ]) {
                try {
                    await attempt();
                    lastErr = null;
                    break;
                } catch (e) {
                    lastErr = e;
                }
            }
            if (lastErr) {
                throw lastErr;
            }

            // Optional: immediately login to retrieve authKey (useful for client flows)
            try {
                for (const attempt of [
                    () => apiStore.login({ email, password }),
                    () => apiStore.login(email, password),
                ]) {
                    try {
                        await attempt();
                        break;
                    } catch {
                        // Try the next supported connection method before reporting failure.
                    }
                }
            } catch {
                // Try the next supported connection method before reporting failure.
            }

            const authKey = apiStore.authKey || tempStorage.auth || tempStorage.authKey || null;

            // If authenticated to SlickSync (public-auth), persist user like connect does
            try {
                const accId = getAccountId(req);
                if (authKey && accId) {
                    // Ensure email uniqueness across all accounts
                    const { ensureEmailUniqueness } = require("../utils/helpers/database");
                    await ensureEmailUniqueness(prisma, email, accId);

                    // Encrypt
                    const encryptedAuthKey = encrypt(authKey, req);
                    const finalUsername = await freeUsername(
                        accId,
                        (username && String(username).trim()) || email.split("@")[0]
                    );
                    // Create user in current account
                    const newUser = await prisma.user.create({
                        data: {
                            accountId: accId,
                            avatarUrl: createDefaultAvatar(),
                            colorIndex: typeof colorIndex === "number" ? colorIndex : 0,
                            email,
                            isActive: true,
                            stremioAuthKey: encryptedAuthKey,
                            username: finalUsername,
                        },
                    });
                    // Assign to group if provided
                    if (groupName && String(groupName).trim()) {
                        try {
                            let group = await prisma.group.findFirst({
                                where: { accountId: accId, name: String(groupName).trim() },
                            });
                            if (!group) {
                                group = await prisma.group.create({
                                    data: { accountId: accId, name: String(groupName).trim() },
                                });
                            }
                            await assignUserToGroup(prisma, newUser.id, group.id, req);
                        } catch {
                            // Unavailable optional records leave the current result in place.
                        }
                    }
                    try {
                        const { emitAutomationEvent } = require("../utils/automation/engine");
                        await emitAutomationEvent(prisma, accId, "user.created", {
                            email: newUser.email,
                            providerType: newUser.providerType,
                            userId: newUser.id,
                            username: newUser.username,
                        });
                    } catch {
                        // Unavailable optional records leave the current result in place.
                    }
                    return res.status(201).json({
                        authKey,
                        message: "Stremio account registered and user created",
                        user: { id: newUser.id, username: newUser.username },
                    });
                }
            } catch {
                // Unavailable optional records leave the current result in place.
            }

            // Fallback: no SlickSync session, return authKey only
            return res.json({ authKey, message: "Stremio account registered successfully" });
        } catch (e) {
            console.error("stremio/register failed:", e);

            // Handle specific Stremio API errors
            if (e?.response?.data?.code === 26) {
                return res.status(400).json({
                    error: "Please enter a valid email address",
                    message: "Invalid email address",
                });
            }

            if (e?.response?.data?.code === 27) {
                return res.status(400).json({
                    error: "This email is already registered with Stremio",
                    message: "Email already exists",
                });
            }

            if (e?.response?.data?.code === 28) {
                return res.status(400).json({
                    error: "Password must be at least 6 characters long",
                    message: "Password too weak",
                });
            }

            // Handle other Stremio API errors
            if (e?.response?.data?.message) {
                return res.status(400).json({
                    error: "Stremio registration failed",
                    message: e.response.data.message,
                });
            }

            const msg =
                typeof e?.message === "string" ? e.message : "Failed to register Stremio account";
            return res.status(500).json({ message: msg });
        }
    });

    // Connect with email/password
    router.post("/connect", async (req, res) => {
        try {
            const { email, password, username, groupName } = req.body;
            console.log("🔍 POST /api/stremio/connect", {
                hasEmail: !!email,
                hasGroup: !!groupName,
                hasUsername: !!username,
            });
            // Redact any sensitive fields from logs
            try {
                const { password: _pw, authKey: _ak, ...rest } = req.body || {};
                console.log("🔍 Request fields (redacted):", rest);
            } catch {
                // Diagnostic logging must not interrupt the operation it describes.
            }

            if (!(email && password)) {
                return res
                    .status(400)
                    .json({ message: email ? "Password is required" : "Invalid email" });
            }
            if (typeof password !== "string" || password.length < 4) {
                return res.status(400).json({ message: "Password must be at least 4 characters" });
            }

            const accountId = getAccountId(req);
            if (!accountId) {
                return res.status(401).json({ message: "Authentication required" });
            }

            // Ensure email uniqueness across all accounts
            const { ensureEmailUniqueness } = require("../utils/helpers/database");
            await ensureEmailUniqueness(prisma, email, accountId);

            // Check if this Stremio account is already someone here. Scoped to the
            // provider type (a Stremio user and a Nuvio user are allowed to share an
            // email — see the composite email+providerType uniqueness constraint).
            // Only the email says it is the same account: a name match is a
            // different person, and matching on it once handed that person's entry
            // (even a Nuvio or Jellyfin one) to this sign-in. Names just get a
            // number on the end instead.
            let existingUser = null;
            try {
                existingUser = await prisma.user.findFirst({
                    where: { accountId, email, providerType: "stremio" },
                });
            } catch {
                // Gracefully handle missing appAccountId
                return res.status(401).json({ message: "Authentication required" });
            }

            // Check if user has a valid Stremio connection
            let hasValidStremioConnection = false;
            if (existingUser?.stremioAuthKey) {
                try {
                    const decryptedKey = decrypt(existingUser.stremioAuthKey, req);
                    const validation = await validateStremioAuthKey(decryptedKey);
                    hasValidStremioConnection = !!validation?.user;
                } catch {
                    // Invalid auth key - allow reconnection
                    hasValidStremioConnection = false;
                }
            }

            if (existingUser) {
                // If user exists with valid Stremio connection, return conflict
                if (hasValidStremioConnection) {
                    if (
                        INSTANCE_TYPE === "public" &&
                        req.appAccountId &&
                        existingUser.accountId === req.appAccountId
                    ) {
                        return res.status(409).json({
                            error: "Email already exists in this account",
                            message: "User with this email already exists",
                        });
                    }

                    if (existingUser.email === email) {
                        return res.status(409).json({
                            error: "Email already exists in this account",
                            message: "User with this email already exists",
                        });
                    }

                    return res.status(409).json({ message: "User already exists" });
                }

                // User exists but has invalid/no Stremio connection - allow reconnection
                // We'll update the existing user instead of creating a new one
                console.log(
                    `🔄 User exists with invalid Stremio connection, allowing reconnection: ${existingUser.id}`
                );
            }

            // Someone reconnected keeps their name; someone new gets the one typed
            // in, else the start of their email.
            const finalUsername = existingUser
                ? existingUser.username
                : await freeUsername(
                      accountId,
                      (username && String(username).trim()) || email.split("@")[0]
                  );

            // Create a temporary storage object for this authentication session
            const tempStorage = {};

            // Create Stremio API store for this user
            const apiStore = new StremioAPIStore({
                endpoint: "https://api.strem.io",
                storage: {
                    getJSON: (key) => {
                        // Return stored values or appropriate defaults
                        if (tempStorage[key] !== undefined) {
                            return tempStorage[key];
                        }
                        switch (key) {
                            case "addons":
                                return [];
                            case "user":
                                return null;
                            case "auth":
                                return null;
                            default:
                                return null;
                        }
                    },
                    setJSON: (key, value) => {
                        // Store in temporary storage during authentication
                        tempStorage[key] = value;
                        console.log(`Stremio storage set: ${key}`, typeof value);
                    },
                },
            });

            // Authenticate with Stremio using email/password only (try both supported signatures)
            const loginEmailOnly = async () => {
                let lastErr;
                for (const attempt of [
                    () => apiStore.login({ email, password }),
                    () => apiStore.login(email, password),
                ]) {
                    try {
                        await attempt();
                        return;
                    } catch (e) {
                        lastErr = e;
                    }
                }
                throw lastErr;
            };

            try {
                await loginEmailOnly();
            } catch (e) {
                console.error("Stremio connection error:", e);
                // Auto-register if the user is not found and client didn't explicitly disable it
                const code = e?.response?.data?.code || e?.code;
                const registerIfMissing = req.body?.registerIfMissing !== false;
                if (code === 2 && registerIfMissing) {
                    try {
                        // Try to register then login again
                        for (const attempt of [
                            () => apiStore.register({ email, password }),
                            () => apiStore.register(email, password),
                        ]) {
                            try {
                                await attempt();
                                break;
                            } catch {
                                // Try the next supported connection method before reporting failure.
                            }
                        }
                        await loginEmailOnly();
                    } catch {
                        return res.status(401).json({
                            error: "No Stremio account found with this email. Registration attempt failed.",
                            message: "User not found",
                        });
                    }
                } else {
                    // Handle specific Stremio API errors
                    if (code === 2) {
                        return res.status(401).json({
                            error: "No Stremio account found with this email. Please register first or check your credentials.",
                            message: "User not found",
                        });
                    }
                    if (code === 3 || e?.wrongPass) {
                        return res.status(401).json({
                            error: "Incorrect password for this Stremio account.",
                            message: "Invalid password",
                        });
                    }
                    if (code === 26) {
                        return res.status(400).json({
                            error: "Please enter a valid email address",
                            message: "Invalid email address",
                        });
                    }
                    if (e?.response?.data?.message) {
                        return res.status(400).json({
                            error: "Stremio authentication failed",
                            message: e.response.data.message,
                        });
                    }
                    return res.status(401).json({ message: "Invalid Stremio credentials" });
                }
            }

            // Pull user's addon collection from Stremio
            await apiStore.pullAddonCollection();

            // Get authentication data from the API store (support both possible keys)
            const authKey = apiStore.authKey || tempStorage.auth || tempStorage.authKey;
            const userData = apiStore.user || tempStorage.user;
            const rawAddonsData = apiStore.addons || tempStorage.addons || {};

            // Serialize addons data to remove functions and keep only serializable data
            const addonsData = JSON.parse(JSON.stringify(rawAddonsData));

            // Verify we have the required authentication data
            if (!(authKey && userData)) {
                console.log("Auth debug - authKey:", !!authKey, "userData:", !!userData);
                console.log("tempStorage keys:", Object.keys(tempStorage));
                return res.status(502).json({
                    error: "Authenticated but missing user data",
                    message: "Failed to connect to Stremio",
                });
            }

            // Encrypt the auth key for secure storage
            const encryptedAuthKey = encrypt(authKey, req);

            // Create or update user in database
            let newUser;
            let wasNewUser = false;
            if (existingUser && !hasValidStremioConnection) {
                // Update existing user with new Stremio connection
                newUser = await prisma.user.update({
                    data: {
                        colorIndex: req.body.colorIndex || existingUser.colorIndex || 0,
                        email,
                        isActive: true,
                        stremioAuthKey: encryptedAuthKey,
                        username: finalUsername,
                    },
                    where: { id: existingUser.id },
                });
                console.log(`✅ Updated existing user with new Stremio connection: ${newUser.id}`);
            } else {
                // Create new user
                newUser = await prisma.user.create({
                    data: {
                        // Scope to current AppAccount when auth is enabled
                        accountId: getAccountId(req),
                        avatarUrl: createDefaultAvatar(),
                        colorIndex: req.body.colorIndex || 0,
                        email,
                        isActive: true,
                        stremioAuthKey: encryptedAuthKey,
                        username: finalUsername,
                    },
                });
                wasNewUser = true;
                console.log(`✅ Created new user: ${newUser.id}`);
            }

            // Handle group assignment if provided
            let assignedGroup = null;
            console.log(
                `🔍 Group assignment - groupName: "${groupName}", type: ${typeof groupName}`
            );
            if (groupName?.trim()) {
                try {
                    console.log(`🔍 Assigning user to group: "${groupName}"`);
                    // Find or create group
                    assignedGroup = await prisma.group.findFirst({
                        where: {
                            accountId: getAccountId(req),
                            name: groupName.trim(),
                        },
                    });

                    if (!assignedGroup) {
                        assignedGroup = await prisma.group.create({
                            data: {
                                accountId: getAccountId(req),
                                description: `Group created for ${finalUsername}`,
                                name: groupName.trim(),
                            },
                        });
                    }
                    console.log("🔍 Group found/created:", assignedGroup);

                    // Assign user to group (persist in group's userIds JSON)
                    await assignUserToGroup(prisma, newUser.id, assignedGroup.id, req);
                    console.log("🔍 User added to group successfully");
                } catch (groupError) {
                    console.error("❌ Failed to assign user to group:", groupError);
                    // Don't fail the entire user creation if group assignment fails
                    console.log("⚠️ Continuing with user creation despite group assignment failure");
                }
            } else {
                console.log("🔍 No group assignment - groupName is empty or undefined");
            }

            if (wasNewUser) {
                try {
                    const { emitAutomationEvent } = require("../utils/automation/engine");
                    await emitAutomationEvent(prisma, getAccountId(req), "user.created", {
                        email: newUser.email,
                        providerType: newUser.providerType,
                        userId: newUser.id,
                        username: newUser.username,
                    });
                } catch {
                    // Unavailable optional records leave the current result in place.
                }
            }

            res.status(201).json({
                addonsCount: Object.keys(addonsData).length,
                group: assignedGroup
                    ? {
                          id: assignedGroup.id,
                          name: assignedGroup.name,
                      }
                    : null,
                message: "Successfully connected to Stremio",
                user: {
                    id: newUser.id,
                    username: newUser.username,
                },
            });
        } catch (error) {
            // Use centralized error handling
            return handleStremioError(error, res);
        }
    });

    // Connect using existing Stremio authKey (create new SlickSync user)
    router.post("/connect-authkey", async (req, res) => {
        try {
            const { username, email, authKey, groupName, colorIndex, create } = req.body;
            if (!authKey) {
                return res.status(400).json({ message: "authKey is required" });
            }

            // Use shared helper to get user info
            const { getStremioUserInfo } = require("./invitations");
            let userInfo;
            try {
                userInfo = await getStremioUserInfo(authKey, username, email);
            } catch (e) {
                if (e.message === "Invalid or expired Stremio auth key") {
                    return res
                        .status(401)
                        .json({ message: publicMessage(e, "Something went wrong") });
                }
                return res
                    .status(400)
                    .json({ message: publicMessage(e, "Could not validate auth key") });
            }

            // Get addons data if needed (for create flow)
            let _addonsData = {};
            if (create) {
                try {
                    const validation = await validateStremioAuthKey(authKey);
                    _addonsData = validation?.addons || {};
                } catch {
                    // Ignore addons fetch errors, we already have user info
                }
            }

            if (!create) {
                return res.json({
                    authKey,
                    message: "Stremio account verified",
                    user: userInfo,
                });
            }

            // When create flag is true, persist the user
            const accountId = getAccountId(req);
            const normalizedEmail = userInfo.email;

            // For invite-based creation, check if a STREMIO user with this email already
            // exists first. Scoped by providerType so the same email can exist as both
            // a Stremio user and a Nuvio user (this previously checked ANY provider,
            // which incorrectly blocked creating a Stremio account whenever a Nuvio
            // account already used that email, and vice versa).
            if (normalizedEmail) {
                const existingUserByEmail = await prisma.user.findFirst({
                    where: {
                        accountId,
                        email: normalizedEmail,
                        providerType: "stremio",
                    },
                });
                if (existingUserByEmail) {
                    return res.status(409).json({ message: "User already exists" });
                }
            }

            const finalUsername = await freeUsername(accountId, userInfo.username);

            const encryptedAuthKey = encrypt(authKey, req);

            // Ensure email uniqueness across all accounts (if email provided)
            if (normalizedEmail) {
                const { ensureEmailUniqueness } = require("../utils/helpers/database");
                await ensureEmailUniqueness(prisma, normalizedEmail, accountId);
            }

            // Check if user exists by username (shouldn't happen after uniqueness check, but just in case)
            let targetUser = await prisma.user.findFirst({
                where: {
                    accountId,
                    username: finalUsername,
                },
            });

            const resolvedColorIndex = Number.isFinite(Number(colorIndex)) ? Number(colorIndex) : 0;

            if (targetUser) {
                // This shouldn't happen after email check and username uniqueness, but handle it
                return res.status(409).json({ message: "User already exists" });
            }
            targetUser = await prisma.user.create({
                data: {
                    accountId,
                    avatarUrl: createDefaultAvatar(),
                    colorIndex: resolvedColorIndex,
                    email: normalizedEmail || `${Date.now()}@example.invalid`,
                    isActive: true,
                    stremioAuthKey: encryptedAuthKey,
                    username: finalUsername,
                },
            });

            let groupAssignmentError = null;
            if (groupName && String(groupName).trim()) {
                try {
                    const trimmed = String(groupName).trim();
                    let group = await prisma.group.findFirst({
                        where: { accountId, name: trimmed },
                    });
                    if (!group) {
                        group = await prisma.group.create({ data: { accountId, name: trimmed } });
                    }
                    await assignUserToGroup(prisma, targetUser.id, group.id, req);
                } catch (groupErr) {
                    console.error("Failed to assign user to group after OAuth creation:", groupErr);
                    groupAssignmentError = groupErr?.message || "Failed to assign to group";
                    // Continue - user was created successfully, group assignment is optional
                }
            }

            try {
                const { emitAutomationEvent } = require("../utils/automation/engine");
                await emitAutomationEvent(prisma, accountId, "user.created", {
                    email: targetUser.email,
                    providerType: targetUser.providerType,
                    userId: targetUser.id,
                    username: targetUser.username,
                });
            } catch {
                // Unavailable optional records leave the current result in place.
            }

            // User was created successfully, return success even if group assignment failed
            return res.status(201).json({
                message: "Successfully connected to Stremio",
                user: {
                    email: targetUser.email,
                    id: targetUser.id,
                    username: targetUser.username,
                },
                ...(groupAssignmentError
                    ? {
                          warning: `User created but group assignment failed: ${groupAssignmentError}`,
                      }
                    : {}),
            });
        } catch (e) {
            console.error("connect-authkey failed:", e);
            const errorMessage = e?.message || "Failed to connect with authKey";
            // If user was created but something else failed, provide more context
            if (errorMessage.includes("user") && errorMessage.includes("created")) {
                return res.status(201).json({
                    message: "User created successfully",
                    warning: errorMessage,
                });
            }
            return res.status(500).json({ message: errorMessage });
        }
    });

    return router;
};
