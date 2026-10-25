// "Chris just added Nuvio - bring the 1,896 titles they've watched on
// Stremio over to it?" On the person page, when their newest sign-in was
// added in the last two weeks and holds little next to an older one. Gone
// once it's dismissed (per sign-in) or once a copy fills it.
//
// Reading both sides costs what a preview costs, so the answer is kept for a
// few minutes per person.

const NEW_FOR_MS = 14 * 24 * 60 * 60 * 1000;
const CACHE_MS = 10 * 60 * 1000;
const FEW = 0.1; // the new one holds under a tenth of the other's titles

const cache = new Map(); // "<account>|<person>" -> { at, value }

function parse(json) {
    try {
        return JSON.parse(json);
    } catch {
        return [];
    }
}

async function offerFor(prisma, deps, accountId, userId, now = Date.now()) {
    // Keyed by account too: the answer names the person and their sign-ins.
    const key = `${accountId}|${userId}`;
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_MS) {
        return hit.value;
    }
    const value = await compute(prisma, deps, accountId, userId, now).catch(() => null);
    if (cache.size > 2000) {
        cache.delete(cache.keys().next().value);
    }
    cache.set(key, { at: now, value });
    return value;
}

async function compute(prisma, deps, accountId, userId, now) {
    const user = await prisma.user.findFirst({
        select: {
            createdAt: true,
            id: true,
            nuvioProfileId: true,
            providerType: true,
            username: true,
        },
        where: { accountId, id: userId },
    });
    if (!user) {
        return null;
    }
    const creds = await prisma.userProviderCredential
        .findMany({ select: { createdAt: true, providerType: true }, where: { userId } })
        .catch(() => []);
    if (!creds.length) {
        return null;
    }
    const signIns = [
        { at: new Date(user.createdAt).getTime(), provider: user.providerType || "stremio" },
        ...creds.map((c) => ({ at: new Date(c.createdAt).getTime(), provider: c.providerType })),
    ].sort((a, b) => b.at - a.at);
    const newest = signIns[0];
    if (now - newest.at > NEW_FOR_MS) {
        return null;
    }
    const setting = await prisma.watchSyncSetting
        .findUnique({ where: { userId } })
        .catch(() => null);
    if (parse(setting?.dismissedOffers).includes(newest.provider)) {
        return null;
    }

    const watchCopy = require("./index");
    const sides = await watchCopy.sides(prisma, deps, accountId, userId);
    // A sign-in's own place: its first profile (the person's own on Nuvio).
    const place = (provider) => {
        const s = sides.find((x) => x.provider === provider);
        if (!s) {
            return null;
        }
        if (provider === "nuvio" && s.profiles.length) {
            return (
                s.profiles.find((p) => p.side === `nuvio:${user.nuvioProfileId || 1}`) ||
                s.profiles[0]
            ).side;
        }
        return s.profiles.length ? s.profiles[0].side : s.side;
    };
    const toSide = place(newest.provider);
    if (!toSide) {
        return null;
    }
    const count = async (side) => {
        const r = await watchCopy.readSide(prisma, deps, accountId, userId, side);
        return [...r.read.state.values()].filter(
            (t) => t.id && (t.watchedAt != null || t.episodes?.size || t.resume)
        ).length;
    };
    const toCount = await count(toSide);
    let best = null;
    for (const s of signIns.slice(1)) {
        const side = place(s.provider);
        if (!side) {
            continue;
        }
        const n = await count(side).catch(() => 0);
        if (!best || n > best.count) {
            best = { count: n, provider: s.provider, side };
        }
    }
    if (!best || best.count === 0 || toCount >= best.count * FEW) {
        return null;
    }
    const label = (provider) => sides.find((x) => x.provider === provider)?.name || provider;
    return {
        from: {
            count: best.count,
            label: label(best.provider),
            provider: best.provider,
            side: best.side,
        },
        name: user.username,
        to: {
            kind: sides.find((x) => x.provider === newest.provider)?.kind || newest.provider,
            label: label(newest.provider),
            provider: newest.provider,
            side: toSide,
        },
    };
}

async function dismiss(prisma, accountId, userId, provider) {
    const setting = await prisma.watchSyncSetting
        .findUnique({ where: { userId } })
        .catch(() => null);
    const list = [...new Set([...parse(setting?.dismissedOffers), String(provider || "")])].filter(
        Boolean
    );
    await prisma.watchSyncSetting.upsert({
        create: { accountId, dismissedOffers: JSON.stringify(list), enabled: false, userId },
        update: { dismissedOffers: JSON.stringify(list) },
        where: { userId },
    });
    forget(userId);
}

function forget(userId) {
    if (!userId) {
        return cache.clear();
    }
    for (const key of cache.keys()) {
        if (key.endsWith(`|${userId}`)) {
            cache.delete(key);
        }
    }
}

module.exports = { dismiss, forget, NEW_FOR_MS, offerFor };
