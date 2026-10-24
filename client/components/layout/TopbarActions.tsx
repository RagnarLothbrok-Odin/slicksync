"use client";

import { XMarkIcon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ResumeTourIcon } from "@/components/ui/icons/ResumeTourIcon";
import { WizardBooksIcon } from "@/components/ui/icons/WizardBooksIcon";
import { FLOATING_ICON_STYLE, NotificationsDropdown } from "@/components/ui/NotificationsDropdown";
import { openCommandPalette } from "@/lib/commandPaletteBus";
import {
    completeOnboarding,
    isOnboardingUnfinished,
    ONBOARDING_PAUSED_CHANGED_EVENT,
    ONBOARDING_RESUME_EVENT,
    ONBOARDING_VISIBILITY_EVENT,
} from "@/lib/onboardingStorage";

interface TopbarActionsProps {
    // Only the sidebar Header passes these through; the Nebula copy renders
    // the bell with no preloaded data, same as before.
    activities?: any[];
    inviteHistory?: any[];
    taskHistory?: any[];
}

// Gap between the bottom of the sticky nav bar and the pinned cluster.
const FLOAT_GAP = 8;
// Fallback pin position for layouts with no `data-nebula-topbar` bar to
// measure against (the sidebar Header, which has its own fixed chrome).
const FALLBACK_FLOAT_TOP = 12;
// Wherever there is a Nebula bar, the cluster docks INSIDE its logo row,
// at the far end from the hamburger, rather than floating under it: the
// floating pair sat over the page's own controls - a person's pills, the
// Users Add button, Discover's Show and Sort - and clicks meant for them hit
// the bell instead. Phones first, then the PC too, in the same spot.
// Docked, how far the cluster sits in from the bar card's right edge: into
// the card's padding, so it isn't crowding the centred logo.
const DOCK_EDGE_INSET = 8;

