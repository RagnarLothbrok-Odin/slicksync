// Titles with no IMDb id (anime, TMDb/TVDB-only) on a Jellyfin, AIOStreams or
// AIOMetadata server had no poster - metahub only knows IMDb ids. They now
// use the server's own Primary image (server/utils/jellyfinImages.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const images = require("../server/utils/jellyfinImages");
const { createJellyfinProvider } = require("../server/providers/jellyfin");

const MOVIE_ID = "c9f640a2e4aaa99571b293c11501718d";
const SHOW_ID = "0a1b2c3d4e5f60718293a4b5c6d7e8f9";

test("poster address: the item's own image, an episode's show, the tag in the address", () => {
    assert.equal(
        images.serverPosterUrl("https://jf.example.com/", {
            Id: MOVIE_ID,
            ImageTags: { Primary: "abc" },
            Type: "Movie",
        }),
        `https://jf.example.com/Items/${MOVIE_ID}/Images/Primary?maxWidth=600&tag=abc`
    );
    assert.equal(
        images.serverPosterUrl("https://aio.example.com/jellyfin/u/family", {
            Id: MOVIE_ID,
            SeriesId: "0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9",
            SeriesPrimaryImageTag: "def",
            Type: "Episode",
        }),
        `https://aio.example.com/jellyfin/u/family/Items/${SHOW_ID}/Images/Primary?maxWidth=600&tag=def`
    );
    assert.equal(
        images.serverPosterUrl("https://jf.example.com", { Id: MOVIE_ID, Type: "Movie" }),
        null,
        "no image tag, no poster"
    );
    assert.equal(
        images.serverPosterUrl("https://jf.example.com", {
            Id: "../System",
            ImageTags: { Primary: "x" },
            Type: "Movie",
        }),
        null
    );
});

test("the image proxy lets through only poster addresses on a known server", () => {
    const servers = ["http://192.168.1.5:8096", "http://10.0.0.2/jellyfin/u/family"];
    const ok = (u) => images.isServerPosterUrl(u, servers);
    assert.equal(
        ok(`http://192.168.1.5:8096/Items/${MOVIE_ID}/Images/Primary?maxWidth=600&tag=abc`),
        true
    );
    assert.equal(
        ok(`http://10.0.0.2/jellyfin/u/family/Items/${MOVIE_ID}/Images/Primary?tag=abc`),
        true
    );
    assert.equal(
        ok("http://192.168.1.5:8096/System/Info?tag=abc"),
        false,
        "nothing else on the server"
    );
    assert.equal(
        ok(`http://192.168.1.5:8096/Items/${MOVIE_ID}/Images/Primary?api_key=x`),
        false,
        "no other parameters"
    );
    assert.equal(
        ok(`http://192.168.1.6:8096/Items/${MOVIE_ID}/Images/Primary?tag=abc`),
        false,
        "another host"
    );
    assert.equal(
        ok(`http://10.0.0.2/other/Items/${MOVIE_ID}/Images/Primary?tag=abc`),
        false,
        "outside the server's own path"
    );
    assert.equal(
        ok(`http://user:pw@192.168.1.5:8096/Items/${MOVIE_ID}/Images/Primary?tag=abc`),
        false
    );
    assert.equal(
        images.looksLikeServerPoster(
            `http://192.168.1.5:8096/Items/${MOVIE_ID}/Images/Primary?tag=abc`
        ),
        true
    );
    assert.equal(
        images.looksLikeServerPoster("https://images.metahub.space/poster/medium/tt0133093/img"),
        false
    );
});

test("a public instance never fetches private addresses, even posters", async () => {
    const config = require("../server/utils/config");
    const was = config.INSTANCE_TYPE;
    config.INSTANCE_TYPE = "public";
    images.forgetForTests();
    const prisma = {
        user: { findMany: async () => [{ jellyfinServerUrl: "http://192.168.1.5:8096" }] },
        userProviderCredential: { findMany: async () => [] },
    };
    try {
        assert.equal(
            await images.allowPrivatePoster(
                prisma,
                `http://192.168.1.5:8096/Items/${MOVIE_ID}/Images/Primary?tag=abc`
            ),
            false
        );
        config.INSTANCE_TYPE = "private";
        images.forgetForTests();
        assert.equal(
            await images.allowPrivatePoster(
                prisma,
                `http://192.168.1.5:8096/Items/${MOVIE_ID}/Images/Primary?tag=abc`
            ),
            true
        );
    } finally {
        config.INSTANCE_TYPE = was;
        images.forgetForTests();
    }
});

test("a server behind a sign-in proxy (401) keeps the old posters; an unreachable one is asked again", async () => {
    images.forgetForTests();
    const status = (code) => async () => ({ body: null, status: code });
    assert.equal(
        await images.imagesOpen("locked", "https://jf.example.com/x", { fetchImpl: status(401) }),
        false
    );
    assert.equal(
        await images.imagesOpen("locked", "https://jf.example.com/x", { fetchImpl: status(200) }),
        false,
        "remembered"
    );
    assert.equal(
        await images.imagesOpen("open", "https://jf.example.com/x", { fetchImpl: status(200) }),
        true
    );
    assert.equal(
        await images.imagesOpen("flaky", "https://jf.example.com/x", {
            fetchImpl: async () => {
                throw new Error("down");
            },
        }),
        true
    );
    assert.equal(
        await images.imagesOpen("flaky", "https://jf.example.com/x", { fetchImpl: status(403) }),
        false,
        "not remembered while unreachable"
    );
    images.forgetForTests();
});

