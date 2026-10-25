"use client";

import {
    BellIcon,
    BookmarkIcon as BookmarkOutlineIcon,
    CheckCircleIcon,
    CheckIcon as CheckIconMini,
    ChevronDownIcon,
    ChevronLeftIcon,
    HandThumbDownIcon,
    HandThumbUpIcon,
} from "@heroicons/react/24/outline";
import {
    BookmarkIcon as BookmarkSolidIcon,
    ClockIcon,
    FilmIcon,
    PlayIcon,
    ShieldCheckIcon,
    StarIcon,
    XMarkIcon,
} from "@heroicons/react/24/solid";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useContext, useEffect, useRef, useState } from "react";
import { TVFocusable } from "@/components/tv/TVFocusable";
import { ScrollRow } from "@/components/ui/ScrollRow";
import { buildAioStreamsAppUrl } from "@/lib/aiostreamsLink";
import {
    type DiscoverItem,
    api as defaultApi,
    type MediaDetails,
    type SeriesSeason,
} from "@/lib/api";
import { buildNuvioAppUrl, buildStremioAppUrl } from "@/lib/appLinks";
import { useDragScroll } from "@/lib/hooks/useDragScroll";
import { useIsTV } from "@/lib/hooks/useIsTV";
import { usePersonalFeatures } from "@/lib/hooks/usePersonalFeatures";
import { posterUrl as cachedPosterUrl } from "@/lib/posterUrl";
import { AddToListButton } from "./AddToListButton";
import { Badge } from "./Badge";
import { CastMenu, type CastMenuTarget } from "./CastMenu";
import { Modal } from "./Modal";
import { OpenWithButton } from "./OpenWithButton";
import { metacriticColor as metacriticTextColor } from "./RatingBadges";
import { toast } from "./Toast";

// The same detail view can use a personal data source without gaining any
// access to household operations. Callers must implement every operation.
export type MediaDetailClient = Pick<
    typeof defaultApi,
    | "getFollows"
    | "followSubject"
    | "muteFollow"
    | "getPersonCredits"
    | "resolveImdbId"
    | "lookupAnime"
    | "getAnimeWatchOrder"
    | "getMediaEpisodes"
    | "getWatchlist"
    | "addToWatchlist"
    | "removeFromWatchlist"
    | "getWatchedStatus"
    | "markWatched"
    | "getUsers"
    | "getWatchTogether"
    | "saveWatchTogether"
    | "deleteWatchTogether"
    | "getReactions"
    | "clearReaction"
    | "setReaction"
    | "getMediaDetails"
    | "getSimilarItems"
>;

interface MediaDetailModalProps {
    cacheImages?: boolean;
    client?: MediaDetailClient;
    fallbackMetacritic?: string | null;
    fallbackPoster?: string | null;
    // Rating/year OVERRIDES — not just fallbacks for when details is missing
    // them. Cinemeta runs two separate backends that can genuinely disagree
    // on the same title (confirmed real example: Americana showed 2023/★5.9
    // in the Discover grid, sourced from v3-cinemeta.strem.io's catalog, but
    // 2025/★6.0 in this modal, sourced from cinemeta-live.strem.io's per-item
    // lookup — same IMDb id, two different answers). Rather than silently
    // overwrite the number a user just saw in the grid with the OTHER
    // backend's answer for the same field, callers that already know the
    // grid's numbers (Discover, Recommendations, Watchlist) pass them here
    // and they win over `details`. Cast/genres/runtime/trailer still only
    // exist on the detail lookup, so those are unaffected either way.
    fallbackRating?: string | null;
    fallbackReleaseInfo?: string | null;
    // Same "grid already knows, don't wait on / overwrite it" reasoning as
    // fallbackRating above, but for OMDb's Rotten Tomatoes/Metacritic scores.
    // The modal's own detail lookup (Cinemeta) never returns these at all, so
    // without a caller-supplied value the row falls back to the bare IMDb
    // number even when the caller already fetched a fuller RatingBadges-style
    // batch (Discover's useRatingsBatch) for the same item.
    fallbackRottenTomatoes?: string | null;
    fallbackTitle: string;
    householdActions?: boolean;
    isOpen: boolean;
    itemId: string;
    itemType: "movie" | "series";
    onClose: () => void;
    // Fires after the modal's own watchlist toggle succeeds (or fails and
    // reverts), so a caller with its own watchlist list/grid — Discover, in
    // practice — can stay in sync. Without this the modal's add/remove was a
    // dead end: it really did persist to the account's watchlist, but nothing
    // told the page that opened the modal, so its poster-card badges and its
    // Watchlist tab (both reading from the page's own already-fetched list,
    // not a fresh request) kept showing the old state until a full reload.
    onWatchlistChange?: (itemId: string, inWatchlist: boolean) => void;
    videoId?: string | null;
}

// The account's AIOStreams servers, read once per page load (see
// lib/aiostreamsLink.ts). An empty list hides Open in AIOStreams.
let aioServersPromise: Promise<{ address: string; people: string[] }[]> | null = null;
function loadAioServers() {
    if (!aioServersPromise) {
        aioServersPromise = defaultApi
            .getAioStreamsServers()
            .then((r) => r.servers || [])
            .catch(() => []);
    }
    return aioServersPromise;
}

