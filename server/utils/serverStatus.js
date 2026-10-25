// One row per Jellyfin-compatible server (Jellyfin, AIOStreams, AIOMetadata)
// for the Health page. Read from what the activity monitor already recorded
// on each person - their providerConnectionError from the last pass - so the
// page makes no calls to the servers, the same as the rest of Health.
//
// - up: someone on it was read fine on the last pass
// - down: everyone on it is failing to connect (the connection alerts' own
//   test for a server outage - utils/connectionAlerts.js)
// - partial: it answers, but some people's sign-ins are rejected or failing

const { serverKeyOf } = require("./jellyfinServerCollections");

const KIND_LABELS = { aiometadata: "AIOMetadata", aiostreams: "AIOStreams", jellyfin: "Jellyfin" };

function stateOf(person) {
    const error = person.providerConnectionError || "";
    if (!error) {
        return "ok";
    }
    return /^Reconnect needed:/i.test(error) ? "reconnect" : "issue";
}

async function serverStatusList(
    prisma,
    accountId,
    { versions = (rows) => require("./serverVersions").annotate(rows) } = {}
) {
    const people = await prisma.user.findMany({
        orderBy: { username: "asc" },
        select: {
            id: true,
            jellyfinServerId: true,
            jellyfinServerKind: true,
            jellyfinServerUrl: true,
            providerConnectionError: true,
            providerConnectionErrorAt: true,
            username: true,
        },
        where: {
            accountId,
            isActive: true,
            jellyfinServerUrl: { not: null },
            providerType: "jellyfin",
        },
    });
    const { displayServer } = require("../providers/jellyfinAuth");
    const servers = new Map();
    for (const p of people) {
        const key = serverKeyOf(p);
        if (!key) {
            continue;
        }
        if (!servers.has(key)) {
            servers.set(key, {
                address: displayServer(p.jellyfinServerUrl),
                key,
                kind: p.jellyfinServerKind || "jellyfin",
                label: KIND_LABELS[p.jellyfinServerKind] || "Jellyfin",
                people: [],
                url: p.jellyfinServerUrl,
            });
        }
        servers.get(key).people.push({
            error: p.providerConnectionError
                ? p.providerConnectionError
                      .replace(/^(Reconnect needed|Connection issue):\s*/i, "")
                      .slice(0, 200)
                : null,
            id: p.id,
            name: p.username || "Someone",
            since: p.providerConnectionErrorAt || null,
            state: stateOf(p),
        });
    }
    const rows = [...servers.values()].map((s) => {
        const failing = s.people.filter((p) => p.state !== "ok");
        const down = s.people.length > 0 && s.people.every((p) => p.state === "issue");
        const status = down ? "down" : failing.length ? "partial" : "up";
        const since = down
            ? new Date(
                  Math.min(...s.people.map((p) => new Date(p.since || Date.now()).getTime()))
              ).toISOString()
            : null;
        return { ...s, failingCount: failing.length, since, status };
    });
    // The version each runs, and whether a newer one is out (utils/serverVersions.js).
    let annotated = rows;
    try {
        annotated = await versions(rows);
    } catch {
        /* shown without */
    }
    // Their address with the configuration in it stays on the server.
    return annotated.map(({ url, ...row }) => row);
}

module.exports = { serverStatusList };
