/**
 * Provider factory — creates the correct provider for a user based on providerType
 * (stremio, nuvio, or jellyfin for any Jellyfin-compatible server).
 *
 * Usage:
 *   const { makeCreateProvider } = require('./providers')
 *   const createProvider = makeCreateProvider({ prisma, encrypt })
 *   const provider = createProvider(user, { decrypt, req })
 *   if (!provider) return res.status(400).json({ error: 'User not connected' })
 *   const { addons } = await provider.getAddons()
 */

const { createStremioProvider } = require("./stremio");
const { createNuvioProvider } = require("./nuvio");
const { createJellyfinProvider } = require("./jellyfin");
const { resolveServerConfigForAccount } = require("./supabase");

function makeCreateProvider({ prisma, encrypt, getAccountId } = {}) {
    return function createProviderLocal(user, { decrypt, req }) {
        const type = user.providerType || "stremio";

        try {
            if (type === "nuvio") {
                if (!(user.nuvioRefreshToken && user.nuvioUserId)) {
                    return null;
                }

                // A merged user's absorbed second provider (see
                // server/utils/userMerge.js / UserProviderCredential) still needs
                // user.id to be the real surviving User.id - that's what group-
                // membership lookups elsewhere in the sync pipeline match against -
                // but that means the DEFAULT persistence below (keyed on that same
                // id) would refresh-write into the survivor's own User.nuvioRefreshToken
                // field instead of the absorbed UserProviderCredential row it
                // actually belongs to. __persistNuvioRefreshToken lets a caller
                // building a credentials object for a secondary provider override
                // WHERE a refreshed token is persisted without changing WHICH id
                // group lookups see - same plaintext-in contract as the default
                // closure (encrypts it itself), so this is a drop-in replacement,
                // not a different calling convention.
                const onTokenRefresh =
                    typeof user.__persistNuvioRefreshToken === "function"
                        ? async (newRefreshToken) =>
                              user.__persistNuvioRefreshToken(encrypt(newRefreshToken, req))
                        : prisma && encrypt && user.id
                          ? async (newRefreshToken) => {
                                const encrypted = encrypt(newRefreshToken, req);
                                // Nuvio rotates the refresh token every time it is used, so
                                // the old one stops working. One Nuvio account can now be
                                // held by more than one user here - one per profile - and
                                // they all authenticate with the same credential. Saving the
                                // rotated token against only the user that happened to
                                // trigger the refresh would leave every sibling holding a
                                // token that has already been spent, and they would fail to
                                // connect the next time they were used. So every user on the
                                // same Nuvio account is moved to the new token together.
                                if (user.nuvioUserId) {
                                    await prisma.user.updateMany({
                                        data: { nuvioRefreshToken: encrypted },
                                        where: {
                                            nuvioUserId: user.nuvioUserId,
                                            providerType: "nuvio",
                                            ...(user.accountId
                                                ? { accountId: user.accountId }
                                                : {}),
                                        },
                                    });
                                } else {
                                    await prisma.user.update({
                                        data: { nuvioRefreshToken: encrypted },
                                        where: { id: user.id },
                                    });
                                }
                            }
                          : undefined;

                return createNuvioProvider({
                    onTokenRefresh,
                    // Which of the account's profiles this user's addon list belongs
                    // to. Passed straight through when the caller already selected it;
                    // otherwise the resolver below reads it once, on first use, so a
                    // caller that selected only the columns it needed cannot end up
                    // writing one profile's addons into another's list.
                    profileId: user.nuvioProfileId,
                    refreshToken: decrypt(user.nuvioRefreshToken, req),
                    // Which of the account's profiles count as this person's viewing.
                    resolveLibraryProfiles:
                        prisma && user.id
                            ? (allIndexes) =>
                                  require("../utils/nuvioProfiles").ownedProfileIndexes(
                                      prisma,
                                      user.id,
                                      allIndexes
                                  )
                            : undefined,
                    resolveProfileId:
                        prisma && user.id
                            ? async () => {
                                  const row = await prisma.user.findUnique({
                                      select: { nuvioProfileId: true, providerType: true },
                                      where: { id: user.id },
                                  });
                                  return row?.providerType === "nuvio" ? row.nuvioProfileId : 1;
                              }
                            : undefined,
                    // Lets an account point Nuvio at its own self-hosted backend
                    // instead of api.nuvio.tv. Passed as a resolver rather than a
                    // value because this factory is synchronous everywhere it's
                    // called and the lookup needs a DB read - the provider resolves
                    // it on first use and caches it. Falls back to the env vars, then
                    // the public defaults, so an account that sets nothing is
                    // completely unaffected.
                    resolveServerConfig: prisma
                        ? () => {
                              const accountId =
                                  (typeof getAccountId === "function" ? getAccountId(req) : null) ||
                                  user.accountId ||
                                  "default";
                              return resolveServerConfigForAccount(prisma, accountId);
                          }
                        : undefined,
                    userId: user.nuvioUserId,
                });
            }

            if (type === "jellyfin") {
                const build = (row) =>
                    createJellyfinProvider({
                        onProfileUnauthorized: prisma
                            ? (profile) =>
                                  require("../utils/jellyfinProfiles").forgetProfileSignIn(
                                      prisma,
                                      profile.id
                                  )
                            : undefined,
                        // The household profiles this person tracks on an AIOStreams or
                        // AIOMetadata configuration (utils/jellyfinProfiles.js). An absorbed
                        // login is only its own sign-in.
                        resolveProfiles:
                            prisma && user.id && !user.__recordAs
                                ? () =>
                                      require("../utils/jellyfinProfiles").trackedProfiles(
                                          prisma,
                                          (text) => decrypt(text, req),
                                          user.id
                                      )
                                : undefined,
                        serverId: row.jellyfinServerId,
                        serverKind: row.jellyfinServerKind || "jellyfin",
                        serverUrl: row.jellyfinServerUrl,
                        // Whose viewing it is: a merged person's absorbed login reads its
                        // own server but its viewing belongs to the person.
                        slicksyncUserId: user.__recordAs || user.id,
                        token: decrypt(row.jellyfinToken, req),
                        userId: row.jellyfinUserId,
                    });
                if (user.jellyfinToken && user.jellyfinServerUrl && user.jellyfinUserId) {
                    return build(user);
                }
                // Most callers select only the columns they need, and none of them
                // knew these columns before this provider existed - so the sign-in
                // is read on first use, the same way Nuvio resolves its profile.
                if (!(prisma && user.id)) {
                    return null;
                }
                return lazyJellyfinProvider(async () => {
                    const row = await prisma.user.findUnique({
                        select: {
                            jellyfinServerId: true,
                            jellyfinServerKind: true,
                            jellyfinServerUrl: true,
                            jellyfinToken: true,
                            jellyfinUserId: true,
                        },
                        where: { id: user.id },
                    });
                    if (!(row?.jellyfinToken && row.jellyfinServerUrl && row.jellyfinUserId)) {
                        throw new Error("Unauthorized: not signed in to the Jellyfin server");
                    }
                    return build(row);
                });
            }

            // Default: stremio
            if (!user.stremioAuthKey) {
                return null;
            }
            return createStremioProvider({
                authKey: decrypt(user.stremioAuthKey, req),
            });
        } catch (e) {
            console.warn("createProvider failed for user", user?.id, ":", e?.message);
            return null;
        }
    };
}

