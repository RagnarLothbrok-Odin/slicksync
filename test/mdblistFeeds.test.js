const test = require("node:test");
const assert = require("node:assert/strict");
const { createMdblistFeeds, normalize } = require("../server/utils/mdblistFeeds");
const notify = require("../server/utils/notify");
const person = { accountId: "home", id: "mine", providerType: "nuvio" };
const show = (id) => ({
    ids: { imdb: `tt${id}`, tmdb: id },
    poster: "/poster.jpg",
    title: "Example",
});
const prisma = {
    dismissedContinueWatching: { findMany: async () => [] },
    dismissedUpcomingEpisode: { findMany: async () => [] },
    mutedShow: { findMany: async () => [] },
};
function fixture(handler) {
    const calls = [];
    return {
        calls,
        feeds: createMdblistFeeds({
            client: {
                withAccess: (_prisma, _person, load) =>
                    load(
                        async (path) => {
                            calls.push(path);
                            return handler(path);
                        },
                        "42",
                        "2026-10-26T10:00:00Z"
                    ),
            },
        }),
    };
}

test("MDBList Continue Watching pages episode summaries, excludes unaired entries and preserves paused progress", async () => {
    const now = new Date().toISOString();
    const { calls, feeds } = fixture((path) => {
        if (path === "/sync/playback") {
            return [
                {
                    episode: { number: 1, season: 1 },
                    paused_at: now,
                    progress: "45.00",
                    show: show(100),
                },
            ];
        }
        const offset = Number(new URL(path, "https://api.mdblist.com").searchParams.get("offset"));
        return {
            has_more: offset === 0,
            items:
                offset === 0
                    ? Array.from({ length: 100 }, (_, i) => ({
                          last_watched_at: now,
                          next_episode: { air_date: "2020-01-01", episode: 2, season: 1 },
                          show: show(100 + i),
                      }))
                    : [
                          {
                              last_watched_at: now,
                              next_episode: { air_date: "2099-01-01", episode: 2, season: 1 },
                              show: show(999),
                          },
                      ],
        };
    });
    const rows = await feeds.continueWatching(prisma, person);
    assert.equal(rows.length, 100);
    assert.equal(rows.find((row) => row.showId === "tt100").progressPercent, 45);
    assert.ok(rows.every((row) => row.trackingService === "MDBList"));
    assert.equal(calls.filter((path) => path.startsWith("/upnext?")).length, 2);
    assert.ok(calls.every((path) => !path.includes("history")));
    const before = calls.length;
    await feeds.continueWatching(prisma, person);
    assert.equal(calls.length, before);
});

test("MDBList now-playing excludes pauses and expired reports and anchors progress to the reported update", async () => {
    const original = notify.fetchMetadata;
    notify.fetchMetadata = async () => ({ poster: "https://example.test/poster.jpg" });
    try {
        const updated = new Date(Date.now() - 30_000).toISOString();
        const active = {
            episode: { number: 2, season: 1 },
            expires_at: new Date(Date.now() + 19 * 60_000).toISOString(),
            progress: 50,
            progress_at_update: "50.00",
            runtime: 40,
            show: show(100),
            updated_at: updated,
        };
        const { feeds } = fixture(() => [
            active,
            { ...active, paused_at: updated },
            { ...active, expires_at: "2000-01-01T00:00:00Z" },
        ]);
        const rows = await feeds.nowPlaying(prisma, person);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].playback.provider, "mdblist");
        assert.equal(rows[0].playback.state, "playing");
        assert.ok(rows[0].lastPosition >= 20 * 60_000 && rows[0].lastPosition < 21 * 60_000);
    } finally {
        notify.fetchMetadata = original;
    }
});

test("MDBList calendar maps each title once and preserves date-only events", async () => {
    const original = notify.fetchMetadata;
    notify.fetchMetadata = async () => null;
    try {
        const { feeds, calls } = fixture((path) =>
            path.startsWith("/calendar/events")
                ? {
                      events: [1, 2].map((number) => ({
                          episode_number: number,
                          season_number: 1,
                          show_tmdb: 100,
                          start: "2026-10-28",
                          title: "Example",
                          type: "episode",
                      })),
                  }
                : { imdb_id: "tt100" }
        );
        const rows = await feeds.calendar(prisma, person);
        assert.equal(rows.length, 2);
        assert.equal(rows[0].airDate, "2026-10-28");
        assert.equal(calls.filter((path) => path === "/tmdb/show/100/").length, 1);
    } finally {
        notify.fetchMetadata = original;
    }
});

test("MDBList invalid playback fails instead of masquerading as an empty source", async () => {
    const { feeds } = fixture(() => ({ unexpected: true }));
    await assert.rejects(() => feeds.nowPlaying(prisma, person), /invalid playback/);
    assert.equal(normalize({ episode: { number: 2, season: null }, show: show(1) }), null);
});

test("MDBList calendar preserves distinct movie releases without refetching events or identity", async () => {
    const original = notify.fetchMetadata;
    notify.fetchMetadata = async () => null;
    try {
        const { feeds, calls } = fixture((path) =>
            path.startsWith("/calendar/events")
                ? {
                      events: ["release", "digital"].map((kind, index) => ({
                          id: kind,
                          release_type: kind,
                          start: `2026-11-0${index + 1}`,
                          title: "Film",
                          tmdb: 99,
                          type: "movie",
                      })),
                  }
                : { imdb_id: "tt99" }
        );
        const rows = await feeds.calendar(prisma, person);
        assert.equal(rows.length, 2);
        assert.ok(rows.every((row) => row.mediaType === "movie"));
        assert.notEqual(rows[0].eventId, rows[1].eventId);
        assert.equal(rows[1].releaseType, "digital");
        const before = calls.length;
        await feeds.calendar(prisma, person);
        assert.equal(calls.length, before);
        assert.equal(calls.filter((path) => path === "/tmdb/movie/99/").length, 1);
    } finally {
        notify.fetchMetadata = original;
    }
});
