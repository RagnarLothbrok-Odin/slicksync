const test = require("node:test");
const assert = require("node:assert/strict");
const {
    createJellyfinProvider,
    stremioIdFromProviderIds,
    decodePackedId,
    encodePackedId,
} = require("../server/providers/jellyfin");
const {
    normalizeServerUrl,
    serverKindOf,
    identityEmail,
    displayServer,
} = require("../server/providers/jellyfinAuth");
const jellyfinLive = require("../server/utils/jellyfinLive");

test("provider ids: IMDb first, then TMDb and TVDB, whatever the key casing", () => {
    assert.equal(stremioIdFromProviderIds({ Imdb: "tt0133093", Tmdb: "603" }), "tt0133093");
    assert.equal(stremioIdFromProviderIds({ tmdb: "603" }), "tmdb:603");
    assert.equal(stremioIdFromProviderIds({ Tvdb: "81189" }), "tvdb:81189");
    assert.equal(stremioIdFromProviderIds({ Imdb: "" }), null);
    assert.equal(stremioIdFromProviderIds(null), null);
});

test("packed ids: the ids AIOStreams builds decode to the title and episode, and encode back", () => {
    // Read from a live AIOStreams 2.35 server: Breaking Bad S01E02, and a movie.
    assert.deepEqual(decodePackedId("a141020000000dca4300010002000000"), {
        base: "tt0903747",
        episode: 2,
        kind: "episode",
        season: 1,
    });
    assert.deepEqual(decodePackedId("a1110100000069caf6ffffffff000000"), {
        base: "tt6933238",
        episode: null,
        kind: "movie",
        season: null,
    });
    assert.equal(
        encodePackedId({ base: "tt0903747", episode: 2, kind: "episode", season: 1 }),
        "a141020000000dca4300010002000000"
    );
    assert.equal(
        encodePackedId({ base: "tt6933238", kind: "movie" }),
        "a1110100000069caf6ffffffff000000"
    );
    // A real Jellyfin's ids are random; nothing to decode.
    assert.equal(decodePackedId("c9f640a2e4aaa99571b293c11501718d"), null);
});

test("addresses: what people paste is trimmed to a base every API path can follow", () => {
    assert.equal(
        normalizeServerUrl("jellyfin.example.com/web/index.html#!/home"),
        "https://jellyfin.example.com"
    );
    assert.equal(normalizeServerUrl("http://192.168.1.5:8096/"), "http://192.168.1.5:8096");
    assert.equal(
        normalizeServerUrl("https://aio.example.com/jellyfin/u/family"),
        "https://aio.example.com/jellyfin/u/family"
    );
    assert.equal(normalizeServerUrl("ftp://nope"), "");
    assert.equal(normalizeServerUrl(""), "");
});

test("server kind: AIOMetadata names itself; AIOStreams carries its extension block", () => {
    assert.equal(serverKindOf({ aiostreams: {}, ServerName: "AIOMetadata" }), "aiometadata");
    assert.equal(
        serverKindOf({ aiostreams: { features: {} }, ServerName: "AIOStreams" }),
        "aiostreams"
    );
    assert.equal(
        serverKindOf({ ProductName: "Jellyfin Server", ServerName: "living room" }),
        "jellyfin"
    );
});

test("display: an AIOStreams picker address never shows its encrypted password", () => {
    const picker = `https://aio.example.com/jellyfin/0f2b9c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b/${"x".repeat(120)}`;
    assert.equal(displayServer(picker).includes("x".repeat(41)), false);
    assert.equal(identityEmail("https://jf.example.com", "ABC123"), "abc123@jf.example.com");
});

