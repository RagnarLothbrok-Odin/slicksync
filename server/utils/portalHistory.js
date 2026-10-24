const {
    parseCsv,
    mapColumns,
    parseWatchedDate,
    looksLikeSeriesEpisodeTitle,
} = require("./csvHistoryImport");
const { parseTraktExport, looksLikeJson } = require("./traktExportImport");

// Preview and commit use the same normalised rows. Imports only create this
// person's movie history, never shared ratings or an existing playback record.
function previewHistory(text, existingIds = []) {
    let parsed;
    if (looksLikeJson(text)) {
        let backup;
        try {
            backup = JSON.parse(text);
        } catch {
            throw new Error("That file is not valid JSON");
        }
        if (Array.isArray(backup?.movieHistory)) {
            parsed = {
                headers: ["imdbID", "Title", "Watched Date"],
                records: backup.movieHistory.map((row) => ({
                    imdbID: row.itemId,
                    Title: row.itemName,
                    "Watched Date": row.watchedAt,
                })),
                skippedNonMovie: Array.isArray(backup.episodeHistory)
                    ? backup.episodeHistory.length
                    : 0,
            };
        } else {
            parsed = parseTraktExport(text);
        }
        if (!parsed) {
            throw new Error("That file is not valid JSON");
        }
    } else {
        parsed = parseCsv(text);
    }
    const { headers, records } = parsed;
    if (!records.length) {
        throw new Error(
            "No movie history found. Choose a history CSV or Trakt movie history JSON file."
        );
    }
    if (records.length > 2000) {
        throw new Error("Please split this file into batches of 2,000 rows or fewer.");
    }
    const columns = mapColumns(headers);
    const seen = new Set(existingIds);
    const rows = [];
    let duplicates = 0,
        skipped = parsed.skippedNonMovie || 0;
    for (const row of records) {
        const id = String(row[columns.imdbId] || "").trim();
        const watchedAt = parseWatchedDate(row[columns.watchedDate]);
        // An explicit IMDb id and watch date avoid importing a watchlist as history
        // or resolving an ambiguous series title as a movie.
        if (!(/^tt\d+$/.test(id) && watchedAt) || looksLikeSeriesEpisodeTitle(row[columns.title])) {
            skipped++;
            continue;
        }
        if (seen.has(id)) {
            duplicates++;
            continue;
        }
        seen.add(id);
        rows.push({
            itemId: id,
            itemName: String(row[columns.title] || id).slice(0, 300),
            watchedAt: watchedAt.toISOString(),
        });
    }
    return { duplicates, rows, skipped, total: records.length + (parsed.skippedNonMovie || 0) };
}
module.exports = { previewHistory };