// Bookmark and Watched as small soft pills - under the title on a computer,
// after the ratings on a phone (with + Catalog beside them).
function SmallPill({
    on,
    tint,
    onClick,
    busy,
    icon,
    label,
    title,
}: {
    on: boolean;
    tint: string;
    onClick: () => void;
    busy?: boolean;
    icon: React.ReactNode;
    label: string;
    title: string;
}) {
    return (
        <button
            aria-pressed={on}
            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-1 font-medium text-xs transition-colors sm:gap-1.5 sm:px-2.5 sm:text-[13px] ${on ? "pill-tint-on" : "pill-tint-off"} ${busy ? "cursor-wait opacity-60" : ""}`}
            disabled={busy}
            onClick={onClick}
            style={{ "--tint": tint } as React.CSSProperties}
            title={title}
            type="button"
        >
            {icon}
            {label}
        </button>
    );
}

export function MediaDetailModal({
    client,
    householdActions = true,
    cacheImages = true,
    isOpen,
    onClose,
    itemId,
    itemType,
    videoId,
    fallbackTitle,
    fallbackPoster,
    fallbackRating,
    fallbackReleaseInfo,
    fallbackRottenTomatoes,
    fallbackMetacritic,
    onWatchlistChange,
}: MediaDetailModalProps) {
    const api = client || defaultApi;
    const posterUrl = useCallback(
        (...args: Parameters<typeof cachedPosterUrl>) =>
            cacheImages ? cachedPosterUrl(...args) : args[0].poster || undefined,
        [cacheImages]
    );
    const [details, setDetails] = useState<MediaDetails | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [hasFetched, setHasFetched] = useState(false);
    const [isTrailerPlaying, setIsTrailerPlaying] = useState(false);
    // Set exactly once per play session (auto-trigger or manual click) and
    // never recomputed afterward - critically, NOT derived reactively from
    // mute state. Confirmed real bug: unmuting via fullscreen used to update a
    // `trailerMuted` state that the iframe's `src` read from, so React changed
    // the iframe's src attribute, the browser reloaded the iframe's document
    // to apply it, and that reload forcibly killed fullscreen and restarted
    // the video right back at the embedded (non-fullscreen) view. All
    // muting/unmuting after the iframe exists must go through the YouTube
    // Player API (trailerPlayerRef below) instead, never by changing src.
    const [trailerSrc, setTrailerSrc] = useState<string | null>(null);
    // Real YouTube IFrame Player API controller, attached to the trailer
    // iframe once it's playing - needed to call unMute() on fullscreen (see
    // the effect near trailerId below for why a raw <iframe src> alone can't
    // do this).
    const trailerIframeRef = useRef<HTMLIFrameElement>(null);
    const trailerPlayerRef = useRef<YouTubePlayer | null>(null);

    const buildTrailerSrc = useCallback((id: string, muted: boolean) => {
        const origin =
            typeof window === "undefined" ? "" : encodeURIComponent(window.location.origin);
        return `https://www.youtube.com/embed/${id}?autoplay=1${muted ? "&mute=1" : ""}&enablejsapi=1&origin=${origin}`;
    }, []);

    // "More Like This" drill-down - clicking a related poster swaps the
    // modal's effective item in place instead of closing and asking whatever
    // opened this modal (5 different callers: Dashboard, Discover, Activity,
    // Settings, UpcomingEpisodesPanel) to manage a second item. Self-contained
    // here so none of them need changes. null = showing the item the caller
    // actually opened; set = drilled into a related title. Reset whenever the
    // EXTERNAL itemId changes (see the effect below) so reopening the modal
    // for a different poster doesn't carry over a stale drill-down.
    const [overrideItem, setOverrideItem] = useState<{
        id: string;
        type: "movie" | "series";
        name: string;
        poster: string | null;
        imdbRating?: string | null;
        releaseInfo?: string | null;
    } | null>(null);
    // Cast/crew deep-dive: when a cast member with a TMDb id is clicked, load
    // their filmography into this panel (optional feature - see discover.js's
    // /person route). `unavailable` carries WHY it is empty: 'nokey' is the
    // feature being off, 'failed' is the request not going through. They read
    // identically to the user otherwise, and conflating them once had someone
    // checking a TMDb key that was set and fine.
    const [personView, setPersonView] = useState<null | {
        id: number | string;
        name: string;
        loading: boolean;
        credits: Array<{
            tmdbId: number;
            mediaType: "movie" | "tv";
            title: string;
            year: string | null;
            poster: string | null;
            role: string | null;
        }>;
        unavailable?: "nokey" | "failed";
    }>(null);

    // Follows for people, keyed by TMDb id. Loaded alongside the show follow
    // so the cast panel can show its own state without a second round trip.
    const [personFollows, setPersonFollows] = useState<
        Record<string, { id: string; muted: boolean }>
    >({});
    const [personFollowBusy, setPersonFollowBusy] = useState<string | null>(null);
    useEffect(() => {
        if (!isOpen) {
            return;
        }
        api.getFollows()
            .then((r) => {
                const map: Record<string, { id: string; muted: boolean }> = {};
                for (const f of Array.isArray(r) ? r : []) {
                    if (f.kind === "person") {
                        map[String(f.subjectId)] = { id: f.id, muted: f.muted };
                    }
                }
                setPersonFollows(map);
            })
            .catch(() => {
                /* following is additive - a failure just hides the state */
            });
    }, [api, isOpen]);

    const togglePersonFollow = useCallback(
        async (tmdbId: string, name: string) => {
            if (personFollowBusy) {
                return;
            }
            setPersonFollowBusy(tmdbId);
            try {
                const existing = personFollows[tmdbId];
                if (!existing) {
                    const row = await api.followSubject("person", tmdbId, name);
                    setPersonFollows((prev) => ({
                        ...prev,
                        [tmdbId]: { id: row.id, muted: row.muted },
                    }));
                    toast.success(
                        `Following ${name} - you'll hear when they have something new out`
                    );
                } else if (existing.muted) {
                    await api.muteFollow(existing.id, false);
                    setPersonFollows((prev) => ({
                        ...prev,
                        [tmdbId]: { ...existing, muted: false },
                    }));
                    toast.success(`Alerts for ${name} turned back on`);
                } else {
                    // Mute rather than unfollow, same as shows: the row survives, so
                    // turning it back on doesn't replay news already announced.
                    await api.muteFollow(existing.id, true);
                    setPersonFollows((prev) => ({
                        ...prev,
                        [tmdbId]: { ...existing, muted: true },
                    }));
                    toast.success(`Muted ${name} - still followed, just quiet`);
                }
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not update following");
            } finally {
                setPersonFollowBusy(null);
            }
        },
        [api, personFollows, personFollowBusy]
    );

    // Their page in Discover: who they are, and everything they've been in.
    // Already on Discover, the page is told who instead of reloading.
    const router = useRouter();
    const seeEverything = useCallback(
        (id: number | string, name: string) => {
            onClose();
            if (window.location.pathname.startsWith("/discover")) {
                window.dispatchEvent(
                    new CustomEvent("slicksync:discover-person", {
                        detail: { id: Number(id) || null, name },
                    })
                );
            } else {
                router.push(
                    `/discover?person=${encodeURIComponent(String(id))}&name=${encodeURIComponent(name)}`
                );
            }
        },
        [onClose, router]
    );

    const openPerson = useCallback(
        async (member: { name: string; tmdbId?: number | string | null }, keepOpen = false) => {
            if (member.tmdbId == null || member.tmdbId === "") {
                return;
            }
            // Clicking the same cast member again closes the filmography row
            // instead of re-fetching the same data - reads as a toggle, same as
            // any other disclosure in this modal. "Show their titles here" from the
            // cast menu only ever opens it.
            if (personView && personView.id === member.tmdbId) {
                if (!keepOpen) {
                    setPersonView(null);
                }
                return;
            }
            setPersonView({ credits: [], id: member.tmdbId, loading: true, name: member.name });
            const res = await api.getPersonCredits(member.tmdbId);
            if (!res.ok) {
                setPersonView({
                    credits: [],
                    id: member.tmdbId,
                    loading: false,
                    name: member.name,
                    unavailable: res.reason,
                });
                return;
            }
            setPersonView({
                credits: res.credits,
                id: member.tmdbId,
                loading: false,
                name: res.person?.name || member.name,
            });
        },
        [api, personView]
    );

    // Mouse grab-drag for the person-filmography row (touch/trackpad scroll it
    // natively already; this adds the desktop drag affordance it was missing).
    const creditsDrag = useDragScroll();

    const openCredit = useCallback(
        async (credit: {
            tmdbId: number;
            mediaType: "movie" | "tv";
            title: string;
            poster: string | null;
        }) => {
            // Suppress the click that ends a drag-scroll (otherwise dragging the row
            // and releasing over a poster would also navigate).
            if (creditsDrag.isDragging()) {
                return;
            }
            const res = await api.resolveImdbId(credit.tmdbId, credit.mediaType);
            if (res?.imdbId) {
                setOverrideItem({
                    id: res.imdbId,
                    name: credit.title,
                    poster: credit.poster,
                    type: res.type,
                });
            }
        },
        [api, creditsDrag]
    );

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        setOverrideItem(null);
        setPersonView(null);
    }, [isOpen, itemId, itemType, videoId]);
    const effectiveId = overrideItem?.id ?? itemId;
    const effectiveType = overrideItem?.type ?? itemType;
    const effectiveVideoId = overrideItem ? null : videoId;
    const effectiveFallbackTitle = overrideItem?.name ?? fallbackTitle;
    const effectiveFallbackPoster = overrideItem?.poster ?? fallbackPoster;
    const effectiveFallbackRating = overrideItem
        ? (overrideItem.imdbRating ?? null)
        : fallbackRating;
    const effectiveFallbackReleaseInfo = overrideItem
        ? (overrideItem.releaseInfo ?? null)
        : fallbackReleaseInfo;
    // Drill-down (cast credit) items never carry a Rotten Tomatoes/Metacritic
    // fallback of their own - details.rottenTomatoes/metacritic (if OMDb ever
    // starts returning them there) is all a drilled-into item can show.
    const effectiveFallbackRottenTomatoes = overrideItem ? null : fallbackRottenTomatoes;
    const effectiveFallbackMetacritic = overrideItem ? null : fallbackMetacritic;

    // The cast filmography belongs to the title it was opened from, so it has
    // to go the moment the modal moves to a different one - by ANY route.
    // Clearing it inside the cast-credit handler alone was not enough: the
    // other drill-downs (More Like This, a collection part, and Back) left the
    // previous title's actor row sitting under a new title's cast, which reads
    // as the popup having lost track of what it is showing. Keyed on
    // effectiveId, so every navigation path is covered by construction - the
    // same reset the seasons, More Like This and collection panels already do.
    useEffect(() => {
        setPersonView(null);
    }, [effectiveId]);

    const {
        enableWatchlist,
        rpdbEnabled,
        enableAutoplayTrailer,
        autoplayTrailerStartMuted,
        enableReactions,
        enableWatchProviders,
        enableWatchedIndicators,
        enableWatchTogether,
    } = usePersonalFeatures();
    const isTV = useIsTV();
    const inheritedFocusKey = useContext(FocusContext);

    // usePersonalFeatures resolves asynchronously (starts from a default of
    // true, then updates once the real Settings value loads) - the
    // item-fetch effect below isn't keyed on these values (that would
    // needlessly re-fetch/reset an already-playing trailer whenever a
    // background settings refresh resolves), so it reads these refs instead
    // of closing over the hook values directly. Otherwise, if getMediaDetails
    // resolves before usePersonalFeatures does, the autoplay decision would
    // fire using the stale default and never get re-checked - a real,
    // confirmed case of the autoplay setting appearing to be ignored.
    const enableAutoplayTrailerRef = useRef(enableAutoplayTrailer);
    const autoplayTrailerStartMutedRef = useRef(autoplayTrailerStartMuted);
    useEffect(() => {
        enableAutoplayTrailerRef.current = enableAutoplayTrailer;
    }, [enableAutoplayTrailer]);
    useEffect(() => {
        autoplayTrailerStartMutedRef.current = autoplayTrailerStartMuted;
    }, [autoplayTrailerStartMuted]);

    // TV mode: the whole modal body (trailer button, Watchlist / Open in
    // Stremio / Open in Nuvio) is one focus group, so D-pad up/down/left/
    // right moves naturally between them by actual on-screen position - this
    // is the actual payoff moment ("read it, watch the trailer, pick an
    // app") the TV app exists for, so it shouldn't require hunting for it
    // with the remote first. Retries on a backoff for the same reason
    // TVPageProvider does - details load asynchronously, so a single
    // fixed-delay focusSelf() could fire before any button exists yet.
    // TV-only. On phone/desktop init() never runs, so registering here feeds
    // an engine with no layout adapter - every mount/unmount then dies inside
    // its async measureLayout ('this.layoutAdapter' undefined), confirmed by
    // betatest stall telemetry as co-timed with multi-second iOS freezes on
    // modal open AND close. isTV is stable for the entire session (see
    // useIsTV), so the conditional hook call below never changes order for a
    // mounted component in practice.
    const fallbackModalRef = useRef<HTMLDivElement>(null);
    const noopFocusModal = useCallback(() => undefined, []);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const tvFocus = isTV ? useFocusable<object, HTMLDivElement>({ trackChildren: true }) : null;
    const modalRef = tvFocus ? tvFocus.ref : fallbackModalRef;
    const modalFocusKey = tvFocus?.focusKey ?? "media-detail-modal";
    const focusModal = tvFocus ? tvFocus.focusSelf : noopFocusModal;
    const hasFocusedChild = tvFocus ? tvFocus.hasFocusedChild : false;
    const hasFocusedChildRef = useRef(false);
    useEffect(() => {
        hasFocusedChildRef.current = hasFocusedChild;
    }, [hasFocusedChild]);
    useEffect(() => {
        if (!(isTV && isOpen && details)) {
            return;
        }
        const delays = [50, 200, 500, 1000];
        const timers = delays.map((delay) =>
            setTimeout(() => {
                if (!hasFocusedChildRef.current) {
                    focusModal();
                }
            }, delay)
        );
        return () => timers.forEach(clearTimeout);
    }, [isTV, isOpen, details, focusModal]);

    // Watchlist state — optimistic-toggle so the icon flips instantly on click
    // and the request happens in the background. Reset on effectiveId change
    // (not just itemId) so drilling into a related title via "More Like This"
    // re-checks watchlist status for THAT title, not the originally-opened
    // one. Skipped entirely when the Watchlist personal feature is disabled.
    // Following a SHOW: alerts when it is renewed, canceled, or gets a
    // premiere date - the gap the episode calendar doesn't cover, because it
    // only knows about shows that are already airing. Movies aren't followable
    // (there is no ongoing status to report), so this only appears for series.
    const [followRow, setFollowRow] = useState<{ id: string; muted: boolean } | null>(null);
    const [followBusy, setFollowBusy] = useState(false);
    useEffect(() => {
        if (!(isOpen && effectiveId) || effectiveType !== "series") {
            setFollowRow(null);
            return;
        }
        let cancelled = false;
        api.getFollows()
            .then((rows) => {
                if (cancelled) {
                    return;
                }
                const hit = rows.find((r) => r.kind === "show" && r.subjectId === effectiveId);
                setFollowRow(hit ? { id: hit.id, muted: hit.muted } : null);
            })
            .catch(() => {
                /* following is additive - a failure just hides the state */
            });
        return () => {
            cancelled = true;
        };
    }, [api, isOpen, effectiveId, effectiveType]);

    const toggleFollow = async () => {
        if (!effectiveId || followBusy) {
            return;
        }
        setFollowBusy(true);
        try {
            if (!followRow) {
                const row = await api.followSubject(
                    "show",
                    effectiveId,
                    details?.title || effectiveFallbackTitle || effectiveId,
                    details?.poster || effectiveFallbackPoster || null
                );
                setFollowRow({ id: row.id, muted: row.muted });
                toast.success("Following - you'll hear when it's renewed, canceled or dated");
            } else if (followRow.muted) {
                await api.muteFollow(followRow.id, false);
                setFollowRow({ ...followRow, muted: false });
                toast.success("Alerts for this show turned back on");
            } else {
                // Mute rather than unfollow: the row survives, so turning it back on
                // doesn't replay news already announced.
                await api.muteFollow(followRow.id, true);
                setFollowRow({ ...followRow, muted: true });
                toast.success("Muted - still followed, just quiet");
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not update following");
        } finally {
            setFollowBusy(false);
        }
    };

    // Anime extras (AniList): only ever attempted for series whose genres say
    // Animation, so a normal show never pays a lookup for nothing. Everything
    // here is additive - if AniList has no match, the modal is unchanged.
    const [anime, setAnime] = useState<{
        anilistId: number;
        nextEpisode: { episode: number; label: string } | null;
        siteUrl: string | null;
    } | null>(null);
    const [animeOrder, setAnimeOrder] = useState<{
        mainLine: Array<{
            anilistId: number;
            name: string;
            episodes: number | null;
            year: number | null;
        }>;
    } | null>(null);
    useEffect(() => {
        const looksAnimated =
            Array.isArray(details?.genres) &&
            details.genres.some((g) => /animation|anime/i.test(String(g)));
        if (!isOpen || effectiveType !== "series" || !looksAnimated || !details?.title) {
            setAnime(null);
            setAnimeOrder(null);
            return;
        }
        let cancelled = false;
        // MediaDetails carries releaseInfo ("2023-" / "2023"), not a year field.
        const yearMatch = String(details.releaseInfo || "").match(/\d{4}/);
        api.lookupAnime(details.title, yearMatch ? Number(yearMatch[0]) : undefined)
            .then((r) => {
                if (cancelled || !r.found || !r.anilistId) {
                    return;
                }
                setAnime({
                    anilistId: r.anilistId,
                    nextEpisode: r.nextEpisode || null,
                    siteUrl: r.siteUrl || null,
                });
                return api.getAnimeWatchOrder(r.anilistId).then((o) => {
                    if (!cancelled) {
                        setAnimeOrder({ mainLine: o.mainLine });
                    }
                });
            })
            .catch(() => {
                /* additive only */
            });
        return () => {
            cancelled = true;
        };
    }, [api, isOpen, effectiveType, details?.title, details?.releaseInfo, details?.genres]);

    // Seasons and episodes (series only). Lazy on purpose: a long-running show
    // has hundreds of episodes, and the detail popup is opened far more often
    // to glance at a title than to browse its season list - so this is fetched
    // when someone actually expands it, not on every open.
    const [seasons, setSeasons] = useState<SeriesSeason[] | null>(null);
    const [seasonsOpen, setSeasonsOpen] = useState(false);
    const [seasonsLoading, setSeasonsLoading] = useState(false);
    const [activeSeason, setActiveSeason] = useState<number | null>(null);
    useEffect(() => {
        // Reset whenever the modal moves to a different title.
        setSeasons(null);
        setSeasonsOpen(false);
        setActiveSeason(null);
    }, [effectiveId]);
    const loadSeasons = async () => {
        setSeasonsOpen((v) => !v);
        if (seasons || seasonsLoading || !effectiveId) {
            return;
        }
        setSeasonsLoading(true);
        try {
            const r = await api.getMediaEpisodes(effectiveId);
            setSeasons(r.seasons || []);
            // Open on the season the current episode belongs to, falling back to
            // the first - landing on season 1 of a show you are deep into is the
            // kind of small wrongness that makes a feature feel unfinished.
            // MediaDetails carries the episode's title but not its numbers; the
            // season comes from the videoId the modal was opened with
            // (tt123:2:5), when there is one.
            const current = Number(String(effectiveVideoId || "").split(":")[1]);
            setActiveSeason(
                Number.isFinite(current) && r.seasons.some((x) => x.season === current)
                    ? current
                    : (r.seasons[0]?.season ?? null)
            );
        } catch {
            setSeasons([]);
        } finally {
            setSeasonsLoading(false);
        }
    };

    const [inWatchlist, setInWatchlist] = useState(false);
    const [watchlistBusy, setWatchlistBusy] = useState(false);
    useEffect(() => {
        if (!(isOpen && effectiveId && enableWatchlist)) {
            return;
        }
        // Ask the watchlist for our current status. Cheap round-trip since we
        // only care about one id — the batched watched-status endpoint isn't
        // needed here.
        let cancelled = false;
        api.getWatchlist()
            .then((list) => {
                if (cancelled) {
                    return;
                }
                setInWatchlist(list.some((i) => i.itemId === effectiveId));
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [api, isOpen, effectiveId, enableWatchlist]);
    const toggleWatchlist = async () => {
        if (watchlistBusy) {
            return;
        }
        setWatchlistBusy(true);
        const next = !inWatchlist;
        setInWatchlist(next); // optimistic
        onWatchlistChange?.(effectiveId, next);
        try {
            if (next) {
                await api.addToWatchlist({
                    itemId: effectiveId,
                    itemType: effectiveType,
                    name: details?.title || effectiveFallbackTitle,
                    poster: details?.poster || effectiveFallbackPoster || null,
                });
            } else {
                await api.removeFromWatchlist(effectiveId);
            }
        } catch {
            setInWatchlist(!next); // revert on failure
            onWatchlistChange?.(effectiveId, !next);
        } finally {
            setWatchlistBusy(false);
        }
    };

    // Reactions (thumbs up/down) - SlickTrax feedback that feeds recommendation
    // scoring (server/utils/recommendationEngine.js's computeSignedAdjustments),
    // not just decoration. Deliberately binary, replacing an earlier 👍/❤️/👎
    // (like/love/dislike) three-tier version that read as clutter - the
    // 'happy'/'sad' state values are a holdover from a brief face-emoji design
    // in between, kept as-is since they're what's already stored server-side;
    // only the icon changed. Same effectiveId-scoped reset and
    // optimistic-update-with-revert pattern as Watchlist above. Personal
    // ratings (1-10, per-season) stay backend-only for now - no UI yet, see
    // client/lib/api.ts's setRating/getRatings if that changes.
    const [reaction, setReactionState] = useState<"happy" | "sad" | null>(null);
    const [reactionBusy, setReactionBusy] = useState(false);

    // Watched state + the unwatch option. The mechanism (ManualWatchOverride,
    // winning over polled history in either direction) predates this UI - the
    // poster context menu on Discover could already toggle it, but the detail
    // modal, the one place you're actually LOOKING at a title, had no way to
    // say "I didn't really watch this". Account-level, same as the indicators.
    const [selfWatched, setSelfWatched] = useState<boolean | null>(null);
    const [selfWatchedBusy, setSelfWatchedBusy] = useState(false);
    // Per-part watched map for the collection row's "watched X of N".
    const [partsWatched, setPartsWatched] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!(isOpen && effectiveId)) {
            return;
        }
        let cancelled = false;
        setSelfWatched(null);
        api.getWatchedStatus([effectiveId])
            .then((m) => {
                if (!cancelled) {
                    setSelfWatched(!!m[effectiveId]);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSelfWatched(null);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [api, isOpen, effectiveId]);

    useEffect(() => {
        const parts = details?.collection?.parts;
        if (!(isOpen && parts) || parts.length === 0) {
            setPartsWatched({});
            return;
        }
        let cancelled = false;
        api.getWatchedStatus(parts.map((pt) => pt.id))
            .then((m) => {
                if (!cancelled) {
                    setPartsWatched(m);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [api, isOpen, details?.collection]);

    const toggleSelfWatched = async () => {
        if (selfWatchedBusy || selfWatched === null) {
            return;
        }
        setSelfWatchedBusy(true);
        const next = !selfWatched;
        setSelfWatched(next); // optimistic, same pattern as watchlist above
        try {
            await api.markWatched(effectiveId, next);
        } catch {
            setSelfWatched(!next);
        } finally {
            setSelfWatchedBusy(false);
        }
    };

    // Watching Together (series only) - watch-ahead protection's management
    // surface. A pact = this show + the members watching it together; once
    // saved, anyone starting an episode another member hasn't seen triggers
    // the household alert (server/utils/watchTogether.js). Data loads lazily
    // on first expand - most modal opens never touch this.
    const [wtOpen, setWtOpen] = useState(false);
    const [wtLoaded, setWtLoaded] = useState(false);
    const [wtUsers, setWtUsers] = useState<Array<{ id: string; username: string }>>([]);
    const [wtSelected, setWtSelected] = useState<Set<string>>(new Set());
    const [wtHasPact, setWtHasPact] = useState(false);
    const [wtFrontier, setWtFrontier] = useState<{ season: number; episode: number } | null>(null);
    const [wtWaitingOn, setWtWaitingOn] = useState<string[]>([]);
    const [wtBusy, setWtBusy] = useState(false);

    useEffect(() => {
        // Reset per title so a "More Like This" drill-down never shows the
        // previous show's pact.
        setWtOpen(false);
        setWtLoaded(false);
        setWtSelected(new Set());
        setWtHasPact(false);
        setWtFrontier(null);
        setWtWaitingOn([]);
    }, [effectiveId]);

    const loadWatchTogether = async () => {
        if (wtLoaded) {
            return;
        }
        try {
            const [users, pacts] = await Promise.all([api.getUsers(), api.getWatchTogether()]);
            setWtUsers(users.map((u) => ({ id: u.id, username: u.username || "Unnamed" })));
            const pact = pacts.find((pt) => pt.showId === effectiveId);
            if (pact) {
                setWtHasPact(true);
                setWtSelected(new Set(pact.members.map((m) => m.userId)));
                setWtFrontier(pact.frontier);
                setWtWaitingOn(pact.waitingOn);
            }
            setWtLoaded(true);
        } catch {
            setWtLoaded(true);
        }
    };

    const saveWatchTogether = async () => {
        setWtBusy(true);
        try {
            await api.saveWatchTogether(
                effectiveId,
                details?.title || effectiveFallbackTitle || effectiveId,
                Array.from(wtSelected)
            );
            setWtHasPact(true);
            toast.success("Spoiler guard on - anyone getting ahead now sets off the alarm");
            // Frontier may exist immediately (members may have history) - refresh.
            const pacts = await api.getWatchTogether().catch(() => []);
            const pact = pacts.find((pt) => pt.showId === effectiveId);
            if (pact) {
                setWtFrontier(pact.frontier);
                setWtWaitingOn(pact.waitingOn);
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not save");
        } finally {
            setWtBusy(false);
        }
    };

    const removeWatchTogether = async () => {
        setWtBusy(true);
        try {
            await api.deleteWatchTogether(effectiveId);
            setWtHasPact(false);
            setWtSelected(new Set());
            setWtFrontier(null);
            setWtWaitingOn([]);
            toast.success("Spoiler guard off - everyone is free to run ahead");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not remove");
        } finally {
            setWtBusy(false);
        }
    };

    useEffect(() => {
        if (!(isOpen && effectiveId && enableReactions)) {
            return;
        }
        let cancelled = false;
        setReactionState(null);
        api.getReactions([effectiveId])
            .then((r) => {
                if (!cancelled) {
                    setReactionState(r.reactions[effectiveId] || null);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [api, isOpen, effectiveId, enableReactions]);

    const toggleReaction = async (next: "happy" | "sad") => {
        if (reactionBusy) {
            return;
        }
        setReactionBusy(true);
        const prev = reaction;
        const willClear = reaction === next; // tapping the active reaction again clears it
        setReactionState(willClear ? null : next); // optimistic
        try {
            if (willClear) {
                await api.clearReaction(effectiveId);
            } else {
                await api.setReaction(
                    effectiveId,
                    effectiveType,
                    next,
                    details?.title || effectiveFallbackTitle,
                    details?.poster || effectiveFallbackPoster || null
                );
            }
        } catch {
            setReactionState(prev); // revert on failure
        } finally {
            setReactionBusy(false);
        }
    };

    // Mouse-only grab-and-drag horizontal scrolling for the Cast row, matching
    // the Dashboard's Continue Watching row. Pointer capture is deliberately
    // deferred until an actual drag crosses the 5px threshold, not engaged on
    // every mouse-down - Continue Watching's fix (see page.tsx) found that
    // capturing eagerly on a plain click blocks Firefox's external-protocol
    // handoff for nuvio://\stremio:// links elsewhere in this same modal, and
    // there's no reason for this row to behave differently just because it
    // has no links of its own. Touch/pen are left alone - overflow-x-auto's
    // native scroll already handles those, and capturing every pointer type
    // fights the page's own vertical touch scroll.
    const castRowRef = useRef<HTMLDivElement>(null);

    // A tap on a cast member opens their titles under the cast; a finger held
    // on them (or a right-click) opens the cast menu (components/ui/CastMenu).
    // On an iPhone a held finger is not a tap - no click comes, and the phone
    // starts selecting the name instead - so the hold is timed here, and the
    // click some browsers still send afterwards is ignored.
    const castHold = useRef<{
        timer: ReturnType<typeof setTimeout> | null;
        x: number;
        y: number;
        fired: boolean;
    }>({ fired: false, timer: null, x: 0, y: 0 });
    const castHoldStart = useCallback((e: React.PointerEvent, open: () => void) => {
        if (e.pointerType === "mouse") {
            return;
        }
        const h = castHold.current;
        if (h.timer) {
            clearTimeout(h.timer);
        }
        h.fired = false;
        h.x = e.clientX;
        h.y = e.clientY;
        h.timer = setTimeout(() => {
            h.timer = null;
            h.fired = true;
            open();
        }, 450);
    }, []);
    const castHoldMove = useCallback((e: React.PointerEvent) => {
        const h = castHold.current;
        if (h.timer && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 10) {
            clearTimeout(h.timer);
            h.timer = null;
        }
    }, []);
    const castHoldEnd = useCallback(() => {
        const h = castHold.current;
        if (h.timer) {
            clearTimeout(h.timer);
            h.timer = null;
        }
    }, []);

    // The filmography opens under the cast row, which on a phone can be below
    // the screen - bring it into view so a tap visibly does something.
    const [castMenu, setCastMenu] = useState<(CastMenuTarget & { tmdbId: string }) | null>(null);
    const closeCastMenu = useCallback(() => setCastMenu(null), []);
    const openCastMenu = useCallback(
        (
            member: {
                name: string;
                character?: string | null;
                photo?: string | null;
                tmdbId?: number | string | null;
            },
            el: HTMLElement
        ) => {
            if (member.tmdbId == null || member.tmdbId === "") {
                return;
            }
            const photo = (el.querySelector("img, div") as HTMLElement | null) || el;
            setCastMenu({
                anchor: photo.getBoundingClientRect(),
                character: member.character || null,
                id: String(member.tmdbId),
                name: member.name,
                photo: member.photo || null,
                tmdbId: String(member.tmdbId),
            });
        },
        []
    );
    const personPanelRef = useRef<HTMLDivElement>(null);
    const personViewId = personView?.id;
    useEffect(() => {
        if (personViewId == null) {
            return;
        }
        const t = setTimeout(
            () => personPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
            60
        );
        return () => clearTimeout(t);
    }, [personViewId]);
    const isCastPointerDownRef = useRef(false);
    const castDragStartXRef = useRef(0);
    const castDragStartScrollLeftRef = useRef(0);
    const hasCapturedCastPointerRef = useRef(false);

    const handleCastPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType !== "mouse" || e.button !== 0 || !castRowRef.current) {
            return;
        }
        isCastPointerDownRef.current = true;
        hasCapturedCastPointerRef.current = false;
        castDragStartXRef.current = e.clientX;
        castDragStartScrollLeftRef.current = castRowRef.current.scrollLeft;
    }, []);

    const handleCastPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType !== "mouse" || !isCastPointerDownRef.current || !castRowRef.current) {
            return;
        }
        // Same recovery as Continue Watching's row (see page.tsx): capture is
        // deferred until the drag threshold, so a release before that point (e.g.
        // mostly-vertical movement off the row) never reaches handleCastPointerUp.
        // Catch it here via e.buttons instead of letting a later hover compute
        // scrollLeft from a stale drag-start.
        if ((e.buttons & 1) === 0) {
            isCastPointerDownRef.current = false;
            return;
        }
        const dx = e.clientX - castDragStartXRef.current;
        if (Math.abs(dx) > 5 && !hasCapturedCastPointerRef.current) {
            castRowRef.current.setPointerCapture(e.pointerId);
            hasCapturedCastPointerRef.current = true;
        }
        castRowRef.current.scrollLeft = castDragStartScrollLeftRef.current - dx;
    }, []);

    const handleCastPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType !== "mouse") {
            return;
        }
        isCastPointerDownRef.current = false;
        if (hasCapturedCastPointerRef.current) {
            castRowRef.current?.releasePointerCapture(e.pointerId);
            hasCapturedCastPointerRef.current = false;
        }
    }, []);

    // Same mouse-drag-scroll treatment as the Cast row above, for the "More
    // Like This" poster row - separate refs since it's a different DOM node.
    const similarRowRef = useRef<HTMLDivElement>(null);
    const isSimilarPointerDownRef = useRef(false);
    const similarDragStartXRef = useRef(0);
    const similarDragStartScrollLeftRef = useRef(0);
    const hasCapturedSimilarPointerRef = useRef(false);

    const handleSimilarPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType !== "mouse" || e.button !== 0 || !similarRowRef.current) {
            return;
        }
        isSimilarPointerDownRef.current = true;
        hasCapturedSimilarPointerRef.current = false;
        similarDragStartXRef.current = e.clientX;
        similarDragStartScrollLeftRef.current = similarRowRef.current.scrollLeft;
    }, []);

    const handleSimilarPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (
            e.pointerType !== "mouse" ||
            !isSimilarPointerDownRef.current ||
            !similarRowRef.current
        ) {
            return;
        }
        if ((e.buttons & 1) === 0) {
            isSimilarPointerDownRef.current = false;
            return;
        }
        const dx = e.clientX - similarDragStartXRef.current;
        if (Math.abs(dx) > 5 && !hasCapturedSimilarPointerRef.current) {
            similarRowRef.current.setPointerCapture(e.pointerId);
            hasCapturedSimilarPointerRef.current = true;
        }
        similarRowRef.current.scrollLeft = similarDragStartScrollLeftRef.current - dx;
    }, []);

    const handleSimilarPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType !== "mouse") {
            return;
        }
        isSimilarPointerDownRef.current = false;
        if (hasCapturedSimilarPointerRef.current) {
            similarRowRef.current?.releasePointerCapture(e.pointerId);
            hasCapturedSimilarPointerRef.current = false;
        }
    }, []);

    // Same mouse-drag-scroll treatment, for the "Part of the X Collection" row.
    const collectionRowRef = useRef<HTMLDivElement>(null);
    const isCollectionPointerDownRef = useRef(false);
    const collectionDragStartXRef = useRef(0);
    const collectionDragStartScrollLeftRef = useRef(0);
    const hasCapturedCollectionPointerRef = useRef(false);

    const handleCollectionPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType !== "mouse" || e.button !== 0 || !collectionRowRef.current) {
            return;
        }
        isCollectionPointerDownRef.current = true;
        hasCapturedCollectionPointerRef.current = false;
        collectionDragStartXRef.current = e.clientX;
        collectionDragStartScrollLeftRef.current = collectionRowRef.current.scrollLeft;
    }, []);

    const handleCollectionPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (
            e.pointerType !== "mouse" ||
            !isCollectionPointerDownRef.current ||
            !collectionRowRef.current
        ) {
            return;
        }
        if ((e.buttons & 1) === 0) {
            isCollectionPointerDownRef.current = false;
            return;
        }
        const dx = e.clientX - collectionDragStartXRef.current;
        if (Math.abs(dx) > 5 && !hasCapturedCollectionPointerRef.current) {
            collectionRowRef.current.setPointerCapture(e.pointerId);
            hasCapturedCollectionPointerRef.current = true;
        }
        collectionRowRef.current.scrollLeft = collectionDragStartScrollLeftRef.current - dx;
    }, []);

    const handleCollectionPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType !== "mouse") {
            return;
        }
        isCollectionPointerDownRef.current = false;
        if (hasCapturedCollectionPointerRef.current) {
            collectionRowRef.current?.releasePointerCapture(e.pointerId);
            hasCapturedCollectionPointerRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (!(isOpen && effectiveId)) {
            return;
        }
        // Reset per-item, since the same modal instance is reused across clicks
        // (and across "More Like This" drill-downs, via effectiveId/effectiveType)
        setDetails(null);
        setHasFetched(false);
        setIsLoading(true);
        setIsTrailerPlaying(false);
        setTrailerSrc(null);

        let cancelled = false;
        api.getMediaDetails(effectiveId, effectiveType, effectiveVideoId).then((result) => {
            if (cancelled) {
                return;
            }
            setDetails(result);
            setIsLoading(false);
            setHasFetched(true);
            // Auto-start the moment a trailer is actually available - no separate
            // "wait for it to load, then play" step needed since this runs right
            // where the trailer id first becomes known.
            const autoTrailerId = result?.trailers?.[0];
            if (enableAutoplayTrailerRef.current && autoTrailerId) {
                setTrailerSrc(buildTrailerSrc(autoTrailerId, autoplayTrailerStartMutedRef.current));
                setIsTrailerPlaying(true);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [buildTrailerSrc, api, isOpen, effectiveId, effectiveType, effectiveVideoId]);

    // SlickTrax "More Like This" - always fresh, always unwatched by anyone
    // in the household (see the /similar route's own comment for why real
    // affinity only biases the genre search rather than supplying items
    // directly). Keyed on effectiveId so a "More Like This" click re-runs
    // this for the newly drilled-into title too, letting you chain through
    // related titles.
    const [similarItems, setSimilarItems] = useState<DiscoverItem[]>([]);
    const [similarHasRealSignal, setSimilarHasRealSignal] = useState(false);
    const [similarLoading, setSimilarLoading] = useState(false);
    // Collapsed by default - a full poster row made this the tallest thing in
    // the popup even for a title with no other details worth reading yet.
    // Data still loads eagerly in the background (cheap for this instance's
    // scale, see the route's own comment) so expanding is instant rather than
    // showing a spinner on click; only the disclosure's OPEN state is what's
    // deferred. Collapses again on every item change, including a "More Like
    // This" drill-down, so it never opens already-expanded on a fresh title.
    const [similarExpanded, setSimilarExpanded] = useState(false);
    useEffect(() => {
        setSimilarExpanded(false);
    }, [effectiveId]);
    // Same collapsed-by-default disclosure treatment as "More Like This" -
    // "Part of the X Collection" can run to 10+ posters (long-running
    // franchises) and shouldn't dominate the popup for a title with no other
    // details worth reading yet. Data (details.collection) already loads
    // eagerly with the rest of the details fetch, so this only defers the
    // OPEN state, not the fetch itself.
    const [collectionExpanded, setCollectionExpanded] = useState(false);
    useEffect(() => {
        setCollectionExpanded(false);
    }, [effectiveId]);
    useEffect(() => {
        if (!(isOpen && effectiveId)) {
            return;
        }
        setSimilarItems([]);
        setSimilarLoading(true);
        let cancelled = false;
        api.getSimilarItems(effectiveId, effectiveType)
            .then((result) => {
                if (cancelled) {
                    return;
                }
                setSimilarItems(result.items);
                setSimilarHasRealSignal(result.hasRealSignal);
            })
            .finally(() => {
                if (!cancelled) {
                    setSimilarLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [api, isOpen, effectiveId, effectiveType]);

    const title = details?.episode?.title
        ? `${details?.title || effectiveFallbackTitle} — ${details.episode.title}`
        : details?.title || effectiveFallbackTitle;
    // The title above already shows the episode NAME ("Cape Fear — The Scar"),
    // but not which episode that is - parsed from videoId (standard Cinemeta
    // format "tt1234567:season:episode") since the episode metadata endpoint
    // itself doesn't return the numbers, only title/overview/thumbnail. Kitsu
    // IDs ("kitsu:50008:4") have no season component, so this only matches the
    // 3-part numeric form both formats happen to share positionally - safe
    // since a non-matching id just renders nothing rather than a wrong number.
    const episodeLabel = (() => {
        if (!(effectiveVideoId && details?.episode)) {
            return null;
        }
        const parts = effectiveVideoId.split(":");
        if (parts.length !== 3) {
            return null;
        }
        const season = Number.parseInt(parts[1], 10);
        const episode = Number.parseInt(parts[2], 10);
        if (Number.isNaN(episode)) {
            return null;
        }
        return Number.isNaN(season) || effectiveVideoId.startsWith("kitsu:")
            ? `E${String(episode).padStart(2, "0")}`
            : `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
    })();
    const heroImage =
        details?.episode?.thumbnail ||
        details?.backdrop ||
        details?.background ||
        details?.poster ||
        effectiveFallbackPoster;
    const overview = details?.episode?.overview || details?.description;
    const trailerId = details?.trailers?.[0];

    // Attaches the real YouTube IFrame Player API to the trailer iframe once
    // it's playing, purely so fullscreen can unmute it - going fullscreen via
    // the player's own button does NOT unmute a muted embed on its own (a raw
    // <iframe src> has no way to detect fullscreen or call unMute() at all).
    // Requires enablejsapi=1 in the iframe's src (see the src below) for the
    // API to actually take control of an already-existing iframe.
    useEffect(() => {
        if (!(isTrailerPlaying && trailerId)) {
            return;
        }
        let cancelled = false;

        function attach() {
            if (cancelled || !trailerIframeRef.current || !window.YT?.Player) {
                return;
            }
            try {
                trailerPlayerRef.current = new window.YT.Player(trailerIframeRef.current, {});
            } catch {
                // This browser capability may be unavailable in the current environment.
            }
        }

        if (window.YT?.Player) {
            attach();
        } else {
            if (!document.getElementById("youtube-iframe-api")) {
                const tag = document.createElement("script");
                tag.id = "youtube-iframe-api";
                tag.src = "https://www.youtube.com/iframe_api";
                document.body.appendChild(tag);
            }
            const previous = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                previous?.();
                attach();
            };
        }

        const handleFullscreenChange = () => {
            if (
                document.fullscreenElement &&
                document.fullscreenElement === trailerIframeRef.current
            ) {
                // Only the real player API call here - never touch trailerSrc/React
                // state in response to this. Changing the iframe's src is what
                // forced a reload that killed fullscreen in the first place (see
                // trailerSrc's own comment above).
                try {
                    trailerPlayerRef.current?.unMute?.();
                } catch {
                    // The embedded player may have been detached before this call completes.
                }
            }
        };
        document.addEventListener("fullscreenchange", handleFullscreenChange);

        return () => {
            cancelled = true;
            document.removeEventListener("fullscreenchange", handleFullscreenChange);
            trailerPlayerRef.current = null;
        };
    }, [isTrailerPlaying, trailerId]);

    // TV mode: one focus group for the whole modal body, so D-pad navigation
    // moves between the trailer button and the action row by actual on-
    // screen position instead of needing separate scopes stitched together.
    // Open in AIOStreams needs to know which AIOStreams servers people here use.
    const [aioServers, setAioServers] = useState<{ address: string; people: string[] }[]>([]);
    const [aioPickerOpen, setAioPickerOpen] = useState(false);
    useEffect(() => {
        if (!(isOpen && householdActions)) {
            return;
        }
        let cancelled = false;
        loadAioServers().then((list) => {
            if (!cancelled) {
                setAioServers(list);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [householdActions, isOpen]);

    // Bookmark and Watched as small pills (see SmallPill above).
    const personalPills = (
        <>
            {enableWatchlist && (
                <SmallPill
                    busy={watchlistBusy}
                    icon={
                        inWatchlist ? (
                            <BookmarkSolidIcon className="h-3.5 w-3.5" />
                        ) : (
                            <BookmarkOutlineIcon className="h-3.5 w-3.5" />
                        )
                    }
                    label={inWatchlist ? "Bookmarked" : "Bookmark"}
                    on={inWatchlist}
                    onClick={toggleWatchlist}
                    tint="var(--color-primary)"
                    title={inWatchlist ? "In your Watchlist - tap to remove" : "Add to Watchlist"}
                />
            )}
            {enableWatchedIndicators && selfWatched !== null && (
                <SmallPill
                    busy={selfWatchedBusy}
                    icon={<CheckCircleIcon className="h-3.5 w-3.5" />}
                    label={selfWatched ? "Watched" : "Not watched"}
                    on={!!selfWatched}
                    onClick={toggleSelfWatched}
                    tint="var(--color-success)"
                    title={
                        selfWatched
                            ? "Watched - tap to mark unwatched (the underlying history is kept)"
                            : "Mark as watched for the household"
                    }
                />
            )}
        </>
    );
    const hasPersonalPills = enableWatchlist || (enableWatchedIndicators && selfWatched !== null);

    // Stop the trailer THE INSTANT a close is triggered (X/backdrop/Escape all
    // route through Modal's onClose uniformly), not just when reopening for a
    // new item. Otherwise the YouTube iframe stays live and keeps decoding
    // video for the whole ~150ms exit transition, competing with the panel's
    // own transform/opacity animation for the same compositor - a real,
    // reported cause of the modal feeling like it lags on close specifically
    // after watching a trailer.
    const handleClose = useCallback(() => {
        // Tell the YouTube player to stop BEFORE clearing the state that unmounts
        // its iframe - not destroy() (that would let the YouTube API physically
        // remove the same DOM node React's own reconciler still owns, which can
        // throw on React's next commit). stopVideo() halts the actual decode/
        // playback work cheaply through the API that already has control of it,
        // so the iframe React removes a moment later is already idle rather than
        // still mid-decode. The comment above already identified iframe teardown
        // as a real, reported cause of a slow-feeling close after a trailer had
        // been playing; this is the part that comment's fix never actually did -
        // clearing trailerSrc unmounts the iframe promptly, but nothing ever told
        // the still-live embed to stop before that happened.
        try {
            trailerPlayerRef.current?.stopVideo?.();
        } catch {
            // The embedded player may have been detached before this call completes.
        }
        setIsTrailerPlaying(false);
        setTrailerSrc(null);
        onClose();
    }, [onClose]);

    return (
        <Modal
            ariaLabel={title || "Media details"}
            backdropImage={isTrailerPlaying ? undefined : heroImage || undefined}
            hideCloseButton={isTrailerPlaying}
            isOpen={isOpen}
            lightweight
            onClose={handleClose}
            size="full"
        >
            <FocusContext.Provider value={isTV ? modalFocusKey : inheritedFocusKey}>
                <div className="-mx-6 -mt-6" ref={isTV ? modalRef : undefined}>
                    {isTrailerPlaying && trailerId && trailerSrc ? (
                        // aspect-video (not a fixed height like the static hero below) -
                        // YouTube's player always keeps its actual video content at 16:9
                        // internally, so a fixed short height on a wide modal (size="full")
                        // squished the container into a much wider-than-16:9 box and the
                        // player letterboxed down to a thin strip in the middle of it.
                        // Deriving height from width keeps the video itself full-size.
                        //
                        // max-w-[calc(60vh*16/9)] (not max-h-[60vh] directly on this box) -
                        // capping height alone while width stays w-full breaks the
                        // aspect-video ratio on a wide viewport (size="full" modal), which
                        // recreated the exact letterboxing this was meant to avoid:
                        // YouTube's player still renders the real 16:9 video inside a now
                        // too-wide box, adding its own black bars to compensate. Capping
                        // width to the aspect-consistent value for a 60vh-tall box instead
                        // lets aspect-video derive an exactly-60vh height with no conflict,
                        // centered via mx-auto (the modal's own surface fills the sides).
                        <div className="relative mx-auto aspect-video w-full max-w-[calc(60vh*16/9)] overflow-hidden rounded-t-2xl bg-black">
                            <iframe
                                allow="autoplay; encrypted-media; picture-in-picture"
                                allowFullScreen
                                className="h-full w-full"
                                ref={trailerIframeRef}
                                src={trailerSrc}
                                title="Trailer"
                            />
                            {/* Fades the video's bottom edge into the surface color below,
                matching the static hero's gradient - a hard cut from a black
                video box straight into the text content looked disjointed. */}
                            <div
                                className="pointer-events-none absolute right-0 bottom-0 left-0 h-12"
                                style={{
                                    background:
                                        "linear-gradient(180deg, transparent, var(--color-surface))",
                                }}
                            />
                            {/* Positioned low and to the right, in the gradient fade zone
                below YouTube's own bottom-row icons (share/save) rather than
                overlapping them - past the right edge of its scrub bar.
                YouTube's own overlay isn't something we control, so this is
                an approximation, not a guarantee. Goes back to the poster/
                details view, not a full close - backdrop click and Escape
                still fully close the modal. */}
                            <button
                                aria-label="Back to details"
                                className="absolute right-2 bottom-2 z-10 rounded-md p-1 transition-colors"
                                onClick={() => setIsTrailerPlaying(false)}
                                style={{ background: "rgba(0,0,0,0.6)", color: "white" }}
                                type="button"
                            >
                                <XMarkIcon className="h-4 w-4" />
                            </button>
                        </div>
                    ) : (
                        heroImage && (
                            <div className="relative h-40 w-full overflow-hidden rounded-t-2xl sm:h-56">
                                <img
                                    alt=""
                                    className="h-full w-full object-cover"
                                    decoding="async"
                                    height={360}
                                    src={heroImage}
                                    style={{ objectPosition: "center 15%" }}
                                    width={640}
                                />
                                <div
                                    className="absolute inset-0"
                                    style={{
                                        background:
                                            "linear-gradient(180deg, transparent 40%, var(--color-surface) 100%)",
                                    }}
                                />
                                {trailerId &&
                                    (isTV ? (
                                        <TVFocusable
                                            className="absolute inset-0 flex items-center justify-center"
                                            onEnterPress={() => {
                                                setTrailerSrc(buildTrailerSrc(trailerId, false));
                                                setIsTrailerPlaying(true);
                                            }}
                                        >
                                            <span
                                                className="flex items-center gap-2 rounded-full px-5 py-2.5 font-medium text-sm"
                                                style={{
                                                    backdropFilter: "blur(4px)",
                                                    background:
                                                        "color-mix(in srgb, var(--color-surface) 60%, transparent)",
                                                    color: "white",
                                                }}
                                            >
                                                <PlayIcon className="h-5 w-5" />
                                                Play Trailer
                                            </span>
                                        </TVFocusable>
                                    ) : (
                                        <button
                                            aria-label="Play trailer"
                                            className="group absolute inset-0 flex items-center justify-center"
                                            onClick={() => {
                                                setTrailerSrc(buildTrailerSrc(trailerId, false));
                                                setIsTrailerPlaying(true);
                                            }}
                                            type="button"
                                        >
                                            <span
                                                className="flex items-center gap-2 rounded-full px-5 py-2.5 font-medium text-sm transition-transform group-hover:scale-105"
                                                style={{
                                                    backdropFilter: "blur(4px)",
                                                    background:
                                                        "color-mix(in srgb, var(--color-surface) 60%, transparent)",
                                                    color: "white",
                                                }}
                                            >
                                                <PlayIcon className="h-5 w-5" />
                                                Play Trailer
                                            </span>
                                        </button>
                                    ))}
                            </div>
                        )
                    )}

                    <div className="px-6 pt-4 pb-2">
                        {/* Only shown mid drill-down (came here via a "More Like This"
              poster) - closing the modal from a related title would
              otherwise just lose the original one entirely, one click from
              a poster grid or not. */}
                        {overrideItem &&
                            (isTV ? (
                                <TVFocusable
                                    className="mb-2 inline-block"
                                    onEnterPress={() => setOverrideItem(null)}
                                >
                                    <span className="flex items-center gap-1 font-medium text-muted text-sm">
                                        <ChevronLeftIcon className="h-4 w-4" />
                                        Back to {fallbackTitle}
                                    </span>
                                </TVFocusable>
                            ) : (
                                <button
                                    className="mb-2 flex items-center gap-1 font-medium text-muted text-sm transition-colors hover:text-default"
                                    onClick={() => setOverrideItem(null)}
                                    type="button"
                                >
                                    <ChevronLeftIcon className="h-4 w-4" />
                                    Back to {fallbackTitle}
                                </button>
                            ))}
                        <h2 className="font-bold font-display text-2xl text-default">{title}</h2>
                        {/* On a computer, Bookmark and Watched sit right under the title,
              where the eye lands first - not mixed in with the app buttons. */}
                        {!(isTV || isLoading) && details?.imdb_id && hasPersonalPills && (
                            <div className="mt-2 hidden items-center gap-2 sm:flex">
                                {personalPills}
                            </div>
                        )}

                        {isLoading && (
                            <div className="mt-4 flex items-center gap-2 text-base text-muted">
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                Loading details…
                            </div>
                        )}

                        {!isLoading && hasFetched && !details && (
                            <p className="mt-4 text-base text-muted">
                                No additional details found for this title.
                            </p>
                        )}

                        {!isLoading && details && (
                            <div className="mt-3 space-y-4">
                                {/* releaseInfo/imdbRating prefer the grid's own values (see the
                  fallbackRating/fallbackReleaseInfo prop comment) — Cinemeta's
                  two backends can disagree, and showing a different number
                  than what the user just clicked reads as a bug. */}
                                <div className="flex flex-wrap items-center gap-3 text-base text-muted">
                                    {episodeLabel && (
                                        <span className="rounded-md border border-default bg-surface-hover px-2 py-0.5 font-semibold text-default text-sm">
                                            {episodeLabel}
                                        </span>
                                    )}
                                    {(effectiveFallbackReleaseInfo || details.releaseInfo) && (
                                        <span>
                                            {effectiveFallbackReleaseInfo || details.releaseInfo}
                                        </span>
                                    )}
                                    {details.runtime && (
                                        <span className="flex items-center gap-1.5">
                                            <ClockIcon className="h-5 w-5" />
                                            {details.runtime}
                                        </span>
                                    )}
                                    {details.rated && (
                                        <span
                                            className="rounded-md border px-2 py-0.5 font-semibold text-sm"
                                            style={{
                                                borderColor: "var(--color-surface-border)",
                                                color: "var(--color-text)",
                                            }}
                                            title="Content rating"
                                        >
                                            {details.rated}
                                        </span>
                                    )}
                                    {(effectiveFallbackRating || details.imdbRating) && (
                                        <span className="flex items-center gap-1.5 font-medium text-amber-400">
                                            <StarIcon className="h-5 w-5" />
                                            {effectiveFallbackRating || details.imdbRating}
                                            <span className="font-normal text-muted">/10</span>
                                        </span>
                                    )}
                                    {(effectiveFallbackRottenTomatoes ||
                                        details.rottenTomatoes) && (
                                        <span
                                            className="flex items-center gap-1.5 font-medium"
                                            style={{ color: "#fa320a" }}
                                            title="Rotten Tomatoes"
                                        >
                                            <span aria-hidden>🍅</span>
                                            {effectiveFallbackRottenTomatoes ||
                                                details.rottenTomatoes}
                                        </span>
                                    )}
                                    {(effectiveFallbackMetacritic || details.metacritic) && (
                                        <span
                                            className="flex items-center gap-1.5 font-medium"
                                            style={{
                                                color: metacriticTextColor(
                                                    effectiveFallbackMetacritic ||
                                                        details.metacritic ||
                                                        ""
                                                ),
                                            }}
                                            title="Metacritic score"
                                        >
                                            <span aria-hidden>Ⓜ</span>
                                            {effectiveFallbackMetacritic || details.metacritic}
                                        </span>
                                    )}
                                    {typeof details.mdblistScore === "number" && (
                                        <span
                                            className="flex items-center gap-1.5 font-medium text-primary"
                                            title="MDBList Score (blended across multiple rating sources)"
                                        >
                                            <span
                                                aria-hidden
                                                className="rounded border border-current px-1 py-0.5 font-bold text-[10px] leading-none"
                                            >
                                                MDB
                                            </span>
                                            {details.mdblistScore}%
                                        </span>
                                    )}
                                    {details.imdb_id && (
                                        <a
                                            className="text-primary hover:underline"
                                            href={`https://www.imdb.com/title/${details.imdb_id}`}
                                            rel="noopener noreferrer"
                                            target="_blank"
                                        >
                                            IMDb
                                        </a>
                                    )}
                                    {details.moviedb_id && (
                                        <a
                                            className="text-primary hover:underline"
                                            href={`https://www.themoviedb.org/${effectiveType === "movie" ? "movie" : "tv"}/${details.moviedb_id}`}
                                            rel="noopener noreferrer"
                                            target="_blank"
                                        >
                                            TMDb
                                        </a>
                                    )}

                                    {/* Reactions - moved in next to the rating row (reads as
                    "your own rating," right next to everyone else's) rather
                    than a standalone row competing with the action buttons
                    below. Feeds recommendation scoring (see the state block
                    above), not just decoration. No TV-focus wiring yet
                    (unlike the action row below) - visible and usable with a
                    mouse/touch on PC and Mobile, just not yet D-pad-reachable
                    on TV. ml-auto pins it to the row's right edge on wide
                    screens; it simply wraps onto its own line on narrow ones. */}
                                    {enableReactions && (
                                        <div className="ml-auto flex items-center gap-1.5">
                                            <button
                                                aria-label="Thumbs up"
                                                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                                                    reaction === "happy"
                                                        ? "bg-success/20 text-success ring-1 ring-success"
                                                        : "bg-surface-hover text-muted hover:bg-success/10"
                                                } ${reactionBusy ? "cursor-wait opacity-60" : ""}`}
                                                disabled={reactionBusy}
                                                onClick={() => toggleReaction("happy")}
                                                title="Thumbs up"
                                                type="button"
                                            >
                                                <HandThumbUpIcon className="h-5 w-5" />
                                            </button>
                                            <button
                                                aria-label="Thumbs down"
                                                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                                                    reaction === "sad"
                                                        ? "bg-error/20 text-error ring-1 ring-error"
                                                        : "bg-surface-hover text-muted hover:bg-error/10"
                                                } ${reactionBusy ? "cursor-wait opacity-60" : ""}`}
                                                disabled={reactionBusy}
                                                onClick={() => toggleReaction("sad")}
                                                title="Thumbs down"
                                                type="button"
                                            >
                                                <HandThumbDownIcon className="h-5 w-5" />
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* On a phone, Bookmark, Watched and + Catalog are one row of
                  small pills straight after the ratings. */}
                                {!isTV && details.imdb_id && (
                                    <div className="flex flex-nowrap items-center gap-1 sm:hidden">
                                        {personalPills}
                                        {householdActions && (
                                            <AddToListButton
                                                item={{
                                                    id: effectiveId,
                                                    name: effectiveFallbackTitle,
                                                    poster: effectiveFallbackPoster || null,
                                                    type: effectiveType,
                                                }}
                                                pill
                                            />
                                        )}
                                    </div>
                                )}

                                {/* "You might not even need an addon for this" - shown
                  unconditionally (not behind a disclosure like Collection
                  below) since it's meant to be seen at a glance, not opted
                  into. Subscription/free tiers only, see the type's own
                  comment for why rent/buy is excluded. Links to TMDb's
                  JustWatch attribution page, required by their API terms
                  when this data is displayed. */}

                                {/* Anime extras: the next-episode countdown AniList publishes
                  exact air times for (better than a vague date), and the
                  franchise's real watch order - the thing people otherwise
                  go and google a chart for. Only ever present when AniList
                  matched an animated series. */}
                                {anime &&
                                    (anime.nextEpisode ||
                                        (animeOrder?.mainLine?.length ?? 0) > 1) && (
                                        <div
                                            className="rounded-xl p-3"
                                            style={{ background: "var(--color-surface-hover)" }}
                                        >
                                            {anime.nextEpisode && (
                                                <p className="text-default text-sm">
                                                    <span className="font-medium">
                                                        Episode {anime.nextEpisode.episode}
                                                    </span>
                                                    <span className="text-muted">
                                                        {" "}
                                                        airs in {anime.nextEpisode.label}
                                                    </span>
                                                </p>
                                            )}
                                            {(animeOrder?.mainLine?.length ?? 0) > 1 && (
                                                <div className={anime.nextEpisode ? "mt-2" : ""}>
                                                    <p
                                                        className="mb-1 font-semibold text-[10px] uppercase tracking-wider"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        Watch order
                                                    </p>
                                                    <ol className="space-y-0.5">
                                                        {(animeOrder?.mainLine ?? []).map(
                                                            (entry, i) => (
                                                                <li
                                                                    className="text-muted text-xs"
                                                                    key={entry.anilistId}
                                                                >
                                                                    <span className="text-default">
                                                                        {i + 1}. {entry.name}
                                                                    </span>
                                                                    {entry.episodes
                                                                        ? ` · ${entry.episodes} eps`
                                                                        : ""}
                                                                    {entry.year
                                                                        ? ` · ${entry.year}`
                                                                        : ""}
                                                                </li>
                                                            )
                                                        )}
                                                    </ol>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                {enableWatchProviders &&
                                    details.watchProviders &&
                                    details.watchProviders.providers.length > 0 && (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-muted text-sm">
                                                Also streaming on
                                            </span>
                                            {details.watchProviders.providers.map((p) => (
                                                <a
                                                    className="flex items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1 transition-colors hover:border-primary"
                                                    href={details.watchProviders?.link || undefined}
                                                    key={p.name}
                                                    rel="noopener noreferrer"
                                                    style={{
                                                        background: "var(--color-surface-hover)",
                                                        borderColor: "var(--color-surface-border)",
                                                    }}
                                                    target="_blank"
                                                    title={p.name}
                                                >
                                                    {p.logo ? (
                                                        <img
                                                            alt=""
                                                            className="h-5 w-5 rounded-full"
                                                            height={20}
                                                            src={p.logo}
                                                            width={20}
                                                        />
                                                    ) : null}
                                                    <span className="font-medium text-default text-xs">
                                                        {p.name}
                                                    </span>
                                                </a>
                                            ))}
                                        </div>
                                    )}

                                {/* Neither link can "detect and fall back" if the target app
                  isn't installed/registered - a plain native <a href>, same
                  as Continue Watching's card, since JS-driven interception
                  of this exact kind of click has broken it before. Offered
                  as two plain options rather than picking one, since this
                  modal isn't tied to a specific managed user/provider the
                  way Continue Watching is. */}
                                {/* Same fixed, theme-independent colors as each provider's
                  identity Badge elsewhere (Users page, next to "Synced") -
                  purple for Stremio, blue/orange for Nuvio - rather than the
                  generic accent color, so these read as "this specific
                  provider" the same way the badges already do. */}
                                {details.imdb_id &&
                                    (() => {
                                        // sm:w-auto justify-center on each control - the mobile
                                        // grid below (2 columns) needs every cell's control to fill
                                        // its cell to actually read as a 2x2 grid rather than 4
                                        // left-aligned buttons in narrow cells; sm:contents/w-auto
                                        // hands width back to flex-wrap's own auto-sizing at the
                                        // desktop breakpoint where the old single-row layout stays.
                                        // Secondary actions are icon-only. Six labelled buttons wrapped
                                        // onto two rows and read as clutter (user feedback); the two
                                        // "open it" actions are the real call to action, so those keep
                                        // their labels and everything else becomes a compact toggle
                                        // with a tooltip and an obvious on-state.
                                        // `label` is optional, and Follow uses it on purpose: an
                                        // unlabelled bell in a row of icons is indistinguishable from
                                        // a notifications toggle, and the feature may as well not
                                        // exist if nobody can tell what it does.
                                        const imdbId = details.imdb_id;
                                        if (!imdbId) {
                                            return null;
                                        }
                                        const iconBtn = (opts: {
                                            onClick: () => void;
                                            busy?: boolean;
                                            on?: boolean;
                                            tint: string;
                                            title: string;
                                            icon: React.ReactNode;
                                            label?: string;
                                        }) => (
                                            <button
                                                aria-label={opts.title}
                                                aria-pressed={opts.on}
                                                className={`flex items-center justify-center gap-1.5 ${opts.label ? "px-3" : "w-10"} h-10 shrink-0 rounded-lg transition-colors ${opts.on ? "ibtn-tint-on" : "ibtn-tint-off"} ${opts.busy ? "cursor-wait opacity-60" : ""}`}
                                                disabled={opts.busy}
                                                onClick={opts.onClick}
                                                style={
                                                    { "--tint": opts.tint } as React.CSSProperties
                                                }
                                                title={opts.title}
                                                type="button"
                                            >
                                                {opts.icon}
                                                {opts.label && (
                                                    <span className="font-medium text-sm">
                                                        {opts.label}
                                                    </span>
                                                )}
                                            </button>
                                        );

                                        const watchlistBtn =
                                            enableWatchlist &&
                                            iconBtn({
                                                busy: watchlistBusy,
                                                icon: inWatchlist ? (
                                                    <BookmarkSolidIcon className="h-5 w-5" />
                                                ) : (
                                                    <BookmarkOutlineIcon className="h-5 w-5" />
                                                ),
                                                on: inWatchlist,
                                                onClick: toggleWatchlist,
                                                tint: "var(--color-primary)",
                                                title: inWatchlist
                                                    ? "In your Watchlist - tap to remove"
                                                    : "Add to Watchlist",
                                            });

                                        const watchedBtn =
                                            enableWatchedIndicators &&
                                            selfWatched !== null &&
                                            iconBtn({
                                                busy: selfWatchedBusy,
                                                icon: <CheckCircleIcon className="h-5 w-5" />,
                                                on: selfWatched,
                                                onClick: toggleSelfWatched,
                                                tint: "var(--color-success)",
                                                title: selfWatched
                                                    ? "Watched - tap to mark unwatched (the underlying history is kept)"
                                                    : "Mark as watched for the household",
                                            });

                                        const followBtn =
                                            householdActions &&
                                            effectiveType === "series" &&
                                            iconBtn({
                                                busy: followBusy,
                                                icon: <BellIcon className="h-5 w-5" />,
                                                label: followRow
                                                    ? followRow.muted
                                                        ? "Muted"
                                                        : "Following"
                                                    : "Follow",
                                                on: !!followRow && !followRow.muted,
                                                onClick: toggleFollow,
                                                tint: "var(--color-primary)",
                                                title: followRow
                                                    ? followRow.muted
                                                        ? "Alerts muted - tap to turn them back on"
                                                        : "Following - tap to mute"
                                                    : "Follow - hear when this is renewed, canceled or dated",
                                            });

                                        const stremioBtn = (
                                            <a
                                                className="flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 font-medium text-sm transition-colors sm:w-auto"
                                                href={buildStremioAppUrl(imdbId, effectiveType)}
                                                style={{
                                                    background: "rgba(167, 139, 250, 0.15)",
                                                    border: "1px solid rgba(167, 139, 250, 0.25)",
                                                    color: "rgb(196, 181, 253)",
                                                }}
                                                tabIndex={isTV ? -1 : undefined}
                                            >
                                                {/* Fixed-width block on a phone, centred in the full-width
                        button, so every app button's play icon lines up. */}
                                                <span className="inline-flex w-[11rem] items-center gap-1.5 sm:w-auto">
                                                    <PlayIcon className="h-4 w-4 shrink-0" />
                                                    Open in Stremio
                                                </span>
                                            </a>
                                        );
                                        const nuvioBtn = (
                                            <a
                                                className="flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 font-medium text-sm transition-colors sm:w-auto"
                                                href={buildNuvioAppUrl(imdbId, effectiveType)}
                                                style={{
                                                    // Blue/orange Nuvio identity split by a `/` diagonal
                                                    // (see Badge.tsx's 'nuvio' variant for the same treatment).
                                                    background:
                                                        "linear-gradient(115deg, rgba(56, 89, 158, 0.22) 0%, rgba(56, 89, 158, 0.22) 50%, rgba(255, 152, 0, 0.10) 50%, rgba(255, 152, 0, 0.10) 100%)",
                                                    border: "1px solid rgba(255, 152, 0, 0.18)",
                                                    color: "rgb(186, 208, 240)",
                                                }}
                                                tabIndex={isTV ? -1 : undefined}
                                            >
                                                <span className="inline-flex w-[11rem] items-center gap-1.5 sm:w-auto">
                                                    <PlayIcon className="h-4 w-4 shrink-0" />
                                                    Open in Nuvio
                                                </span>
                                            </a>
                                        );

                                        // AIOStreams: B2's soft lavender-to-indigo, "AIO" in white.
                                        // One server opens straight away; more than one asks which.
                                        const aioType: "movie" | "series" =
                                            effectiveType === "movie" ? "movie" : "series";
                                        const aioLinks = aioServers
                                            .map((srv) => ({
                                                ...srv,
                                                url: buildAioStreamsAppUrl(
                                                    srv.address,
                                                    imdbId,
                                                    aioType
                                                ),
                                            }))
                                            .filter(
                                                (
                                                    srv
                                                ): srv is {
                                                    address: string;
                                                    people: string[];
                                                    url: string;
                                                } => !!srv.url
                                            );
                                        const aioStyle = {
                                            background:
                                                "linear-gradient(110deg, rgba(212, 208, 255, 0.13), rgba(124, 111, 240, 0.22))",
                                            border: "1px solid rgba(159, 146, 255, 0.25)",
                                            color: "rgb(212, 208, 255)",
                                        };
                                        const aioLabel = (
                                            <>
                                                <PlayIcon className="h-4 w-4" />
                                                <span className="whitespace-nowrap">
                                                    {"Open in "}
                                                    <span
                                                        style={{
                                                            color: "#ffffff",
                                                            fontWeight: 600,
                                                        }}
                                                    >
                                                        AIO
                                                    </span>
                                                    Streams
                                                </span>
                                            </>
                                        );
                                        const aioClass =
                                            "flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors w-full sm:w-auto";
                                        const aioBtn =
                                            aioLinks.length === 0 ? null : aioLinks.length === 1 ? (
                                                <a
                                                    className={aioClass}
                                                    href={aioLinks[0].url}
                                                    style={aioStyle}
                                                    tabIndex={isTV ? -1 : undefined}
                                                >
                                                    {aioLabel}
                                                </a>
                                            ) : (
                                                <div className="relative w-full sm:w-auto">
                                                    <button
                                                        aria-expanded={aioPickerOpen}
                                                        className={aioClass}
                                                        onClick={() => setAioPickerOpen((o) => !o)}
                                                        style={aioStyle}
                                                        type="button"
                                                    >
                                                        {aioLabel}
                                                    </button>
                                                    {aioPickerOpen && (
                                                        <>
                                                            <button
                                                                aria-label="Close popup"
                                                                className="fixed inset-0 z-40 border-0 bg-transparent p-0"
                                                                onClick={() =>
                                                                    setAioPickerOpen(false)
                                                                }
                                                                tabIndex={-1}
                                                                type="button"
                                                            />
                                                            <div className="absolute left-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-default bg-surface p-2 shadow-xl sm:right-0 sm:left-auto">
                                                                <p className="px-1.5 pb-1 font-semibold text-default text-sm">
                                                                    Open in AIOStreams on…
                                                                </p>
                                                                {aioLinks.map((srv) => (
                                                                    <a
                                                                        className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-surface-hover"
                                                                        href={srv.url}
                                                                        key={srv.address}
                                                                        onClick={() =>
                                                                            setAioPickerOpen(false)
                                                                        }
                                                                    >
                                                                        <span className="min-w-0 flex-1">
                                                                            <span className="block truncate text-default text-sm">
                                                                                {srv.people.join(
                                                                                    ", "
                                                                                ) || "AIOStreams"}
                                                                            </span>
                                                                            <span className="block truncate text-muted text-xs">
                                                                                {srv.address.replace(
                                                                                    /^https?:\/\//,
                                                                                    ""
                                                                                )}
                                                                            </span>
                                                                        </span>
                                                                    </a>
                                                                ))}
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            );

                                        // TV mode: Norigin owns keyboard focus/activation itself
                                        // (it doesn't ride native DOM Tab order or native Enter-on-
                                        // link behavior) - so each control needs an explicit
                                        // onEnterPress that does what the click/native nav would
                                        // have done. tabIndex={-1} above keeps a stray native Tab
                                        // press from also landing on the underlying <a> and
                                        // double-handling the same keystroke.
                                        if (isTV) {
                                            return (
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {enableWatchlist && (
                                                        <TVFocusable onEnterPress={toggleWatchlist}>
                                                            {watchlistBtn}
                                                        </TVFocusable>
                                                    )}
                                                    {enableWatchedIndicators &&
                                                        selfWatched !== null && (
                                                            <TVFocusable
                                                                onEnterPress={toggleSelfWatched}
                                                            >
                                                                {watchedBtn}
                                                            </TVFocusable>
                                                        )}
                                                    {followBtn && (
                                                        <TVFocusable onEnterPress={toggleFollow}>
                                                            {followBtn}
                                                        </TVFocusable>
                                                    )}
                                                    <TVFocusable
                                                        onEnterPress={() => {
                                                            window.location.href =
                                                                buildStremioAppUrl(
                                                                    imdbId,
                                                                    effectiveType
                                                                );
                                                        }}
                                                    >
                                                        {stremioBtn}
                                                    </TVFocusable>
                                                    <TVFocusable
                                                        onEnterPress={() => {
                                                            window.location.href = buildNuvioAppUrl(
                                                                imdbId,
                                                                effectiveType
                                                            );
                                                        }}
                                                    >
                                                        {nuvioBtn}
                                                    </TVFocusable>
                                                    {aioLinks.length === 1 && (
                                                        <TVFocusable
                                                            onEnterPress={() => {
                                                                window.location.href =
                                                                    aioLinks[0].url;
                                                            }}
                                                        >
                                                            {aioBtn}
                                                        </TVFocusable>
                                                    )}
                                                </div>
                                            );
                                        }

                                        return (
                                            // One row: the two "open it" actions carry labels because
                                            // they are what this modal is for, and the rest sit beside
                                            // them as icons. Previously all six were labelled buttons
                                            // that wrapped onto two lines on any normal width.
                                            <div className="flex flex-wrap items-center gap-2">
                                                {stremioBtn}
                                                {nuvioBtn}
                                                {/* Jellyfin, AIOStreams or AIOMetadata people here: open it
                        in the app this device picked (components/ui/OpenWithButton). */}
                                                {householdActions && (
                                                    <OpenWithButton
                                                        imdbId={imdbId}
                                                        type={aioType}
                                                    />
                                                )}
                                                {householdActions && (
                                                    <span
                                                        className="mx-0.5 hidden h-6 w-px sm:block"
                                                        style={{
                                                            background:
                                                                "var(--color-surface-border)",
                                                        }}
                                                    />
                                                )}
                                                <div className="flex items-center gap-1.5">
                                                    {followBtn}
                                                    {/* On a phone + Catalog is a pill after the ratings instead. */}
                                                    <div className="hidden sm:block">
                                                        {householdActions && (
                                                            <AddToListButton
                                                                compact
                                                                item={{
                                                                    id: effectiveId,
                                                                    name: effectiveFallbackTitle,
                                                                    poster:
                                                                        effectiveFallbackPoster ||
                                                                        null,
                                                                    type: effectiveType,
                                                                }}
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                {details.genres && details.genres.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {details.genres.map((genre) => (
                                            <Badge key={genre} size="md" variant="default">
                                                {genre}
                                            </Badge>
                                        ))}
                                    </div>
                                )}

                                {overview && (
                                    <p className="text-base text-default leading-relaxed">
                                        {overview}
                                    </p>
                                )}

                                {details.director && details.director.length > 0 && (
                                    <p className="text-base">
                                        <span className="text-muted">Director: </span>
                                        <span className="text-default">
                                            {details.director.join(", ")}
                                        </span>
                                    </p>
                                )}

                                {/* Seasons and episodes. Series only, collapsed by default, and
                  the list is only fetched on expand - see loadSeasons. */}
                                {effectiveType === "series" && (
                                    <div
                                        className="rounded-xl"
                                        style={{ background: "var(--color-surface-hover)" }}
                                    >
                                        <button
                                            className="flex w-full items-center justify-between gap-3 p-3 text-left"
                                            onClick={loadSeasons}
                                            type="button"
                                        >
                                            <span className="font-medium text-default text-sm">
                                                Seasons &amp; episodes
                                                {seasons && seasons.length > 0 && (
                                                    <span className="font-normal text-muted text-xs">
                                                        {" "}
                                                        · {seasons.length} season
                                                        {seasons.length === 1 ? "" : "s"}
                                                    </span>
                                                )}
                                            </span>
                                            <ChevronDownIcon
                                                className={`h-4 w-4 shrink-0 transition-transform ${seasonsOpen ? "rotate-180" : ""}`}
                                                style={{ color: "var(--color-text-muted)" }}
                                            />
                                        </button>

                                        {seasonsOpen && (
                                            <div className="px-3 pb-3">
                                                {seasonsLoading && (
                                                    <p className="py-2 text-muted text-xs">
                                                        Loading episodes…
                                                    </p>
                                                )}
                                                {!seasonsLoading &&
                                                    seasons &&
                                                    seasons.length === 0 && (
                                                        <p className="py-2 text-muted text-xs">
                                                            No episode list is available for this
                                                            title.
                                                        </p>
                                                    )}
                                                {!seasonsLoading &&
                                                    seasons &&
                                                    seasons.length > 0 && (
                                                        <>
                                                            <ScrollRow className="flex gap-1.5 pb-2">
                                                                {seasons.map((s) => (
                                                                    <button
                                                                        className={`whitespace-nowrap rounded-lg px-2.5 py-1 font-medium text-xs ${activeSeason === s.season ? "bg-primary text-white" : "bg-surface text-muted"}`}
                                                                        key={s.season}
                                                                        onClick={() =>
                                                                            setActiveSeason(
                                                                                s.season
                                                                            )
                                                                        }
                                                                        type="button"
                                                                    >
                                                                        Season {s.season}
                                                                        {s.watchedCount > 0 && (
                                                                            <span
                                                                                className={
                                                                                    activeSeason ===
                                                                                    s.season
                                                                                        ? "opacity-80"
                                                                                        : "opacity-60"
                                                                                }
                                                                            >
                                                                                {" "}
                                                                                · {s.watchedCount}/
                                                                                {s.episodes.length}
                                                                            </span>
                                                                        )}
                                                                    </button>
                                                                ))}
                                                            </ScrollRow>
                                                            <div className="max-h-56 space-y-px overflow-y-auto pr-1">
                                                                {seasons
                                                                    .find(
                                                                        (s) =>
                                                                            s.season ===
                                                                            activeSeason
                                                                    )
                                                                    ?.episodes.map((ep) => (
                                                                        <div
                                                                            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-surface-hover ${ep.watched ? "ep-watched" : "ep-unwatched"}`}
                                                                            key={`${ep.season}-${ep.episode}`}
                                                                        >
                                                                            <span
                                                                                className="w-10 shrink-0 text-xs tabular-nums"
                                                                                style={{
                                                                                    color: "var(--color-text-muted)",
                                                                                }}
                                                                            >
                                                                                E
                                                                                {String(
                                                                                    ep.episode
                                                                                ).padStart(2, "0")}
                                                                            </span>
                                                                            <span className="min-w-0 flex-1 truncate text-default text-xs">
                                                                                {ep.title ||
                                                                                    `Episode ${ep.episode}`}
                                                                            </span>
                                                                            {ep.released && (
                                                                                <span
                                                                                    className="shrink-0 text-[11px]"
                                                                                    style={{
                                                                                        color: "var(--color-text-subtle)",
                                                                                    }}
                                                                                >
                                                                                    {new Date(
                                                                                        ep.released
                                                                                    ).getFullYear() ||
                                                                                        ""}
                                                                                </span>
                                                                            )}
                                                                            {ep.watched && (
                                                                                <CheckCircleIcon
                                                                                    className="h-4 w-4 shrink-0"
                                                                                    style={{
                                                                                        color: "var(--color-success)",
                                                                                    }}
                                                                                />
                                                                            )}
                                                                        </div>
                                                                    ))}
                                                            </div>
                                                        </>
                                                    )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Spoiler guard. Collapsed it is a single inline control, not
                  a full-width bar holding two words and a lot of nothing -
                  it only takes real space once it is actually opened. */}
                                {effectiveType === "series" && enableWatchTogether && (
                                    <div
                                        className={
                                            wtOpen
                                                ? "rounded-xl border border-default bg-surface-hover/40"
                                                : ""
                                        }
                                    >
                                        <button
                                            className={
                                                wtOpen
                                                    ? "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
                                                    : "inline-flex items-center gap-2 rounded-lg bg-surface-hover px-3 py-1.5 text-left transition-colors"
                                            }
                                            onClick={() => {
                                                setWtOpen((v) => !v);
                                                if (!wtOpen) {
                                                    loadWatchTogether();
                                                }
                                            }}
                                            type="button"
                                        >
                                            <div className="flex min-w-0 items-center gap-2">
                                                <ShieldCheckIcon
                                                    className={`h-4 w-4 shrink-0 ${wtHasPact ? "text-primary" : "text-muted"}`}
                                                />
                                                <span className="font-medium text-default text-sm">
                                                    Spoiler guard
                                                </span>
                                                {wtHasPact && (
                                                    <span className="truncate text-muted text-xs">
                                                        {wtSelected.size} people
                                                        {wtFrontier
                                                            ? ` · everyone is at S${wtFrontier.season}E${wtFrontier.episode}${wtWaitingOn.length ? ` (waiting on ${wtWaitingOn.join(", ")})` : ""}`
                                                            : " · not everyone has started yet"}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="shrink-0 text-muted text-xs">
                                                {wtOpen ? "Hide" : wtHasPact ? "Edit" : "Set up"}
                                            </span>
                                        </button>
                                        {wtOpen && (
                                            <div className="px-3 pb-3">
                                                <p className="mb-2 text-muted text-xs">
                                                    Pick who is watching this show together. When
                                                    anyone starts an episode someone else here has
                                                    not seen, the household gets told - by name.
                                                </p>
                                                {wtLoaded ? (
                                                    wtUsers.length < 2 ? (
                                                        <p className="text-subtle text-xs">
                                                            The spoiler guard takes at least two
                                                            users on this instance.
                                                        </p>
                                                    ) : (
                                                        <>
                                                            <div className="mb-3 flex flex-wrap gap-2">
                                                                {wtUsers.map((u) => {
                                                                    const on = wtSelected.has(u.id);
                                                                    return (
                                                                        <button
                                                                            className={`rounded-full border px-2.5 py-1 font-medium text-xs transition-colors ${on ? "chip-solid-on" : "chip-solid-off"}`}
                                                                            key={u.id}
                                                                            onClick={() =>
                                                                                setWtSelected(
                                                                                    (prev) => {
                                                                                        const n =
                                                                                            new Set(
                                                                                                prev
                                                                                            );
                                                                                        if (
                                                                                            n.has(
                                                                                                u.id
                                                                                            )
                                                                                        ) {
                                                                                            n.delete(
                                                                                                u.id
                                                                                            );
                                                                                        } else {
                                                                                            n.add(
                                                                                                u.id
                                                                                            );
                                                                                        }
                                                                                        return n;
                                                                                    }
                                                                                )
                                                                            }
                                                                            type="button"
                                                                        >
                                                                            {u.username}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <button
                                                                    className="rounded-lg px-3 py-1.5 font-medium text-xs transition-opacity disabled:opacity-40"
                                                                    disabled={
                                                                        wtBusy ||
                                                                        wtSelected.size < 2
                                                                    }
                                                                    onClick={saveWatchTogether}
                                                                    style={{
                                                                        background:
                                                                            "var(--color-primary)",
                                                                        color: "var(--color-bg)",
                                                                    }}
                                                                    type="button"
                                                                >
                                                                    {wtHasPact
                                                                        ? "Update"
                                                                        : "Turn on spoiler guard"}
                                                                </button>
                                                                {wtHasPact && (
                                                                    <button
                                                                        className="rounded-lg px-3 py-1.5 font-medium text-muted text-xs transition-colors hover:text-default"
                                                                        disabled={wtBusy}
                                                                        onClick={
                                                                            removeWatchTogether
                                                                        }
                                                                        type="button"
                                                                    >
                                                                        Stop
                                                                    </button>
                                                                )}
                                                                {wtSelected.size === 1 && (
                                                                    <span className="text-subtle text-xs">
                                                                        Pick at least one more
                                                                        person
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </>
                                                    )
                                                ) : (
                                                    <p className="text-subtle text-xs">
                                                        Loading...
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {details.cast && details.cast.length > 0 && (
                                    <div>
                                        <p className="mb-2 text-base text-muted">Cast</p>
                                        <div
                                            // Room above and left of the photos: the row hides what
                                            // overflows it, and the hover ring sits outside the photo.
                                            className="no-scrollbar -mt-1.5 -ml-1 flex cursor-grab select-none gap-4 overflow-x-auto pt-1.5 pr-6 pb-1 pl-1 active:cursor-grabbing"
                                            onPointerDown={handleCastPointerDown}
                                            onPointerMove={handleCastPointerMove}
                                            onPointerUp={handleCastPointerUp}
                                            ref={castRowRef}
                                        >
                                            {details.cast.slice(0, 10).map((member) => {
                                                const clickable =
                                                    member.tmdbId != null && member.tmdbId !== "";
                                                return (
                                                    <button
                                                        className={`w-24 shrink-0 text-center ${clickable ? "group/cast cursor-pointer" : "cursor-default"}`}
                                                        disabled={!clickable}
                                                        key={member.name}
                                                        // Only a real click (not a drag) fires - the cast row's
                                                        // drag-scroll only captures the pointer after 5px of
                                                        // movement, so a stationary click still reaches here.
                                                        onClick={() => {
                                                            if (castHold.current.fired) {
                                                                castHold.current.fired = false;
                                                                return;
                                                            }
                                                            if (clickable) {
                                                                openPerson(member);
                                                            }
                                                        }}
                                                        onContextMenu={(e) => {
                                                            e.preventDefault();
                                                            // Android sends this for a held finger too; the timer may already have opened it.
                                                            if (
                                                                clickable &&
                                                                !castHold.current.fired
                                                            ) {
                                                                openCastMenu(
                                                                    member,
                                                                    e.currentTarget
                                                                );
                                                            }
                                                        }}
                                                        onPointerCancel={castHoldEnd}
                                                        onPointerDown={(e) => {
                                                            if (!clickable) {
                                                                return;
                                                            }
                                                            const el = e.currentTarget;
                                                            castHoldStart(e, () =>
                                                                openCastMenu(member, el)
                                                            );
                                                        }}
                                                        onPointerMove={castHoldMove}
                                                        onPointerUp={castHoldEnd}
                                                        // No text selection or callout on a held finger - that
                                                        // is the phone's Copy / Look Up bubble, not ours.
                                                        style={{
                                                            userSelect: "none",
                                                            WebkitTouchCallout: "none",
                                                            WebkitUserSelect: "none",
                                                        }}
                                                        title={
                                                            clickable
                                                                ? `See ${member.name}'s other titles`
                                                                : member.name
                                                        }
                                                        type="button"
                                                    >
                                                        {member.photo ? (
                                                            /* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Preventing native image dragging does not make the image a control. */
                                                            <img
                                                                alt={member.name}
                                                                className={`pointer-events-none mx-auto h-20 w-20 rounded-full bg-surface-hover object-cover transition-transform ${clickable ? "group-hover/cast:scale-105 group-hover/cast:ring-2 group-hover/cast:ring-primary" : ""}`}
                                                                decoding="async"
                                                                draggable={false}
                                                                height={80}
                                                                loading="lazy"
                                                                onDragStart={(e) =>
                                                                    e.preventDefault()
                                                                }
                                                                src={member.photo}
                                                                width={80}
                                                            />
                                                        ) : (
                                                            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-surface-hover font-medium text-muted text-xl">
                                                                {member.name.charAt(0)}
                                                            </div>
                                                        )}
                                                        <p
                                                            className={`mt-2 font-medium text-sm leading-tight ${clickable ? "text-default transition-colors group-hover/cast:text-primary" : "text-default"}`}
                                                            style={{
                                                                display: "-webkit-box",
                                                                overflow: "hidden",
                                                                WebkitBoxOrient: "vertical",
                                                                WebkitLineClamp: 2,
                                                            }}
                                                            title={member.name}
                                                        >
                                                            {member.name}
                                                        </p>
                                                        {member.character && (
                                                            <p
                                                                className="text-subtle text-xs leading-tight"
                                                                style={{
                                                                    display: "-webkit-box",
                                                                    overflow: "hidden",
                                                                    WebkitBoxOrient: "vertical",
                                                                    WebkitLineClamp: 1,
                                                                }}
                                                                title={member.character}
                                                            >
                                                                {member.character}
                                                            </p>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        {/* Filmography deep-dive for a clicked cast member. Inline
                      under the Cast row so it reads as an expansion of it, not
                      a context switch. Clicking a title resolves its IMDb id
                      and re-drives the whole modal to that title (setOverrideItem),
                      same navigation "More Like This" uses. */}
                                        {castMenu && (
                                            <CastMenu
                                                follow={personFollows[castMenu.tmdbId] || null}
                                                onClose={closeCastMenu}
                                                onFollow={() =>
                                                    togglePersonFollow(
                                                        castMenu.tmdbId,
                                                        castMenu.name
                                                    )
                                                }
                                                onSeeEverything={() =>
                                                    seeEverything(castMenu.tmdbId, castMenu.name)
                                                }
                                                onShowHere={() => {
                                                    if (
                                                        personView &&
                                                        String(personView.id) === castMenu.tmdbId
                                                    ) {
                                                        setPersonView(null);
                                                    } else {
                                                        openPerson(
                                                            {
                                                                name: castMenu.name,
                                                                tmdbId: castMenu.tmdbId,
                                                            },
                                                            true
                                                        );
                                                    }
                                                }}
                                                target={castMenu}
                                                title={
                                                    details?.title || effectiveFallbackTitle || null
                                                }
                                                titlesOpen={
                                                    !!personView &&
                                                    String(personView.id) === castMenu.tmdbId
                                                }
                                            />
                                        )}
                                        {personView && (
                                            <div
                                                className="mt-4 scroll-mt-4 rounded-xl border border-default bg-surface-hover/40 p-3"
                                                ref={personPanelRef}
                                            >
                                                <div className="mb-2 flex items-center justify-between">
                                                    <p className="font-semibold text-default text-sm">
                                                        {personView.name}
                                                        <span className="font-normal text-muted">
                                                            {" "}
                                                            — more titles
                                                        </span>
                                                    </p>
                                                    <div className="flex shrink-0 items-center gap-2">
                                                        {/* Following a person had no way in at all before
                              this: the server accepted it, nothing in the app
                              asked for it. Here is where someone is already
                              looking at that person's work. */}
                                                        <button
                                                            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium text-xs transition-colors ${personFollows[String(personView.id)] && !personFollows[String(personView.id)].muted ? "ibtn-tint-on" : "ibtn-tint-off"}`}
                                                            disabled={
                                                                personFollowBusy ===
                                                                String(personView.id)
                                                            }
                                                            onClick={() =>
                                                                togglePersonFollow(
                                                                    String(personView.id),
                                                                    personView.name
                                                                )
                                                            }
                                                            style={
                                                                {
                                                                    "--tint":
                                                                        "var(--color-primary)",
                                                                } as React.CSSProperties
                                                            }
                                                            title={
                                                                personFollows[String(personView.id)]
                                                                    ? personFollows[
                                                                          String(personView.id)
                                                                      ].muted
                                                                        ? "Alerts muted - tap to turn them back on"
                                                                        : "Following - tap to mute"
                                                                    : `Follow ${personView.name} - hear when they have something new out`
                                                            }
                                                            type="button"
                                                        >
                                                            <BellIcon className="h-3.5 w-3.5" />
                                                            {personFollows[String(personView.id)]
                                                                ? personFollows[
                                                                      String(personView.id)
                                                                  ].muted
                                                                    ? "Muted"
                                                                    : "Following"
                                                                : "Follow"}
                                                        </button>
                                                        <button
                                                            className="text-muted text-xs transition-colors hover:text-default"
                                                            onClick={() => setPersonView(null)}
                                                            type="button"
                                                        >
                                                            Close
                                                        </button>
                                                    </div>
                                                </div>
                                                {personView.loading ? (
                                                    <p className="py-4 text-center text-muted text-sm">
                                                        Loading filmography…
                                                    </p>
                                                ) : personView.unavailable ? (
                                                    <p className="py-3 text-subtle text-xs">
                                                        {personView.unavailable === "nokey"
                                                            ? "Cast deep-dive needs a TMDb API key (Settings → add one, or set TMDB_API_KEY)."
                                                            : "Could not load this filmography just now. Tap the name again to retry."}
                                                    </p>
                                                ) : personView.credits.length === 0 ? (
                                                    <p className="py-3 text-muted text-sm">
                                                        No other titles found.
                                                    </p>
                                                ) : (
                                                    <div
                                                        className="no-scrollbar flex cursor-grab select-none gap-3 overflow-x-auto pb-1 active:cursor-grabbing"
                                                        onPointerDown={
                                                            creditsDrag.handlers.onPointerDown
                                                        }
                                                        onPointerLeave={
                                                            creditsDrag.handlers.onPointerLeave
                                                        }
                                                        onPointerMove={
                                                            creditsDrag.handlers.onPointerMove
                                                        }
                                                        onPointerUp={
                                                            creditsDrag.handlers.onPointerUp
                                                        }
                                                        ref={creditsDrag.ref}
                                                    >
                                                        {personView.credits.map((c) => (
                                                            <button
                                                                className="group/cred w-20 shrink-0 text-left"
                                                                key={`${c.mediaType}-${c.tmdbId}`}
                                                                onClick={() => openCredit(c)}
                                                                title={`${c.title}${c.role ? ` · ${c.role}` : ""}`}
                                                                type="button"
                                                            >
                                                                <div className="aspect-[2/3] overflow-hidden rounded-lg border border-default bg-surface">
                                                                    {c.poster ? (
                                                                        <img
                                                                            alt={c.title}
                                                                            className="h-full w-full object-cover transition-transform group-hover/cred:scale-105"
                                                                            decoding="async"
                                                                            draggable={false}
                                                                            height={450}
                                                                            loading="lazy"
                                                                            src={c.poster}
                                                                            width={300}
                                                                        />
                                                                    ) : (
                                                                        <div className="flex h-full w-full items-center justify-center p-1 text-center text-muted text-xs">
                                                                            {c.title}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <p className="mt-1 line-clamp-2 font-medium text-[11px] text-default leading-tight transition-colors group-hover/cred:text-primary">
                                                                    {c.title}
                                                                </p>
                                                                {c.year && (
                                                                    <p className="text-[10px] text-subtle">
                                                                        {c.year}
                                                                    </p>
                                                                )}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                                {!(
                                                    personView.loading || personView.unavailable
                                                ) && (
                                                    <button
                                                        className="mt-2.5 font-semibold text-sm transition-opacity hover:opacity-80"
                                                        onClick={() =>
                                                            seeEverything(
                                                                personView.id,
                                                                personView.name
                                                            )
                                                        }
                                                        style={{
                                                            color: "color-mix(in srgb, var(--color-primary) 45%, #ffffff)",
                                                        }}
                                                        type="button"
                                                    >
                                                        See more about {personView.name} →
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {details.awards && (
                                    <p className="flex items-start gap-1.5 text-muted text-sm">
                                        <FilmIcon className="mt-0.5 h-5 w-5 shrink-0" />
                                        {details.awards}
                                    </p>
                                )}

                                {details.boxOffice && (
                                    <p className="flex items-start gap-1.5 text-muted text-sm">
                                        <span
                                            aria-hidden
                                            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center"
                                        >
                                            💰
                                        </span>
                                        Box office: {details.boxOffice}
                                    </p>
                                )}

                                {/* TMDb "belongs_to_collection" grouping - e.g. Dune (2021) ->
                  "Part of the Dune Collection" -> the other films in it,
                  each clickable via the same setOverrideItem navigation
                  "More Like This" already uses to swap the modal's content
                  in place. Movies only; null entirely for TV or a movie
                  not part of one, so this section just doesn't render. */}
                                {details.collection && details.collection.parts.length > 0 && (
                                    <div>
                                        {(() => {
                                            const toggleLabel = (
                                                <span className="flex w-full items-center justify-between py-1 text-base text-muted transition-colors hover:text-default">
                                                    <span className="flex items-center gap-2">
                                                        Part of the {details.collection.name}
                                                        {(() => {
                                                            // Membership = this title + the other parts; the
                                                            // completion count is the collection's entire
                                                            // reason to exist as a stat.
                                                            const others = details.collection.parts;
                                                            const watchedOthers = others.filter(
                                                                (pt) => partsWatched[pt.id]
                                                            ).length;
                                                            const watchedTotal =
                                                                watchedOthers +
                                                                (selfWatched ? 1 : 0);
                                                            const total = others.length + 1;
                                                            const done = watchedTotal >= total;
                                                            return (
                                                                <span
                                                                    className={`text-xs ${done ? "text-success" : ""}`}
                                                                >
                                                                    {done
                                                                        ? "saga complete"
                                                                        : `watched ${watchedTotal} of ${total}`}
                                                                </span>
                                                            );
                                                        })()}
                                                    </span>
                                                    <ChevronDownIcon
                                                        className={`h-4 w-4 transition-transform ${collectionExpanded ? "rotate-180" : ""}`}
                                                    />
                                                </span>
                                            );
                                            const onToggle = () => setCollectionExpanded((v) => !v);
                                            return isTV ? (
                                                <TVFocusable
                                                    className="block w-full"
                                                    onEnterPress={onToggle}
                                                >
                                                    {toggleLabel}
                                                </TVFocusable>
                                            ) : (
                                                <button
                                                    className="block w-full"
                                                    onClick={onToggle}
                                                    type="button"
                                                >
                                                    {toggleLabel}
                                                </button>
                                            );
                                        })()}
                                        {collectionExpanded && (
                                            <div
                                                className="no-scrollbar mt-2 flex cursor-grab select-none gap-3 overflow-x-auto pr-6 pb-1 active:cursor-grabbing"
                                                onPointerDown={handleCollectionPointerDown}
                                                onPointerMove={handleCollectionPointerMove}
                                                onPointerUp={handleCollectionPointerUp}
                                                ref={collectionRowRef}
                                            >
                                                {details.collection.parts.map((part) => {
                                                    const goToPart = () =>
                                                        setOverrideItem({
                                                            id: part.id,
                                                            name: part.title,
                                                            poster: part.poster,
                                                            releaseInfo:
                                                                part.releaseYear || undefined,
                                                            type: "movie",
                                                        });
                                                    return (
                                                        <button
                                                            className="group tap-card w-28 shrink-0 text-left"
                                                            key={part.id}
                                                            onClick={goToPart}
                                                            type="button"
                                                        >
                                                            <div className="relative h-40 w-28 overflow-hidden rounded-lg bg-surface-hover">
                                                                {partsWatched[part.id] && (
                                                                    <span
                                                                        className="absolute top-1.5 right-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full"
                                                                        style={{
                                                                            background:
                                                                                "var(--color-success)",
                                                                        }}
                                                                    >
                                                                        <CheckIconMini className="h-3.5 w-3.5 text-white" />
                                                                    </span>
                                                                )}
                                                                {part.poster ? (
                                                                    /* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Preventing native image dragging does not make the image a control. */
                                                                    <img
                                                                        alt={part.title}
                                                                        className="pointer-events-none h-full w-full object-cover transition-transform group-hover:scale-105"
                                                                        decoding="async"
                                                                        draggable={false}
                                                                        height={160}
                                                                        loading="lazy"
                                                                        onDragStart={(e) =>
                                                                            e.preventDefault()
                                                                        }
                                                                        src={part.poster}
                                                                        width={112}
                                                                    />
                                                                ) : (
                                                                    <div className="flex h-full w-full items-center justify-center text-muted">
                                                                        <FilmIcon className="h-8 w-8" />
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <p className="mt-1.5 line-clamp-2 font-medium text-default text-sm leading-tight transition-colors group-hover:text-primary">
                                                                {part.title}
                                                            </p>
                                                            {part.releaseYear && (
                                                                <p className="text-subtle text-xs">
                                                                    {part.releaseYear}
                                                                </p>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* SlickTrax "More Like This" - a disclosure, collapsed by
                  default, rather than an always-open poster row that made
                  this the tallest section in the whole popup regardless of
                  whether anyone wanted it. Hidden entirely once loaded if
                  the /similar route came back empty (a title Cinemeta has no
                  genre data for, on top of nobody in the household having
                  watched it) - no point showing a toggle for nothing.
                  hasRealSignal swaps the label - real household affinity is
                  a stronger, more specific claim than the generic
                  genre-backfill copy. */}
                                {(similarLoading || similarItems.length > 0) && (
                                    <div>
                                        {(() => {
                                            const toggleLabel = (
                                                <span className="flex w-full items-center justify-between py-1 text-base text-muted transition-colors hover:text-default">
                                                    <span className="flex items-center gap-2">
                                                        {similarHasRealSignal
                                                            ? "Because you're into titles like this"
                                                            : "More Like This"}
                                                        {!similarLoading && (
                                                            <span className="text-subtle text-xs">
                                                                ({similarItems.length})
                                                            </span>
                                                        )}
                                                    </span>
                                                    {similarLoading ? (
                                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                    ) : (
                                                        <ChevronDownIcon
                                                            className={`h-4 w-4 transition-transform ${similarExpanded ? "rotate-180" : ""}`}
                                                        />
                                                    )}
                                                </span>
                                            );
                                            const onToggle = () => {
                                                if (!similarLoading) {
                                                    setSimilarExpanded((v) => !v);
                                                }
                                            };
                                            return isTV ? (
                                                <TVFocusable
                                                    className="block w-full"
                                                    onEnterPress={onToggle}
                                                >
                                                    {toggleLabel}
                                                </TVFocusable>
                                            ) : (
                                                <button
                                                    className="block w-full"
                                                    disabled={similarLoading}
                                                    onClick={onToggle}
                                                    type="button"
                                                >
                                                    {toggleLabel}
                                                </button>
                                            );
                                        })()}
                                        {similarExpanded && !similarLoading && (
                                            <div
                                                className="no-scrollbar mt-2 flex cursor-grab select-none gap-3 overflow-x-auto pr-6 pb-1 active:cursor-grabbing"
                                                onPointerDown={handleSimilarPointerDown}
                                                onPointerMove={handleSimilarPointerMove}
                                                onPointerUp={handleSimilarPointerUp}
                                                ref={similarRowRef}
                                            >
                                                {similarItems.map((item) => {
                                                    const goToItem = () =>
                                                        setOverrideItem({
                                                            id: item.id,
                                                            imdbRating: item.imdbRating,
                                                            name: item.name,
                                                            poster: item.poster,
                                                            releaseInfo: item.releaseInfo,
                                                            type: item.type,
                                                        });
                                                    const card = (
                                                        <button
                                                            className="group tap-card w-28 shrink-0 text-left"
                                                            onClick={goToItem}
                                                            tabIndex={isTV ? -1 : undefined}
                                                            type="button"
                                                        >
                                                            <div className="h-40 w-28 overflow-hidden rounded-lg bg-surface-hover">
                                                                {item.poster ? (
                                                                    /* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Preventing native image dragging does not make the image a control. */
                                                                    <img
                                                                        alt={item.name}
                                                                        className="pointer-events-none h-full w-full object-cover transition-transform group-hover:scale-105"
                                                                        decoding="async"
                                                                        draggable={false}
                                                                        height={160}
                                                                        loading="lazy"
                                                                        onDragStart={(e) =>
                                                                            e.preventDefault()
                                                                        }
                                                                        src={posterUrl(
                                                                            item,
                                                                            rpdbEnabled
                                                                        )}
                                                                        width={112}
                                                                    />
                                                                ) : (
                                                                    <div className="flex h-full w-full items-center justify-center text-muted">
                                                                        <FilmIcon className="h-8 w-8" />
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <p
                                                                className="mt-1.5 font-medium text-default text-sm leading-tight transition-colors group-hover:text-primary"
                                                                style={{
                                                                    display: "-webkit-box",
                                                                    overflow: "hidden",
                                                                    WebkitBoxOrient: "vertical",
                                                                    WebkitLineClamp: 2,
                                                                }}
                                                                title={item.name}
                                                            >
                                                                {item.name}
                                                            </p>
                                                        </button>
                                                    );
                                                    return isTV ? (
                                                        <TVFocusable
                                                            key={item.id}
                                                            onEnterPress={goToItem}
                                                        >
                                                            {card}
                                                        </TVFocusable>
                                                    ) : (
                                                        <Fragment key={item.id}>{card}</Fragment>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </FocusContext.Provider>
        </Modal>
    );
}