function fakeServer(routes) {
    const calls = [];
    const original = global.fetch;
    global.fetch = async (url) => {
        const { pathname, searchParams } = new URL(url);
        calls.push(pathname + (searchParams.toString() ? `?${searchParams}` : ""));
        const key = Object.keys(routes).find((k) => `${pathname}?${searchParams}`.includes(k));
        const body = key ? routes[key](searchParams) : { Items: [] };
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    return {
        calls,
        restore: () => {
            global.fetch = original;
        },
    };
}

test("library: played, in-progress and playing titles become one entry per movie and per show", async () => {
    const now = new Date().toISOString();
    const server = fakeServer({
        "/Sessions": () => [
            {
                LastActivityDate: now,
                NowPlayingItem: {
                    Id: "e2",
                    IndexNumber: 2,
                    ParentIndexNumber: 1,
                    RunTimeTicks: 30_000_000_000,
                    SeriesId: "s1",
                    SeriesName: "Breaking Bad",
                    Type: "Episode",
                },
                PlayState: { IsPaused: false, PositionTicks: 600_000_000 },
                UserId: "u1",
            },
        ],
        "/UserItems/Resume": () => ({
            Items: [
                {
                    Id: "m1",
                    Name: "The Matrix",
                    ProviderIds: { Imdb: "tt0133093" },
                    RunTimeTicks: 60_000_000_000,
                    Type: "Movie",
                    UserData: {
                        LastPlayedDate: "2026-10-01T10:00:00Z",
                        PlaybackPositionTicks: 18_000_000_000,
                        Played: false,
                    },
                },
            ],
        }),
        "Filters=IsFavorite": () => ({
            Items: [
                {
                    Id: "fav",
                    Name: "Severance",
                    ProviderIds: { Imdb: "tt11280740" },
                    Type: "Series",
                },
            ],
        }),
        "Filters=IsPlayed": () => ({
            Items: [
                {
                    Id: "e1",
                    IndexNumber: 1,
                    ParentIndexNumber: 1,
                    RunTimeTicks: 30_000_000_000,
                    SeriesId: "s1",
                    SeriesName: "Breaking Bad",
                    Type: "Episode",
                    UserData: {
                        LastPlayedDate: "2026-09-30T10:00:00Z",
                        PlaybackPositionTicks: 0,
                        PlayCount: 1,
                        Played: true,
                    },
                },
            ],
        }),
        "Ids=s1": () => ({
            Items: [{ Id: "s1", Name: "Breaking Bad", ProviderIds: { Imdb: "tt0903747" } }],
        }),
    });
    try {
        const provider = createJellyfinProvider({
            serverId: "srv-test-1",
            serverUrl: "https://jf.test",
            slicksyncUserId: "person-1",
            token: "t",
            userId: "u1",
        });
        const library = await provider.getLibrary();
        const byId = Object.fromEntries(library.map((i) => [i._id, i]));

        // A show carries the episode it is on now: the one playing beats the one played yesterday.
        assert.equal(byId.tt0903747.type, "series");
        assert.equal(byId.tt0903747.state.video_id, "tt0903747:1:2");
        assert.equal(byId.tt0903747.state.timeOffset, 60_000);
        assert.equal(byId.tt0903747._jf.live, true);

        // A resume point is where playback is, in milliseconds.
        assert.equal(byId.tt0133093.state.timeOffset, 1_800_000);
        assert.equal(byId.tt0133093.state.duration, 6_000_000);
        assert.equal(byId.tt0133093.state.wallClockCapped, true);

        // A favourite with nothing watched is a library bookmark.
        assert.deepEqual(byId.tt11280740.state, {});

        // What plays is handed to Now Playing.
        const live = jellyfinLive.liveViewings(["person-1"]);
        assert.equal(live.length, 1);
        assert.equal(live[0].videoId, "tt0903747:1:2");
        assert.equal(live[0].season, 1);
    } finally {
        server.restore();
        jellyfinLive.forgetUser("person-1");
    }
});

test("library: played with no resume point left is reported as finished, at the end", async () => {
    const server = fakeServer({
        "Filters=IsPlayed": () => ({
            Items: [
                {
                    Id: "m1",
                    Name: "Inception",
                    ProviderIds: { Imdb: "tt1375666" },
                    RunTimeTicks: 88_800_000_000,
                    Type: "Movie",
                    UserData: {
                        LastPlayedDate: "2026-09-29T21:00:00Z",
                        PlaybackPositionTicks: 0,
                        PlayCount: 2,
                        Played: true,
                    },
                },
            ],
        }),
    });
    try {
        const provider = createJellyfinProvider({
            serverId: "srv-test-2",
            serverUrl: "https://jf.test",
            slicksyncUserId: "person-2",
            token: "t",
            userId: "u1",
        });
        const [movie] = await provider.getLibrary();
        assert.equal(movie.state.timeOffset, movie.state.duration);
        assert.equal(movie.state.flaggedWatched, 1);
        assert.equal(movie.state.timesWatched, 2);
        assert.equal(movie.state.lastWatched, "2026-09-29T21:00:00.000Z");
    } finally {
        server.restore();
        jellyfinLive.forgetUser("person-2");
    }
});

test("live: a viewing is announced once, when it first appears", () => {
    jellyfinLive.drainStarts();
    const viewing = {
        durationMs: 6_000_000,
        itemId: "tt0133093",
        itemName: "The Matrix",
        itemType: "movie",
        positionMs: 1000,
        videoId: null,
    };
    jellyfinLive.recordLive("person-3", [viewing]);
    jellyfinLive.recordLive("person-3", [{ ...viewing, positionMs: 61_000 }]);
    const starts = jellyfinLive.drainStarts().filter((s) => s.userId === "person-3");
    assert.equal(starts.length, 1);
    jellyfinLive.recordLive("person-3", []);
    assert.equal(jellyfinLive.liveViewings(["person-3"]).length, 0);
    jellyfinLive.forgetUser("person-3");
});

test("household: each profile is read with its own sign-in and its viewing carries the profile name", async () => {
    const original = global.fetch;
    const seen = [];
    global.fetch = async (url, opts) => {
        const { pathname, searchParams } = new URL(url);
        const auth = String(opts?.headers?.Authorization || "");
        const token = /Token="([^"]+)"/.exec(auth)?.[1];
        seen.push(`${token} ${pathname}`);
        let body = { Items: [] };
        if (pathname.endsWith("/Items") && searchParams.get("Filters") === "IsPlayed") {
            body =
                token === "kid-token"
                    ? {
                          Items: [
                              {
                                  Id: "k1",
                                  Name: "Paddington",
                                  ProviderIds: { Imdb: "tt1109624" },
                                  RunTimeTicks: 57_000_000_000,
                                  Type: "Movie",
                                  UserData: {
                                      LastPlayedDate: "2026-10-02T18:00:00Z",
                                      PlaybackPositionTicks: 0,
                                      Played: true,
                                  },
                              },
                          ],
                      }
                    : {
                          Items: [
                              {
                                  Id: "o1",
                                  Name: "Heat",
                                  ProviderIds: { Imdb: "tt0113277" },
                                  RunTimeTicks: 102_000_000_000,
                                  Type: "Movie",
                                  UserData: {
                                      LastPlayedDate: "2026-10-01T21:00:00Z",
                                      PlaybackPositionTicks: 0,
                                      Played: true,
                                  },
                              },
                          ],
                      };
        }
        if (pathname.endsWith("/Sessions")) {
            body =
                token === "kid-token"
                    ? [
                          {
                              NowPlayingItem: {
                                  Id: "k2",
                                  Name: "Moana",
                                  ProviderIds: { Imdb: "tt3521164" },
                                  RunTimeTicks: 64_000_000_000,
                                  Type: "Movie",
                              },
                              PlayState: { PositionTicks: 300_000_000 },
                              UserId: "kid",
                          },
                      ]
                    : [];
        }
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    try {
        const provider = createJellyfinProvider({
            resolveProfiles: async () => [
                { jellyfinUserId: "kid", name: "Kid", token: "kid-token" },
            ],
            serverId: "srv-household",
            serverKind: "aiostreams",
            serverUrl: "https://aio.test/jellyfin",
            slicksyncUserId: "person-h",
            token: "owner-token",
            userId: "owner",
        });
        const library = await provider.getLibrary();
        const byId = Object.fromEntries(library.map((i) => [i._id, i]));
        assert.equal(
            byId.tt0113277.state.profileLabel,
            undefined,
            "the person's own viewing has no profile label"
        );
        assert.equal(byId.tt1109624.state.profileLabel, "Kid");
        assert.equal(byId.tt3521164._jf.live, true);
        assert.ok(
            seen.some((s) => s.startsWith("kid-token ") && s.endsWith("/Items")),
            "the profile is read with its own token"
        );
        const live = jellyfinLive.liveViewings(["person-h"]);
        assert.equal(live.length, 1);
        assert.equal(live[0].itemId, "tt3521164");
    } finally {
        global.fetch = original;
        jellyfinLive.forgetUser("person-h");
    }
});

