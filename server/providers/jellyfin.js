/**
 * Jellyfin provider - a person whose app signs in to a Jellyfin-compatible
 * server: a real Jellyfin, the media server an AIOStreams configuration runs
 * (its web and desktop apps, Infuse, Swiftfin, Findroid...), or AIOMetadata's.
 *
 * One provider is one user on one server, signed in with that user's own
 * token. The server already keeps what they watched - resume points, played
 * marks, favourites - so getLibrary() reads that and hands it back in the
 * same shape the Stremio and Nuvio providers return, which is what every
 * history, session and metrics step downstream reads. What is playing right
 * now comes from the server's own sessions list.
 *
 * There is no addon list on any of these servers for SlickSync to manage, so
 * the addon methods answer "unsupported" and sync leaves these people out.
 */

const { jfRequest, deviceIdFor } = require("./jellyfinAuth");

const TICKS_PER_MS = 10_000;
const PLAYED_LIMIT = 1000;
const FAVORITES_LIMIT = 500;

function ticksToMs(ticks) {
    const n = Number(ticks);
    return Number.isFinite(n) && n > 0 ? Math.round(n / TICKS_PER_MS) : 0;
}

// A series' own ids, which its episodes do not carry: the show's IMDb id is
// on the Series item. Server ids never change, so they are kept across polls.
const seriesIdCache = new Map(); // `${serverKey}:${seriesItemId}` -> { id, name } | null
const SERIES_CACHE_MAX = 5000;
function rememberSeries(key, value) {
    if (seriesIdCache.size >= SERIES_CACHE_MAX) {
        seriesIdCache.delete(seriesIdCache.keys().next().value);
    }
    seriesIdCache.set(key, value);
}

// The ids a Stremio addon would use, in the order SlickSync prefers them.
function stremioIdFromProviderIds(providerIds) {
    if (!providerIds || typeof providerIds !== "object") {
        return null;
    }
    const get = (name) => {
        for (const [k, v] of Object.entries(providerIds)) {
            if (k.toLowerCase() === name && v != null && String(v).trim()) {
                return String(v).trim();
            }
        }
        return null;
    };
    const imdb = get("imdb");
    if (imdb && /^tt\d+$/.test(imdb)) {
        return imdb;
    }
    const tmdb = get("tmdb");
    if (tmdb && /^\d+$/.test(tmdb)) {
        return `tmdb:${tmdb}`;
    }
    const tvdb = get("tvdb");
    if (tvdb && /^\d+$/.test(tvdb)) {
        return `tvdb:${tvdb}`;
    }
    return null;
}

/*
 * AIOStreams and AIOMetadata both build item ids the same way instead of
 * storing them: 16 bytes, byte 0 = 0xa1, then kind and id type, media type, a
 * 48-bit numeric id, season and episode (0xffff for none). Decoding one gives
 * the title's own id even when the server sent no provider ids, and encoding
 * one is how a title SlickSync knows by IMDb id is found on those servers.
 */
const PACKED = 0xa1;
const KIND_CODES = { episode: 4, movie: 1, season: 3, series: 2 };
const ID_TYPES = [null, "tt", "tmdb:", "tvdb:", "kitsu:", "mal:", "anilist:", "anidb:"];

function decodePackedId(hexId) {
    const hex = String(hexId || "")
        .replace(/-/g, "")
        .toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) {
        return null;
    }
    const buf = Buffer.from(hex, "hex");
    if (buf[0] !== PACKED) {
        return null;
    }
    const kindCode = buf[1] >> 4;
    const prefix = ID_TYPES[buf[1] & 0x0f];
    if (!prefix) {
        return null;
    }
    const numeric = buf.readUIntBE(3, 6);
    const season = buf.readUInt16BE(9);
    const episode = buf.readUInt16BE(11);
    const base = prefix === "tt" ? `tt${String(numeric).padStart(7, "0")}` : `${prefix}${numeric}`;
    const kind = Object.keys(KIND_CODES).find((k) => KIND_CODES[k] === kindCode) || null;
    return {
        base,
        episode: episode === 0xff_ff ? null : episode,
        kind,
        season: season === 0xff_ff ? null : season,
    };
}

function encodePackedId({ kind, base, season = null, episode = null, version = 0 }) {
    const m = /^(tt|tmdb:|tvdb:|kitsu:|mal:|anilist:|anidb:)(\d+)$/.exec(String(base || ""));
    if (!(m && KIND_CODES[kind])) {
        return null;
    }
    const idType = ID_TYPES.indexOf(m[1]);
    const numeric = Number(m[2]);
    if (!Number.isSafeInteger(numeric) || numeric > 2 ** 48 - 1) {
        return null;
    }
    const buf = Buffer.alloc(16);
    buf[0] = PACKED;
    buf[1] = (KIND_CODES[kind] << 4) | idType;
    buf[2] = kind === "movie" ? 1 : 2;
    buf.writeUIntBE(numeric, 3, 6);
    buf.writeUInt16BE(season == null ? 0xff_ff : season, 9);
    buf.writeUInt16BE(episode == null ? 0xff_ff : episode, 11);
    buf[13] = version;
    return buf.toString("hex");
}

