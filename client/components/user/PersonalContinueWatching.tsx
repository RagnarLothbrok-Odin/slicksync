"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ContinueWatchingCard } from "@/components/ui/ContinueWatchingCard";
import { ContinueWatchingSection } from "@/components/ui/ContinueWatchingSection";
import { toast } from "@/components/ui/Toast";
import type { ContinueWatchingItem } from "@/lib/api";
import { useDragScroll } from "@/lib/hooks/useDragScroll";
import { useUserAuthHeaders } from "@/lib/hooks/useUserAuth";
import { personalRequest } from "@/lib/user-api";
import { PersonalMediaDetailModal } from "./PersonalMediaDetailModal";

export function PersonalContinueWatching() {
    const { userId, authKey, isReady } = useUserAuthHeaders();
    const [items, setItems] = useState<ContinueWatchingItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [menu, setMenu] = useState<string | null>(null);
    const [selected, setSelected] = useState<ContinueWatchingItem | null>(null);
    const wasDraggedRef = useRef(false);
    const drag = useDragScroll();
    const unchanged = useCallback(() => undefined, []);

    useEffect(() => {
        if (!(isReady && userId && authKey)) {
            return;
        }
        let active = true;
        setItems([]);
        setSelected(null);
        setMenu(null);
        setLoading(true);
        const load = async () => {
            try {
                const result = await personalRequest<{ items: ContinueWatchingItem[] }>(
                    userId,
                    authKey,
                    "/continue-watching"
                );
                if (active) {
                    setItems(result.items);
                    setError(false);
                }
            } catch {
                if (active) {
                    setError(true);
                }
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };
        void load();
        const timer = window.setInterval(() => {
            if (!document.hidden) {
                void load();
            }
        }, 30_000);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, [userId, authKey, isReady]);

    const dismiss = async (item: ContinueWatchingItem) => {
        if (!(userId && authKey)) {
            return;
        }
        try {
            await personalRequest(userId, authKey, "/continue-watching/dismiss", {
                body: JSON.stringify({ showId: item.showId }),
                method: "POST",
            });
            setItems((current) => current.filter((row) => row.showId !== item.showId));
            toast.success("Removed from Continue Watching. Your watch history is kept.");
        } catch {
            toast.error("Could not remove this title. Please try again.");
        }
    };

    // Match the household dashboard: only show the section when titles exist.
    if (loading || error || items.length === 0) {
        return null;
    }

    return (
        <ContinueWatchingSection>
            <div
                ref={drag.ref}
                {...drag.handlers}
                className="no-scrollbar paint-isolated flex cursor-grab gap-3 overflow-x-auto pb-1 active:cursor-grabbing"
            >
                {items.map((item, index) => (
                    <ContinueWatchingCard
                        cacheImages={false}
                        isMenuOpen={menu === `${item.userId}-${item.showId}`}
                        item={item}
                        key={`${item.userId}-${item.showId}`}
                        onMenuOpenChange={(open, key) => setMenu(open ? key : null)}
                        onOpenDetails={setSelected}
                        onRemove={dismiss}
                        priority={index < 6}
                        removalMessage={null}
                        wasDraggedRef={wasDraggedRef}
                    />
                ))}
            </div>
            {selected && userId && authKey && (
                <PersonalMediaDetailModal
                    authKey={authKey}
                    item={{
                        id: selected.showId,
                        imdbRating: selected.imdbRating,
                        name: selected.showName,
                        poster: selected.poster,
                        type: selected.contentType,
                    }}
                    onChange={unchanged}
                    onClose={() => setSelected(null)}
                    userId={userId}
                />
            )}
        </ContinueWatchingSection>
    );
}