test("ids split into title, season and episode - a prefixed id keeps its prefix", () => {
    const { splitStremioId } = require("../server/providers/jellyfin");
    assert.deepEqual(splitStremioId("tt0903747:1:2"), {
        base: "tt0903747",
        episode: "2",
        season: "1",
    });
    assert.deepEqual(splitStremioId("tt0133093"), {
        base: "tt0133093",
        episode: undefined,
        season: undefined,
    });
    // Read as show "tmdb", season 209867 before this existed.
    assert.deepEqual(splitStremioId("tmdb:209867"), {
        base: "tmdb:209867",
        episode: undefined,
        season: undefined,
    });
    assert.deepEqual(splitStremioId("tmdb:209867:1:3"), {
        base: "tmdb:209867",
        episode: "3",
        season: "1",
    });
    assert.deepEqual(splitStremioId("kitsu:46676:1"), {
        base: "kitsu:46676",
        episode: undefined,
        season: "1",
    });
});

test("episodes: filler and recap come from AIOStreams' field or AIOMetadata's tags; mixed episodes stay unmarked", async () => {
    const server = fakeServer({
        "/Shows/s9/Episodes": (q) => {
            assert.match(q.get("Fields") || "", /Tags/, "asks for the tags");
            return {
                Items: [
                    { Id: "a", IndexNumber: 1, ParentIndexNumber: 1, Tags: [] },
                    { Id: "b", IndexNumber: 2, ParentIndexNumber: 1, Tags: ["Filler"] },
                    { Id: "c", IndexNumber: 3, ParentIndexNumber: 1, Tags: ["Recap"] },
                    { Id: "d", IndexNumber: 4, ParentIndexNumber: 1, Tags: ["Mixed Canon/Filler"] },
                    { aiostreams: { filler: true }, Id: "e", IndexNumber: 5, ParentIndexNumber: 1 },
                    {
                        Id: "f",
                        IndexNumber: 6,
                        ParentIndexNumber: 1,
                        Tags: ["filler fan favourite"],
                    },
                ],
            };
        },
        "IncludeItemTypes=Series": () => ({
            Items: [
                { Id: "s9", Name: "Naruto", ProviderIds: { Imdb: "tt0409591" }, Type: "Series" },
            ],
        }),
    });
    try {
        const provider = createJellyfinProvider({
            serverId: "srv-test-1",
            serverUrl: "https://jf.test",
            token: "t",
            userId: "u1",
        });
        const eps = await provider.listEpisodes("tt0409591");
        assert.deepEqual(
            eps.map((e) => [e.episode, e.filler, e.recap]),
            [
                [1, false, false],
                [2, true, false],
                [3, false, true],
                [4, false, false],
                [5, true, false],
                [6, false, false],
            ]
        );
    } finally {
        server.restore();
    }
});

