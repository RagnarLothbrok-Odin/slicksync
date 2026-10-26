/** Use the same Continue Watching endpoint as Trakt's web client. */
async function loadUpNext(get, now = Date.now()) {
    const entries = new Map();
    const limit = 100;
    for (let page = 1; page <= 20; page++) {
        const result = await get(
            `/sync/progress/up_next_nitro?intent=continue&page=${page}&limit=${limit}`
        );
        if (!Array.isArray(result.data)) {
            throw new Error("Trakt Continue Watching is unavailable.");
        }
        for (const entry of result.data) {
            const progress = entry.progress;
            const episode = progress?.next_episode;
            const aired = Date.parse(episode?.first_aired);
            if (
                progress?.hidden ||
                !/^tt\d+$/.test(entry.show?.ids?.imdb || "") ||
                !Number.isInteger(episode?.season) ||
                !Number.isInteger(episode?.number) ||
                episode.number < 1 ||
                episode.season < 0 ||
                !Number.isFinite(aired) ||
                aired > now
            ) {
                continue;
            }
            entries.set(entry.show.ids.imdb, {
                episode,
                lastEpisode: progress.last_episode || null,
                paused_at: progress.last_watched_at,
                resume: false,
                show: entry.show,
            });
        }
        // This endpoint can retain broader pagination headers after filtering.
        // A short body page is exhausted even when those headers report more pages.
        if (
            result.data.length < limit ||
            (Number.isInteger(result.pages) && page >= result.pages)
        ) {
            return [...entries.values()];
        }
    }
    throw new Error("Trakt Continue Watching could not be loaded completely.");
}
module.exports = { loadUpNext };
