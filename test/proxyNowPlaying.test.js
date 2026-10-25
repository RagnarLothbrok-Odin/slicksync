const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeProxyNowPlaying } = require("../server/utils/proxyNowPlaying");

function makeProxyRow(overrides = {}) {
    return {
        aiostreamsUser: "alice",
        displayName: "The Rock (1996)",
        filename: "The.Rock.1996.mkv",
        id: "proxy-1",
        lastSeenAt: new Date("2026-07-15T20:05:00Z"),
        posterUrl: null,
        startTime: new Date("2026-07-15T20:00:00Z"),
        // The freeze basis for elapsedSeconds - the last poll cycle that
        // reconfirmed this connection with AIOStreams, which is updatedAt rather
        // than lastSeenAt (see the long comment in proxyNowPlaying.js). Omitting
        // it made every fixture blow up on `undefined.getTime()`, because the
        // code has required it since it started freezing elapsed time on poll
        // confirmation instead of request cadence.
        updatedAt: new Date("2026-07-15T20:05:00Z"),
        url: "https://example.com/stream",
        ...overrides,
    };
}

test("mergeProxyNowPlaying: a stale/unrelated active proxy row does not suppress a different-title native entry for the same user (usenet regression)", async () => {
    // This is the exact bug reported: a user streaming a usenet-sourced show
    // (never routed through AIOStreams' proxy) had their legitimate native
    // Now Playing entry silently dropped whenever ANY active proxy row -
    // even a stale/unrelated debrid one - was attributed to them.
    const users = [{ email: "alice@example.com", id: "user-1", username: "alice" }];
    const nativeChernobylEntry = {
        item: { id: "tt123", name: "Chernobyl", type: "series" },
        user: { id: "user-1", username: "alice" },
        videoId: "tt123:1:1",
    };
    const fakePrisma = {
        proxyStreamSession: {
            findMany: async () => [makeProxyRow()], // active proxy row for an unrelated title
        },
    };

    const result = await mergeProxyNowPlaying(fakePrisma, "acct-1", users, [nativeChernobylEntry]);

    const titles = result.map((r) => r.item.name);
    assert.ok(titles.includes("The Rock (1996)"), "proxy-derived entry should be present");
    assert.ok(
        titles.includes("Chernobyl"),
        "unrelated native entry must survive - this is the usenet fix"
    );
});

test("mergeProxyNowPlaying: a matching-title proxy row supersedes the native entry, borrowing its richer metadata", async () => {
    const users = [{ email: "alice@example.com", id: "user-1", username: "alice" }];
    const nativeEntry = {
        item: { id: "tt999", name: "The Rock", poster: "https://posters/rock.jpg", type: "movie" },
        user: { id: "user-1", username: "alice" },
        videoId: null,
    };
    const fakePrisma = {
        proxyStreamSession: {
            findMany: async () => [makeProxyRow()], // displayName "The Rock (1996)" title-matches "The Rock"
        },
    };

    const result = await mergeProxyNowPlaying(fakePrisma, "acct-1", users, [nativeEntry]);

    assert.equal(result.length, 1, "should be a single merged entry, not a duplicate");
    assert.equal(result[0].source, "aiostreams-proxy");
    assert.equal(
        result[0].item.id,
        "tt999",
        "should borrow the richer native item metadata, not the bare proxy one"
    );
});

test("mergeProxyNowPlaying: returns the native list unchanged when there are no proxy sessions at all", async () => {
    const nativeEntry = { item: { name: "Anything" }, user: { id: "user-1", username: "alice" } };
    const fakePrisma = { proxyStreamSession: { findMany: async () => [] } };
    const result = await mergeProxyNowPlaying(
        fakePrisma,
        "acct-1",
        [{ id: "user-1", username: "alice" }],
        [nativeEntry]
    );
    assert.deepEqual(result, [nativeEntry]);
});

test("mergeProxyNowPlaying: falls back to the native list if the proxy session query fails", async () => {
    const nativeEntry = { item: { name: "Anything" }, user: { id: "user-1", username: "alice" } };
    const fakePrisma = {
        proxyStreamSession: {
            findMany: async () => {
                throw new Error("db down");
            },
        },
    };
    const result = await mergeProxyNowPlaying(
        fakePrisma,
        "acct-1",
        [{ id: "user-1", username: "alice" }],
        [nativeEntry]
    );
    assert.deepEqual(result, [nativeEntry]);
});

// The proxy is authoritative for content it carries; native is the only truth
// for content it doesn't (e.g. usenet via newznab, which bypasses the proxy).

// findMany is called twice: first for active sessions, then for recently-closed.
function makeSplitPrisma(active, recentlyClosed) {
    let call = 0;
    return {
        proxyStreamSession: {
            findMany: async () => (call++ === 0 ? active : recentlyClosed),
        },
    };
}

