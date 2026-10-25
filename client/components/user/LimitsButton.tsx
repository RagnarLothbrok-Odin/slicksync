"use client";

// "Limits": someone's daily limit, bedtime and age limit in one popup - three
// cards with a switch each. On a person's page beside Caught up to, on each
// card on the Users page (just before Synced), and under each Nuvio profile
// and household user there, where a merged profile has limits of its own
// (server/utils/screenSubjects.js).
//
// On the Users page the pill's colour comes from the page's one overview of
// who has limits (api.getLimitsOverview), so a page of cards asks the server
// once, not once per card; on a person's page it reads its own. Opening it
// reads the rest.

import { AdjustmentsHorizontalIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ActionPill, type ActionPillTone } from "@/components/user/ActionPill";
import { AgeLimitCard, ageLimitLabel } from "@/components/user/AgeLimitCard";
import { ScreenTimePanel } from "@/components/user/ScreenTimePanel";
import { type PopupPlacement, placePopup, popupStyle, useFitPopup } from "@/lib/anchoredPopup";
import { type AgeLimitView, api, type LimitsSummary, type ScreenTimeView } from "@/lib/api";

export function LimitsButton({
    id,
    name,
    summary,
    size = "sm",
    onPickGroup,
    onReconnect,
}: {
    /** A person's id, or a merged profile's (its limitId). */
    id: string;
    name: string;
    /** From the page's overview; left out, the pill reads its own state. */
    summary?: LimitsSummary | null;
    /** 'sm' beside the small badges on a card or tile, 'md' among a person page's pills. */
    size?: "sm" | "md";
    onPickGroup?: () => void;
    onReconnect?: () => void;
}) {
    const button = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const [anchor, setAnchor] = useState<PopupPlacement | null>(null);
    // What the popup - or, without an overview, the pill itself - last read.
    const [screen, setScreen] = useState<ScreenTimeView | null>(null);
    const [age, setAge] = useState<AgeLimitView | null>(null);

    useEffect(() => {
        if (summary !== undefined) {
            return;
        }
        api.getScreenTime(id)
            .then(setScreen)
            .catch(() => undefined);
        api.getAgeLimit(id)
            .then(setAge)
            .catch(() => undefined);
    }, [id, summary === undefined]);

    const open = !!anchor;
    const close = () => setAnchor(null);
    const place = () => {
        const r = button.current?.getBoundingClientRect();
        if (!r) {
            return null;
        }
        return placePopup(r, 360, panel.current?.scrollHeight);
    };
    const toggleOpen = () => {
        if (open) {
            close();
            return;
        }
        const at = place();
        if (at) {
            setAnchor(at);
        }
    };
    useFitPopup(panel, open, () => {
        const at = place();
        if (at) {
            setAnchor(at);
        }
    });

    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                close();
            }
        };
        const onMove = () => {
            const at = place();
            if (at) {
                setAnchor(at);
            }
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("resize", onMove);
        window.addEventListener("scroll", onMove, true);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("resize", onMove);
            window.removeEventListener("scroll", onMove, true);
        };
    }, [open]);

    const paused = screen ? screen.paused : summary?.paused || null;
    const limitMinutes = screen?.limit?.minutes || 0;
    const reached =
        !!limitMinutes && !!screen?.appliesToday && (screen?.todayMinutes ?? 0) >= limitMinutes;
    const on = screen || age ? !!screen?.limit || age?.current != null : !!summary?.on;
    const tone: ActionPillTone = paused || reached ? "warn" : on ? "on" : "neutral";
    const title = paused
        ? `Paused until ${paused.untilLabel}`
        : reached
          ? "Past today’s limit"
          : on
            ? "Limits are on"
            : "No limits";
    const ageLabel = ageLimitLabel(age);

    return (
        // A card or tile underneath may react to clicks, right-clicks and keys of
        // its own; nothing done here - in the pill or its popup, whose backdrop
        // covers the whole page - reaches it. (React passes a portal's events up
        // through the component that rendered it, so a right-click anywhere
        // while the popup was open used to open the card's own menu.)
        <span
            className="inline-flex min-w-0 max-w-full"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            role="none"
        >
            <ActionPill
                icon={AdjustmentsHorizontalIcon}
                onClick={toggleOpen}
                open={open}
                ref={button}
                size={size}
                title={title}
                tone={tone}
            >
                Limits
            </ActionPill>
            {open &&
                anchor &&
                typeof document !== "undefined" &&
                createPortal(
                    <>
                        <button
                            aria-label="Close popup"
                            className="fixed inset-0 z-[9998] border-0 bg-transparent p-0"
                            onClick={close}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                close();
                            }}
                            tabIndex={-1}
                            type="button"
                        />
                        <div
                            aria-label={`Limits for ${name}`}
                            className="fixed z-[9999] rounded-2xl border border-default p-4 shadow-2xl"
                            ref={panel}
                            role="dialog"
                            style={{ ...popupStyle(anchor), background: "var(--color-surface)" }}
                        >
                            <ScreenTimePanel
                                after={
                                    <AgeLimitCard
                                        name={name}
                                        onChange={setAge}
                                        onClose={close}
                                        userId={id}
                                    />
                                }
                                alsoOn={ageLabel ? `nothing rated above ${ageLabel}` : null}
                                name={name}
                                onChange={setScreen}
                                onClose={close}
                                onPickGroup={onPickGroup}
                                onReconnect={onReconnect}
                                userId={id}
                            />
                        </div>
                    </>,
                    document.body
                )}
        </span>
    );
}
