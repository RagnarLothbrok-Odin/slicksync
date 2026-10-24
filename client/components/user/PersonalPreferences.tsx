"use client";

import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { toast } from "@/components/ui/Toast";
import { type PersonalFeatures, PersonalFeaturesContext } from "@/lib/hooks/usePersonalFeatures";
import { useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { type PersonalPreferences, personalRequest } from "@/lib/user-api";

const defaults: PersonalPreferences = {
    autoplayTrailer: false,
    beginnerMode: false,
    hideSensitive: false,
    posterRatings: false,
    trailerSound: false,
};
const Context = createContext<{
    preferences: PersonalPreferences;
    ready: boolean;
    saving: boolean;
    error: string | null;
    reload: () => void;
    save: (patch: Partial<PersonalPreferences>) => Promise<void>;
}>({
    error: null,
    preferences: defaults,
    ready: false,
    reload: () => undefined,
    save: async () => undefined,
    saving: false,
});

export function PersonalPreferencesProvider({ children }: { children: ReactNode }) {
    const { userId, authKey, isReady } = useUserAuthHeaders();
    const identity = useRef({ authKey, userId });
    identity.current = { authKey, userId };
    const [preferences, setPreferences] = useState(defaults);
    const [ready, setReady] = useState(false);
    const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        let active = true;
        setReady(false);
        setSaving(false);
        setPreferences(defaults);
        setError(null);
        if (isReady && userId && authKey) {
            personalRequest<PersonalPreferences>(userId, authKey, "/preferences")
                .then((value) => {
                    if (active) {
                        setPreferences(value);
                        setLoadedUserId(userId);
                        setReady(true);
                    }
                })
                .catch(() => {
                    if (active) {
                        setError("Could not load your display preferences.");
                    }
                });
        }
        return () => {
            active = false;
        };
    }, [userId, authKey, isReady, revision]);
    const save = useCallback(
        async (patch: Partial<PersonalPreferences>) => {
            if (!ready || saving || !userId || !authKey) {
                return;
            }
            setSaving(true);
            try {
                const next = await personalRequest<PersonalPreferences>(
                    userId,
                    authKey,
                    "/preferences",
                    {
                        body: JSON.stringify({ preferences: { ...preferences, ...patch } }),
                        method: "PATCH",
                    }
                );
                if (identity.current.userId === userId && identity.current.authKey === authKey) {
                    setPreferences(next);
                    toast.success("Saved");
                }
            } catch {
                if (identity.current.userId === userId && identity.current.authKey === authKey) {
                    toast.error("Could not save your display preferences");
                }
            } finally {
                if (identity.current.userId === userId && identity.current.authKey === authKey) {
                    setSaving(false);
                }
            }
        },
        [ready, saving, userId, authKey, preferences]
    );
    // Keep sensitive fields covered until this person's preferences arrive,
    // including the first render after a reload or an identity switch.
    const resolved = ready && loadedUserId === userId;
    const visiblePreferences = resolved ? preferences : { ...defaults, hideSensitive: true };
    const features = useMemo<PersonalFeatures>(
        () => ({
            autoplayTrailerStartMuted: !preferences.trailerSound,
            enableAutoplayTrailer: preferences.autoplayTrailer,
            enablePosterRatings: preferences.posterRatings,
            enableReactions: true,
            enableRecommendations: false,
            enableWatchedIndicators: false,
            enableWatchlist: true,
            enableWatchProviders: false,
            enableWatchTogether: false,
            rpdbEnabled: false,
        }),
        [preferences]
    );
    return (
        <Context.Provider
            value={{
                error,
                preferences: visiblePreferences,
                ready: resolved,
                reload: () => setRevision((value) => value + 1),
                save,
                saving,
            }}
        >
            <PersonalFeaturesContext.Provider value={features}>
                {children}
            </PersonalFeaturesContext.Provider>
        </Context.Provider>
    );
}
export const usePersonalPreferences = () => useContext(Context);