test("AIOMetadata: what plays on every device comes from /AIOStreams/Activity, kept to this viewer", async () => {
    const server = fakeServer({
        "/AIOStreams/Activity": () => ({
            sessions: [
                {
                    DeviceName: "Living room TV",
                    NowPlayingItem: { Id: "m1", Name: "The Matrix", Type: "Movie" },
                    PlayState: { PositionTicks: 15_000_000_000 },
                    UserId: "e1271701-4ac0-4111-8066-c21a15cba9a0",
                },
                {
                    DeviceName: "Kid tablet",
                    NowPlayingItem: { Id: "m2", Name: "WALL-E", Type: "Movie" },
                    PlayState: { PositionTicks: 1 },
                    UserId: "2fc8a50e-4ce2-fa7e-5834-fe55ac1f8e08",
                },
            ],
            users: [],
        }),
        "/Sessions": () => [],
    });
    try {
        const provider = createJellyfinProvider({
            serverKind: "aiometadata",
            serverUrl: "https://aiom.test/jellyfin/x",
            token: "t",
            userId: "e12717014ac041118066c21a15cba9a0",
        });
        const sessions = await provider.getNowPlaying();
        assert.deepEqual(
            sessions.map((s) => s.NowPlayingItem.Name),
            ["The Matrix"]
        );
        assert.ok(server.calls.some((c) => c.includes("/AIOStreams/Activity")));
    } finally {
        server.restore();
    }
});
