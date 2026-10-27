"use client";

import { useMemo } from "react";
import { UpcomingEpisodesPanel } from "@/components/ui/UpcomingEpisodesPanel";
import type { UpcomingEpisode } from "@/lib/api";
import { useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { personalRequest } from "@/lib/user-api";
import { PersonalMediaDetailModal } from "./PersonalMediaDetailModal";

const unchanged = () => undefined;

export function PersonalCalendar() {
    const { userId, authKey, isReady } = useUserAuthHeaders();
    const client = useMemo(() => {
        const unavailable = async (): Promise<never> => {
            throw new Error("Calendar tracking is managed by your household administrator.");
        };
        return {
            dismissUpcomingEpisode: unavailable,
            getMutedShows: unavailable,
            getUpcomingEpisodes: () =>
                personalRequest<UpcomingEpisode[]>(
                    userId || "",
                    authKey || "",
                    "/upcoming-episodes"
                ),
            muteShow: unavailable,
            unmuteShow: unavailable,
        };
    }, [userId, authKey]);
    if (!(isReady && userId && authKey)) {
        return null;
    }
    return (
        <UpcomingEpisodesPanel
            client={client}
            householdActions={false}
            key={userId}
            renderDetail={(item, onClose) => (
                <PersonalMediaDetailModal
                    authKey={authKey}
                    item={{
                        id: item.showId,
                        name: item.showName || "Upcoming episode",
                        poster: item.poster,
                        type: item.mediaType || "series",
                    }}
                    onChange={unchanged}
                    onClose={onClose}
                    userId={userId}
                />
            )}
        />
    );
}
