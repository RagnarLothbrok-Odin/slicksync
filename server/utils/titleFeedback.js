// SlickTrax reactions (thumbs up/down) and personal ratings - both household-wide
// (no userId), matching NotInterestedItem/WatchlistItem's existing scoping
// (see server/utils/notInterested.js). Both feed recommendation scoring via
// recommendationEngine.js's computeSignedAdjustments - see that module's own
// comment for the weight scheme.
//
// Deliberately binary (happy/sad), not a 3-tier like/love/dislike - the
// original 👍/❤️/👎 version read as clutter in practice (real feedback,
// this session) and a plain two-state reaction needs no legend to
// understand at a glance.
const REACTIONS = new Set(["happy", "sad"]);
const OVERALL_SEASON = 0;

function normalizeAccountId(accountId) {
    return accountId || "default";
}

// ---- Reactions --------------------------------------------------------

/** Upsert (one reaction per item - setting a new one replaces the old). */
async function setReaction(prisma, accountId, itemId, itemType, reaction, itemName, poster) {
    if (!REACTIONS.has(reaction)) {
        throw new Error(`Invalid reaction: ${reaction}`);
    }
    const accountIdValue = normalizeAccountId(accountId);
    return prisma.titleReaction.upsert({
        create: {
            accountId: accountIdValue,
            itemId,
            itemName: itemName || null,
            itemType,
            poster: poster || null,
            reaction,
        },
        update: { itemName: itemName || undefined, poster: poster || undefined, reaction },
        where: { accountId_itemId: { accountId: accountIdValue, itemId } },
    });
}

async function clearReaction(prisma, accountId, itemId) {
    const accountIdValue = normalizeAccountId(accountId);
    await prisma.titleReaction.deleteMany({ where: { accountId: accountIdValue, itemId } });
}

/** { itemId: 'like'|'love'|'dislike' } lookup, for batch UI state. */
async function getReactionsMap(prisma, accountId, itemIds) {
    const accountIdValue = normalizeAccountId(accountId);
    const where = { accountId: accountIdValue };
    if (Array.isArray(itemIds)) {
        where.itemId = { in: itemIds };
    }
    const rows = await prisma.titleReaction.findMany({
        select: { itemId: true, reaction: true },
        where,
    });
    return Object.fromEntries(rows.map((r) => [r.itemId, r.reaction]));
}

/** Full rows, for feeding the recommendation engine's affinity walk. */
async function getAllReactions(prisma, accountId) {
    const accountIdValue = normalizeAccountId(accountId);
    return prisma.titleReaction.findMany({
        select: { itemId: true, itemName: true, itemType: true, poster: true, reaction: true },
        where: { accountId: accountIdValue },
    });
}

// ---- Ratings ------------------------------------------------------------

/** season omitted/0 = overall (movies always use this; series may use it too, independent of any per-season ratings). */
async function setRating(prisma, accountId, itemId, itemType, rating, season, itemName, poster) {
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 10) {
        throw new Error("rating must be an integer 1-10");
    }
    const seasonValue = Number.isInteger(season) ? season : OVERALL_SEASON;
    const accountIdValue = normalizeAccountId(accountId);
    return prisma.titleRating.upsert({
        create: {
            accountId: accountIdValue,
            itemId,
            itemName: itemName || null,
            itemType,
            poster: poster || null,
            rating: r,
            season: seasonValue,
        },
        update: { itemName: itemName || undefined, poster: poster || undefined, rating: r },
        where: {
            accountId_itemId_season: { accountId: accountIdValue, itemId, season: seasonValue },
        },
    });
}

async function clearRating(prisma, accountId, itemId, season) {
    const seasonValue = Number.isInteger(season) ? season : OVERALL_SEASON;
    const accountIdValue = normalizeAccountId(accountId);
    await prisma.titleRating.deleteMany({
        where: { accountId: accountIdValue, itemId, season: seasonValue },
    });
}

/** { itemId: { 0: rating, 1: rating, ... } } lookup, for the detail modal's season picker. */
async function getRatingsForItem(prisma, accountId, itemId) {
    const accountIdValue = normalizeAccountId(accountId);
    const rows = await prisma.titleRating.findMany({
        select: { rating: true, season: true },
        where: { accountId: accountIdValue, itemId },
    });
    return Object.fromEntries(rows.map((r) => [r.season, r.rating]));
}

/** Full rows, for feeding the recommendation engine. */
async function getAllRatings(prisma, accountId) {
    const accountIdValue = normalizeAccountId(accountId);
    return prisma.titleRating.findMany({
        select: {
            itemId: true,
            itemName: true,
            itemType: true,
            poster: true,
            rating: true,
            season: true,
        },
        where: { accountId: accountIdValue },
    });
}

module.exports = {
    clearRating,
    clearReaction,
    getAllRatings,
    getAllReactions,
    getRatingsForItem,
    getReactionsMap,
    OVERALL_SEASON,
    setRating,
    setReaction,
};