// The topbar's right-hand cluster: command palette, then notifications.
// Grouped into one component because the resume-tour prompt deliberately
// sits ON TOP of both of them - it has to be dismissed before either can
// be clicked, which only works if they share a positioning context.
//
// Renders the same on every screen size. Mobile briefly hid the command
// palette here, back when its bell lived in a separate fixed corner pill
// too tight to fit both; that pill is gone and the two platforms now share
// one cluster in one place, so there's no per-platform variant to keep in
// sync.
//
// The cluster sits inline in the page heading at rest, then docks inside
// the sticky nav's logo row once that spot scrolls past (or, in the sidebar
// layout, which has no such row, pins itself near the top). Without this it
// scrolled away entirely, which mattered most on mobile: there's no Ctrl+K
// on a phone, so this button is the only way into the command palette, and
// on a long page (Discover's infinite scroll especially) it was unreachable
// without scrolling all the way back to the top.
export function TopbarActions({ activities, inviteHistory, taskHistory }: TopbarActionsProps) {
    // Shown for the whole time the tour is unfinished - not only after it was
    // paused via one of its own links - and stays until the prompt's own X
    // dismisses it for good.
    const [unfinished, setUnfinished] = useState(false);
    const [wizardOpen, setWizardOpen] = useState(false);
    const showPrompt = unfinished && !wizardOpen;
    // Read inside measure(), which is deliberately dependency-free so the
    // scroll listener is attached once and never torn down/re-attached. A ref
    // lets that stable callback still see the current value.
    const showPromptRef = useRef(showPrompt);
    // Holds the cluster's place in the page-heading flow. Keeping a
    // same-sized box here is what stops the heading row from collapsing (and
    // everything beside it jumping sideways) the moment the buttons leave the
    // flow to pin themselves.
    const placeholderRef = useRef<HTMLDivElement>(null);
    // The buttons themselves - inline or pinned. The resume prompt tracks
    // THIS, not the placeholder, so it follows the buttons while they're
    // pinned instead of sitting over an empty gap up the page.
    const buttonsRef = useRef<HTMLDivElement>(null);
    // docked: inside the bar's logo row (phones) rather than floating under it.
    const [pinned, setPinned] = useState<{ top: number; right: number; docked: boolean } | null>(
        null
    );
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        const sync = () => setUnfinished(isOnboardingUnfinished());
        sync();
        const onVisibility = (e: Event) => {
            setWizardOpen(Boolean((e as CustomEvent<{ open: boolean }>).detail?.open));
            sync();
        };
        // The topbar persists across client-side navigation and never
        // remounts, so it needs explicit signals to re-read.
        window.addEventListener(ONBOARDING_PAUSED_CHANGED_EVENT, sync);
        window.addEventListener(ONBOARDING_VISIBILITY_EVENT, onVisibility);
        window.addEventListener("storage", sync);
        return () => {
            window.removeEventListener(ONBOARDING_PAUSED_CHANGED_EVENT, sync);
            window.removeEventListener(ONBOARDING_VISIBILITY_EVENT, onVisibility);
            window.removeEventListener("storage", sync);
        };
    }, []);

    // Decides pinned vs inline, and re-measures the prompt's anchor. Both are
    // driven off the placeholder, which stays in normal flow and so always
    // reports where the cluster WOULD be - the pinned buttons can't be used
    // for that, since once they're fixed their own rect stops moving and the
    // condition to unpin could never become true again.
    const measure = useCallback(() => {
        const holder = placeholderRef.current;
        if (!holder) {
            return;
        }
        const natural = holder.getBoundingClientRect();

        // Measured every time rather than cached: this bar collapses its nav
        // links into a hamburger once scrolled, so its height genuinely
        // changes between the top of the page and everywhere else.
        const bar = document.querySelector("[data-nebula-topbar]");
        const floatTop = bar ? bar.getBoundingClientRect().bottom + FLOAT_GAP : FALLBACK_FLOAT_TOP;

        // Every setState below is guarded on the value actually changing. This
        // runs on each scroll frame, and returning a fresh object each time
        // would re-render the whole cluster (and the bell's subtree) for the
        // entire length of a scroll even when nothing moved.
        // The expanded desktop row uses the space next to the account button
        // for destinations. Dock only after those links have collapsed; until
        // then the inline controls scroll behind the bar with their heading.
        const canDock =
            !bar ||
            (bar.getAttribute("data-navigation-expanded") !== "true" &&
                !bar.querySelector(".interface-main-nav"));
        if (natural.top < floatTop && canDock) {
            // Centred on the logo row, near the bar card's right edge.
            const row = document.querySelector("[data-nebula-logo-row]");
            const rr = row?.getBoundingClientRect();
            const card = row?.parentElement?.getBoundingClientRect();
            const edge = card ? card.right - DOCK_EDGE_INSET - 52 : (rr?.right ?? 0);
            // A fixed element's `right` counts from the page's visible width, which
            // excludes a desktop-style scrollbar; innerWidth would include it and
            // shift the buttons left by the scrollbar's width.
            const viewW = document.documentElement.clientWidth;
            const next = rr
                ? {
                      docked: true,
                      right: Math.max(Math.round(viewW - edge), 0),
                      top: Math.round(rr.top + (rr.height - natural.height) / 2),
                  }
                : { docked: false, right: Math.max(viewW - natural.right, 0), top: floatTop };
            setSize((prev) =>
                prev && prev.width === natural.width && prev.height === natural.height
                    ? prev
                    : { height: natural.height, width: natural.width }
            );
            setPinned((prev) =>
                prev &&
                prev.top === next.top &&
                prev.right === next.right &&
                prev.docked === next.docked
                    ? prev
                    : next
            );
        } else {
            setPinned((prev) => (prev === null ? prev : null));
        }

        // Only the prompt uses this, and it's the expensive half (a second
        // getBoundingClientRect per frame), so skip it entirely when there's no
        // prompt on screen to position.
        if (!showPromptRef.current) {
            return;
        }
        const target = buttonsRef.current ?? holder;
        const r = target.getBoundingClientRect();
        const nextAnchor = {
            right: Math.max(document.documentElement.clientWidth - r.right, 12),
            top: Math.max(r.top, 12),
        };
        setAnchor((prev) =>
            prev && prev.top === nextAnchor.top && prev.right === nextAnchor.right
                ? prev
                : nextAnchor
        );
    }, []);

    // Keep the ref current and re-measure on the transition, so the prompt
    // gets an anchor the moment it appears rather than on the next scroll.
    useEffect(() => {
        showPromptRef.current = showPrompt;
        measure();
    }, [showPrompt, measure]);

    useEffect(() => {
        measure();
        let frame = 0;
        const onChange = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
        };
        // capture:true so this still fires for scrolls inside nested scroll
        // containers, not just the window.
        window.addEventListener("scroll", onChange, { capture: true, passive: true });
        window.addEventListener("resize", onChange);
        // Collapse, menu and viewport changes can move the target without a
        // new scroll event. Follow the bar's actual geometry and nav state.
        const bar = document.querySelector("[data-nebula-topbar]");
        const resize = new ResizeObserver(onChange);
        const mutation = new MutationObserver(onChange);
        if (bar) {
            resize.observe(bar);
            mutation.observe(bar, {
                attributeFilter: ["data-navigation-expanded"],
                attributes: true,
                childList: true,
                subtree: true,
            });
        }
        return () => {
            resize.disconnect();
            mutation.disconnect();
            cancelAnimationFrame(frame);
            window.removeEventListener("scroll", onChange, {
                capture: true,
            } as EventListenerOptions);
            window.removeEventListener("resize", onChange);
        };
    }, [measure]);

    const resume = () => window.dispatchEvent(new Event(ONBOARDING_RESUME_EVENT));

    // This X is the real dismissal - the wizard's own X is only "not now".
    const dismiss = () => completeOnboarding();

    const promptCard = (
        <div
            className="flex items-center gap-2 rounded-xl py-1.5 pr-1.5 pl-2"
            style={{
                background: "var(--color-surface)",
                border: "1px solid color-mix(in srgb, var(--color-primary) 45%, transparent)",
                boxShadow:
                    "0 10px 30px -8px rgba(0,0,0,0.6), 0 0 0 3px color-mix(in srgb, var(--color-primary) 18%, transparent)",
            }}
        >
            <ResumeTourIcon
                className="h-6 w-6 shrink-0"
                style={{ color: "var(--color-primary)" }}
            />
            <button
                className="whitespace-nowrap rounded-lg px-2.5 py-1.5 font-semibold text-xs transition-opacity hover:opacity-90"
                onClick={resume}
                style={{ background: "var(--color-primary)", color: "var(--color-bg)" }}
                type="button"
            >
                Resume tour
            </button>
            <button
                aria-label="Dismiss the tour"
                className="shrink-0 rounded-lg p-1 transition-colors hover:bg-surface-hover"
                onClick={dismiss}
                style={{ color: "var(--color-text-muted)" }}
                title="Dismiss - don't show this again"
                type="button"
            >
                <XMarkIcon className="h-4 w-4" />
            </button>
        </div>
    );

    // Floating over scrolling content (pinned under the bar, not docked in it)
    // is when the icons would be unreadable against posters and cards - so
    // each gets its own round backdrop then. Docked in the bar they sit on the
    // bar's own surface and look as they do inline.
    const floating = !!pinned && !pinned.docked;

    const buttons = (
        <div
            className={`flex items-center ${floating ? "gap-2" : "gap-0.5"}`}
            data-topbar-actions={pinned ? "pinned" : "inline"}
            ref={buttonsRef}
            // Above the bar (z-30) so docked buttons show on it.
            style={
                pinned
                    ? { position: "fixed", right: pinned.right, top: pinned.top, zIndex: 35 }
                    : undefined
            }
        >
            {/* Styled to match NotificationsDropdown's bell exactly - same
          padding, radius, muted colour and hover treatment - so the two
          read as one pair of peer controls rather than a button next to
          an icon. */}
            <button
                aria-label="Open the command palette"
                className={`p-2 transition-colors ${floating ? "rounded-full" : "hov-surface rounded-lg"}`}
                onClick={openCommandPalette}
                style={{
                    color: "var(--color-text-muted)",
                    ...(floating ? FLOATING_ICON_STYLE : {}),
                }}
                title="Search, jump to a page, or ask how to do something (Ctrl+K)"
                type="button"
            >
                <WizardBooksIcon className="h-5 w-5" />
            </button>

            <NotificationsDropdown
                activities={activities}
                floating={floating}
                inviteHistory={inviteHistory}
                taskHistory={taskHistory}
            />
        </div>
    );

    return (
        <div
            className="relative flex items-center justify-end"
            ref={placeholderRef}
            // Reserves the vacated space only while pinned, so the heading row
            // keeps its shape instead of reflowing as you scroll past.
            style={pinned && size ? { height: size.height, width: size.width } : undefined}
        >
            {buttons}

            {/* Prompt itself is portaled to <body> as position:fixed - it has to
          escape the heading row, which is normal page content and scrolls
          away, and it has to sit over BOTH buttons wherever they currently
          are (inline or pinned), which is why it tracks buttonsRef.
          The showPrompt check gates the PORTAL, not a child inside an
          AnimatePresence: with AnimatePresence the exit animation ran to
          opacity:0 but the node was never unmounted, leaving an invisible
          element still intercepting clicks on the bell underneath it
          (confirmed live 2026-08-21 - isConnected:true at opacity:0). An
          entry-only animation that reliably unmounts beats a 160ms fade
          that strands a click-blocker on the page. */}
            {mounted &&
                anchor &&
                showPrompt &&
                createPortal(
                    <motion.div
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        initial={{ opacity: 0, scale: 0.94, y: -4 }}
                        style={{
                            position: "fixed",
                            right: anchor.right,
                            top: anchor.top,
                            zIndex: 60,
                        }}
                        transition={{ duration: 0.16 }}
                    >
                        {promptCard}
                    </motion.div>,
                    document.body
                )}
        </div>
    );
}
