"use client";

import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    type ComponentType,
    Fragment,
    type ReactNode,
    useEffect,
    useId,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { TVFocusable } from "@/components/tv/TVFocusable";
import { ScrollRow } from "@/components/ui/ScrollRow";
import { SlickSyncLogo } from "@/components/ui/SlickSyncLogo";
import { useIsTV } from "@/lib/hooks/useIsTV";

function isNavItemActive(pathname: string, href: string, homeHref = "/") {
    if (href === homeHref) {
        return pathname === homeHref;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
}

export interface NebulaNavSection {
    id: string;
    items: { href: string; label: string; icon: ComponentType<{ className?: string }> }[];
}

function subscribeToViewport(onChange: () => void) {
    const query = window.matchMedia("(max-width: 1279px)");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
}
const compactViewport = () => window.matchMedia("(max-width: 1279px)").matches;
const serverViewport = () => false;

/** Shared admin and personal navigation. TV keeps every destination visible;
 * touch screens open an explicit menu, while desktop collapses on scroll. */
export function NebulaBar({
    sections,
    homeHref,
    menu,
    account,
}: {
    sections: NebulaNavSection[];
    homeHref: string;
    menu: { isOpen: boolean; onOpen: () => void; onClose: () => void };
    account: ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const isTV = useIsTV();
    const reduceMotion = useReducedMotion();
    const navId = useId();
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const [isScrolled, setIsScrolled] = useState(false);
    const isCompact = useSyncExternalStore(subscribeToViewport, compactViewport, serverViewport);
    const { isOpen, onOpen, onClose } = menu;

    useEffect(() => {
        if (isTV) {
            return;
        }
        // Hysteresis exceeds the space released by the nav. A collapse cannot
        // clamp the scroll position past the expand threshold and oscillate.
        let collapsed = window.scrollY > 160;
        let frame = requestAnimationFrame(() => setIsScrolled(collapsed));
        const onScroll = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const next = collapsed ? window.scrollY > 8 : window.scrollY > 160;
                if (next !== collapsed) {
                    collapsed = next;
                    setIsScrolled(next);
                }
            });
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("scroll", onScroll);
        };
    }, [isTV]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
                menuButtonRef.current?.focus();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isOpen, onClose]);

    const navVisible = isTV || isOpen || !(isCompact || isScrolled);
    const showMenu = !isTV && (isCompact || isScrolled);

    return (
        <>
            {/* The action cluster measures these two anchors when the page title
          scrolls out of view. Keep the logo row clear at the right edge. */}
            <header
                className={`interface-topbar sticky top-0 z-30 ${isTV ? "interface-topbar-tv" : ""}`}
                data-menu-open={isOpen}
                data-navigation-expanded={navVisible}
                data-nebula-topbar
            >
                <div className="nebula-bar-panel interface-nav-material">
                    <div
                        className="interface-brand-row relative flex items-center"
                        data-nebula-logo-row
                    >
                        {showMenu && (
                            <button
                                aria-controls={navId}
                                aria-expanded={isOpen}
                                aria-label={isOpen ? "Close navigation" : "Open navigation"}
                                className="interface-menu-button flex shrink-0 items-center justify-center rounded-xl"
                                onClick={isOpen ? onClose : onOpen}
                                ref={menuButtonRef}
                                type="button"
                            >
                                {isOpen ? (
                                    <XMarkIcon className="h-5 w-5" />
                                ) : (
                                    <Bars3Icon className="h-5 w-5" />
                                )}
                            </button>
                        )}
                        <Link
                            aria-label="SlickSync home"
                            className="interface-brand inline-flex min-w-0 items-center gap-2.5"
                            href={homeHref}
                        >
                            <span className="interface-brand-mark flex shrink-0 items-center justify-center rounded-xl">
                                <SlickSyncLogo className="h-5 w-5" />
                            </span>
                            <span className="font-semibold text-base text-default tracking-tight">
                                SlickSync
                            </span>
                        </Link>
                    </div>
                    <AnimatePresence initial={false}>
                        {navVisible && (
                            <motion.nav
                                animate={{ opacity: 1 }}
                                aria-label="Main navigation"
                                className="interface-main-nav overflow-hidden"
                                exit={{ opacity: 0 }}
                                id={navId}
                                // Navigation shares a responsive grid with the brand and account.
                                // Avoid retaining a measured height across hydration and reloads.
                                initial={false}
                                transition={
                                    reduceMotion
                                        ? { duration: 0 }
                                        : { bounce: 0, duration: 0.3, type: "spring" }
                                }
                            >
                                <div className="interface-nav-sections">
                                    {sections.map((section) => (
                                        <ScrollRow
                                            className={`interface-nav-row interface-nav-${section.id} flex w-full flex-nowrap items-center gap-1`}
                                            key={section.id}
                                        >
                                            {section.items.map((link) => {
                                                const active = isNavItemActive(
                                                    pathname,
                                                    link.href,
                                                    homeHref
                                                );
                                                const Icon = link.icon;
                                                const navLink = (
                                                    <Link
                                                        aria-current={active ? "page" : undefined}
                                                        className={`interface-nav-link nav-item-hover-pill flex items-center gap-2 whitespace-nowrap rounded-xl ${active ? "nebula-link-on" : "text-muted"}`}
                                                        href={link.href}
                                                        onClick={onClose}
                                                        tabIndex={isTV ? -1 : undefined}
                                                    >
                                                        <Icon className="h-4 w-4 shrink-0" />
                                                        {link.label}
                                                    </Link>
                                                );
                                                // Fresh nodes avoid stale hover paint after navigation in
                                                // Firefox. Norigin still owns activation on TV remotes.
                                                return isTV ? (
                                                    <TVFocusable
                                                        key={`${link.href}-${pathname}`}
                                                        onEnterPress={() => router.push(link.href)}
                                                    >
                                                        {navLink}
                                                    </TVFocusable>
                                                ) : (
                                                    <Fragment key={`${link.href}-${pathname}`}>
                                                        {navLink}
                                                    </Fragment>
                                                );
                                            })}
                                        </ScrollRow>
                                    ))}
                                </div>
                            </motion.nav>
                        )}
                    </AnimatePresence>
                    <div className="interface-account">{account}</div>
                </div>
            </header>
        </>
    );
}