test("mergeProxyNowPlaying: suppresses the stale native echo of a stream the proxy just finished (no post-exit lingering)", async () => {
    const users = [{ email: "alice@example.com", id: "user-1", username: "alice" }];
    // Native still thinks this is playing - its freshness window holds a session
    // "active" ~15min after the provider's stop checkpoint.
    const staleNative = {
        item: { id: "tt1", name: "The Rock" },
        user: { id: "user-1", username: "alice" },
    };
    const closedProxyRow = { ...makeProxyRow(), endTime: new Date(), isActive: false };
    const prisma = makeSplitPrisma([], [closedProxyRow]);

    const result = await mergeProxyNowPlaying(prisma, "acct-1", users, [staleNative]);

    assert.equal(
        result.length,
        0,
        "the proxy knows this stream ended, so the native echo must be dropped"
    );
});

test("mergeProxyNowPlaying: keeps a native entry the proxy never carried (usenet via newznab)", async () => {
    const users = [{ email: "alice@example.com", id: "user-1", username: "alice" }];
    // Usenet bypasses the proxy entirely - native is the only signal for it.
    const usenetNative = {
        item: { id: "tt9", name: "Eastbound & Down" },
        user: { id: "user-1", username: "alice" },
    };
    // An unrelated debrid stream the proxy recently finished must not blank it out.
    const closedProxyRow = { ...makeProxyRow(), endTime: new Date(), isActive: false };
    const prisma = makeSplitPrisma([], [closedProxyRow]);

    const result = await mergeProxyNowPlaying(prisma, "acct-1", users, [usenetNative]);

    assert.equal(result.length, 1);
    assert.equal(result[0].item.name, "Eastbound & Down");
});

// --- a live row is only shown while the monitor is still confirming it ------

test("mergeProxyNowPlaying: a live row the monitor has stopped confirming is not shown as playing (the day-old card)", async () => {
    const users = [{ email: "alice@example.com", id: "user-1", username: "alice" }];
    // What the database still says days after polling broke: one row, active.
    const stuck = makeProxyRow({
        displayName: "Hercules (1997)",
        filename: "Hercules.1997.mkv",
        isActive: true,
    });
    const native = {
        item: { id: "tt15325794", name: "Fall 2", type: "movie" },
        user: { id: "user-1", username: "alice" },
    };

    const shown = await mergeProxyNowPlaying(
        makeSplitPrisma([stuck], []),
        "acct-1",
        users,
        [native],
        { isConfirming: () => true }
    );
    assert.deepEqual(shown.map((r) => r.item.name).sort(), ["Fall 2", "Hercules (1997)"]);

    const hidden = await mergeProxyNowPlaying(
        makeSplitPrisma([stuck], []),
        "acct-1",
        users,
        [native],
        { isConfirming: () => false }
    );
    assert.deepEqual(
        hidden.map((r) => r.item.name),
        ["Fall 2"],
        "only what is really playing is left"
    );
});

test("mergeProxyNowPlaying: a stream the proxy saw end still clears its native echo while the monitor is not confirming", async () => {
    const users = [{ email: "alice@example.com", id: "user-1", username: "alice" }];
    const staleNative = {
        item: { id: "tt1", name: "The Rock" },
        user: { id: "user-1", username: "alice" },
    };
    const closedProxyRow = { ...makeProxyRow(), endTime: new Date(), isActive: false };
    const result = await mergeProxyNowPlaying(
        makeSplitPrisma([], [closedProxyRow]),
        "acct-1",
        users,
        [staleNative],
        { isConfirming: () => false }
    );
    assert.equal(result.length, 0);
});

// --- a sequel is not its original -------------------------------------------

test("mergeProxyNowPlaying: a sequel being streamed does not take the name and poster of the original still open in the library", async () => {
    const users = [{ email: "alice@example.com", id: "user-1", username: "alice" }];
    const sequel = makeProxyRow({ displayName: "Fall 2 (2025)", filename: "Fall.2.2025.mkv" });
    const original = {
        item: { id: "tt15325794", name: "Fall", poster: "https://posters/fall.jpg", type: "movie" },
        user: { id: "user-1", username: "alice" },
        videoId: null,
    };
    const result = await mergeProxyNowPlaying(
        makeSplitPrisma([sequel], []),
        "acct-1",
        users,
        [original],
        { isConfirming: () => true }
    );
    const proxyCard = result.find((r) => r.source === "aiostreams-proxy");
    assert.ok(proxyCard, "the stream has its own card");
    assert.equal(proxyCard.item.name, "Fall 2 (2025)");
    assert.notEqual(proxyCard.item.poster, "https://posters/fall.jpg");
    assert.ok(
        result.some((r) => r.item.name === "Fall"),
        "the original is not hidden by it"
    );
});

test("mergeProxyNowPlaying: ids decide over names - a matched stream never borrows a different title that shares its name", async () => {
    const users = [{ email: "alice@example.com", id: "user-1", username: "alice" }];
    const remake = makeProxyRow({
        displayName: "It (2017)",
        filename: "It.2017.mkv",
        metadataItemId: "tt1396484",
        metadataName: "It",
    });
    const older = {
        item: { id: "tt0099864", name: "It", type: "series" },
        user: { id: "user-1", username: "alice" },
        videoId: null,
    };
    const result = await mergeProxyNowPlaying(
        makeSplitPrisma([remake], []),
        "acct-1",
        users,
        [older],
        { isConfirming: () => true }
    );
    assert.equal(result.length, 2);
    assert.notEqual(result.find((r) => r.source === "aiostreams-proxy").item.id, "tt0099864");
});
