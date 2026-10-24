"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

// Feature flags for the SlickSync-native personal features (Watchlist,
// Watched indicators, Recommendations). Live on AppAccount.sync JSON —
// this hook fetches them once, caches in-module so every consumer shares
// the same state, and refreshes when the Settings page dispatches the
// bump event below. Default TRUE on missing / error / still-loading, so
// nothing hides while we're waiting for the first fetch.

export interface PersonalFeatures {
    // Whether that autoplay starts muted (true, default) or with sound
    // (false) - a separate choice, not decided for the viewer. Only read when
    // enableAutoplayTrailer is on; an explicit "Play Trailer" click always
    // starts with sound regardless of this.
    autoplayTrailerStartMuted: boolean;
    // Trailer in the detail modal starts playing automatically instead of
    // waiting for a "Play Trailer" click. Default false (opt-in, not
    // opt-out) - unlike the other three SlickTrax flags above, autoplaying
    // audio/video the instant a modal opens is disruptive enough that it
    // shouldn't happen until someone explicitly asks for it in Settings.
    enableAutoplayTrailer: boolean;
    // IMDb/Rotten Tomatoes/Metacritic badges on every poster card. Default
    // false (opt-in, like Autoplay trailer) - showing scores before anyone's
    // read anything about a title is enough of a judgment call that it
    // shouldn't happen until someone explicitly asks for it in Settings.
    enablePosterRatings: boolean;
    // Thumbs up/down reactions on the detail modal - feeds /recommendations scoring
    // (recommendationEngine.js's computeSignedAdjustments), not just
    // decorative. Default true, same as Watchlist/Watched indicators/
    // Recommendations above. Personal 1-10 ratings share the same backend
    // and toggle but have no UI yet (see MediaDetailModal.tsx).
    enableReactions: boolean;
    enableRecommendations: boolean;
    enableWatchedIndicators: boolean;
    enableWatchlist: boolean;
    // "Also streaming on" (JustWatch subscription/free-tier availability) row
    // in the detail modal. Default true, same opt-out treatment as Watchlist/
    // Watched indicators/Recommendations/Reactions above.
    enableWatchProviders: boolean;
    enableWatchTogether: boolean;
    // Whether to actually route a title's poster through RPDB's rating-
    // embedded art (/api/poster/{imdbId}) instead of its own stored poster.
    // Requires BOTH a configured RPDB key AND enablePosterRatings below -
    // RPDB's whole product is posters with ratings baked into the image, so
    // turning "Poster ratings" off is expected to hide those too, not just
    // this app's own overlay badges (confirmed live: a key alone was still
    // showing rating-embedded posters everywhere with the toggle off).
    // Deliberately just a boolean: the raw key stays server-side / confined
    // to the Settings page's own edit form, never round-tripped here.
    rpdbEnabled: boolean;
}

const DEFAULT: PersonalFeatures = {
    autoplayTrailerStartMuted: true,
    enableAutoplayTrailer: false,
    enablePosterRatings: false,
    enableReactions: true,
    enableRecommendations: true,
    enableWatchedIndicators: true,
    enableWatchlist: true,
    enableWatchProviders: true,
    enableWatchTogether: true,
    rpdbEnabled: false,
};

// One in-flight promise + one cached value shared across every hook
// consumer. Prevents each Discover PosterCard / Dashboard panel from
// firing its own /account-sync call on mount.
let cached: PersonalFeatures | null = null;
let inFlight: Promise<PersonalFeatures> | null = null;
const listeners = new Set<(v: PersonalFeatures) => void>();
const REFRESH_EVENT = "slicksync:personal-features-changed";

async function fetchOnce(): Promise<PersonalFeatures> {
    if (cached) {
        return cached;
    }
    if (inFlight) {
        return inFlight;
    }
    inFlight = api
        .getSyncSettings()
        .then((s) => {
            cached = {
                autoplayTrailerStartMuted: s?.autoplayTrailerStartMuted !== false,
                enableAutoplayTrailer: s?.enableAutoplayTrailer === true,
                enablePosterRatings: s?.enablePosterRatings === true,
                enableReactions: s?.enableReactions !== false,
                enableRecommendations: s?.enableRecommendations !== false,
                enableWatchedIndicators: s?.enableWatchedIndicators !== false,
                enableWatchlist: s?.enableWatchlist !== false,
                enableWatchProviders: s?.enableWatchProviders !== false,
                enableWatchTogether: s?.enableWatchTogether !== false,
                rpdbEnabled: !!s?.rpdbApiKey?.trim() && s?.enablePosterRatings === true,
            };
            inFlight = null;
            return cached;
        })
        .catch(() => {
            cached = DEFAULT;
            inFlight = null;
            return cached;
        });
    return inFlight;
}

/** Call from Settings after saving one of the toggles to invalidate the cache. */
export function invalidatePersonalFeatures() {
    cached = null;
    inFlight = null;
    // Re-fetch immediately + notify every mounted subscriber so they re-render.
    fetchOnce().then((v) =>
        listeners.forEach((l) => {
            l(v);
        })
    );
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
    }
}

export const PersonalFeaturesContext = createContext<PersonalFeatures | null>(null);

export function usePersonalFeatures(): PersonalFeatures {
    const override = useContext(PersonalFeaturesContext);
    const [value, setValue] = useState<PersonalFeatures>(cached || DEFAULT);

    useEffect(() => {
        if (override) {
            return;
        }
        let mounted = true;
        fetchOnce().then((v) => {
            if (mounted) {
                setValue(v);
            }
        });
        listeners.add(setValue);
        // Also listen to the cross-window custom event so the Settings page
        // and a Discover tab in the same window both react to an edit.
        const onChange = () => {
            if (mounted && cached) {
                setValue(cached);
            }
        };
        if (typeof window !== "undefined") {
            window.addEventListener(REFRESH_EVENT, onChange);
        }
        return () => {
            mounted = false;
            listeners.delete(setValue);
            if (typeof window !== "undefined") {
                window.removeEventListener(REFRESH_EVENT, onChange);
            }
        };
    }, [override]);

    return override || value;
}