/**
 * A Stremio-style id in its parts: the title's own id, then season and
 * episode. An IMDb id is one part (tt123:1:2); a prefixed one is two
 * (tmdb:603, kitsu:46676:1), so splitting on the first ':' alone read
 * "tmdb:209867" as show "tmdb", season 209867.
 */
// Whether an episode carries one of AIOMetadata's filler tags, exactly.
function episodeTagged(item, tag) {
    return Array.isArray(item?.Tags) && item.Tags.includes(tag);
}

function splitStremioId(id) {
    const parts = String(id || "").split(":");
    const prefixed = parts.length > 1 && !/^tt\d+$/i.test(parts[0]);
    const rest = parts.slice(prefixed ? 2 : 1);
    return {
        base: prefixed ? `${parts[0]}:${parts[1]}` : parts[0],
        episode: rest[1],
        season: rest[0],
    };
}

// metahub for an IMDb id; otherwise the server's own poster when its images
// are open (utils/jellyfinImages.js) - anime and TMDb/TVDB-only titles had
// none. `serverPoster` is that address, or null.
function posterFor(stremioId, serverPoster = null) {
    if (/^tt\d+$/.test(stremioId || "")) {
        return `https://images.metahub.space/poster/medium/${stremioId}/img`;
    }
    return serverPoster || null;
}

// Asks for the Primary image tag the poster address needs.
const IMAGE_PARAMS = { EnableImages: "true", EnableImageTypes: "Primary", ImageTypeLimit: "1" };

function dateMs(value) {
    const t = value ? new Date(value).getTime() : Number.NaN;
    return Number.isFinite(t) ? t : 0;
}

