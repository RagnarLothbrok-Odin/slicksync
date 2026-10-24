const { createDefaultAvatar } = require("./defaultAvatar");
// AIOStreams and AIOMetadata household users, as profiles.
//
// An AIOStreams or AIOMetadata configuration is a Jellyfin-compatible server
// with a user for everyone in the household, all behind the one
// configuration password - much like a Nuvio account and its profiles. So a
// person added with their sign-in brings the rest of the household along as
// profiles: SlickSync signs each of them in while it has the password (it is
// never stored), keeps each one's token, and reads their viewing as this
// person's, labelled with the profile's name. A profile can then be
// separated into its own person, merged back, or left untracked - the same
// choices Nuvio profiles have.
//
// A real Jellyfin server has no such thing: its users are separate accounts
// with their own passwords, each added as their own person.

const jfAuth = require("../providers/jellyfinAuth");
const { migrateTable, runMembershipTransaction } = require("./userMerge");
const { moveProfileHistory } = require("./nuvioProfiles");

const HOUSEHOLD_KINDS = new Set(["aiostreams", "aiometadata"]);

function hasHousehold(kind) {
    return HOUSEHOLD_KINDS.has(kind);
}

function isPlainAddress(serverUrl) {
    try {
        return /\/jellyfin$/i.test(new URL(serverUrl).pathname.replace(/\/+$/, ""));
    } catch {
        return false;
    }
}

/**
 * The names a household user might sign in as, most likely first. On
 * AIOStreams' plain address the configuration is named in the user name:
 * its main user signs in as the configuration UUID (or alias) alone, everyone
 * else as "<uuid>/Sam". Which one is the main user is not marked anywhere, so
 * both are tried and the one that signs in as that very user is kept. On a
 * sign-in picker address, and on AIOMetadata, the plain name is enough. So is
 * it at a personal address (/jellyfin/p/<code>), which is not a plain address
 * and lists only that one person.
 */
function loginNamesFor(kind, serverUrl, account, user) {
    if (kind !== "aiostreams" || !isPlainAddress(serverUrl)) {
        return [user.name];
    }
    if (!account) {
        return [];
    }
    return [`${account}/${user.name}`, account];
}

/** The configuration part of what someone typed to sign in: "<uuid>" from "<uuid>/Sam". */
function accountOf(typedLogin) {
    const typed = String(typedLogin || "").trim();
    if (!typed) {
        return null;
    }
    return typed.includes("/") ? typed.slice(0, typed.lastIndexOf("/")) : typed;
}

/**
 * What to do with each sign-in made on the way: hand it to everyone holding
 * that server user (jellyfinConnect.rememberSignIn). Signing a household user
 * in retires the token they held for this device, and the name tried second
 * on AIOStreams is the main user's own, so every sign-in counts, not only
 * the one that is kept.
 */
function handToHolders(prisma, encrypt, serverUrl) {
    return (signed) =>
        require("./jellyfinConnect").rememberSignIn(prisma, encrypt, { serverUrl }, signed);
}

/**
 * Sign one household user in, trying each possible name; the first that is
 * really them wins. `onSignIn(signed)` hears of every successful sign-in.
 */
async function signInAs(serverUrl, names, userId, secret, onSignIn) {
    let pinNeeded = false;
    for (const name of names) {
        try {
            const signed = await jfAuth.authenticateByName(serverUrl, name, secret);
            if (typeof onSignIn === "function") {
                await Promise.resolve(onSignIn(signed)).catch(() => undefined);
            }
            if (signed.userId === userId) {
                return { loginName: name, token: signed.token };
            }
        } catch (e) {
            if (e?.pinNeeded) {
                pinNeeded = true;
            }
        }
    }
    return { loginName: null, pinNeeded, token: null };
}

/**
 * Sign in everyone else in the household, with the password just used when
 * there is one. Users that need a PIN, or that would not sign in, come back
 * without a token so the household card can offer to finish them.
 */