function fakeServer(routes, imageStatus = 200) {
    const original = global.fetch;
    global.fetch = async (url) => {
        const { pathname, searchParams } = new URL(url);
        if (pathname.includes("/Images/Primary")) {
            return { body: null, ok: imageStatus < 400, status: imageStatus, text: async () => "" };
        }
        const key = Object.keys(routes).find((k) => `${pathname}?${searchParams}`.includes(k));
        const body = key ? routes[key](searchParams) : { Items: [] };
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    return () => {
        global.fetch = original;
    };
}

const routes = {
    "/UserItems/Resume": () => ({
        Items: [
            {
                Id: MOVIE_ID,
                ImageTags: { Primary: "tagm" },
                Name: "Spirited Away",
                ProviderIds: { Tmdb: "129" },
                RunTimeTicks: 60_000_000_000,
                Type: "Movie",
                UserData: {
                    LastPlayedDate: "2026-10-01T10:00:00Z",
                    PlaybackPositionTicks: 18_000_000_000,
                },
            },
            {
                Id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                ImageTags: { Primary: "tagx" },
                Name: "The Matrix",
                ProviderIds: { Imdb: "tt0133093" },
                RunTimeTicks: 60_000_000_000,
                Type: "Movie",
                UserData: {
                    LastPlayedDate: "2026-10-01T09:00:00Z",
                    PlaybackPositionTicks: 18_000_000_000,
                },
            },
        ],
    }),
    "Filters=IsPlayed": (q) => {
        assert.equal(q.get("EnableImageTypes"), "Primary", "asks for the image tag");
        return {
            Items: [
                {
                    Id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    IndexNumber: 3,
                    ParentIndexNumber: 1,
                    RunTimeTicks: 30_000_000_000,
                    SeriesId: SHOW_ID,
                    SeriesName: "Frieren",
                    SeriesPrimaryImageTag: "tags",
                    Type: "Episode",
                    UserData: {
                        LastPlayedDate: "2026-09-30T10:00:00Z",
                        PlayCount: 1,
                        Played: true,
                    },
                },
            ],
        };
    },
    [`Ids=${SHOW_ID}`]: () => ({
        Items: [{ Id: SHOW_ID, Name: "Frieren", ProviderIds: { Tvdb: "424536" } }],
    }),
    "/Sessions": () => [],
};

test("library: non-IMDb titles get the server's poster; IMDb titles keep metahub", async () => {
    images.forgetForTests();
    const restore = fakeServer(routes);
    try {
        const provider = createJellyfinProvider({
            serverId: "srv-open",
            serverUrl: "https://jf.example.com",
            token: "t",
            userId: "u1",
        });
        const byId = Object.fromEntries((await provider.getLibrary()).map((i) => [i._id, i]));
        assert.equal(
            byId["tmdb:129"].poster,
            `https://jf.example.com/Items/${MOVIE_ID}/Images/Primary?maxWidth=600&tag=tagm`
        );
        assert.equal(
            byId["tvdb:424536"].poster,
            `https://jf.example.com/Items/${SHOW_ID}/Images/Primary?maxWidth=600&tag=tags`
        );
        assert.equal(
            byId.tt0133093.poster,
            "https://images.metahub.space/poster/medium/tt0133093/img"
        );
    } finally {
        restore();
        images.forgetForTests();
    }
});

test("library: a server whose images need a sign-in falls back to metahub-or-nothing", async () => {
    images.forgetForTests();
    const restore = fakeServer(routes, 401);
    try {
        const provider = createJellyfinProvider({
            serverId: "srv-locked",
            serverUrl: "https://jf.example.com",
            token: "t",
            userId: "u1",
        });
        const byId = Object.fromEntries((await provider.getLibrary()).map((i) => [i._id, i]));
        assert.equal(byId["tmdb:129"].poster, null);
        assert.equal(
            byId.tt0133093.poster,
            "https://images.metahub.space/poster/medium/tt0133093/img"
        );
    } finally {
        restore();
        images.forgetForTests();
    }
});

test("/api/img serves a poster from a home server, and never follows a redirect from one", async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const http = require("node:http");
    const express = require("express");
    const png = fs.readFileSync(
        path.join(
            require("node:path").dirname(module.filename),
            "..",
            "client",
            "public",
            "favicon-16x16.png"
        )
    );
    const cwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slicksync-img-"));
    process.chdir(tmp); // the poster cache lives under the working directory

    // A "home server" on a loopback (private) address.
    let redirected = false;
    const home = http.createServer((req, res) => {
        if (req.url.startsWith(`/Items/${MOVIE_ID}/Images/Primary`)) {
            res.writeHead(200, { "content-type": "image/png" });
            return res.end(png);
        }
        if (req.url.startsWith(`/Items/${SHOW_ID}/Images/Primary`)) {
            res.writeHead(302, { location: "/elsewhere" });
            return res.end();
        }
        if (req.url === "/elsewhere") {
            redirected = true;
            res.writeHead(200, { "content-type": "image/png" });
            return res.end(png);
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise((r) => home.listen(0, "127.0.0.1", r));
    const homeUrl = `http://127.0.0.1:${home.address().port}`;

    images.forgetForTests();
    const prisma = {
        user: { findMany: async () => [{ jellyfinServerUrl: homeUrl }] },
        userProviderCredential: { findMany: async () => [] },
    };
    delete require.cache[require.resolve("../server/utils/imageCacheCore")];
    delete require.cache[require.resolve("../server/routes/imageCache")];
    const app = express();
    app.use("/api/img", require("../server/routes/imageCache")({ prisma }));
    const server = await new Promise((r) => {
        const s = app.listen(0, "127.0.0.1", () => r(s));
    });
    const base = `http://127.0.0.1:${server.address().port}/api/img`;
    try {
        const poster = `${homeUrl}/Items/${MOVIE_ID}/Images/Primary?maxWidth=600&tag=abc`;
        const ok = await fetch(`${base}?src=${encodeURIComponent(poster)}&w=64`);
        assert.equal(ok.status, 200);
        assert.match(ok.headers.get("content-type"), /^image\//);

        const other = await fetch(
            `${base}?src=${encodeURIComponent(`${homeUrl}/System/Info/Public`)}&w=64`
        );
        assert.equal(other.status, 400, "anything else on the home server is still refused");

        const moved = `${homeUrl}/Items/${SHOW_ID}/Images/Primary?tag=def`;
        const res = await fetch(`${base}?src=${encodeURIComponent(moved)}&w=64`, {
            redirect: "manual",
        });
        assert.equal(res.status, 302, "handed back to the browser");
        assert.equal(res.headers.get("location"), moved);
        assert.equal(redirected, false, "the server itself never followed it");
    } finally {
        server.close();
        home.close();
        process.chdir(cwd);
        images.forgetForTests();
        fs.rmSync(tmp, { force: true, recursive: true });
    }
});

test("titles watched before server posters existed get theirs filled in, blank ones only", async () => {
    const rows = {
        episodeWatchHistory: [
            { accountId: "acc", poster: null, showId: "tvdb:424536", userId: "u1" },
            { accountId: "acc", poster: null, showId: "tvdb:424536", userId: "u1" },
            { accountId: "acc", poster: null, showId: "tvdb:999", userId: "u1" },
        ],
        movieWatchHistory: [
            { accountId: "acc", itemId: "tmdb:129", poster: null, userId: "u1" },
            {
                accountId: "acc",
                itemId: "tmdb:500",
                poster: "https://kept.example.com/p.jpg",
                userId: "u1",
            },
            { accountId: "acc", itemId: "tmdb:129", poster: null, userId: "u2" },
        ],
        watchSession: [{ accountId: "acc", itemId: "tmdb:129", poster: null, userId: "u1" }],
    };
    const matches = (r, where) => Object.entries(where).every(([k, v]) => r[k] === v);
    const prisma = Object.fromEntries(
        Object.entries(rows).map(([name, list]) => [
            name,
            {
                findMany: async ({ where, distinct }) => {
                    const seen = new Set();
                    return list
                        .filter((r) => matches(r, where))
                        .filter((r) => !seen.has(r[distinct[0]]) && seen.add(r[distinct[0]]))
                        .map((r) => ({ [distinct[0]]: r[distinct[0]] }));
                },
                updateMany: async ({ where, data }) => {
                    const hit = list.filter((r) => matches(r, where));
                    for (const r of hit) {
                        Object.assign(r, data);
                    }
                    return { count: hit.length };
                },
            },
        ])
    );
    const library = [
        { _id: "tmdb:129", poster: "https://jf.example.com/Items/a/Images/Primary?tag=m" },
        { _id: "tmdb:500", poster: "https://jf.example.com/Items/b/Images/Primary?tag=n" },
        { _id: "tvdb:424536", poster: "https://jf.example.com/Items/c/Images/Primary?tag=s" },
    ];
    assert.equal(await images.fillMissingPosters(prisma, "acc", "u1", library), 4);
    assert.equal(rows.movieWatchHistory[0].poster, library[0].poster);
    assert.equal(
        rows.movieWatchHistory[1].poster,
        "https://kept.example.com/p.jpg",
        "a poster already there is kept"
    );
    assert.equal(rows.movieWatchHistory[2].poster, null, "another person is left alone");
    assert.ok(
        rows.episodeWatchHistory.slice(0, 2).every((r) => r.poster === library[2].poster),
        "every episode of the show"
    );
    assert.equal(
        rows.episodeWatchHistory[2].poster,
        null,
        "a show the library has no poster for stays blank"
    );
    assert.equal(rows.watchSession[0].poster, library[0].poster);
    assert.equal(
        await images.fillMissingPosters(prisma, "acc", "u1", library),
        0,
        "nothing left to do"
    );
});
