// The personal dashboard must resolve titles independently of whether the
// library page has warmed its cache. Reads never sync or modify a provider.
async function portalActivityMetadata(
    library,
    activities,
    fetchMetadata = require("./notify").fetchMetadata
) {
    const baseId = (id) => /^tt\d+/.exec(String(id))?.[0] || id;
    const map = new Map();
    for (const item of library) {
        map.set(baseId(item._id || item.id), item);
    }
    const ranked = new Map();
    for (const activity of activities) {
        const id = baseId(activity.itemId);
        const entry = ranked.get(id) || { duration: 0, id, type: activity.itemType };
        entry.duration += activity.watchTimeSeconds || 0;
        ranked.set(id, entry);
    }
    // Prioritize the Most Watched card and bound cold-cache network work.
    const missing = [...ranked.values()]
        .sort((a, b) => b.duration - a.duration)
        .filter(
            (item) =>
                !map.get(item.id)?.name ||
                map.get(item.id).name === item.id ||
                !map.get(item.id)?.poster
        )
        .slice(0, 12);
    await Promise.all(
        missing.map(async (item) => {
            try {
                const meta = await fetchMetadata(item.id, item.type, null);
                if (meta?.title) {
                    map.set(item.id, {
                        ...map.get(item.id),
                        name: meta.title,
                        poster: meta.poster || map.get(item.id)?.poster,
                    });
                }
            } catch {
                /* An unavailable metadata service must not fail watch history. */
            }
        })
    );
    return { get: (id) => map.get(baseId(id)), size: map.size };
}
module.exports = { portalActivityMetadata };
