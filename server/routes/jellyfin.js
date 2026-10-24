const { createDefaultAvatar } = require("../utils/defaultAvatar");
const express = require("express");
const {
    signInFromBody,
    rememberSignIn,
    jellyfinFields,
    findJellyfinUser,
    mountSignInSteps,
    sendError,
} = require("../utils/jellyfinConnect");
const { serverKindLabel } = require("../providers/jellyfinAuth");
const household = require("../utils/jellyfinProfiles");

// Admin side of Jellyfin-compatible servers: Add User and reconnecting a
// person whose sign-in stopped working. See utils/jellyfinConnect.js for the
// sign-in itself, shared with the public sign-in pages and invitations.
module.exports = ({ prisma, getAccountId, encrypt, decrypt, assignUserToGroup }) => {
    const router = express.Router();

    // POST /probe, /quick-connect, /quick-connect-status
    mountSignInSteps(router);

    // Sign in and either add a new person or reconnect an existing one.
    router.post("/connect", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const { probe, login } = await signInFromBody(req.body);
            // Whoever already holds this login keeps working (see rememberSignIn),
            // whatever this request goes on to do with it.
            await rememberSignIn(prisma, encrypt, probe, login);
            if (!req.body?.quickConnectSecret && typeof req.body?.password === "string") {
                reqPassword.set(login, {
                    loginName: String(req.body.jellyfinUsername || ""),
                    password: req.body.password,
                });
            }
            const fields = jellyfinFields(probe, login, encrypt, req);
            const { identityEmail } = require("../providers/jellyfinAuth");
            const email = identityEmail(probe.serverUrl, login.userId);

            // Reconnect: the person keeps everything, only the sign-in changes.
            if (req.body?.userId) {
                const target = await prisma.user.findFirst({
                    where: { accountId, id: String(req.body.userId) },
                });
                if (!target) {
                    return res.status(404).json({ error: "User not found" });
                }
                const other = await findJellyfinUser(prisma, accountId, login, probe);
                if (other && other.id !== target.id) {
                    return res
                        .status(409)
                        .json({ error: `That server user is already added as ${other.username}` });
                }
                const updated = await prisma.user.update({
                    data: {
                        ...fields,
                        email,
                        isActive: true,
                        nuvioRefreshToken: null,
                        nuvioUserId: null,
                        providerConnectionError: null,
                        providerConnectionErrorAt: null,
                        stremioAuthKey: null,
                    },
                    where: { id: target.id },
                });
                const profiles = await bringHousehold(updated, probe, login);
                return res.json({
                    household: profiles,
                    providerType: "jellyfin",
                    success: true,
                    user: { email, id: target.id, username: target.username },
                });
            }

            const existing = await findJellyfinUser(prisma, accountId, login, probe);
            if (existing) {
                return res.status(409).json({
                    error: `${login.userName || "That user"} is already added as ${existing.username}`,
                });
            }

            const wanted =
                String(req.body?.username || login.userName || "jellyfin-user").trim() ||
                "jellyfin-user";
            let finalUsername = wanted;
            for (
                let attempt = 1;
                await prisma.user.findFirst({ where: { accountId, username: finalUsername } });
                attempt++
            ) {
                if (attempt > 100) {
                    return res.status(409).json({ error: "Pick a different name for this person" });
                }
                finalUsername = `${wanted}${attempt}`;
            }

            const created = await prisma.user.create({
                data: {
                    accountId,
                    avatarUrl: createDefaultAvatar(),
                    email,
                    username: finalUsername,
                    ...fields,
                    colorIndex: Number.isInteger(req.body?.colorIndex) ? req.body.colorIndex : 0,
                    isActive: true,
                },
            });

            const groupName = String(req.body?.groupName || "").trim();
            if (groupName && typeof assignUserToGroup === "function") {
                try {
                    let group = await prisma.group.findFirst({
                        where: { accountId, name: groupName },
                    });
                    if (!group) {
                        group = await prisma.group.create({
                            data: {
                                accountId,
                                description: `Group created for ${finalUsername}`,
                                name: groupName,
                            },
                        });
                    }
                    await assignUserToGroup(prisma, created.id, group.id, req);
                } catch (e) {
                    console.warn(
                        "[Jellyfin] Could not add the new person to their group:",
                        e?.message
                    );
                }
            }

            // Someone added on their own who was a profile of another person here
            // is read as themselves from now on, not twice.
            await claimProfileForPerson(created, probe, login);
            const profiles = await bringHousehold(created, probe, login);
            // Their picture on the server, and their household's, straight away.
            require("../utils/serverAvatars")
                .refreshAccount(prisma, decrypt, accountId)
                .catch(() => undefined);

            res.json({
                household: profiles,
                providerType: "jellyfin",
                server: {
                    kind: probe.kind,
                    label: serverKindLabel(probe.kind),
                    name: probe.serverName,
                },
                success: true,
                user: { email, id: created.id, username: finalUsername },
            });
        } catch (error) {
            sendError(res, error, "Could not sign in to the server");
        }
    });

    // Everyone else on an AIOStreams or AIOMetadata configuration comes along
    // as this person's profiles, signed in with the password just typed (never
    // stored). A Quick Connect sign-in has no password, so they are listed and
    // the person page asks for it once.
    async function bringHousehold(person, probe, login) {
        if (!household.hasHousehold(probe.kind)) {
            return [];
        }
        const typed = reqPassword.get(login) || {};
        // Read-only watch for outside changes (utils/aiostreamsConfig.js).
        await require("../utils/aiostreamsConfig").rememberConfigAccess(prisma, encrypt, person, {
            password: typed.password ?? null,
            probe,
            typedLogin: typed.loginName || null,
        });
        // AIOMetadata's, for adding household users and their PINs (utils/aiometadataHousehold.js).
        await require("../utils/aiometadataHousehold").rememberAccess(prisma, encrypt, person, {
            password: typed.password ?? null,
            probe,
        });
        try {
            const found = await household.signInHousehold({
                login,
                onSignIn: household.handToHolders(prisma, encrypt, probe.serverUrl),
                password: typed.password ?? null,
                probe,
                typedLogin: typed.loginName || null,
            });
            await household.saveHousehold(prisma, encrypt, person, found);
            return household.describeHousehold(prisma, person.id);
        } catch (e) {
            console.warn("[Jellyfin] Could not bring in the household:", e?.message);
            return [];
        }
    }

    async function claimProfileForPerson(person, probe, login) {
        const owners = await prisma.user.findMany({
            select: { id: true },
            where: {
                accountId: person.accountId,
                id: { not: person.id },
                jellyfinServerUrl: probe.serverUrl,
                providerType: "jellyfin",
            },
        });
        if (!owners.length) {
            return;
        }
        await prisma.jellyfinProfile.updateMany({
            data: { ownUserId: person.id },
            where: {
                jellyfinUserId: login.userId,
                ownerUserId: { in: owners.map((o) => o.id) },
                ownUserId: null,
            },
        });
    }

    // The password reaches bringHousehold without riding on the login object
    // that gets passed around and logged.
    const reqPassword = new WeakMap();

    async function loadProfile(req, res) {
        const profile = await prisma.jellyfinProfile.findFirst({
            where: { accountId: getAccountId(req), id: String(req.params.profileId) },
        });
        if (!profile) {
            res.status(404).json({ error: "Profile not found" });
            return null;
        }
        const owner = await prisma.user.findFirst({
            where: { accountId: getAccountId(req), id: profile.ownerUserId },
        });
        if (!owner) {
            res.status(404).json({ error: "Person not found" });
            return null;
        }
        return { owner, profile };
    }

    // The AIOStreams Collections page: SlickSync's catalogs as collections in
    // AIOStreams' apps, per AIOStreams account (utils/aioCollections.js).

    // A person whose collections can be arranged: someone who signs in with
    // AIOStreams. Stremio and Nuvio people are managed elsewhere (Nuvio
    // Collections), even with the AIOStreams watch history link on.
    async function collectionsPerson(accountId, userId) {
        if (!userId) {
            return null;
        }
        return prisma.user.findFirst({
            select: {
                accountId: true,
                aioConfigId: true,
                aioConfigPassword: true,
                id: true,
                jellyfinServerUrl: true,
                traxToken: true,
                username: true,
                watchStateEnabled: true,
            },
            where: {
                accountId,
                id: String(userId),
                jellyfinServerKind: "aiostreams",
                providerType: "jellyfin",
            },
        });
    }

    // One of that person's household profiles, when the page is on a profile.
    // A profile can have collections of its own; until it does, it sees its
    // login's (utils/aioProfileVariants.js sets that up in AIOStreams).
    async function collectionsProfile(person, profileId) {
        if (!profileId) {
            return null;
        }
        const profile = await prisma.jellyfinProfile.findFirst({
            select: { id: true, name: true },
            where: { id: String(profileId), ownerUserId: person.id },
        });
        if (!profile) {
            throw Object.assign(new Error("That profile is not on this AIOStreams account"), {
                status: 404,
            });
        }
        return profile;
    }

    router.get("/collections/accounts", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const people = await prisma.user.findMany({
                orderBy: { username: "asc" },
                select: {
                    aioConfigPassword: true,
                    avatarUrl: true,
                    colorIndex: true,
                    email: true,
                    id: true,
                    traxToken: true,
                    useGravatar: true,
                    username: true,
                    watchStateEnabled: true,
                },
                where: {
                    accountId,
                    isActive: true,
                    jellyfinServerKind: "aiostreams",
                    providerType: "jellyfin",
                },
            });
            const profiles = people.length
                ? await prisma.jellyfinProfile.findMany({
                      orderBy: { name: "asc" },
                      select: { id: true, name: true, ownerUserId: true },
                      where: { ownerUserId: { in: people.map((p) => p.id) } },
                  })
                : [];
            const own = await require("../utils/aioCollections").ownProfileIds(prisma, accountId);
            res.json({
                accounts: people.map((p) => ({
                    avatarUrl: p.avatarUrl || null,
                    // Giving a profile its own collections means a change in AIOStreams,
                    // which needs the configuration password SlickSync kept.
                    canSplit: !!p.aioConfigPassword,
                    colorIndex: p.colorIndex ?? null,
                    email: p.email || null,
                    id: p.id,
                    linked: !!(p.watchStateEnabled && p.traxToken),
                    name: p.username,
                    profiles: profiles
                        .filter((x) => x.ownerUserId === p.id)
                        .map((x) => ({ id: x.id, name: x.name, own: own.has(x.id) })),
                    useGravatar: p.useGravatar === true,
                })),
            });
        } catch (error) {
            sendError(res, error, "Could not read the AIOStreams accounts");
        }
    });

    router.get("/collections", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const person = await collectionsPerson(accountId, req.query.userId);
            if (!person) {
                return res.status(404).json({ error: "Pick an AIOStreams account" });
            }
            const profile = await collectionsProfile(person, req.query.profileId);
            const {
                loadCollections,
                membersOf,
                coverOf,
                ownProfileIds,
            } = require("../utils/aioCollections");
            const { configured, collections, lists } = await loadCollections(
                prisma,
                accountId,
                person.id,
                profile?.id || null
            );
            res.json({
                catalogs: lists.map((l) => {
                    let items = [];
                    try {
                        items = JSON.parse(l.itemsJson || "[]").filter((i) =>
                            /^tt\d+$/.test(String(i?.id || ""))
                        );
                    } catch {
                        // Malformed optional data leaves the existing fallback in place.
                    }
                    // Same fallback a collection's cover uses: the first title's poster.
                    const poster = items.find((i) => i?.poster)?.poster || null;
                    return {
                        cover: l.coverImageUrl || poster,
                        id: l.id,
                        name: l.name,
                        titles: items.length,
                    };
                }),
                collections: collections.map((c) => {
                    const members = membersOf(c, lists);
                    // When the cover is just the first title's poster, which title -
                    // so the page can show that poster the way its poster cards do.
                    const ownCover =
                        c.coverUrl || lists.find((l) => l.id === c.catalogIds[0])?.coverImageUrl;
                    const coverTitleId = ownCover
                        ? null
                        : members.find((m) => m.poster)?.id || null;
                    return {
                        ...c,
                        cover: coverOf(c, lists, members),
                        coverTitleId,
                        titles: members.length,
                    };
                }),
                configured,
                linked: !!(person.watchStateEnabled && person.traxToken),
                profile: profile
                    ? {
                          id: profile.id,
                          name: profile.name,
                          own: (await ownProfileIds(prisma, accountId)).has(profile.id),
                      }
                    : null,
            });
        } catch (error) {
            sendError(res, error, "Could not read the collections");
        }
    });

    router.put("/collections", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const person = await collectionsPerson(accountId, req.body?.userId);
            if (!person) {
                return res.status(404).json({ error: "Pick an AIOStreams account" });
            }
            const profile = await collectionsProfile(person, req.body?.profileId);
            const { saveCollections } = require("../utils/aioCollections");
            const { setProfileVariant } = require("../utils/aioProfileVariants");
            const reset = req.body?.reset === true;
            if (profile && reset) {
                // Back to the login's collections. The variant goes too; if AIOStreams
                // can't be reached, the profile's link already falls back to the login's.
                await saveCollections(prisma, accountId, person.id, null, profile.id);
                try {
                    await setProfileVariant(prisma, decrypt, person, profile, false);
                } catch (e) {
                    console.warn("[Collections] could not remove the profile variant:", e?.message);
                }
                return res.json({ success: true });
            }
            await saveArrangement(accountId, person, profile, reset ? null : req.body?.collections);
            res.json({ success: true });
        } catch (error) {
            sendError(res, error, "Could not save the collections");
        }
    });

    // Keep an arrangement for an account or one of its profiles. A profile's
    // first arrangement makes it the profile's own - that is set up in
    // AIOStreams before anything is kept, so nothing is saved that the profile
    // would never see.
    async function saveArrangement(accountId, person, profile, collections) {
        const { saveCollections, ownProfileIds } = require("../utils/aioCollections");
        if (
            profile &&
            collections !== null &&
            !(await ownProfileIds(prisma, accountId)).has(profile.id)
        ) {
            await require("../utils/aioProfileVariants").setProfileVariant(
                prisma,
                decrypt,
                person,
                profile,
                true
            );
        }
        await saveCollections(prisma, accountId, person.id, collections, profile?.id || null);
    }

    // Export (and share codes, made from the same thing in the browser): the
    // collections with the catalogs they hold, titles included.
    router.get("/collections/export", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const person = await collectionsPerson(accountId, req.query.userId);
            if (!person) {
                return res.status(404).json({ error: "Pick an AIOStreams account" });
            }
            const profile = await collectionsProfile(person, req.query.profileId);
            res.json(
                await require("../utils/aioCollections").exportCollections(
                    prisma,
                    accountId,
                    person.id,
                    profile?.id || null
                )
            );
        } catch (error) {
            sendError(res, error, "Could not export the collections");
        }
    });

    // Import a file or share code: its collections are added after the ones
    // already here (or replace them with mode 'replace'); catalogs it needs
    // are found here or made.
    router.post("/collections/import", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const person = await collectionsPerson(accountId, req.body?.userId);
            if (!person) {
                return res.status(404).json({ error: "Pick an AIOStreams account" });
            }
            const profile = await collectionsProfile(person, req.body?.profileId);
            const aio = require("../utils/aioCollections");
            const imported = await aio.importCollections(prisma, accountId, req.body?.payload);
            const current =
                req.body?.mode === "replace"
                    ? []
                    : (await aio.loadCollections(prisma, accountId, person.id, profile?.id || null))
                          .collections;
            await saveArrangement(accountId, person, profile, [
                ...current,
                ...imported.collections,
            ]);
            res.json({
                added: imported.collections.length,
                catalogsCreated: imported.catalogsCreated,
                catalogsReused: imported.catalogsReused,
            });
        } catch (error) {
            sendError(res, error, "Could not import the collections");
        }
    });

    // Jellyfin Collections page: SlickSync catalogs as real collections on the
    // household's own Jellyfin servers (utils/jellyfinServerCollections.js).
    const serverCollections = require("../utils/jellyfinServerCollections");

    async function collectionsServer(accountId, key) {
        const servers = await serverCollections.serversFor(prisma, accountId);
        const server = servers.find((s) => s.key === String(key || ""));
        if (!server) {
            throw Object.assign(
                new Error("That Jellyfin server is not one anyone here signs in to"),
                { status: 404 }
            );
        }
        return server;
    }

    router.get("/server-collections/servers", async (req, res) => {
        try {
            const servers = await serverCollections.serversFor(prisma, getAccountId(req));
            const { jfRequest } = require("../providers/jellyfinAuth");
            res.json({
                servers: await Promise.all(
                    servers.map(async (s) => {
                        let name = null;
                        try {
                            name =
                                (await jfRequest(s.url, "/System/Info/Public", { timeoutMs: 5000 }))
                                    ?.ServerName || null;
                        } catch {
                            // A missing server name does not invalidate the saved server address.
                        }
                        return {
                            address: s.address,
                            key: s.key,
                            name: serverCollections.serverDisplayName(name, s.address),
                            people: s.people.map((p) => ({ id: p.id, username: p.username })),
                        };
                    })
                ),
            });
        } catch (error) {
            sendError(res, error, "Could not read the Jellyfin servers");
        }
    });

    router.get("/server-collections", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const server = await collectionsServer(accountId, req.query.server);
            res.json(await serverCollections.describeServer(prisma, decrypt, accountId, server));
        } catch (error) {
            sendError(res, error, "Could not read the Jellyfin collections");
        }
    });

    router.put("/server-collections", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const server = await collectionsServer(accountId, req.body?.server);
            const catalogId = String(req.body?.catalogId || "");
            const list = await prisma.customList.findFirst({
                select: { id: true },
                where: { accountId, id: catalogId },
            });
            if (!list) {
                return res.status(404).json({ error: "Catalog not found" });
            }
            await serverCollections.setCatalog(
                prisma,
                decrypt,
                accountId,
                server,
                list.id,
                req.body?.on === true
            );
            res.json(await serverCollections.describeServer(prisma, decrypt, accountId, server));
        } catch (error) {
            sendError(res, error, "Could not change the Jellyfin collection");
        }
    });

    router.post("/server-collections/sync", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const server = await collectionsServer(accountId, req.body?.server);
            await serverCollections.syncServer(prisma, decrypt, accountId, server);
            res.json(await serverCollections.describeServer(prisma, decrypt, accountId, server));
        } catch (error) {
            sendError(res, error, "Could not sync the Jellyfin collections");
        }
    });

    // Opt-in: Vault key changes also update this AIOStreams person's debrid
    // keys inside their configuration (utils/aioServiceKeys.js).
    router.get("/users/:id/aio-rotate-keys", async (req, res) => {
        try {
            res.json(
                await require("../utils/aioServiceKeys").statusFor(
                    prisma,
                    getAccountId(req),
                    req.params.id
                )
            );
        } catch (error) {
            sendError(res, error, "Could not read that setting");
        }
    });

    router.put("/users/:id/aio-rotate-keys", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const keys = require("../utils/aioServiceKeys");
            const status = await keys.statusFor(prisma, accountId, req.params.id);
            if (!status.available) {
                return res.status(404).json({ error: "Not an AIOStreams person" });
            }
            await keys.setEnabled(
                prisma,
                accountId,
                String(req.params.id),
                req.body?.enabled === true
            );
            res.json(await keys.statusFor(prisma, accountId, req.params.id));
        } catch (error) {
            sendError(res, error, "Could not change that setting");
        }
    });

    // A Jellyfin person's age limit on their server (utils/jellyfinParental.js).
    // What AIOStreams itself says about this person's configuration, and a
    // one-off "test this title" search (utils/aioHealth.js). Read-only.
    router.get("/users/:id/aio-health", async (req, res) => {
        try {
            res.json(
                await require("../utils/aioHealth").healthFor(
                    prisma,
                    decrypt,
                    getAccountId(req),
                    String(req.params.id),
                    { range: req.query.range === "7d" ? "7d" : "24h" }
                )
            );
        } catch (error) {
            sendError(res, error, "Could not read AIOStreams");
        }
    });

    router.post("/users/:id/aio-test-search", async (req, res) => {
        try {
            res.json(
                await require("../utils/aioHealth").testSearch(
                    prisma,
                    decrypt,
                    getAccountId(req),
                    String(req.params.id),
                    { id: req.body?.id, type: req.body?.type }
                )
            );
        } catch (error) {
            sendError(res, error, "Could not run the search");
        }
    });

    // Every version of their AIOStreams configuration SlickSync has seen, and
    // putting one back (utils/aioConfigHistory.js).
    router.get("/users/:id/aio-history", async (req, res) => {
        try {
            res.json(
                await require("../utils/aioConfigHistory").historyFor(
                    prisma,
                    getAccountId(req),
                    String(req.params.id)
                )
            );
        } catch (error) {
            sendError(res, error, "Could not read the configuration history");
        }
    });

    router.post("/users/:id/aio-history/:snapshotId/restore", async (req, res) => {
        try {
            const keep = req.body?.keep || {};
            await require("../utils/aioConfigHistory").restore(
                prisma,
                decrypt,
                getAccountId(req),
                String(req.params.id),
                String(req.params.snapshotId),
                {
                    keepApiKeys: keep.apiKeys !== false,
                    keepPersonas: keep.users !== false,
                    keepServices: keep.services !== false,
                }
            );
            res.json(
                await require("../utils/aioConfigHistory").historyFor(
                    prisma,
                    getAccountId(req),
                    String(req.params.id)
                )
            );
        } catch (error) {
            sendError(res, error, "Could not put that version back");
        }
    });

    router.get("/users/:id/age-limit", async (req, res) => {
        try {
            res.json(
                await require("../utils/jellyfinParental").getAgeLimit(
                    prisma,
                    decrypt,
                    getAccountId(req),
                    req.params.id
                )
            );
        } catch (error) {
            sendError(res, error, "Could not read the age limit");
        }
    });

    router.put("/users/:id/age-limit", async (req, res) => {
        try {
            res.json(
                await require("../utils/jellyfinParental").setAgeLimit(
                    prisma,
                    decrypt,
                    getAccountId(req),
                    req.params.id,
                    {
                        blockUnrated:
                            typeof req.body?.blockUnrated === "boolean"
                                ? req.body.blockUnrated
                                : undefined,
                        value: req.body?.value ?? null,
                    }
                )
            );
        } catch (error) {
            sendError(res, error, "Could not set the age limit");
        }
    });

    // Real Jellyfin servers an invitation can make accounts on: those where
    // someone here signs in as an administrator (utils/jellyfinInviteAccounts.js).
    router.get("/invite-servers", async (req, res) => {
        try {
            res.json({
                servers: await require("../utils/jellyfinInviteAccounts").inviteServers(
                    prisma,
                    decrypt,
                    getAccountId(req)
                ),
            });
        } catch (error) {
            sendError(res, error, "Could not read the Jellyfin servers");
        }
    });

    // Their SlickSync picture on their server too (utils/serverAvatars.js).
    router.post("/users/:id/picture", async (req, res) => {
        try {
            res.json({
                success: true,
                ...(await require("../utils/serverAvatars").pushPicture(
                    prisma,
                    decrypt,
                    getAccountId(req),
                    String(req.params.id)
                )),
            });
        } catch (error) {
            sendError(res, error, "Could not set the picture on their server");
        }
    });

    // Whether what this person finishes elsewhere is marked played on their
    // real Jellyfin server (utils/jellyfinMarkPlayed.js), and switching it.
    router.get("/users/:id/mark-played", async (req, res) => {
        try {
            res.json(
                await require("../utils/jellyfinMarkPlayed").statusFor(
                    prisma,
                    getAccountId(req),
                    String(req.params.id)
                )
            );
        } catch (error) {
            sendError(res, error, "Could not read that setting");
        }
    });

    router.put("/users/:id/mark-played", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const person = await prisma.user.findFirst({
                select: { id: true },
                where: { accountId, id: String(req.params.id) },
            });
            if (!person) {
                return res.status(404).json({ error: "Person not found" });
            }
            const mp = require("../utils/jellyfinMarkPlayed");
            if (typeof req.body?.enabled === "boolean") {
                await mp.setEnabled(prisma, accountId, person.id, req.body.enabled);
            }
            if (typeof req.body?.lists === "boolean") {
                await mp.setLists(prisma, accountId, person.id, req.body.lists);
            }
            res.json(await mp.statusFor(prisma, accountId, person.id));
        } catch (error) {
            sendError(res, error, "Could not change that setting");
        }
    });

    // What is signed in as someone on a real Jellyfin server, and signing a
    // device out (utils/jellyfinDevices.js).
    router.get("/users/:id/devices", async (req, res) => {
        try {
            res.json(
                await require("../utils/jellyfinDevices").listDevices(
                    prisma,
                    decrypt,
                    getAccountId(req),
                    req.params.id
                )
            );
        } catch (error) {
            sendError(res, error, "Could not read the signed-in devices");
        }
    });

    router.delete("/users/:id/devices/:deviceId", async (req, res) => {
        try {
            res.json(
                await require("../utils/jellyfinDevices").signOutDevice(
                    prisma,
                    decrypt,
                    getAccountId(req),
                    req.params.id,
                    req.params.deviceId
                )
            );
        } catch (error) {
            sendError(res, error, "Could not sign that device out");
        }
    });

    // Sign a TV (or any Jellyfin app) in with the Quick Connect code it shows,
    // as this person or one of their household profiles: SlickSync approves the
    // code with that sign-in, and the server signs the device in as them.
    // AIOStreams and Jellyfin both sign the device in as whoever approved it.
    router.post("/users/:id/quick-connect", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const person = await prisma.user.findFirst({
                select: {
                    accountId: true,
                    id: true,
                    jellyfinServerUrl: true,
                    jellyfinToken: true,
                    jellyfinUserId: true,
                    username: true,
                },
                where: { accountId, id: String(req.params.id), providerType: "jellyfin" },
            });
            if (!person?.jellyfinServerUrl) {
                return res.status(404).json({ error: "Person not found" });
            }
            const code = String(req.body?.code || "").replace(/\D/g, "");
            if (code.length < 4 || code.length > 10) {
                return res.status(400).json({ error: "Type the code the TV shows" });
            }

            let token = person.jellyfinToken;
            let who = person.username;
            if (req.body?.profileId) {
                const profile = await prisma.jellyfinProfile.findFirst({
                    select: { name: true, needsPin: true, token: true },
                    where: { id: String(req.body.profileId), ownerUserId: person.id },
                });
                if (!profile) {
                    return res.status(404).json({ error: "That profile is not in this household" });
                }
                if (!profile.token) {
                    return res.status(409).json({
                        error: `Sign ${profile.name} in on SlickSync first${profile.needsPin ? " with their PIN" : ""} (Users page -> household)`,
                    });
                }
                token = profile.token;
                who = profile.name;
            }
            if (!token) {
                return res.status(409).json({ error: `Reconnect ${person.username} first` });
            }

            const { jfRequest, deviceIdFor } = require("../providers/jellyfinAuth");
            let approved;
            try {
                approved = await jfRequest(
                    person.jellyfinServerUrl,
                    `/QuickConnect/Authorize?code=${encodeURIComponent(code)}`,
                    {
                        deviceId: deviceIdFor(person.jellyfinServerUrl, person.jellyfinUserId),
                        method: "POST",
                        token: decrypt(token, { appAccountId: person.accountId || "default" }),
                    }
                );
            } catch (e) {
                if (e.status === 401 || e.status === 403) {
                    return res.status(400).json({
                        error: "The server turned it down - Quick Connect may be off on it, or that code is for another server",
                    });
                }
                // Jellyfin answers an unknown or expired code with a bare 404.
                if (e.status === 404 || e.status === 400) {
                    return res.status(400).json({
                        error: "That code didn't work - codes change every few minutes, so check the TV and try again",
                    });
                }
                throw e;
            }
            if (approved !== true) {
                return res.status(400).json({
                    error: "That code didn't work - codes change every few minutes, so check the TV and try again",
                });
            }
            res.json({ success: true, who });
        } catch (error) {
            sendError(res, error, "Could not sign the device in");
        }
    });

    // A person's household, and - for someone separated out of one - whose it is.
    // Everything a title's "Open in …" button needs (components/ui/OpenWith):
    // per Jellyfin, AIOStreams or AIOMetadata server people here use, its
    // address and id, who uses it (their user id there - Swiftfin's link names
    // the user), and the server's own item for this title. On a real Jellyfin,
    // also the devices each of them has open in a Jellyfin app, for Play on.
    const openItemCache = new Map(); // "<address>|<id>|<type>" -> { at, itemId }
    router.get("/open-targets", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const id = String(req.query.id || "");
            const type = req.query.type === "movie" ? "movie" : "series";
            if (!/^(tt\d+|tmdb:\d+|tvdb:\d+|kitsu:\d+)$/.test(id)) {
                return res.json({ devices: [], servers: [] });
            }
            const people = await prisma.user.findMany({ where: { accountId } });
            const creds = await prisma.userProviderCredential
                .findMany({
                    where: { providerType: "jellyfin", userId: { in: people.map((p) => p.id) } },
                })
                .catch(() => []);
            const rows = [
                ...people.filter(
                    (p) => p.providerType === "jellyfin" && p.jellyfinServerUrl && p.jellyfinToken
                ),
                ...creds
                    .filter((c) => c.jellyfinServerUrl && c.jellyfinToken)
                    .map((c) => {
                        const p = people.find((x) => x.id === c.userId);
                        return (
                            p && {
                                ...p,
                                __credentialId: c.id,
                                jellyfinServerId: c.jellyfinServerId,
                                jellyfinServerKind: c.jellyfinServerKind,
                                jellyfinServerUrl: c.jellyfinServerUrl,
                                jellyfinToken: c.jellyfinToken,
                                jellyfinUserId: c.jellyfinUserId,
                                jellyfinUserName: c.jellyfinUserName,
                                providerType: "jellyfin",
                            }
                        );
                    })
                    .filter(Boolean),
            ];
            const { makeCreateProvider } = require("../providers");
            const create = makeCreateProvider({ encrypt, prisma });
            const providerFor = (row) => create(row, { decrypt: (t) => decrypt(t, req), req });
            const { encodePackedId } = require("../providers/jellyfin");
            const servers = new Map();
            const devices = [];
            for (const row of rows) {
                const address = String(row.jellyfinServerUrl).replace(/\/+$/, "");
                const kind = row.jellyfinServerKind || "jellyfin";
                let s = servers.get(address);
                if (!s) {
                    s = {
                        address,
                        itemId: null,
                        kind,
                        people: [],
                        serverId: row.jellyfinServerId || null,
                    };
                    servers.set(address, s);
                    if (kind === "aiostreams" || kind === "aiometadata") {
                        s.itemId = encodePackedId({ base: id, kind: type }) || null;
                    } else {
                        const key = `${address}|${id}|${type}`;
                        const hit = openItemCache.get(key);
                        if (hit && Date.now() - hit.at < 10 * 60 * 1000) {
                            s.itemId = hit.itemId;
                        } else {
                            s.itemId =
                                (await providerFor(row)
                                    ?.findItem(id, type)
                                    .catch(() => null)) || null;
                            openItemCache.set(key, { at: Date.now(), itemId: s.itemId });
                            if (openItemCache.size > 2000) {
                                openItemCache.delete(openItemCache.keys().next().value);
                            }
                        }
                    }
                }
                if (!s.people.some((x) => x.userId === row.jellyfinUserId)) {
                    s.people.push({ name: row.username, userId: row.jellyfinUserId || null });
                }
                if (kind === "jellyfin" && s.itemId) {
                    const list =
                        (await providerFor(row)
                            ?.controllableSessions()
                            .catch(() => [])) || [];
                    for (const d of list) {
                        devices.push({
                            address,
                            client: d.client,
                            credentialId: row.__credentialId || null,
                            device: d.device,
                            itemId: s.itemId,
                            person: row.username,
                            personId: row.id,
                            sessionId: d.id,
                        });
                    }
                }
            }
            // Infuse opens a title by its TMDB id; Cinemeta carries it for IMDb ids.
            let tmdbId = id.startsWith("tmdb:") ? id.slice(5) : null;
            if (!tmdbId && /^tt\d+$/.test(id) && servers.size) {
                const key = `tmdb|${type}|${id}`;
                const hit = openItemCache.get(key);
                if (hit && Date.now() - hit.at < 24 * 60 * 60 * 1000) {
                    tmdbId = hit.itemId;
                } else {
                    try {
                        const r = await fetch(
                            `https://v3-cinemeta.strem.io/meta/${type}/${id}.json`,
                            { signal: AbortSignal.timeout(5000) }
                        );
                        const m = r.ok ? (await r.json())?.meta : null;
                        tmdbId = m?.moviedb_id ? String(m.moviedb_id) : null;
                    } catch {
                        tmdbId = null;
                    }
                    openItemCache.set(key, { at: Date.now(), itemId: tmdbId });
                }
            }
            res.json({ devices, servers: [...servers.values()], tmdbId });
        } catch (error) {
            console.warn("[jellyfin] open targets failed:", error?.message);
            res.json({ devices: [], servers: [] });
        }
    });

    // Play on: start a title on one of the devices /open-targets listed.
    router.post("/play-on", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const { personId, credentialId, sessionId, itemId } = req.body || {};
            if (!(personId && sessionId && itemId)) {
                return res.status(400).json({ message: "Pick a device" });
            }
            const person = await prisma.user.findFirst({
                where: { accountId, id: String(personId) },
            });
            if (!person) {
                return res.status(404).json({ message: "Person not found" });
            }
            let row = person;
            if (credentialId) {
                const c = await prisma.userProviderCredential.findFirst({
                    where: {
                        id: String(credentialId),
                        providerType: "jellyfin",
                        userId: person.id,
                    },
                });
                if (!c) {
                    return res.status(404).json({ message: "That sign-in is gone" });
                }
                row = {
                    ...person,
                    __credentialId: c.id,
                    jellyfinServerId: c.jellyfinServerId,
                    jellyfinServerKind: c.jellyfinServerKind,
                    jellyfinServerUrl: c.jellyfinServerUrl,
                    jellyfinToken: c.jellyfinToken,
                    jellyfinUserId: c.jellyfinUserId,
                    jellyfinUserName: c.jellyfinUserName,
                    providerType: "jellyfin",
                };
            }
            if (row.providerType !== "jellyfin") {
                return res.status(400).json({ message: "They have no Jellyfin sign-in" });
            }
            const provider = require("../providers").makeCreateProvider({ encrypt, prisma })(row, {
                decrypt: (t) => decrypt(t, req),
                req,
            });
            await provider.playOn(String(sessionId), String(itemId));
            res.json({ success: true });
        } catch (error) {
            const status = error?.status && error.status < 500 ? error.status : 502;
            res.status(status).json({
                message:
                    status < 500
                        ? error.message
                        : "That device did not answer - it may have closed the app",
            });
        }
    });

    // The AIOStreams servers people here sign in to, for "Open in AIOStreams"
    // on a title: its apps open aiostreams://item/<id>?server=<address> links,
    // where the address is the API base the app saved - the one SlickSync signs
    // in to. One entry per address, named by who uses it.
    router.get("/aiostreams-servers", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const people = await prisma.user.findMany({
                select: {
                    id: true,
                    jellyfinServerKind: true,
                    jellyfinServerUrl: true,
                    username: true,
                },
                where: { accountId },
            });
            const byId = new Map(people.map((p) => [p.id, p]));
            const creds = await prisma.userProviderCredential
                .findMany({
                    select: { jellyfinServerUrl: true, userId: true },
                    where: {
                        jellyfinServerKind: "aiostreams",
                        jellyfinServerUrl: { not: null },
                        userId: { in: people.map((p) => p.id) },
                    },
                })
                .catch(() => []);
            const rows = [
                ...people
                    .filter((p) => p.jellyfinServerKind === "aiostreams" && p.jellyfinServerUrl)
                    .map((p) => ({ address: p.jellyfinServerUrl, name: p.username })),
                ...creds.map((c) => ({
                    address: c.jellyfinServerUrl,
                    name: byId.get(c.userId)?.username || "",
                })),
            ];
            const servers = new Map();
            for (const r of rows) {
                const address = String(r.address).replace(/\/+$/, "");
                const s = servers.get(address) || { address, people: [] };
                if (r.name && !s.people.includes(r.name)) {
                    s.people.push(r.name);
                }
                servers.set(address, s);
            }
            res.json({ servers: [...servers.values()] });
        } catch {
            res.json({ servers: [] });
        }
    });

    router.get("/users/:id/household", async (req, res) => {
        try {
            const accountId = getAccountId(req);
            const person = await prisma.user.findFirst({
                select: { id: true, jellyfinServerKind: true, providerType: true },
                where: { accountId, id: String(req.params.id) },
            });
            if (!person) {
                return res.status(404).json({ error: "User not found" });
            }
            const profiles =
                person.providerType === "jellyfin"
                    ? await household.describeHousehold(prisma, person.id)
                    : [];
            const membership = await prisma.jellyfinProfile.findFirst({
                where: { accountId, ownUserId: person.id },
            });
            let partOf = null;
            if (membership) {
                const owner = await prisma.user.findFirst({
                    select: { id: true, username: true },
                    where: { accountId, id: membership.ownerUserId },
                });
                if (owner) {
                    partOf = { name: membership.name, owner, profileId: membership.id };
                }
            }
            const full = await prisma.user.findFirst({
                select: {
                    aioConfigId: true,
                    aioConfigPassword: true,
                    jellyfinServerKind: true,
                    jellyfinServerUrl: true,
                    providerType: true,
                },
                where: { id: person.id },
            });
            // Household users can be added, and PINs changed, here (utils/aioHousehold.js,
            // utils/aiometadataHousehold.js) - PINs on AIOMetadata only once it has them.
            const aiom = require("../utils/aiometadataHousehold");
            const canManage =
                require("../utils/aioHousehold").canManage(full) || aiom.canManage(full);
            const canPin =
                canManage &&
                (full.jellyfinServerKind !== "aiometadata" || (await aiom.hasPins(full)));
            // Who is kept separate, with their own sign-in address (AIOStreams only).
            const personal =
                full.jellyfinServerKind === "aiostreams" && profiles.length
                    ? await require("../utils/aioHousehold").personalSettings(
                          decrypt,
                          { ...full, accountId },
                          profiles
                      )
                    : null;
            res.json({
                canManage,
                canPin,
                kind: person.jellyfinServerKind || null,
                partOf,
                personal,
                profiles,
            });
        } catch (error) {
            sendError(res, error, "Could not read the household");
        }
    });

    // Add a household user to their AIOStreams configuration (utils/aioHousehold.js).
    router.post("/users/:id/household", async (req, res) => {
        try {
            const owner = await prisma.user.findFirst({
                where: { accountId: getAccountId(req), id: String(req.params.id) },
            });
            if (!owner) {
                return res.status(404).json({ error: "User not found" });
            }
            const result =
                owner.jellyfinServerKind === "aiometadata"
                    ? await require("../utils/aiometadataHousehold").addUser(
                          prisma,
                          decrypt,
                          encrypt,
                          owner,
                          { name: req.body?.name, pin: req.body?.pin ?? null }
                      )
                    : await require("../utils/aioHousehold").addPersona(
                          prisma,
                          decrypt,
                          encrypt,
                          owner,
                          {
                              history: req.body?.history,
                              name: req.body?.name,
                              pin: req.body?.pin ?? null,
                              separate: req.body?.separate === true,
                          }
                      );
            res.json({
                success: true,
                ...result,
                profiles: await household.describeHousehold(prisma, owner.id),
            });
        } catch (error) {
            sendError(res, error, "Could not add the household user");
        }
    });

    // Change or remove a household user's PIN.
    router.post("/household/:profileId/pin", async (req, res) => {
        try {
            const found = await loadProfile(req, res);
            if (!found) {
                return;
            }
            const result =
                found.owner.jellyfinServerKind === "aiometadata"
                    ? await require("../utils/aiometadataHousehold").setUserPin(
                          prisma,
                          decrypt,
                          encrypt,
                          found.owner,
                          found.profile,
                          req.body?.pin ?? null
                      )
                    : await require("../utils/aioHousehold").setPersonaPin(
                          prisma,
                          decrypt,
                          encrypt,
                          found.owner,
                          found.profile,
                          req.body?.pin ?? null
                      );
            res.json({
                success: true,
                ...result,
                profiles: await household.describeHousehold(prisma, found.owner.id),
            });
        } catch (error) {
            sendError(res, error, "Could not change the PIN");
        }
    });

    // Keep a household user separate with a sign-in address of their own, stop,
    // or give them a new address: body { mode: 'on' | 'off' | 'renew' }.
    router.post("/household/:profileId/personal-address", async (req, res) => {
        try {
            const found = await loadProfile(req, res);
            if (!found) {
                return;
            }
            if (found.owner.jellyfinServerKind !== "aiostreams") {
                return res
                    .status(400)
                    .json({ error: "Only AIOStreams household users can be kept separate" });
            }
            const personal = await require("../utils/aioHousehold").setPersonaSeparation(
                prisma,
                decrypt,
                found.owner,
                found.profile,
                String(req.body?.mode || "")
            );
            res.json({
                personal,
                profiles: await household.describeHousehold(prisma, found.owner.id),
                success: true,
            });
        } catch (error) {
            sendError(res, error, "Could not change that sign-in address");
        }
    });

    router.post("/household/:profileId/track", async (req, res) => {
        try {
            const found = await loadProfile(req, res);
            if (!found) {
                return;
            }
            await household.setTracked(prisma, found.profile, req.body?.tracked !== false);
            res.json({
                profiles: await household.describeHousehold(prisma, found.owner.id),
                success: true,
            });
        } catch (error) {
            sendError(res, error, "Could not change that profile");
        }
    });

    router.post("/household/:profileId/sign-in", async (req, res) => {
        try {
            const found = await loadProfile(req, res);
            if (!found) {
                return;
            }
            await household.signInProfile(prisma, encrypt, {
                ...found,
                password: String(req.body?.password ?? ""),
                pin: req.body?.pin ? String(req.body.pin) : null,
            });
            res.json({
                profiles: await household.describeHousehold(prisma, found.owner.id),
                success: true,
            });
        } catch (error) {
            sendError(res, error, "Could not sign that profile in");
        }
    });

    router.post("/household/:profileId/separate", async (req, res) => {
        try {
            const found = await loadProfile(req, res);
            if (!found) {
                return;
            }
            const result = await household.separateProfile(prisma, found);
            res.json({
                success: true,
                ...result,
                profiles: await household.describeHousehold(prisma, found.owner.id),
            });
        } catch (error) {
            sendError(res, error, "Could not separate that profile");
        }
    });

    router.post("/household/:profileId/merge-back", async (req, res) => {
        try {
            const found = await loadProfile(req, res);
            if (!found) {
                return;
            }
            const result = await household.mergeProfileBack(prisma, found);
            res.json({
                success: true,
                ...result,
                profiles: await household.describeHousehold(prisma, found.owner.id),
            });
        } catch (error) {
            sendError(res, error, "Could not merge that profile back");
        }
    });

    return router;
};
