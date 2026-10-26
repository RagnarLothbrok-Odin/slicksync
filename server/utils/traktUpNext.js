const { mapLimit } = require("./mapLimit");

/** Read recent show summaries and their next aired episodes, never lifetime events. */
async function loadUpNext(get) {
    const [watched, hidden, dropped] = await Promise.all([
        get("/sync/watched/shows?extended=noseasons&page=1&limit=24"),
        get("/users/hidden/progress_watched?type=show&page=1&limit=250"),
        get("/users/hidden/dropped?type=show&page=1&limit=250"),
    ]);
    if (!(Array.isArray(watched.data) && Array.isArray(hidden.data))) {
        throw new Error("Trakt show progress is unavailable.");
    }
    if (hidden.pages > 1 || dropped.pages > 1) {
        throw new Error("Trakt hidden show preferences could not be loaded completely.");
    }
    const excluded = new Set(
        [...hidden.data, ...dropped.data].map((entry) => entry.show?.ids?.trakt)
    );
    const candidates = watched.data
        .filter(
            (entry) =>
                entry.show?.ids?.trakt &&
                /^tt\d+$/.test(entry.show?.ids?.imdb || "") &&
                !excluded.has(entry.show.ids.trakt)
        )
        .slice(0, 24);
    const entries = await mapLimit(candidates, 3, async (entry) => {
        try {
            const result = await get(
                `/shows/${entry.show.ids.trakt}/progress/watched?hidden=false&specials=false&last_activity=watched`
            );
            const progress = result.data;
            const episode = progress?.next_episode;
            if (
                !(Number.isInteger(episode?.season) && Number.isInteger(episode?.number)) ||
                episode.number < 1 ||
                episode.season < 0
            ) {
                return null;
            }
            return {
                episode,
                paused_at: progress.last_watched_at || entry.last_watched_at,
                resume: false,
                show: entry.show,
            };
        } catch (error) {
            if (error.providerStatus === 404) {
                return null;
            }
            throw error;
        }
    });
    return entries.filter(Boolean);
}
module.exports = { loadUpNext };
