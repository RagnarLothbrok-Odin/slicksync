"use client";

import {
    ChevronRightIcon,
    LifebuoyIcon,
    MagnifyingGlassIcon,
    SparklesIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Breadcrumbs, Header } from "@/components/layout/Header";
import { NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { PageSection } from "@/components/layout/PageContainer";
import { Card } from "@/components/ui";
import { type HelpEntry, helpEntriesByCategory, searchHelp } from "@/lib/helpContent";
import { useLayoutMode } from "@/lib/layout-mode";

// The Guides index - the "browse everything" counterpart to the command
// palette's search-as-you-type. The palette answers a question you already
// know how to ask; this page is for when you don't know what to search for
// yet, which is exactly when a flat search box is useless and a categorised
// list isn't.
export default function GuidesPage() {
    const { layoutMode } = useLayoutMode();
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<string | null>(null);

    // With a query we show a flat ranked list (relevance beats category
    // grouping when you've actually asked for something specific); without
    // one, the full categorised browse.
    const results: HelpEntry[] | null = useMemo(() => {
        const q = query.trim();
        if (!q) {
            return null;
        }
        return searchHelp(q, 30);
    }, [query]);

    const grouped = useMemo(() => helpEntriesByCategory(), []);

    return (
        <>
            {layoutMode !== "nebula" && (
                <Header
                    title={
                        <Breadcrumbs
                            className="font-semibold text-xl"
                            items={[{ label: "Guides" }]}
                        />
                    }
                />
            )}
            <div className={layoutMode === "nebula" ? "px-4 pt-6 pb-8 md:px-6" : "p-8"}>
                <div
                    className={layoutMode === "nebula" ? "mx-auto" : ""}
                    style={
                        layoutMode === "nebula"
                            ? { maxWidth: "var(--interface-content-width)" }
                            : undefined
                    }
                >
                    {layoutMode === "nebula" && (
                        <NebulaPageHeading
                            subtitle="A little guidance, whenever you need it."
                            title="Guides"
                        />
                    )}

                    {/* Search */}
                    <PageSection className="mb-6" delay={0.05}>
                        <Card padding="lg">
                            <div className="flex items-center gap-3">
                                <MagnifyingGlassIcon
                                    className="h-5 w-5 shrink-0"
                                    style={{ color: "var(--color-text-muted)" }}
                                />
                                <input
                                    aria-label="Search guides"
                                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search help - try &quot;history missing&quot;, &quot;2fa&quot;, or &quot;auto remove&quot;"
                                    style={{ color: "var(--color-text)" }}
                                    type="search"
                                    value={query}
                                />
                                {query && (
                                    <button
                                        className="shrink-0 text-xs hover:opacity-80"
                                        onClick={() => setQuery("")}
                                        style={{ color: "var(--color-text-muted)" }}
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                            <p
                                className="mt-3 text-xs"
                                style={{ color: "var(--color-text-muted)" }}
                            >
                                Tip: press{" "}
                                <kbd
                                    className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                                    style={{ background: "var(--color-subtle)" }}
                                >
                                    Ctrl
                                </kbd>
                                {" + "}
                                <kbd
                                    className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                                    style={{ background: "var(--color-subtle)" }}
                                >
                                    K
                                </kbd>{" "}
                                anywhere to search this from any page.
                            </p>
                        </Card>
                    </PageSection>

                    {/* Search results */}
                    {results !== null && (
                        <PageSection delay={0.1}>
                            <Card padding="lg">
                                <p
                                    className="mb-4 font-semibold text-xs uppercase tracking-wider"
                                    style={{ color: "var(--color-text-muted)" }}
                                >
                                    {results.length > 0
                                        ? `${results.length} result${results.length === 1 ? "" : "s"}`
                                        : "No results"}
                                </p>
                                {results.length === 0 ? (
                                    <p
                                        className="text-sm"
                                        style={{ color: "var(--color-text-muted)" }}
                                    >
                                        Nothing matched &quot;{query}&quot;. Try a shorter or more
                                        general term - or clear the search to browse everything by
                                        category.
                                    </p>
                                ) : (
                                    <div className="flex flex-col gap-1">
                                        {results.map((entry) => (
                                            <HelpRow entry={entry} key={entry.id} showCategory />
                                        ))}
                                    </div>
                                )}
                            </Card>
                        </PageSection>
                    )}

                    {results === null && (
                        <nav
                            aria-label="Guide categories"
                            className="guide-categories mb-6 flex flex-wrap gap-2"
                        >
                            <button
                                aria-pressed={category === null}
                                className="guide-category rounded-full px-4 py-2.5 text-sm"
                                onClick={() => setCategory(null)}
                                type="button"
                            >
                                All guides
                            </button>
                            {grouped.map((group) => (
                                <button
                                    aria-pressed={category === group.category}
                                    className="guide-category rounded-full px-4 py-2.5 text-sm"
                                    key={group.category}
                                    onClick={() => setCategory(group.category)}
                                    type="button"
                                >
                                    {group.category}
                                </button>
                            ))}
                        </nav>
                    )}

                    {/* Categorised browse.
              CSS multi-column rather than a grid: category cards have wildly
              different heights (10 guides vs. 2), and in a 2-col grid every
              row is as tall as its tallest card, which left large dead gaps
              under the short ones. Columns let the cards flow and pack
              tightly instead. break-inside-avoid keeps a card from being
              split across the column boundary. */}
                    {results === null && (
                        <div
                            className={category ? "" : "columns-1 gap-4 lg:columns-2"}
                            style={category ? { maxWidth: "52rem" } : undefined}
                        >
                            {grouped
                                .filter((group) => !category || group.category === category)
                                .map((group) => (
                                    <div className="mb-4 break-inside-avoid" key={group.category}>
                                        <Card padding="lg">
                                            <div className="mb-4 flex items-center gap-3">
                                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-muted">
                                                    {group.category === "Troubleshooting" ? (
                                                        <LifebuoyIcon className="h-5 w-5 text-primary" />
                                                    ) : (
                                                        <SparklesIcon className="h-5 w-5 text-primary" />
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <h3 className="truncate font-display font-semibold text-base text-default">
                                                        {group.category}
                                                    </h3>
                                                    <p
                                                        className="text-xs"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    >
                                                        {group.entries.length} guide
                                                        {group.entries.length === 1 ? "" : "s"}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                {group.entries.map((entry) => (
                                                    <HelpRow entry={entry} key={entry.id} />
                                                ))}
                                            </div>
                                        </Card>
                                    </div>
                                ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

function HelpRow({ entry, showCategory = false }: { entry: HelpEntry; showCategory?: boolean }) {
    return (
        <Link
            className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-hover"
            href={`/guides/${entry.id}`}
        >
            <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-default text-sm">{entry.title}</span>
                    {showCategory && (
                        <span
                            className="shrink-0 rounded px-1.5 py-0.5 font-semibold text-[10px] uppercase tracking-wider"
                            style={{
                                background: "var(--color-bg-muted)",
                                color: "var(--color-text-muted)",
                            }}
                        >
                            {entry.category}
                        </span>
                    )}
                </span>
                <span
                    className="mt-1 line-clamp-2 block text-xs"
                    style={{ color: "var(--color-text-muted)" }}
                >
                    {entry.answer}
                </span>
            </span>
            <ChevronRightIcon
                className="mt-0.5 h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: "var(--color-text-muted)" }}
            />
        </Link>
    );
}
