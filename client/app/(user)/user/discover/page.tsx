"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, PosterCard, type PosterCardItem } from "@/components/ui";
import {
    DiscoverControls,
    DiscoverFilters,
    DiscoverHeading,
} from "@/components/ui/DiscoverControls";
import { toast } from "@/components/ui/Toast";
import { PersonalMediaDetailModal } from "@/components/user/PersonalMediaDetailModal";
import { usePersonalPreferences } from "@/components/user/PersonalPreferences";
import type { RatingsBatchEntry } from "@/lib/api";
import {
    DECADES,
    GENRES,
    type Kind,
    LENGTHS,
    RATINGS,
    SORTS,
    type SortKey,
} from "@/lib/discoverWords";
import { useRatingsBatch } from "@/lib/hooks/useRatingsBatch";
import { useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { personalRequest } from "@/lib/user-api";

interface Title {
    id: string;
    imdbRating?: string;
    name: string;
    poster: string | null;
    releaseInfo?: string;
    type: "movie" | "series";
}
interface TitleState {
    itemId: string;
    itemType: "movie" | "series";
    name: string;
    poster: string | null;
    reaction: "like" | "dislike" | null;
    saved: boolean;
}

interface Page {
    items: Title[];
    nextSkip: number | null;
}

export default function PersonalDiscoverPage() {
    const { userId, authKey, isReady } = useUserAuthHeaders();
    const { preferences } = usePersonalPreferences();
    const fetchRatings = useCallback(
        async (ids: string[]) => {
            if (!(userId && authKey)) {
                return { ratings: {} };
            }
            const batches = [];
            for (let index = 0; index < ids.length; index += 60) {
                batches.push(
                    personalRequest<{ ratings: Record<string, RatingsBatchEntry> }>(
                        userId,
                        authKey,
                        "/discover/ratings",
                        {
                            body: JSON.stringify({ imdbIds: ids.slice(index, index + 60) }),
                            method: "POST",
                        }
                    )
                );
            }
            return {
                ratings: Object.assign(
                    {},
                    ...(await Promise.all(batches)).map((batch) => batch.ratings)
                ) as Record<string, RatingsBatchEntry>,
            };
        },
        [userId, authKey]
    );
    const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
    const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState("");
    const [search, setSearch] = useState("");
    const [kind, setKind] = useState<Kind>("both");
    const [sort, setSort] = useState<SortKey>("popular");
    const [genre, setGenre] = useState("");
    const [decade, setDecade] = useState("");
    const [minRating, setMinRating] = useState("");
    const [length, setLength] = useState("");
    const [lens, setLens] = useState<"titles" | "watchlist">("titles");
    const [items, setItems] = useState<Title[]>([]);
    const [next, setNext] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [revision, setRevision] = useState(0);
    const refreshSaved = useCallback(() => setRevision((value) => value + 1), []);
    const [selected, setSelected] = useState<Title | null>(null);
    const [attribution, setAttribution] = useState("");
    // A generation pins pagination to its filters. Late pages never append to
    // a newer search, and double taps cannot request the same cursor twice.
    const generation = useRef(0);
    const paging = useRef(false);
    const ratingsById = useRatingsBatch(
        preferences.posterRatings ? items.map((item) => item.id) : [],
        fetchRatings
    );
    const params = useMemo(
        () =>
            new URLSearchParams({
                catalog: SORTS.find((item) => item.key === sort)?.catalog || "top",
                type: kind,
                ...(search ? { query: search } : {}),
                ...(genre ? { genre } : {}),
                ...(decade ? { decade } : {}),
                ...(minRating ? { minRating } : {}),
                ...(length ? { length } : {}),
                paged: "1",
            }).toString(),
        [kind, sort, search, genre, decade, minRating, length]
    );
    useEffect(() => {
        const timer = setTimeout(() => setSearch(query.trim()), 300);
        return () => clearTimeout(timer);
    }, [query]);
    useEffect(() => {
        let active = true;
        if (isReady && userId && authKey) {
            personalRequest<{ attribution: string }>(userId, authKey, "/discover/lumiere")
                .then((data) => {
                    if (active) {
                        setAttribution(data.attribution);
                    }
                })
                .catch(() => undefined);
        }
        return () => {
            active = false;
        };
    }, [isReady, userId, authKey]);
    useEffect(() => {
        const version = ++generation.current;
        paging.current = false;
        setItems([]);
        setNext(null);
        setError("");
        if (!(isReady && userId && authKey)) {
            return;
        }
        setBusy(true);
        const load = async () => {
            if (lens === "watchlist") {
                const data = await personalRequest<{ items: TitleState[] }>(
                    userId,
                    authKey,
                    "/discover/saved"
                );
                return {
                    items: data.items.map((item) => ({
                        id: item.itemId,
                        name: item.name,
                        poster: item.poster,
                        type: item.itemType,
                    })),
                    nextSkip: null,
                } as Page;
            }
            return personalRequest<Page>(
                userId,
                authKey,
                `/discover/${search ? "search" : "browse"}?${params}`
            );
        };
        load()
            .then((data) => {
                if (version === generation.current) {
                    setItems(data.items);
                    setNext(data.nextSkip);
                }
            })
            .catch((errorLocal) => {
                if (version === generation.current) {
                    setError(
                        errorLocal instanceof Error ? errorLocal.message : "Could not load titles"
                    );
                }
            })
            .finally(() => {
                if (version === generation.current) {
                    setBusy(false);
                }
            });
        return () => {
            generation.current = version + 1;
        };
    }, [isReady, userId, authKey, lens, search, params, revision]);
    const loadMore = async () => {
        if (!(userId && authKey) || next === null || paging.current) {
            return;
        }
        const version = generation.current;
        paging.current = true;
        setBusy(true);
        setError("");
        try {
            const data = await personalRequest<Page>(
                userId,
                authKey,
                `/discover/browse?${params}&skip=${next}`
            );
            if (version === generation.current) {
                setItems((previous) => {
                    const ids = new Set(previous.map((item) => item.id));
                    return [...previous, ...data.items.filter((item) => !ids.has(item.id))];
                });
                setNext(data.nextSkip === next ? null : data.nextSkip);
            }
        } catch {
            if (version === generation.current) {
                setError("Could not load more titles. Please try again.");
            }
        } finally {
            if (version === generation.current) {
                paging.current = false;
                setBusy(false);
            }
        }
    };
    useEffect(() => {
        let active = true;
        if (isReady && userId && authKey) {
            personalRequest<{ items: TitleState[] }>(userId, authKey, "/discover/saved")
                .then((data) => {
                    if (active) {
                        setSavedIds(new Set(data.items.map((item) => item.itemId)));
                    }
                })
                .catch(() => undefined);
        }
        return () => {
            active = false;
        };
    }, [isReady, userId, authKey, revision]);
    const prefetch = (item: PosterCardItem) => {
        if (userId && authKey) {
            void personalRequest(
                userId,
                authKey,
                `/discover/titles/${item.id}?type=${item.type}`
            ).catch(() => undefined);
        }
    };
    const toggleSaved = async (item: PosterCardItem, saved: boolean) => {
        if (!(userId && authKey)) {
            return;
        }
        try {
            const { state } = await personalRequest<{ state: TitleState | null }>(
                userId,
                authKey,
                `/discover/titles/${item.id}?type=${item.type}`
            );
            await personalRequest(userId, authKey, `/discover/titles/${item.id}`, {
                body: JSON.stringify({
                    itemType: item.type,
                    name: item.name,
                    poster: item.poster,
                    reaction: state?.reaction || null,
                    saved,
                }),
                method: "PUT",
            });
            setRevision((value) => value + 1);
        } catch {
            toast.error("Could not update your watchlist");
        }
    };
    const sorted = useMemo(() => {
        const result = items.filter(
            (item) =>
                lens !== "watchlist" ||
                ((!search || item.name.toLowerCase().includes(search.toLowerCase())) &&
                    (kind === "both" || item.type === kind))
        );
        if (sort === "az") {
            result.sort((a, b) => a.name.localeCompare(b.name));
        }
        if (sort === "rated") {
            const score = (value?: string) => {
                const number = Number.parseFloat(value || "");
                return Number.isFinite(number) ? number : -1;
            };
            result.sort((a, b) => score(b.imdbRating) - score(a.imdbRating));
        }
        if (sort === "newest") {
            result.sort(
                (a, b) =>
                    (Number.parseInt(b.releaseInfo || "", 10) || 0) -
                    (Number.parseInt(a.releaseInfo || "", 10) || 0)
            );
        }
        return result;
    }, [items, sort, lens, search, kind]);

    const clearFilters = () => {
        setGenre("");
        setDecade("");
        setMinRating("");
        setLength("");
    };
    const groups = [
        {
            label: "Genre",
            onChange: setGenre,
            options: GENRES.map((value) => ({ label: value, value })),
            value: genre,
        },
        {
            label: "Decade",
            onChange: setDecade,
            options: DECADES.map((item) => ({ label: item.label, value: item.key })),
            value: decade,
        },
        {
            label: "Rating",
            onChange: setMinRating,
            options: RATINGS.map((value) => ({ label: `${value}+`, value: String(value) })),
            value: minRating,
        },
        {
            label: "Length",
            onChange: setLength,
            options: LENGTHS.map((item) => ({ label: item.label, value: item.key })),
            value: length,
        },
    ];
    const applied =
        lens === "titles"
            ? groups
                  .filter((group) => group.value)
                  .map((group) => ({
                      clear: () => group.onChange(""),
                      key: group.label,
                      label:
                          group.options.find((option) => option.value === group.value)?.label ||
                          group.value,
                  }))
            : [];
    return (
        <div className="pt-6 pb-8">
            <DiscoverHeading />
            <DiscoverControls
                applied={applied}
                filterCount={applied.length}
                filtersBody={(close) => (
                    <DiscoverFilters
                        clear={clearFilters}
                        close={close}
                        count={applied.length}
                        groups={groups}
                    />
                )}
                hasFilters={lens === "titles"}
                kind={kind}
                lens={lens}
                lenses={[
                    { key: "titles", label: "Titles" },
                    { count: savedIds.size, key: "watchlist", label: "Watchlist" },
                ]}
                pickSort={(value) => setSort(value as SortKey)}
                searchPlaceholder={
                    lens === "watchlist" ? "Search your watchlist" : "Search a title"
                }
                searchQuery={query}
                setKind={setKind}
                setLens={setLens}
                setSearchQuery={setQuery}
                sortOptions={SORTS.filter((item) => item.key !== "trending")}
                sortValue={sort}
                surprise={() => {
                    const item = sorted[Math.floor(Math.random() * sorted.length)];
                    if (item) {
                        setSelected(item);
                    }
                }}
            />
            <h2 className="mb-4 font-display font-semibold text-default text-lg sm:text-xl">
                {lens === "watchlist"
                    ? "Your watchlist"
                    : search
                      ? `Results for “${search}”`
                      : SORTS.find((item) => item.key === sort)?.label}
            </h2>
            {error && (
                <div className="mb-5 flex items-center gap-3 text-error text-sm" role="alert">
                    <p>{error}</p>
                    <Button
                        onClick={() =>
                            next === null ? setRevision((value) => value + 1) : loadMore()
                        }
                        size="sm"
                        variant="secondary"
                    >
                        Try again
                    </Button>
                </div>
            )}
            {!(busy || error || items.length) && (
                <Card padding="lg">
                    <p className="text-muted text-sm">
                        {lens === "watchlist"
                            ? "Your watchlist is empty. Open a title and save it for later."
                            : "No titles match these filters. Try another search or reset your filters."}
                    </p>
                </Card>
            )}
            <div className="discovery-poster-grid">
                {sorted.map((item, index) => (
                    <PosterCard
                        cacheImages={false}
                        inWatchlist={savedIds.has(item.id)}
                        isMenuOpen={openMenuKey === item.id}
                        item={item}
                        key={item.id}
                        onMenuOpenChange={(open, key) => setOpenMenuKey(open ? key : null)}
                        onOpenDetails={(itemLocal) =>
                            setSelected({
                                ...itemLocal,
                                imdbRating: itemLocal.imdbRating || undefined,
                                releaseInfo: itemLocal.releaseInfo || undefined,
                            })
                        }
                        onPrefetchDetails={prefetch}
                        onToggleWatched={() => undefined}
                        onToggleWatchlist={toggleSaved}
                        priority={index < 16}
                        ratings={ratingsById[item.id]}
                        showCatalogMenu={false}
                        showWatchedBadge={false}
                        showWatchedMenu={false}
                    />
                ))}
            </div>
            {busy && (
                <p className="py-6 text-muted text-sm" role="status">
                    Loading titles...
                </p>
            )}
            {next !== null && !search && lens === "titles" && (
                <div className="mt-6 flex justify-center">
                    <Button disabled={busy} onClick={loadMore} variant="secondary">
                        Load more
                    </Button>
                </div>
            )}
            {attribution && <p className="mt-8 text-muted text-xs">{attribution}</p>}
            {selected && userId && authKey && (
                <PersonalMediaDetailModal
                    authKey={authKey}
                    item={selected}
                    key={`${userId}:${selected.id}`}
                    onChange={refreshSaved}
                    onClose={() => setSelected(null)}
                    ratings={ratingsById[selected.id]}
                    userId={userId}
                />
            )}
        </div>
    );
}
