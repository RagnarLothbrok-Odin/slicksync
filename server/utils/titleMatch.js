// Whether a proxy stream and a library title are the same thing.
//
// The proxy only knows a filename ("Dune.Part.Two.2024.2160p...", "Man on
// Fire S01E01"); the native pipeline knows the library's own title ("Dune:
// Part Two", "Man on Fire"). They used to be compared by "one contains the
// other", which was written so an episode filename would match its show -
// and also made every sequel match its original ("dune part two" contains
// "dune", "toy story 2" contains "toy story", "us" is inside "the usual
// suspects"). A live stream then borrowed the older film's name and poster,
// or hid the wrong card.
//
// The rule now:
//   1. When both sides carry an IMDb id, the ids decide - same id, same
//      title; different ids, different titles. That also separates remakes
//      that share a name ("It" 1990 and 2017).
//   2. Otherwise the names must be equal once tidied: lowercased, year and
//      leading release tags dropped, and anything from an episode marker on
//      cut off ("man on fire s01e01 pilot" is "man on fire").
//   3. For a series only, the other ways a release names an episode are cut
//      off too ("Ep05", "Episode 5", "S2 - 05", "2nd Season", a date for a
//      daily show), a country or a year after the name is ignored
//      ("Shameless US" is "Shameless"), and a bare trailing episode number
//      matches ("[Group] Show - 05" is "Show") - anime releases number that
//      way. Never for films: "Toy Story 2" is not "Toy Story". A series
//      whose library name is two words or eight characters long also
//      matches a stream name that starts with it ("Band of Brothers Part
//      3"): a missed match leaves a duplicate card and a stale entry, and
//      IMDb ids settle it first whenever both sides have one. A shorter name
//      ("Dune") only accepts episode wording after it.
//   4. For a film only, a name may carry edition wording the library title
//      lacks ("Blade Runner The Final Cut" is "Blade Runner"). The words are
//      a closed list - anything else after the name is a different film.
//
// For a film nothing here is "starts with" or "contains" on its own: that is
// what let a sequel through.

const EPISODE_MARKER = /\s+(s\d{1,2}\s?e\d{1,3}|\d{1,2}x\d{1,3}|e\d{1,3}|season\s+\d{1,2})\b.*$/;
// Series only: episode, season and air-date forms without an SxxExx.
const SERIES_MARKER =
    /\s+(ep\s?\d{1,4}|episode\s+\d{1,4}|s\d{1,2}|\d{1,2}(?:st|nd|rd|th)\s+season|(?:19|20)\d{2}\s\d{2}\s\d{2}|\d{2}\s\d{2}\s(?:19|20)\d{2})\b.*$/;
// Series only: a country or a year a release puts after the show's name.
const SERIES_TAIL = /\s+(?:us|uk|au|ca|nz|(?:19|20)\d{2})$/;
// Series only, after a short name: a number with letters on it ("05v2", "05 bd"),
// or ova/oad/ona/special, or part/pt/vol with a number or roman numeral.
const SERIES_RELEASE_WORDING =
    /^(?:\d[a-z0-9]*(?:\s.*)?|(?:ova|oad|ona|special)(?:\s.*)?|(?:part|pt|vol)\s(?:\d{1,3}|[ivx]{1,4})(?:\s.*)?)$/;
// Film only: every one of the extra words has to be one of these.
const EDITION_WORDS = new Set([
    "the",
    "extended",
    "director",
    "directors",
    "s",
    "cut",
    "final",
    "unrated",
    "uncut",
    "theatrical",
    "imax",
    "remastered",
    "remaster",
    "restored",
    "restoration",
    "special",
    "edition",
    "redux",
    "ultimate",
    "criterion",
    "collector",
    "collectors",
    "anniversary",
    "version",
    "4k",
]);
// ...and at least one of these, so "the" alone is not an edition.
const EDITION_ANCHORS = new Set([
    "extended",
    "cut",
    "unrated",
    "uncut",
    "theatrical",
    "imax",
    "remastered",
    "remaster",
    "restored",
    "restoration",
    "edition",
    "redux",
    "criterion",
    "version",
]);

/** Lowercase, year and punctuation dropped. "Obsession (2025)" -> "obsession". */
function normalizeTitle(name) {
    return (name || "")
        .toLowerCase()
        .replace(/\(\d{4}\)/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/** The title itself: release tags off the front, episode marker and what follows off the end. */
function titleCore(name, { series = false } = {}) {
    const whole = normalizeTitle(name);
    // A title that is nothing but a bracket group ("[REC]") is the title.
    const untagged =
        normalizeTitle(String(name || "").replace(/^(\s*\[[^\]]*\]\s*)+/, "")) || whole;
    if (!series) {
        return untagged.replace(EPISODE_MARKER, "").trim();
    }
    // The series forms first: "2nd season 05" has to go whole, before the
    // plain "season 05" marker takes only its second half.
    let core = untagged.replace(SERIES_MARKER, "").replace(EPISODE_MARKER, "").trim();
    // Never strip a name down to nothing: "1923" is a show.
    while (SERIES_TAIL.test(core)) {
        core = core.replace(SERIES_TAIL, "").trim();
    }
    return core;
}

// "blade runner the final cut" against "blade runner".
function editionOf(long, short) {
    if (!long.startsWith(`${short} `)) {
        return false;
    }
    const extra = long.slice(short.length + 1).split(" ");
    return extra.every((w) => EDITION_WORDS.has(w)) && extra.some((w) => EDITION_ANCHORS.has(w));
}

function sameTitle(a, b, { series = false } = {}) {
    const x = titleCore(a, { series });
    const y = titleCore(b, { series });
    if (!(x && y)) {
        return false;
    }
    if (x === y) {
        return true;
    }
    if (!series) {
        return editionOf(x, y) || editionOf(y, x);
    }
    // "show 05" against "show", either way round.
    const numbered = (long, short) => {
        if (!long.startsWith(`${short} `)) {
            return false;
        }
        const rest = long.slice(short.length + 1);
        if (/^\d{1,4}$/.test(rest)) {
            return true;
        }
        // A name long enough to be itself: whatever follows it is that show's own
        // release wording ("band of brothers part 3", "attack on titan 05v2 bd").
        if (short.length >= 8 || short.includes(" ")) {
            return true;
        }
        // A short name ("dune", "ncis") is also the start of other shows, so only
        // the wording a release uses for an episode counts.
        return SERIES_RELEASE_WORDING.test(rest);
    };
    return numbered(x, y) || numbered(y, x);
}

const isImdbId = (id) => /^tt\d+$/.test(String(id || ""));

/**
 * A proxy stream against a library item.
 * `proxy`: { id (the stream's matched IMDb id, if any), titles: [names it goes by] }
 * `item`:  { id, name, type }
 */
function pairMatches(proxy, item) {
    if (!(proxy && item)) {
        return false;
    }
    if (isImdbId(proxy.id) && isImdbId(item.id)) {
        return proxy.id === item.id;
    }
    const series = item.type === "series";
    return (proxy.titles || []).some((t) => sameTitle(t, item.name, { series }));
}

module.exports = { isImdbId, normalizeTitle, pairMatches, sameTitle, titleCore };
