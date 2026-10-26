const test = require("node:test");
const assert = require("node:assert/strict");
const tracking = require("../server/utils/traktTracking");
const feeds = require("../server/utils/traktFeeds");
const notify = require("../server/utils/notify");
const person = { accountId: "household", id: "person", providerType: "nuvio", username: "Viewer" };
const show = { ids: { imdb: "tt123" }, runtime: 45, title: "Example" };
const episode = { number: 3, runtime: 45, season: 2, title: "An episode" };
const prisma = { dismissedContinueWatching: { findMany: async () => [] } };
const originalRead = tracking.read;
const originalMetadata = notify.fetchMetadata;
test.before(() => {
    notify.fetchMetadata = async () => ({
        background: "backdrop.jpg",
        episode: { overview: "Episode synopsis", thumbnail: "episode.jpg" },
        poster: "poster.jpg",
    });
});
test.after(() => {
    tracking.read = originalRead;
    notify.fetchMetadata = originalMetadata;
});

test("tracker presence uses expiry and runtime as an estimate, not a reported pause", async () => {
    tracking.read = async (_db, who, resource) => {
        assert.equal(who.id, person.id);
        assert.equal(resource, "watching");
        return {
            checkedAt: new Date().toISOString(),
            connected: true,
            data: {
                episode,
                expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
                show,
                started_at: new Date(Date.now() - 60_000).toISOString(),
            },
        };
    };
    const rows = await feeds.nowPlaying(prisma, person);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].playback.evidence, "tracker");
    assert.equal(rows[0].playback.position, "estimated");
    assert.equal(rows[0].playback.state, "playing");
    assert.ok(Math.abs(rows[0].lastPosition - 25 * 60_000) < 1000);
    assert.equal(rows[0].videoId, "tt123:2:3");
    assert.equal(rows[0].item.thumbnail, "episode.jpg");
    assert.equal(rows[0].item.description, "Episode synopsis");
    tracking.read = async () => ({ connected: true, data: null });
    assert.deepEqual(await feeds.nowPlaying(prisma, person), []);
});

test("cached tracker position is anchored to the original observation", async () => {
    const now = Date.now();
    tracking.read = async () => ({
        checkedAt: new Date(now - 20_000).toISOString(),
        connected: true,
        data: {
            episode,
            expires_at: new Date(now + 20 * 60_000).toISOString(),
            show,
            started_at: new Date(now - 60_000).toISOString(),
        },
    });
    const [row] = await feeds.nowPlaying(prisma, person);
    assert.equal(row.lastPosition, 25 * 60_000 - 20_000);
});

test("Continue Watching keeps resume points, excludes dismissals and picks newer native progress", async () => {
    tracking.read = async () => ({
        connected: true,
        data: [{ episode, paused_at: "2026-10-25T21:00:00Z", progress: 40, show }],
    });
    const items = await feeds.continueWatching(prisma, person);
    assert.equal(items[0].progressPercent, 40);
    assert.equal(items[0].trackingService, "Trakt");
    assert.equal(items[0].contentType, "series");
    assert.equal(items[0].nextEpisode.episode, 3);
    const newer = {
        ...items[0],
        lastWatchedAt: "2026-10-25T22:00:00Z",
        progressPercent: 60,
        trackingService: undefined,
    };
    assert.equal(feeds.mergeContinue([newer], items)[0].progressPercent, 60);
    assert.deepEqual(
        await feeds.continueWatching(
            {
                dismissedContinueWatching: {
                    findMany: async ({ where }) => {
                        assert.equal(where.userId, person.id);
                        return [{ showId: "tt123" }];
                    },
                },
            },
            person
        ),
        []
    );
});

test("calendar merges by episode and preserves the actual UTC airing instant", async () => {
    const first_aired = "2026-10-26T01:30:00.000Z";
    tracking.read = async () => ({ connected: true, data: [{ episode, first_aired, show }] });
    const items = await feeds.calendar(prisma, person);
    assert.equal(items[0].airDate, first_aired);
    const merged = feeds.mergeCalendar([{ ...items[0], title: "Old title" }], items);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].title, episode.title);
});

test("missing title identities or invalid progress do not produce misleading cards", async () => {
    tracking.read = async () => ({
        connected: true,
        data: [
            {
                movie: { ids: {}, title: "No identity" },
                paused_at: "2026-10-25T21:00:00Z",
                progress: 30,
            },
            { episode, paused_at: "2026-10-25T21:00:00Z", progress: Number.NaN, show },
        ],
    });
    assert.deepEqual(await feeds.continueWatching(prisma, person), []);
    assert.equal(feeds.media({ movie: { ids: { tmdb: 123 } } }), null);
});

test("calendar keeps household muted and dismissed episodes out of tracker results", async () => {
    tracking.read = async () => ({
        connected: true,
        data: [{ episode, first_aired: "2026-10-26T01:30:00Z", show }],
    });
    const muted = {
        mutedShow: {
            findMany: async ({ where }) => {
                assert.equal(where.accountId, "household");
                return [{ showId: "tt123" }];
            },
        },
    };
    assert.deepEqual(await feeds.calendar(muted, person), []);
    const dismissed = {
        dismissedUpcomingEpisode: {
            findMany: async () => [{ episode: 3, season: 2, showId: "tt123" }],
        },
    };
    assert.deepEqual(await feeds.calendar(dismissed, person), []);
});

test("Continue Watching includes next episodes and prefers paused progress for the same show", async () => {
    const date = new Date().toISOString();
    tracking.read = async (_db, _person, resource) => ({
        connected: true,
        data:
            resource === "progress"
                ? [{ episode, paused_at: date, progress: 40, show }]
                : [
                      { episode: { ...episode, number: 4 }, paused_at: date, resume: false, show },
                      {
                          episode: { ...episode, number: 8 },
                          paused_at: date,
                          resume: false,
                          show: { ...show, ids: { imdb: "tt456" } },
                      },
                  ],
    });
    const rows = await feeds.continueWatching(prisma, person);
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.showId === "tt123").nextEpisode.episode, 3);
    assert.equal(rows.find((row) => row.showId === "tt123").resume, true);
    assert.equal(rows.find((row) => row.showId === "tt456").resume, false);
    assert.equal(rows.find((row) => row.showId === "tt456").progressPercent, null);
});

test("personal Continue Watching retains the complete Trakt list when merged", async () => {
    tracking.read = async (_db, _person, resource) => ({
        connected: true,
        data:
            resource === "upNext"
                ? Array.from({ length: 36 }, (_, index) => ({
                      episode,
                      paused_at: "2026-10-26T12:00:00Z",
                      resume: false,
                      show: { ...show, ids: { imdb: `tt${index + 1000}` } },
                  }))
                : [],
    });
    const rows = await feeds.continueWatching(prisma, person);
    assert.equal(rows.length, 36);
    assert.equal(feeds.mergeContinue([], rows, 2000).length, 36);
    assert.equal(feeds.mergeContinue([], rows).length, 12);
});

test("a complete Trakt outage is reported instead of looking like an empty Continue Watching list", async () => {
    tracking.read = async () => {
        throw Object.assign(new Error("Trakt unavailable"), { status: 503 });
    };
    await assert.rejects(feeds.continueWatching(prisma, person), /Trakt unavailable/);
});