// A Jellyfin provider whose sign-in is read on the first call. Same surface
// as createJellyfinProvider's; every method waits for the real one.
function lazyJellyfinProvider(load) {
    let pending = null;
    const real = () => {
        pending = pending || load();
        return pending;
    };
    const forward =
        (name) =>
        async (...args) => {
            const provider = await real();
            return provider[name](...args);
        };
    const lazy = { supportsAddons: false, supportsLibraryWrite: true, type: "jellyfin" };
    for (const name of [
        "getAddons",
        "setAddons",
        "addAddon",
        "clearAddons",
        "getLibrary",
        "getNowPlaying",
        "findItem",
        "listEpisodes",
        "playedUpTo",
        "setPlayed",
        "setFavorite",
        "clearResume",
        "watchState",
        "titleIndex",
        "episodesOf",
        "setPlayedAt",
        "setPosition",
        "runtimeMs",
        "controllableSessions",
        "playOn",
        "addLibraryItem",
        "removeLibraryItem",
        "getLikeStatus",
        "setLikeStatus",
    ]) {
        lazy[name] = forward(name);
    }
    return lazy;
}

// Backward compat: unconfigured version (no token persistence on refresh).
// Use makeCreateProvider({ prisma, encrypt }) for full functionality.
const createProvider = makeCreateProvider();

module.exports = { createProvider, makeCreateProvider };