async function signInHousehold({ probe, login, password, typedLogin, onSignIn }) {
    if (!hasHousehold(probe.kind)) {
        return [];
    }
    let users = [];
    try {
        users = await jfAuth.listServerUsers(probe.serverUrl, login.token);
    } catch (e) {
        console.warn("[JellyfinProfiles] Could not list the household:", e?.message);
        return [];
    }
    const account = accountOf(typedLogin);
    const out = [];
    for (const user of users.filter((u) => u.id !== login.userId)) {
        const names = loginNamesFor(probe.kind, probe.serverUrl, account, user);
        // On AIOStreams, a user that can't sign in automatically is one with a PIN,
        // and isn't tried: wrong guesses count towards its lockout, and the
        // household card asks for the PIN instead. AIOMetadata marks every user
        // that way, PIN or not, so there the sign-in itself is the test.
        const pinHint = probe.kind === "aiostreams" && user.needsPin === true;
        const entry = {
            jellyfinUserId: user.id,
            loginName: names[0] || null,
            name: user.name,
            needsPin: pinHint,
            token: null,
        };
        if (names.length && password != null && !entry.needsPin) {
            const signed = await signInAs(probe.serverUrl, names, user.id, password, onSignIn);
            if (signed.token) {
                entry.token = signed.token;
                entry.loginName = signed.loginName;
            } else if (signed.pinNeeded) {
                entry.needsPin = true;
            }
        }
        // Which name a PIN user answers to is only known once they sign in; the
        // household card tries the same names in the same order.
        if (!entry.token && names.length > 1) {
            entry.loginName = names.join("\n");
        }
        out.push(entry);
    }
    return out;
}

/**
 * Keep the household on the person. A profile someone already separated into
 * their own person stays theirs, and an untracked one stays untracked; only
 * the sign-in is refreshed.
 */
async function saveHousehold(prisma, encrypt, owner, household) {
    const accountId = owner.accountId || "default";
    for (const p of household) {
        const token = p.token ? encrypt(p.token, { appAccountId: accountId }) : null;
        const existing = await prisma.jellyfinProfile.findUnique({
            where: {
                ownerUserId_jellyfinUserId: {
                    jellyfinUserId: p.jellyfinUserId,
                    ownerUserId: owner.id,
                },
            },
        });
        if (existing) {
            await prisma.jellyfinProfile.update({
                data: {
                    loginName: p.loginName || existing.loginName,
                    name: p.name,
                    needsPin: p.token ? false : p.needsPin,
                    ...(token ? { token } : {}),
                },
                where: { id: existing.id },
            });
            // A separated profile's person reads with its own sign-in; keep it fresh too.
            if (existing.ownUserId && token) {
                await prisma.user.updateMany({
                    data: {
                        jellyfinToken: token,
                        providerConnectionError: null,
                        providerConnectionErrorAt: null,
                    },
                    where: { id: existing.ownUserId, providerType: "jellyfin" },
                });
            }
        } else {
            // Someone already here as their own person (added on their own before)
            // is that person, not a profile.
            const own = await prisma.user.findFirst({
                select: { id: true },
                where: {
                    accountId,
                    jellyfinServerUrl: owner.jellyfinServerUrl,
                    jellyfinUserId: p.jellyfinUserId,
                    providerType: "jellyfin",
                },
            });
            await prisma.jellyfinProfile.create({
                data: {
                    accountId,
                    jellyfinUserId: p.jellyfinUserId,
                    loginName: p.loginName || null,
                    name: p.name,
                    needsPin: p.token ? false : p.needsPin,
                    ownerUserId: owner.id,
                    ownUserId: own?.id || null,
                    token,
                },
            });
        }
    }
}

/**
 * Someone is being deleted: the household they brought (and the sign-ins it
 * holds) goes with them, and a profile that had been separated into them stops
 * being tracked rather than quietly counting for its old owner again.
 */
async function forgetPersonHousehold(prisma, userId) {
    try {
        await prisma.jellyfinProfile.deleteMany({ where: { ownerUserId: userId } });
        await prisma.jellyfinProfile.updateMany({
            data: { ownUserId: null, skip: true },
            where: { ownUserId: userId },
        });
    } catch (e) {
        console.warn(
            "[JellyfinProfiles] Could not clear the household of a deleted person:",
            e?.message
        );
    }
}

/** A profile whose sign-in stopped working waits for a fresh one on the household card. */
async function forgetProfileSignIn(prisma, profileId) {
    await prisma.jellyfinProfile
        .update({ data: { token: null }, where: { id: profileId } })
        .catch(() => undefined);
}

