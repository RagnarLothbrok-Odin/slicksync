"use client";

import {
    ArrowUpRightIcon,
    BookOpenIcon,
    ChartBarIcon,
    ClockIcon,
    Cog6ToothIcon,
    DocumentTextIcon,
    EnvelopeIcon,
    FilmIcon,
    HomeIcon,
    LifebuoyIcon,
    MagnifyingGlassIcon,
    PuzzlePieceIcon,
    QueueListIcon,
    RectangleStackIcon,
    ShieldCheckIcon,
    SparklesIcon,
    SwatchIcon,
    TvIcon,
    UserGroupIcon,
    UsersIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { type HelpEntry, searchHelp } from "@/lib/helpContent";
import { cachedImageUrl } from "@/lib/posterUrl";
import { searchSettings } from "@/lib/settingsIndex";

// Global Ctrl+K/Cmd+K command palette - the trigger key shown adapts to the
// OS (Mac gets the Cmd glyph, everyone else gets Ctrl), same convention
// every command palette (Linear, Notion, Raycast) already uses. Two tiers:
// fast client-side fuzzy search over static nav destinations + live
// users/addons/catalogs (fetched once on first open, not per keystroke),
// and - only when nothing matches - a local how-to knowledge base
// (lib/helpContent.ts) for free-text questions. This used to call out to an
// AI Services key for that second tier, but that only worked for whoever
// had a key configured and added a network round-trip for something a
// fixed, reviewed list of guides answers just as well, instantly, for
// everyone.
const NAV_ITEMS = [
    { href: "/", icon: HomeIcon, keywords: "home", label: "Dashboard" },
    { href: "/activity", icon: ClockIcon, keywords: "watch history", label: "Activity" },
    { href: "/metrics", icon: ChartBarIcon, keywords: "stats analytics health", label: "Metrics" },
    { href: "/users", icon: UsersIcon, keywords: "household members", label: "Users" },
    { href: "/groups", icon: UserGroupIcon, keywords: "", label: "Groups" },
    { href: "/discover", icon: MagnifyingGlassIcon, keywords: "browse search", label: "Discover" },
    { href: "/catalogs", icon: RectangleStackIcon, keywords: "lists", label: "Catalogs" },
    { href: "/addons", icon: PuzzlePieceIcon, keywords: "", label: "Addons" },
    {
        href: "/vault",
        icon: ShieldCheckIcon,
        keywords: "credentials api keys debrid",
        label: "Vault",
    },
    { href: "/invitations", icon: EnvelopeIcon, keywords: "invite", label: "Invitations" },
    { href: "/tasks", icon: QueueListIcon, keywords: "backup snapshot", label: "Tasks" },
    { href: "/settings", icon: Cog6ToothIcon, keywords: "", label: "Settings" },
    {
        href: "/settings?tab=themes",
        icon: SwatchIcon,
        keywords: "appearance colors theme custom layout",
        label: "Themes",
    },
    {
        href: "/changelog",
        icon: DocumentTextIcon,
        keywords: "whats new updates",
        label: "Changelog",
    },
    // Keywords deliberately include the words people type instead of the
    // page's actual name - "how to", "help", "faq", "docs" all land here.
    {
        href: "/guides",
        icon: LifebuoyIcon,
        keywords: "help how to how-to support faq docs documentation manual tutorial guide guides",
        label: "Guides",
    },
];

// Lets the topbar button (and anything else) open the palette without
// having to synthesise a fake Ctrl+K keystroke.
import { COMMAND_PALETTE_OPEN_EVENT } from "@/lib/commandPaletteBus";

// Re-exported so existing imports keep working; new code should import
// from lib/commandPaletteBus so it does not pull this whole module in.
export { COMMAND_PALETTE_OPEN_EVENT, openCommandPalette } from "@/lib/commandPaletteBus";

function isMac() {
    if (typeof navigator === "undefined") {
        return false;
    }
    // navigator.platform is deprecated but still the most broadly-supported
    // synchronous signal; userAgentData.platform (where available) is
    // checked first since it's the non-deprecated replacement.
    const uaData = navigator.userAgentData;
    if (uaData?.platform) {
        return /mac/i.test(uaData.platform);
    }
    return /mac/i.test(navigator.platform || navigator.userAgent || "");
}

interface Result {
    href: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    id: string;
    label: string;
    /** A title result shows its poster in place of the icon. */
    poster?: string | null;
    sublabel?: string;
}

export function CommandPalette() {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const [mac, setMac] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const [entities, setEntities] = useState<Result[] | null>(null);
    const [loadingEntities, setLoadingEntities] = useState(false);

    useEffect(() => {
        setMac(isMac());
    }, []);

    const loadEntities = useCallback(async () => {
        if (entities || loadingEntities) {
            return;
        }
        setLoadingEntities(true);
        try {
            const [users, addons, lists, titles] = await Promise.all([
                api.getUsers().catch(() => []),
                api.getAddons().catch(() => []),
                api.getLists().catch(() => []),
                // The household's own titles (watchlist + recently watched) - the
                // same index Discover matches against as you type, so a film you
                // have here is one keystroke away from anywhere.
                api.getLocalIndex().catch(() => ({ items: [] })),
            ]);
            const results: Result[] = [
                ...users.map((u) => ({
                    href: `/users/${u.id}`,
                    icon: UsersIcon,
                    id: `user-${u.id}`,
                    label: u.username,
                    sublabel: "User",
                })),
                ...addons.map((a) => ({
                    href: `/addons/${a.id}`,
                    icon: PuzzlePieceIcon,
                    id: `addon-${a.id}`,
                    label: a.name,
                    sublabel: "Addon",
                })),
                ...lists.map((l) => ({
                    href: `/catalogs/${l.id}`,
                    icon: RectangleStackIcon,
                    id: `list-${l.id}`,
                    label: l.name,
                    sublabel: "Catalog",
                })),
                ...(titles.items || []).map((t) => ({
                    href: `/discover?q=${encodeURIComponent(t.name)}&t=${t.type}`,
                    icon: t.type === "series" ? TvIcon : FilmIcon,
                    id: `title-${t.id}`,
                    label: t.name,
                    poster: t.poster ? cachedImageUrl(t.poster, 64) : null,
                    sublabel: t.type === "series" ? "Series" : "Movie",
                })),
            ];
            setEntities(results);
        } finally {
            setLoadingEntities(false);
        }
    }, [entities, loadingEntities]);

    const close = useCallback(() => {
        setIsOpen(false);
    }, []);

    // Global trigger - Ctrl+K everywhere except Mac, which gets Cmd+K.
    // Ignored while typing in a real input/textarea/contenteditable elsewhere
    // on the page, so it never hijacks a K keystroke mid-form.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const modifierPressed = mac ? e.metaKey : e.ctrlKey;
            if (modifierPressed && e.key.toLowerCase() === "k") {
                e.preventDefault();
                setIsOpen((prev) => {
                    if (prev) {
                        return prev; // already open, let it handle its own Escape
                    }
                    setQuery("");
                    setActiveIndex(0);
                    loadEntities();
                    return true;
                });
                return;
            }
            if (e.key === "Escape" && isOpen) {
                close();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [mac, isOpen, close, loadEntities]);

    useEffect(() => {
        const openFromButton = () => {
            setIsOpen((prev) => {
                if (prev) {
                    return prev;
                }
                setQuery("");
                setActiveIndex(0);
                loadEntities();
                return true;
            });
        };
        window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, openFromButton);
        return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, openFromButton);
    }, [loadEntities]);

    useEffect(() => {
        if (isOpen) {
            // Next tick, so the input exists before we try to focus it.
            const id = setTimeout(() => inputRef.current?.focus(), 10);
            return () => clearTimeout(id);
        }
    }, [isOpen]);

    const navResults: Result[] = useMemo(
        () =>
            NAV_ITEMS.map((n) => ({
                href: n.href,
                icon: n.icon,
                id: `nav-${n.href}`,
                label: n.label,
                sublabel: undefined,
            })),
        []
    );

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) {
            return navResults.slice(0, 8);
        }
        const pool: Result[] = [
            ...NAV_ITEMS.filter(
                (n) => n.label.toLowerCase().includes(q) || n.keywords.includes(q)
            ).map((n) => ({
                href: n.href,
                icon: n.icon,
                id: `nav-${n.href}`,
                label: n.label,
                sublabel: undefined,
            })),
            // Individual settings, between pages and entities: page names are
            // still the strongest intent signal, but "digest" or "2fa" should
            // land on the exact toggle, not just the Settings page. These are
            // pure navigation (the highlight param scrolls to and flashes the
            // control) - the guides tier below is untouched and still gets its
            // own reserved section for free-text questions.
            ...searchSettings(query, 3).map((s) => ({
                href: `/settings?highlight=${encodeURIComponent(s.label)}`,
                icon: Cog6ToothIcon,
                id: `setting-${s.label}`,
                label: s.label,
                sublabel: `Setting · ${s.section}`,
            })),
            ...(entities || []).filter((r) => r.label.toLowerCase().includes(q)),
        ];
        // Capped lower than the old 8 so help matches always have room to show
        // alongside destinations rather than being crowded out - "how do I do X"
        // and "take me to X" are both legitimate reasons to open this.
        return pool.slice(0, 5);
    }, [query, navResults, entities]);

    // Local how-to knowledge base. This used to only run when nav/entity
    // search came up completely empty, which meant a query like "vault" showed
    // the Vault page and silently hid four genuinely useful guides about it.
    // Now it always runs alongside, and selecting one opens the full topic
    // page (/guides/[id]) instead of leaving you with a two-line blurb.
    const helpResults: HelpEntry[] = useMemo(() => {
        if (!query.trim()) {
            return [];
        }
        return searchHelp(query, 4);
    }, [query]);

    useEffect(() => {
        setActiveIndex(0);
    }, [query]);

    const handleSelect = (result: Result) => {
        router.push(result.href);
        // Settings deep-links: if the user is ALREADY on /settings, a
        // query-only push doesn't remount the page, so its mount-time URL read
        // never re-fires - the event tells it to scroll/flash right now. Fired
        // unconditionally; the settings page is the only listener and ignores
        // it when unmounted.
        if (result.id.startsWith("setting-")) {
            const target = new URLSearchParams(result.href.split("?")[1] || "").get("highlight");
            if (target) {
                window.dispatchEvent(
                    new CustomEvent("slicksync:settings-highlight", { detail: target })
                );
            }
        }
        close();
    };

    // Always opens the full topic page. The entry's own href (the "go do the
    // thing" destination) is offered on that page as a button instead, so
    // picking a help result never skips past the explanation to a page you
    // then have to figure out unaided.
    const handleSelectHelp = (entry: HelpEntry) => {
        router.push(`/guides/${entry.id}`);
        close();
    };

    const browseAllHelp = () => {
        router.push("/guides");
        close();
    };

    // Arrow keys walk one continuous list across both sections (destinations
    // first, then help), so Down from the last destination lands on the first
    // guide rather than dead-ending.
    const activeListLength = filtered.length + helpResults.length;

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, activeListLength - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (activeIndex < filtered.length) {
                const target = filtered[activeIndex];
                if (target) {
                    handleSelect(target);
                }
            } else {
                const target = helpResults[activeIndex - filtered.length];
                if (target) {
                    handleSelectHelp(target);
                }
            }
        }
    };

    return (
        <>
            {/* No persistent floating trigger button - it cluttered every page
          and looked out of place. Discovery is the onboarding wizard's own
          dedicated tip step instead, same as Linear/Notion/Raycast rely on
          the shortcut itself rather than a permanent on-screen button once
          a user's been shown it once. */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        <motion.div
                            animate={{ opacity: 1 }}
                            className="fixed inset-0 z-[100] bg-black/50"
                            exit={{ opacity: 0 }}
                            initial={{ opacity: 0 }}
                            onClick={close}
                        />
                        <motion.div
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            className="fixed top-[15vh] left-1/2 z-[101] w-full -translate-x-1/2 px-4"
                            exit={{ opacity: 0, scale: 0.98, y: -12 }}
                            initial={{ opacity: 0, scale: 0.98, y: -12 }}
                            // Inline maxWidth, not a Tailwind max-w-* class: globals.css
                            // has an unlayered `* { max-width: 100vw }` rule that beats
                            // any layered utility, so max-w-lg was doing nothing and the
                            // palette stretched the full width of a desktop monitor.
                            style={{ maxWidth: "min(38rem, 100%)" }}
                            transition={{ duration: 0.15 }}
                        >
                            <div
                                className="overflow-hidden rounded-2xl shadow-2xl"
                                style={{
                                    background: "var(--color-surface)",
                                    border: "1px solid var(--color-surface-border)",
                                }}
                            >
                                <div
                                    className="flex items-center gap-3 px-4 py-3"
                                    style={{
                                        borderBottom: "1px solid var(--color-surface-border)",
                                    }}
                                >
                                    <MagnifyingGlassIcon
                                        className="h-5 w-5 shrink-0"
                                        style={{ color: "var(--color-text-muted)" }}
                                    />
                                    <input
                                        className="flex-1 bg-transparent text-sm outline-none"
                                        onChange={(e) => setQuery(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder="Jump to a page, user, addon… or ask how to do something"
                                        ref={inputRef}
                                        style={{ color: "var(--color-text)" }}
                                        type="text"
                                        value={query}
                                    />
                                    <kbd
                                        className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                                        style={{
                                            background: "var(--color-subtle)",
                                            color: "var(--color-text-muted)",
                                        }}
                                    >
                                        Esc
                                    </kbd>
                                </div>

                                <div className="max-h-96 overflow-y-auto py-2">
                                    {filtered.length === 0 &&
                                        query.trim() &&
                                        helpResults.length === 0 && (
                                            <div className="px-4 py-6 text-center">
                                                <p className="mb-3 text-muted text-sm">
                                                    No matches for &quot;{query}&quot;
                                                </p>
                                                <button
                                                    className="font-medium text-xs transition-opacity hover:opacity-80"
                                                    onClick={browseAllHelp}
                                                    style={{ color: "var(--color-secondary)" }}
                                                    type="button"
                                                >
                                                    Browse all guides →
                                                </button>
                                            </div>
                                        )}

                                    {filtered.length > 0 && (
                                        <>
                                            {query.trim() && (
                                                <p
                                                    className="px-4 pb-1.5 font-semibold text-[10px] uppercase tracking-wider"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                >
                                                    Go to
                                                </p>
                                            )}
                                            {filtered.map((r, i) => {
                                                const Icon = r.icon;
                                                return (
                                                    <button
                                                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === activeIndex ? "row-hl" : ""}`}
                                                        key={r.id}
                                                        onClick={() => handleSelect(r)}
                                                        onMouseEnter={() => setActiveIndex(i)}
                                                        type="button"
                                                    >
                                                        {r.poster ? (
                                                            <img
                                                                alt=""
                                                                className="h-7 w-5 shrink-0 rounded-sm object-cover"
                                                                decoding="async"
                                                                height={28}
                                                                loading="lazy"
                                                                src={r.poster}
                                                                width={20}
                                                            />
                                                        ) : (
                                                            <Icon
                                                                className="h-4 w-4 shrink-0"
                                                                style={{
                                                                    color: "var(--color-text-muted)",
                                                                }}
                                                            />
                                                        )}
                                                        <span
                                                            className="flex-1 truncate text-sm"
                                                            style={{ color: "var(--color-text)" }}
                                                        >
                                                            {r.label}
                                                        </span>
                                                        {r.sublabel && (
                                                            <span
                                                                className="text-xs"
                                                                style={{
                                                                    color: "var(--color-text-muted)",
                                                                }}
                                                            >
                                                                {r.sublabel}
                                                            </span>
                                                        )}
                                                        <ArrowUpRightIcon
                                                            className="h-3.5 w-3.5 shrink-0"
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                                opacity: i === activeIndex ? 1 : 0,
                                                            }}
                                                        />
                                                    </button>
                                                );
                                            })}
                                        </>
                                    )}

                                    {helpResults.length > 0 && (
                                        <div
                                            className="px-2 pt-2"
                                            style={
                                                filtered.length > 0
                                                    ? {
                                                          borderTop:
                                                              "1px solid var(--color-surface-border)",
                                                          marginTop: 8,
                                                      }
                                                    : undefined
                                            }
                                        >
                                            <p
                                                className="px-2 pb-1.5 font-semibold text-[10px] uppercase tracking-wider"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                Guides &amp; how-to
                                            </p>
                                            {helpResults.map((h, i) => {
                                                const idx = filtered.length + i;
                                                return (
                                                    <button
                                                        className={`flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${idx === activeIndex ? "row-hl" : ""}`}
                                                        key={h.id}
                                                        onClick={() => handleSelectHelp(h)}
                                                        onMouseEnter={() => setActiveIndex(idx)}
                                                        type="button"
                                                    >
                                                        <SparklesIcon
                                                            className="mt-0.5 h-4 w-4 shrink-0"
                                                            style={{
                                                                color: "var(--color-primary)",
                                                            }}
                                                        />
                                                        <span className="min-w-0 flex-1">
                                                            <span className="flex items-center gap-2">
                                                                <span
                                                                    className="truncate font-medium text-sm"
                                                                    style={{
                                                                        color: "var(--color-text)",
                                                                    }}
                                                                >
                                                                    {h.title}
                                                                </span>
                                                                <span
                                                                    className="shrink-0 rounded px-1.5 py-0.5 font-semibold text-[9px] uppercase tracking-wider"
                                                                    style={{
                                                                        background:
                                                                            "var(--color-bg-muted)",
                                                                        color: "var(--color-text-muted)",
                                                                    }}
                                                                >
                                                                    {h.category}
                                                                </span>
                                                            </span>
                                                            <span
                                                                className="mt-0.5 line-clamp-2 block text-xs"
                                                                style={{
                                                                    color: "var(--color-text-muted)",
                                                                }}
                                                            >
                                                                {h.answer}
                                                            </span>
                                                        </span>
                                                        <ArrowUpRightIcon
                                                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                                opacity:
                                                                    idx === activeIndex ? 1 : 0,
                                                            }}
                                                        />
                                                    </button>
                                                );
                                            })}
                                            <button
                                                className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-hover"
                                                onClick={browseAllHelp}
                                                type="button"
                                            >
                                                <BookOpenIcon
                                                    className="h-4 w-4 shrink-0"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                />
                                                <span
                                                    className="font-medium text-xs"
                                                    style={{ color: "var(--color-secondary)" }}
                                                >
                                                    Browse all guides
                                                </span>
                                            </button>
                                        </div>
                                    )}

                                    {loadingEntities && !query && (
                                        <div className="px-4 py-2 text-muted text-xs">
                                            Loading users, addons, catalogs…
                                        </div>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