function createJellyfinProvider({
    serverUrl,
    token,
    userId,
    serverKind = "jellyfin",
    serverId,
    deviceId,
    slicksyncUserId,
    onUnauthorized,
    resolveProfiles,
    onProfileUnauthorized,
}) {
    const base = serverUrl;
    const serverKey = serverId || serverUrl;
    const device = deviceId || deviceIdFor(serverUrl, userId);
    const isAio = serverKind === "aiostreams" || serverKind === "aiometadata";
    const kindLabel =
        serverKind === "aiostreams"
            ? "AIOStreams"
            : serverKind === "aiometadata"
              ? "AIOMetadata"
              : "Jellyfin";

    // Whose sign-in a request runs as: the person's own, or one of their
    // household profiles (utils/jellyfinProfiles.js), each with its own token.
    const self = { label: null, token, userId };

    async function call(path, opts = {}, viewer = self) {
        try {
            return await jfRequest(base, path, { deviceId: device, token: viewer.token, ...opts });
        } catch (e) {
            // Same wording the activity monitor already treats as "Reconnect needed".
            if (e.status === 401) {
                if (viewer === self && typeof onUnauthorized === "function") {
                    try {
                        await onUnauthorized();
                    } catch {}
                }
                throw Object.assign(
                    new Error(
                        `Unauthorized: the ${kindLabel} sign-in${viewer.label ? ` for ${viewer.label}` : ""} no longer works (401)`
                    ),
                    { status: 401 }
                );
            }
            throw e;
        }
    }

    async function itemsQuery(params, viewer = self) {
        const qs = new URLSearchParams({ userId: viewer.userId, ...params });
        const data = await call(`/Items?${qs}`, {}, viewer);
        return Array.isArray(data?.Items) ? data.Items : [];
    }

    async function resumeItems(viewer = self) {
        const qs = new URLSearchParams({
            EnableUserData: "true",
            Fields: "ProviderIds",
            IncludeItemTypes: "Movie,Episode",
            Limit: "200",
            userId: viewer.userId,
            ...IMAGE_PARAMS,
        });
        try {
            const data = await call(`/UserItems/Resume?${qs}`, {}, viewer);
            return Array.isArray(data?.Items) ? data.Items : [];
        } catch (e) {
            // Servers older than 10.9 only know the per-user path.
            if (e.status !== 404) {
                throw e;
            }
            const data = await call(`/Users/${viewer.userId}/Items/Resume?${qs}`, {}, viewer);
            return Array.isArray(data?.Items) ? data.Items : [];
        }
    }

    // What this user has playing right now. A user's own token sees only their
    // own sessions, on every kind of server.
    async function nowPlaying(viewer = self) {
        const mine = (s) =>
            s?.NowPlayingItem &&
            (!s.UserId || String(s.UserId).replace(/-/g, "").toLowerCase() === viewer.userId);
        // AIOMetadata (3.6.1+) lists only the asking device's playback on
        // /Sessions; every device of the account is on /AIOStreams/Activity,
        // which answers in full to the main sign-in - the one SlickSync holds.
        if (serverKind === "aiometadata") {
            const activity = await call("/AIOStreams/Activity").catch(() => null);
            if (Array.isArray(activity?.sessions)) {
                return activity.sessions.filter(mine);
            }
        }
        const sessions = await call("/Sessions", {}, viewer);
        if (!Array.isArray(sessions)) {
            return [];
        }
        return sessions.filter(mine);
    }

    /** The show's own id and name for each series item id. */
    async function resolveSeries(seriesItemIds, viewer = self) {
        const out = new Map();
        const missing = [];
        for (const id of seriesItemIds) {
            const key = `${serverKey}:${id}`;
            if (seriesIdCache.has(key)) {
                out.set(id, seriesIdCache.get(key));
            } else {
                missing.push(id);
            }
        }
        for (let i = 0; i < missing.length; i += 100) {
            const chunk = missing.slice(i, i + 100);
            let items = [];
            try {
                items = await itemsQuery({ Fields: "ProviderIds", Ids: chunk.join(",") }, viewer);
            } catch {
                items = [];
            }
            const found = new Map(
                items.map((it) => [String(it.Id).replace(/-/g, "").toLowerCase(), it])
            );
            for (const id of chunk) {
                const it = found.get(id);
                let stremioId = it ? stremioIdFromProviderIds(it.ProviderIds) : null;
                if (!stremioId) {
                    stremioId = decodePackedId(id)?.base || null;
                }
                const value = stremioId ? { id: stremioId, name: it?.Name || null } : null;
                // An item the server could not answer for this time is asked again
                // next poll rather than remembered as unknown.
                if (it || value) {
                    rememberSeries(`${serverKey}:${id}`, value);
                }
                out.set(id, value);
            }
        }
        return out;
    }

    function normId(id) {
        return String(id || "")
            .replace(/-/g, "")
            .toLowerCase();
    }

    function movieIdOf(item) {
        return stremioIdFromProviderIds(item.ProviderIds) || decodePackedId(item.Id)?.base || null;
    }

    // The person's household profiles, read once per provider.
    let profilesPromise = null;
    function profileViewers() {
        if (typeof resolveProfiles !== "function") {
            return Promise.resolve([]);
        }
        if (!profilesPromise) {
            profilesPromise = Promise.resolve()
                .then(() => resolveProfiles())
                .then((rows) =>
                    (Array.isArray(rows) ? rows : []).map((p) => ({
                        id: p.id,
                        label: p.name,
                        token: p.token,
                        userId: normId(p.jellyfinUserId),
                    }))
                )
                .catch((e) => {
                    console.warn(
                        "[JellyfinProvider] Could not load household profiles:",
                        e?.message
                    );
                    return [];
                });
        }
        return profilesPromise;
    }
    async function viewerFor(label) {
        if (!label) {
            return self;
        }
        return (await profileViewers()).find((v) => v.label === label) || self;
    }

    /**
     * One sign-in's viewing as SlickSync library entries: one per movie and per
     * show, Stremio-style - a show carries the episode it was last on - plus
     * what is playing right now.
     */
    async function readViewer(viewer) {
        const [resume, played, favorites, live] = await Promise.all([
            resumeItems(viewer),
            itemsQuery(
                {
                    EnableUserData: "true",
                    Fields: "ProviderIds",
                    Filters: "IsPlayed",
                    IncludeItemTypes: "Movie,Episode",
                    Limit: String(PLAYED_LIMIT),
                    Recursive: "true",
                    SortBy: "DatePlayed",
                    SortOrder: "Descending",
                    ...IMAGE_PARAMS,
                },
                viewer
            ),
            itemsQuery(
                {
                    EnableUserData: "true",
                    Fields: "ProviderIds",
                    Filters: "IsFavorite",
                    IncludeItemTypes: "Movie,Series",
                    Limit: String(FAVORITES_LIMIT),
                    Recursive: "true",
                    ...IMAGE_PARAMS,
                },
                viewer
            ).catch(() => []),
            nowPlaying(viewer).catch(() => []),
        ]);

        // Live positions win over what the server last saved: clients report
        // progress to the session every few seconds, but the saved resume point
        // can lag until they pause or stop.
        const liveById = new Map();
        const now = Date.now();
        for (const s of live) {
            const it = s.NowPlayingItem;
            liveById.set(normId(it.Id), {
                // Which device and app - "Living room TV", "Infuse". Real Jellyfin
                // and AIOStreams (its /Sessions lists what its users play) report
                // these; AIOMetadata keeps no sessions list.
                device:
                    s.DeviceId || s.DeviceName
                        ? {
                              client: s.Client || null,
                              id: s.DeviceId || null,
                              name: s.DeviceName || null,
                          }
                        : null,
                item: it,
                paused: s.PlayState?.IsPaused === true,
                positionMs: ticksToMs(s.PlayState?.PositionTicks),
            });
        }

        const seriesIds = new Set();
        for (const it of [...resume, ...played, ...live.map((s) => s.NowPlayingItem)]) {
            if (it?.Type === "Episode" && it.SeriesId) {
                seriesIds.add(normId(it.SeriesId));
            }
        }
        const series = await resolveSeries([...seriesIds], viewer);

        // The server's own posters, unless it wants a sign-in for images.
        const { serverPosterUrl, imagesOpen } = require("../utils/jellyfinImages");
        const sample = [...resume, ...played, ...live.map((s) => s.NowPlayingItem), ...favorites]
            .map((it) => serverPosterUrl(base, it))
            .find(Boolean);
        const useServerPosters = sample ? await imagesOpen(serverKey, sample) : false;
        const serverPoster = (it) => (useServerPosters ? serverPosterUrl(base, it) : null);

        // Candidates are ranked by when they were last touched; a live one is "now".
        const entries = new Map();
        function consider(
            it,
            { livePos = null, liveAt = null, paused = false, device = null } = {}
        ) {
            if (!it || (it.Type !== "Movie" && it.Type !== "Episode")) {
                return;
            }
            const ud = it.UserData || {};
            const durationMs = ticksToMs(it.RunTimeTicks);
            let id,
                type,
                name,
                videoId = null,
                season = null,
                episode = null;
            if (it.Type === "Movie") {
                id = movieIdOf(it);
                type = "movie";
                name = it.Name || "";
                videoId = id;
            } else {
                const show = series.get(normId(it.SeriesId));
                id = show?.id || null;
                type = "series";
                name = it.SeriesName || show?.name || "";
                season = Number.isInteger(it.ParentIndexNumber) ? it.ParentIndexNumber : null;
                episode = Number.isInteger(it.IndexNumber) ? it.IndexNumber : null;
                if (id && season != null && episode != null) {
                    videoId = `${id}:${season}:${episode}`;
                }
                if (!videoId) {
                    const packed = decodePackedId(it.Id);
                    if (id && packed?.season != null && packed?.episode != null) {
                        videoId = `${id}:${packed.season}:${packed.episode}`;
                    }
                }
            }
            if (!id) {
                return;
            }

            let positionMs = livePos === null ? ticksToMs(ud.PlaybackPositionTicks) : livePos;
            // Played with no position left is how a server records "finished":
            // it clears the resume point. Reported as at the end, the way the
            // other providers report a finished title.
            const finished = livePos == null && ud.Played === true && positionMs === 0;
            if (finished && durationMs > 0) {
                positionMs = durationMs;
            }
            const lastWatchedMs = liveAt || dateMs(ud.LastPlayedDate) || 0;
            const candidate = {
                _ctime: lastWatchedMs || now,
                _id: id,
                _jf: {
                    device,
                    itemId: normId(it.Id),
                    live: livePos != null,
                    paused,
                    profile: viewer.label,
                    seriesId: it.SeriesId ? normId(it.SeriesId) : null,
                },
                _mtime: lastWatchedMs || now,
                name,
                poster: posterFor(id, serverPoster(it)),
                removed: false,
                state: {
                    duration: durationMs,
                    episode,
                    flaggedWatched: ud.Played === true ? 1 : 0,
                    lastWatched: lastWatchedMs ? new Date(lastWatchedMs).toISOString() : null,
                    overallTimeWatched: positionMs,
                    season,
                    timeOffset: positionMs,
                    timesWatched: Number(ud.PlayCount) || 0,
                    timeWatched: 0,
                    video_id: videoId,
                    // Which household profile it was watched on, if not the person's
                    // own sign-in - history and watch time carry it, like a Nuvio profile.
                    ...(viewer.label ? { profileLabel: viewer.label } : {}),
                    // Positions here are where playback is, not time spent: a seek
                    // jumps them. Metrics caps what such a jump can add by the real
                    // time that passed (see metricsProcessor's wall-clock cap).
                    wallClockCapped: true,
                },
                type,
            };
            const kept = entries.get(id);
            if (!kept || candidate._mtime > kept._mtime || (candidate._jf.live && !kept._jf.live)) {
                entries.set(id, candidate);
            }
        }

        for (const it of played) {
            consider(it);
        }
        for (const it of resume) {
            consider(it);
        }
        for (const [, l] of liveById) {
            consider(l.item, {
                device: l.device,
                liveAt: l.paused ? null : now,
                livePos: l.positionMs,
                paused: l.paused,
            });
        }

        // Favourites with nothing played are library bookmarks, the same as a
        // Stremio library item that was added but never opened.
        for (const it of favorites) {
            const id =
                it.Type === "Series"
                    ? stremioIdFromProviderIds(it.ProviderIds) || decodePackedId(it.Id)?.base
                    : movieIdOf(it);
            if (!id || entries.has(id)) {
                continue;
            }
            entries.set(id, {
                _ctime: now,
                _id: id,
                _jf: { favorite: true, itemId: normId(it.Id), profile: viewer.label },
                _mtime: now,
                name: it.Name || "",
                poster: posterFor(id, serverPoster(it)),
                removed: false,
                state: viewer.label ? { profileLabel: viewer.label } : {},
                type: it.Type === "Series" ? "series" : "movie",
            });
        }
        for (const entry of entries.values()) {
            if (
                favorites.some(
                    (f) => normId(f.Id) === entry._jf.itemId || normId(f.Id) === entry._jf.seriesId
                )
            ) {
                entry._jf.favorite = true;
            }
        }
        // AIOStreams names an item by its IMDb id when its metadata has no
        // title; everything downstream (history, Activity, the bell) would show
        // "tt4468740". Real titles from utils/titleNames.
        await require("../utils/titleNames")
            .fillNames([...entries.values()], {
                getId: (e) => e._id,
                getName: (e) => e.name,
                getType: (e) => e.type,
                setName: (e, name) => {
                    e.name = name;
                },
            })
            .catch(() => undefined);
        return entries;
    }

    return {
        async addAddon() {
            return null;
        },

        // Stremio's library is Jellyfin's favourites: adding a title to the
        // library favourites it, removing one unfavourites it.
        async addLibraryItem(changes) {
            for (const change of Array.isArray(changes) ? changes : [changes]) {
                const id = change?._jf?.itemId || (await this.findItem(change._id, change.type));
                if (!id) {
                    continue;
                }
                await this.setFavorite(id, change.removed !== true, change?._jf?.profile || null);
            }
            return { ok: true };
        },
        async clearAddons() {
            return null;
        },

        /** Take a title out of Continue Watching without marking it watched. */
        async clearResume(itemId, profile = null) {
            const viewer = await viewerFor(profile);
            return call(
                `/UserItems/${itemId}/UserData?userId=${viewer.userId}`,
                { body: { PlaybackPositionTicks: 0 }, method: "POST" },
                viewer
            );
        },

        /**
         * Devices this sign-in can start a title on: its own sessions in any
         * Jellyfin app that takes remote commands (the official apps included),
         * seen in the last 15 minutes. A real Jellyfin only - AIOStreams and
         * AIOMetadata accept the commands but do nothing with them.
         */
        async controllableSessions() {
            if (isAio) {
                return [];
            }
            const sessions = await call(
                `/Sessions?${new URLSearchParams({ ActiveWithinSeconds: "900", ControllableByUserId: userId })}`
            );
            return (Array.isArray(sessions) ? sessions : [])
                .filter((s) => s?.Id && s.SupportsRemoteControl && s.DeviceId !== device)
                .map((s) => ({
                    client: s.Client || null,
                    device: s.DeviceName || "A device",
                    id: s.Id,
                    playing: s.NowPlayingItem?.Name || null,
                }));
        },

        /** A show's episodes by the show's item id: [{ itemId, season, episode }]. */
        async episodesOf(seriesItemId) {
            const data = await call(
                `/Shows/${seriesItemId}/Episodes?${new URLSearchParams({ userId })}`
            );
            return (Array.isArray(data?.Items) ? data.Items : [])
                .filter(
                    (it) =>
                        Number.isInteger(it.ParentIndexNumber) && Number.isInteger(it.IndexNumber)
                )
                .map((it) => ({
                    episode: it.IndexNumber,
                    itemId: normId(it.Id),
                    season: it.ParentIndexNumber,
                }));
        },

        // --- Library writes ---

        /**
         * The server's item for a title SlickSync knows by its own id
         * (tt123 / tt123:1:2). AIOStreams and AIOMetadata build their ids from
         * the title's id, so they are computed and checked; a real Jellyfin is
         * searched through its movies and shows.
         */
        async findItem(stremioId, type) {
            const { base: baseId, season: s, episode: e } = splitStremioId(stremioId);
            const season = s != null && s !== "" ? Number(s) : null;
            const episode = e != null && e !== "" ? Number(e) : null;
            const wantEpisode =
                type === "series" && Number.isInteger(season) && Number.isInteger(episode);
            if (isAio) {
                for (const version of [0, 1]) {
                    const id = encodePackedId({
                        base: baseId,
                        episode: wantEpisode ? episode : null,
                        kind: wantEpisode ? "episode" : type === "series" ? "series" : "movie",
                        season: wantEpisode ? season : null,
                        version,
                    });
                    if (!id) {
                        break;
                    }
                    try {
                        const item = await call(`/Items/${id}?userId=${userId}`);
                        if (item?.Id) {
                            return normId(item.Id);
                        }
                    } catch {
                        /* try the next layout */
                    }
                }
                return null;
            }
            const kind = type === "series" ? "Series" : "Movie";
            const all = await itemsQuery({
                Fields: "ProviderIds",
                IncludeItemTypes: kind,
                Limit: "5000",
                Recursive: "true",
            });
            const match = all.find((it) => stremioIdFromProviderIds(it.ProviderIds) === baseId);
            if (!match) {
                return null;
            }
            if (!wantEpisode) {
                return normId(match.Id);
            }
            const eps = await call(
                `/Shows/${match.Id}/Episodes?${new URLSearchParams({ season: String(season), userId })}`
            );
            const ep = (Array.isArray(eps?.Items) ? eps.Items : []).find(
                (it) =>
                    it.IndexNumber === episode &&
                    (it.ParentIndexNumber == null || it.ParentIndexNumber === season)
            );
            return ep ? normId(ep.Id) : null;
        },
        async getAddons() {
            return { addons: [], unsupported: true };
        },

        // --- Content ---

        /**
         * The person's viewing: their own sign-in's, and each household profile
         * they track, merged one entry per title - the most recently touched wins,
         * the way a Nuvio account's profiles are merged. A profile that cannot be
         * read this time is left out of this pass; the person's own sign-in
         * failing is a connection problem and is reported as one.
         */
        async getLibrary() {
            const profiles = await profileViewers();
            const own = await readViewer(self);
            const merged = new Map(own);
            const reads = await Promise.all(
                profiles.map((viewer) =>
                    readViewer(viewer).catch(async (e) => {
                        console.warn(
                            `[JellyfinProvider] Could not read profile ${viewer.label}:`,
                            e?.message
                        );
                        // Signed out on the server (a PIN change, a password change): the
                        // household card asks for a fresh sign-in instead of failing quietly.
                        if (e?.status === 401 && typeof onProfileUnauthorized === "function") {
                            try {
                                await onProfileUnauthorized(viewer);
                            } catch {}
                        }
                        return null;
                    })
                )
            );
            for (const entries of reads) {
                if (!entries) {
                    continue;
                }
                for (const [id, candidate] of entries) {
                    const kept = merged.get(id);
                    if (
                        !kept ||
                        candidate._mtime > kept._mtime ||
                        (candidate._jf.live && !kept._jf.live)
                    ) {
                        merged.set(id, candidate);
                    }
                }
            }

            // Now Playing reads this, between polls - see utils/jellyfinLive.js.
            // Everything playing on any of the person's sign-ins counts, not only
            // the entry that won the merge for its title.
            try {
                const playing = [];
                for (const entries of [own, ...reads]) {
                    if (!entries) {
                        continue;
                    }
                    for (const e of entries.values()) {
                        if (!e._jf.live) {
                            continue;
                        }
                        playing.push({
                            device: e._jf.device || null,
                            durationMs: e.state.duration || null,
                            episode: e.state.episode,
                            itemId: e._id,
                            itemName: e.name || null,
                            itemType: e.type,
                            paused: e._jf.paused === true,
                            positionMs: e.state.timeOffset || 0,
                            poster: e.poster,
                            profileLabel: e._jf.profile || null,
                            season: e.state.season,
                            videoId: e.type === "series" ? e.state.video_id : null,
                        });
                    }
                }
                require("../utils/jellyfinLive").recordLive(slicksyncUserId, playing);
            } catch {}

            return [...merged.values()];
        },

        // Likes - no equivalent
        async getLikeStatus() {
            return null;
        },

        /** What is playing for this user now, straight from the server. */
        async getNowPlaying() {
            return nowPlaying();
        },

        /**
         * A show's episodes on the server, by the show's own id (tt123, tmdb:1):
         * [{ itemId, season, episode, title, premiere, played }]. Null when the
         * server doesn't have the show.
         */
        async listEpisodes(stremioShowId) {
            const seriesId = await this.findItem(splitStremioId(stremioShowId).base, "series");
            if (!seriesId) {
                return null;
            }
            const data = await call(
                `/Shows/${seriesId}/Episodes?${new URLSearchParams({ EnableUserData: "true", Fields: "PremiereDate,Tags", userId })}`
            );
            return (Array.isArray(data?.Items) ? data.Items : [])
                .filter(
                    (it) =>
                        Number.isInteger(it.ParentIndexNumber) && Number.isInteger(it.IndexNumber)
                )
                .map((it) => ({
                    episode: it.IndexNumber,
                    // Anime filler and recap episodes: AIOStreams says so in its own
                    // field (its "fillers" extension), AIOMetadata in the episode's
                    // Tags ("Filler", "Recap"; its "Mixed Canon/Filler" still has story
                    // in it, so it isn't marked). Other servers never say.
                    filler: it.aiostreams?.filler === true || episodeTagged(it, "Filler"),
                    itemId: normId(it.Id),
                    played: it.UserData?.Played === true,
                    premiere: it.PremiereDate || null,
                    recap: it.aiostreams?.recap === true || episodeTagged(it, "Recap"),
                    season: it.ParentIndexNumber,
                    title: it.Name || null,
                }));
        },

        /**
         * "This episode and every aired one before it" in one call instead of one
         * per episode. AIOStreams has it, and so does AIOMetadata (it offers the
         * same extensions); only where the server says so (features.playedUpTo).
         * Its /AIOStreams/ routes take a sign-in, never an API key. Returns false
         * when it isn't there, so the caller goes per episode.
         */
        async playedUpTo(episodeItemId) {
            if (serverKind === "jellyfin") {
                return false;
            }
            const info = await call("/System/Info/Public").catch(() => null);
            if (!info?.aiostreams?.features?.playedUpTo) {
                return false;
            }
            await call(`/AIOStreams/PlayedUpTo/${episodeItemId}`, { method: "POST" });
            return true;
        },

        /** Starts an item on one of controllableSessions(). */
        async playOn(sessionId, itemId) {
            if (isAio) {
                throw Object.assign(
                    new Error("Only a Jellyfin server can start a title on a device"),
                    { status: 400 }
                );
            }
            await call(
                `/Sessions/${encodeURIComponent(sessionId)}/Playing?${new URLSearchParams({ itemIds: itemId, playCommand: "PlayNow" })}`,
                { method: "POST" }
            );
            return true;
        },

        // Removing a title takes it off the device: out of favourites and out of
        // Continue Watching. What was watched stays watched.
        async removeLibraryItem(changes) {
            const library = await this.getLibrary();
            for (const change of Array.isArray(changes) ? changes : [changes]) {
                const entry = library.find((it) => it._id === change._id);
                const ids = new Set();
                if (entry?._jf?.itemId) {
                    ids.add(entry._jf.itemId);
                }
                if (!entry) {
                    const found = await this.findItem(change._id, change.type);
                    if (found) {
                        ids.add(found);
                    }
                }
                const profile = entry?._jf?.profile || null;
                for (const id of ids) {
                    await this.setFavorite(id, false, profile).catch(() => undefined);
                    await this.clearResume(id, profile).catch(() => undefined);
                }
                if (entry?._jf?.seriesId) {
                    await this.setFavorite(entry._jf.seriesId, false, profile).catch(
                        () => undefined
                    );
                }
            }
            return { ok: true };
        },

        /** An item's runtime (ms), or 0 when the server doesn't say. */
        async runtimeMs(itemId, profile = null) {
            const viewer = await viewerFor(profile);
            const it = await call(`/Items/${itemId}?userId=${viewer.userId}`, {}, viewer).catch(
                () => null
            );
            return ticksToMs(it?.RunTimeTicks);
        },
        serverKind,
        async setAddons() {
            return null;
        },

        async setFavorite(itemId, favorite, profile = null) {
            const viewer = await viewerFor(profile);
            return call(
                `/UserFavoriteItems/${itemId}?userId=${viewer.userId}`,
                { method: favorite ? "POST" : "DELETE" },
                viewer
            );
        },
        async setLikeStatus() {
            return null;
        },

        async setPlayed(itemId, played, profile = null) {
            const viewer = await viewerFor(profile);
            return call(
                `/UserPlayedItems/${itemId}?userId=${viewer.userId}`,
                { method: played ? "POST" : "DELETE" },
                viewer
            );
        },

        /** Mark played on the date it was really watched (Jellyfin keeps it as the last-played date). */
        async setPlayedAt(itemId, at, profile = null) {
            const viewer = await viewerFor(profile);
            const date = at ? `&datePlayed=${encodeURIComponent(new Date(at).toISOString())}` : "";
            return call(
                `/UserPlayedItems/${itemId}?userId=${viewer.userId}${date}`,
                { method: "POST" },
                viewer
            );
        },

        /** Put a resume point on an item (0 clears it). */
        async setPosition(itemId, positionMs, profile = null, at = null) {
            const viewer = await viewerFor(profile);
            const body = {
                PlaybackPositionTicks:
                    Math.max(0, Math.round(Number(positionMs) || 0)) * TICKS_PER_MS,
            };
            if (at) {
                body.LastPlayedDate = new Date(at).toISOString();
            }
            return call(
                `/UserItems/${itemId}/UserData?userId=${viewer.userId}`,
                { body, method: "POST" },
                viewer
            );
        },

        // --- Addons: none of these servers has an addon list to manage ---
        supportsAddons: false,

        supportsLibraryWrite: true,

        /**
         * Which titles this server has at all: the id of each movie and show
         * (tt123, tmdb:1) -> its item id. Only a real Jellyfin has a fixed
         * library to list; AIOStreams and AIOMetadata make any title on request,
         * so they answer null and findItem() is asked instead.
         */
        async titleIndex() {
            if (isAio) {
                return null;
            }
            const index = new Map();
            const PAGE = 1000;
            for (let start = 0; start < 200_000; start += PAGE) {
                const items = await itemsQuery({
                    Fields: "ProviderIds",
                    IncludeItemTypes: "Movie,Series",
                    Limit: String(PAGE),
                    Recursive: "true",
                    StartIndex: String(start),
                });
                for (const it of items) {
                    const id =
                        stremioIdFromProviderIds(it.ProviderIds) || decodePackedId(it.Id)?.base;
                    if (id && !index.has(id)) {
                        index.set(id, {
                            itemId: normId(it.Id),
                            type: it.Type === "Series" ? "series" : "movie",
                        });
                    }
                }
                if (items.length < PAGE) {
                    break;
                }
            }
            return index;
        },
        type: "jellyfin",

        /**
         * Everything one sign-in (or household profile) has finished or has in
         * progress, read in full for Copy watch history: movies and episodes,
         * each with the title's own id, the date and the position.
         * Returns [{ itemId, type, id, season, episode, played, playedAt, positionMs, durationMs, name, seriesName }].
         */
        async watchState(profile = null) {
            const viewer = await viewerFor(profile);
            const PAGE = 500;
            const pages = async (params) => {
                const all = [];
                for (let start = 0; start < 50_000; start += PAGE) {
                    const items = await itemsQuery(
                        { ...params, Limit: String(PAGE), StartIndex: String(start) },
                        viewer
                    );
                    all.push(...items);
                    if (items.length < PAGE) {
                        break;
                    }
                }
                return all;
            };
            const fields = {
                EnableUserData: "true",
                Fields: "ProviderIds",
                IncludeItemTypes: "Movie,Episode",
                Recursive: "true",
            };
            const [played, resume] = await Promise.all([
                pages({
                    ...fields,
                    Filters: "IsPlayed",
                    SortBy: "DatePlayed",
                    SortOrder: "Descending",
                }),
                pages({ ...fields, Filters: "IsResumable" }).catch(() => resumeItems(viewer)),
            ]);
            const seriesIds = new Set(
                [...played, ...resume]
                    .filter((it) => it.Type === "Episode" && it.SeriesId)
                    .map((it) => normId(it.SeriesId))
            );
            const series = await resolveSeries([...seriesIds], viewer);
            const out = new Map();
            for (const it of [...played, ...resume]) {
                if (!it || (it.Type !== "Movie" && it.Type !== "Episode")) {
                    continue;
                }
                const itemId = normId(it.Id);
                if (out.has(itemId)) {
                    continue;
                }
                const ud = it.UserData || {};
                const entry = {
                    durationMs: ticksToMs(it.RunTimeTicks),
                    itemId,
                    name: it.Name || null,
                    played: ud.Played === true,
                    playedAt: dateMs(ud.LastPlayedDate) || null,
                    positionMs: ticksToMs(ud.PlaybackPositionTicks),
                    type: it.Type === "Movie" ? "movie" : "episode",
                };
                if (it.Type === "Movie") {
                    entry.id = movieIdOf(it);
                } else {
                    const show = series.get(normId(it.SeriesId));
                    const packed = decodePackedId(it.Id);
                    entry.id = show?.id || null;
                    entry.seriesName = it.SeriesName || show?.name || null;
                    entry.season = Number.isInteger(it.ParentIndexNumber)
                        ? it.ParentIndexNumber
                        : (packed?.season ?? null);
                    entry.episode = Number.isInteger(it.IndexNumber)
                        ? it.IndexNumber
                        : (packed?.episode ?? null);
                }
                out.set(itemId, entry);
            }
            // Same id-for-a-name repair as readViewer, for AIOSync's reads.
            const list = [...out.values()];
            const names = require("../utils/titleNames");
            await names
                .fillNames(
                    list.filter((e) => e.type === "movie"),
                    {
                        getId: (e) => e.id,
                        getName: (e) => e.name,
                        getType: () => "movie",
                        setName: (e, name) => {
                            e.name = name;
                        },
                    }
                )
                .catch(() => undefined);
            await names
                .fillNames(
                    list.filter((e) => e.type === "episode"),
                    {
                        getId: (e) => e.id,
                        getName: (e) => e.seriesName,
                        getType: () => "series",
                        setName: (e, name) => {
                            e.seriesName = name;
                        },
                    }
                )
                .catch(() => undefined);
            return list;
        },
    };
}

module.exports = {
    createJellyfinProvider,
    decodePackedId,
    encodePackedId,
    splitStremioId,
    stremioIdFromProviderIds,
    ticksToMs,
};