/** The profiles this person reads, with decrypted sign-ins, for the provider. */
async function trackedProfiles(prisma, decrypt, userId) {
    const rows = await prisma.jellyfinProfile.findMany({
        where: { ownerUserId: userId, ownUserId: null, skip: false, token: { not: null } },
    });
    const out = [];
    for (const r of rows) {
        try {
            out.push({
                id: r.id,
                jellyfinUserId: r.jellyfinUserId,
                name: r.name,
                token: decrypt(r.token, { appAccountId: r.accountId }),
            });
        } catch {
            /* a token from a rotated key; the person page offers a fresh sign-in */
        }
    }
    return out;
}

/** The household as the person page shows it. */
async function describeHousehold(prisma, userId) {
    const rows = await prisma.jellyfinProfile.findMany({
        orderBy: { name: "asc" },
        where: { ownerUserId: userId },
    });
    const people = await prisma.user.findMany({
        select: { id: true, username: true },
        where: { id: { in: rows.map((r) => r.ownUserId).filter(Boolean) } },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    return rows.map((r) => ({
        avatarUrl: r.avatarUrl || null,
        id: r.id,
        // Whose limits its Limits pill opens: its own person's, or its own as a
        // household user merged into this one (screenSubjects.js).
        limitId:
            r.ownUserId && byId.has(r.ownUserId)
                ? r.ownUserId
                : require("./screenSubjects").householdSubject(r.id),
        name: r.name,
        person:
            r.ownUserId && byId.has(r.ownUserId)
                ? { id: r.ownUserId, username: byId.get(r.ownUserId).username }
                : null,
        status:
            r.ownUserId && byId.has(r.ownUserId)
                ? "own"
                : r.skip
                  ? "untracked"
                  : r.token
                    ? "tracked"
                    : r.needsPin
                      ? "needs-pin"
                      : "needs-sign-in",
    }));
}

/** Track a profile again, or stop. */
async function setTracked(prisma, profile, tracked) {
    await prisma.jellyfinProfile.update({ data: { skip: !tracked }, where: { id: profile.id } });
}

/** Finish a profile that needs a PIN, or a password after a Quick Connect add. */
async function signInProfile(prisma, encrypt, { profile, owner, password, pin }) {
    const names = String(profile.loginName || profile.name)
        .split("\n")
        .filter(Boolean);
    const secret = pin ? `${password || ""}/${pin}` : password || "";
    const signed = await signInAs(
        owner.jellyfinServerUrl,
        names,
        profile.jellyfinUserId,
        secret,
        handToHolders(prisma, encrypt, owner.jellyfinServerUrl)
    );
    if (!signed.token) {
        throw Object.assign(
            new Error(signed.pinNeeded ? "That PIN did not work" : "Wrong password"),
            { status: 400 }
        );
    }
    await prisma.jellyfinProfile.update({
        data: {
            loginName: signed.loginName,
            needsPin: false,
            token: encrypt(signed.token, { appAccountId: owner.accountId || "default" }),
        },
        where: { id: profile.id },
    });
}

/**
 * Separate a profile into its own person: they get the profile's sign-in, the
 * owner's groups, and everything watched on that profile so far.
 */
async function separateProfile(prisma, { profile, owner }) {
    if (profile.ownUserId) {
        throw Object.assign(new Error("That profile is already its own person"), { status: 400 });
    }
    if (!profile.token) {
        throw Object.assign(new Error("Sign this profile in first"), { status: 400 });
    }
    const accountId = owner.accountId || "default";
    let username = profile.name;
    for (
        let attempt = 1;
        await prisma.user.findFirst({ where: { accountId, username } });
        attempt++
    ) {
        if (attempt > 100) {
            throw Object.assign(new Error("Pick a different name first"), { status: 409 });
        }
        username = `${profile.name}${attempt}`;
    }
    let created;
    let moved = { activity: 0, episodes: 0, movies: 0 };
    await runMembershipTransaction(prisma, accountId, async (tx) => {
        created = await tx.user.create({
            data: {
                accountId,
                avatarUrl: createDefaultAvatar(),
                colorIndex: ((owner.colorIndex || 0) + 1) % 10,
                email: jfAuth.identityEmail(owner.jellyfinServerUrl, profile.jellyfinUserId),
                isActive: true,
                jellyfinServerId: owner.jellyfinServerId,
                jellyfinServerKind: owner.jellyfinServerKind,
                jellyfinServerUrl: owner.jellyfinServerUrl,
                jellyfinToken: profile.token,
                jellyfinUserId: profile.jellyfinUserId,
                jellyfinUserName: profile.name,
                providerType: "jellyfin",
                username,
            },
        });
        moved = await moveProfileHistory(tx, {
            accountId,
            fromUserId: owner.id,
            profileLabel: profile.name,
            toUserId: created.id,
        });
        // The new person joins the owner's group.
        const ownerGroup = await tx.group.findFirst({
            select: { id: true },
            where: { accountId, userIds: { contains: owner.id } },
        });
        if (ownerGroup) {
            await require("./helpers/database").moveIntoGroup(
                tx,
                accountId,
                created.id,
                ownerGroup.id
            );
        }
        await tx.jellyfinProfile.update({
            data: { ownUserId: created.id, skip: false },
            where: { id: profile.id },
        });
    });
    return { moved, person: { id: created.id, username } };
}

/**
 * Merge a separated profile's person back into the person whose household it
 * is: everything they recorded moves across, labelled with the profile so a
 * later Separate takes it with them again, and the person leaves the Users
 * list. Their sign-in goes back to the profile.
 */
async function mergeProfileBack(prisma, { profile, owner }) {
    const accountId = owner.accountId || "default";
    const person = profile.ownUserId
        ? await prisma.user.findFirst({ where: { accountId, id: profile.ownUserId } })
        : null;
    if (!person) {
        throw Object.assign(new Error("That profile has no person of its own"), { status: 400 });
    }
    await runMembershipTransaction(prisma, accountId, async (tx) => {
        // Label first, so the profile can take its viewing with it again later.
        await tx.watchActivity.updateMany({
            data: { profileLabel: profile.name },
            where: { profileLabel: null, userId: person.id },
        });
        await tx.movieWatchHistory.updateMany({
            data: { profileLabel: profile.name },
            where: { profileLabel: null, userId: person.id },
        });
        await tx.episodeWatchHistory.updateMany({
            data: { profileLabel: profile.name },
            where: { profileLabel: null, userId: person.id },
        });
        await tx.watchActivity.updateMany({
            data: { userId: owner.id },
            where: { userId: person.id },
        });
        // migrateTable records what it moved for an undo; a merge back is undone by separating again.
        const archive = { donorRows: {}, overwrittenSurvivorRows: {} };
        await migrateTable(
            tx,
            "movieWatchHistory",
            owner.id,
            person.id,
            "watchedAt",
            (row) => ({ accountId: row.accountId, itemId: row.itemId, userId: owner.id }),
            { archive }
        );
        await migrateTable(
            tx,
            "episodeWatchHistory",
            owner.id,
            person.id,
            "watchedAt",
            (row) => ({ accountId: row.accountId, userId: owner.id, videoId: row.videoId }),
            { archive }
        );
        // Progress baselines are per sign-in, and the profile keeps its own
        // through the owner's read from now on; the person's are not needed.
        await tx.watchSnapshot.deleteMany({ where: { userId: person.id } });
        await tx.watchSession.deleteMany({ where: { userId: person.id } });
        await tx.dismissedContinueWatching.deleteMany({ where: { userId: person.id } });
        await require("./helpers/database").dropFromAllGroups(tx, accountId, person.id);
        await tx.jellyfinProfile.update({
            data: {
                ownUserId: null,
                skip: false,
                ...(person.jellyfinToken ? { needsPin: false, token: person.jellyfinToken } : {}),
            },
            where: { id: profile.id },
        });
        await tx.user.delete({ where: { id: person.id } });
    });
    try {
        require("./jellyfinLive").forgetUser(person.id);
    } catch {}
    return { mergedInto: owner.id, removed: { id: person.id, username: person.username } };
}

module.exports = {
    describeHousehold,
    forgetPersonHousehold,
    forgetProfileSignIn,
    handToHolders,
    hasHousehold,
    loginNamesFor,
    mergeProfileBack,
    saveHousehold,
    separateProfile,
    setTracked,
    signInAs,
    signInHousehold,
    signInProfile,
    trackedProfiles,
};
