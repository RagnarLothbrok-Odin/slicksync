"use client";

import {
    ArrowPathIcon,
    BugAntIcon,
    CheckIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    ClipboardDocumentIcon,
    DocumentTextIcon,
    SparklesIcon,
    TagIcon,
    WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumbs, Header } from "@/components/layout/Header";
import { NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { PageSection } from "@/components/layout/PageContainer";
import { Badge, Button, Card } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { copyToClipboard } from "@/lib/clipboard";
import { useLayoutMode } from "@/lib/layout-mode";

// Types
interface ReleaseSection {
    items: string[];
    title: string;
}

interface Release {
    bugFixes: string[];
    date: string;
    features: string[];
    htmlUrl: string;
    isPreRelease: boolean;
    miscChores: string[];
    otherSections: ReleaseSection[];
    rawBody: string;
    tagName: string;
    title?: string;
    version: string;
}

interface _GithubReleaseResponse {
    body: string | null;
    created_at: string | null;
    draft: boolean;
    html_url: string;
    name: string;
    prerelease: boolean;
    published_at: string | null;
    tag_name: string;
}

const CHANGELOG_URL = "/changelog.json";

// Helper functions
const bulletRegex = /^[*-]\s+/;

const cleanEntry = (value: string): string => {
    if (!value) {
        return "";
    }
    let cleaned = value.trim();

    cleaned = cleaned.replace(bulletRegex, "");

    cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string) => {
        if (/^[0-9a-f]{7,}$/i.test(label) || /^#[0-9]+$/i.test(label)) {
            return "";
        }
        return label;
    });

    cleaned = cleaned.replace(/\(([^)]+)\)/g, (match, inner: string) => {
        const trimmed = inner.trim();
        if (
            /^#[0-9]+$/i.test(trimmed) ||
            /^[0-9a-f]{7,}$/i.test(trimmed) ||
            /^https?:\/\//i.test(trimmed)
        ) {
            return "";
        }
        return match;
    });

    cleaned = cleaned.replace(/\b[0-9a-f]{7,}\b/gi, "");
    cleaned = cleaned.replace(/\(\s*\)/g, "");
    cleaned = cleaned.replace(/\s{2,}/g, " ").trim();

    if (cleaned.endsWith(":")) {
        cleaned = cleaned.slice(0, -1).trim();
    }

    return cleaned;
};

const splitAndClean = (block: string): string[] =>
    block
        .split(/\r?\n+/)
        .map((line) => cleanEntry(line))
        .filter((line) => line.length > 0);

const parseSectionItems = (block: string): string[] => {
    if (!block) {
        return [];
    }

    const bulletMatches = Array.from(block.matchAll(/^[\s>*-]*[-*+]\s+(.*)$/gm))
        .map((match) => cleanEntry(match[1] ?? ""))
        .filter((item) => item.length > 0);

    if (bulletMatches.length > 0) {
        return bulletMatches;
    }

    return splitAndClean(block);
};

const _parseReleaseBody = (body: string | null | undefined) => {
    const normalized = (body || "").replace(/\r\n/g, "\n").trim();

    const result = {
        bugFixes: [] as string[],
        features: [] as string[],
        miscChores: [] as string[],
        otherSections: [] as ReleaseSection[],
        rawBody: normalized,
    };

    if (!normalized) {
        return result;
    }

    const headingRegex = /^###\s+(.+?)\s*$/gim;
    const matches = Array.from(normalized.matchAll(headingRegex));

    matches.forEach((match, index) => {
        const headingRaw = match[1] || "";
        const heading = headingRaw.trim().toLowerCase();
        const start = match.index + match[0].length;
        const end = index + 1 < matches.length ? matches[index + 1].index : normalized.length;
        const content = normalized.slice(start, end).trim();
        const items = parseSectionItems(content);

        if (!(items.length || content)) {
            return;
        }

        switch (heading) {
            case "features":
                result.features.push(...(items.length ? items : splitAndClean(content)));
                break;
            case "bug fixes":
            case "bugfixes":
            case "bug-fixes":
                result.bugFixes.push(...(items.length ? items : splitAndClean(content)));
                break;
            case "miscellaneous chores":
            case "misc chores":
            case "chores":
                result.miscChores.push(...(items.length ? items : splitAndClean(content)));
                break;
            default: {
                const sectionItems = items.length ? items : splitAndClean(content);
                if (sectionItems.length) {
                    result.otherSections.push({
                        items: sectionItems,
                        title: headingRaw
                            ? headingRaw.replace(/\b\w/g, (c) => c.toUpperCase())
                            : "Notes",
                    });
                }
                break;
            }
        }
    });

    if (
        result.features.length === 0 &&
        result.bugFixes.length === 0 &&
        result.miscChores.length === 0 &&
        result.otherSections.length === 0
    ) {
        const fallbackItems = parseSectionItems(normalized);
        if (fallbackItems.length) {
            result.otherSections.push({
                items: fallbackItems,
                title: "Notes",
            });
        }
    }

    return result;
};

interface LocalChangelogEntry {
    bugFixes: string[];
    date: string;
    features: string[];
    miscChores: string[];
    title?: string;
    version: string;
}

const mapLocalEntry = (entry: LocalChangelogEntry): Release => ({
    bugFixes: entry.bugFixes || [],
    date: entry.date,
    features: entry.features || [],
    htmlUrl: `https://github.com/slicknsliding/slicksync/releases/tag/v${entry.version}`,
    isPreRelease: false,
    miscChores: entry.miscChores || [],
    otherSections: [],
    rawBody: "",
    tagName: `v${entry.version}`,
    title: entry.title,
    version: entry.version,
});

const fetchChangelog = async (): Promise<Release[]> => {
    const response = await fetch(CHANGELOG_URL, { cache: "no-store" });

    if (!response.ok) {
        throw new Error(`Changelog request failed with status ${response.status}`);
    }

    const data: LocalChangelogEntry[] = await response.json();

    return data
        .map(mapLocalEntry)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export default function ChangelogPage() {
    const { layoutMode } = useLayoutMode();
    const appVersion = (process.env.NEXT_PUBLIC_APP_VERSION as string) || "dev";
    const [releases, setReleases] = useState<Release[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isError, setIsError] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
    const [copied, setCopied] = useState(false);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        setIsError(false);
        setError(null);
        try {
            const data = await fetchChangelog();
            setReleases(data);
            // Auto-expand the first (latest) release
            if (data.length > 0) {
                setExpandedVersions(new Set([data[0].version]));
            }
        } catch (err) {
            setIsError(true);
            setError(err as Error);
            toast.error("Failed to load changelog");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const capitalizeFirst = (text: string): string => {
        if (!text) {
            return text;
        }
        return text.charAt(0).toUpperCase() + text.slice(1);
    };

    // The maintained deployment bundle uses the fork's private GHCR image.
    // Pulling and recreating preserves the named data volume.
    const copyUpdateCommand = () => {
        const composeFile = "docker-compose.private.yml";
        const command = `docker compose -f ${composeFile} pull && docker compose -f ${composeFile} up -d --force-recreate`;
        copyToClipboard(command)
            .then(() => {
                setCopied(true);
                toast.success("Update command copied to clipboard!");
                setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => {
                toast.error("Failed to copy to clipboard");
            });
    };

    const toggleVersion = (version: string) => {
        setExpandedVersions((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(version)) {
                newSet.delete(version);
            } else {
                newSet.add(version);
            }
            return newSet;
        });
    };

    const isInitialLoading = isLoading && releases.length === 0;
    const errorMessage = error instanceof Error ? error.message : "Failed to load changelog.";

    return (
        <>
            {layoutMode !== "nebula" && (
                <Header
                    subtitle="The latest improvements, in one place."
                    title={
                        <Breadcrumbs
                            className="font-semibold text-xl"
                            items={[{ label: "What's New" }]}
                        />
                    }
                />
            )}

            <div className={layoutMode === "nebula" ? "px-4 pt-6 pb-8 md:px-6" : "p-8"}>
                <div
                    className={layoutMode === "nebula" ? "mx-auto" : ""}
                    style={layoutMode === "nebula" ? { maxWidth: "min(72rem, 92vw)" } : undefined}
                >
                    {layoutMode === "nebula" && (
                        <NebulaPageHeading
                            subtitle="The latest improvements, in one place."
                            title="What's New"
                        />
                    )}
                    {/* Loading State */}
                    {isInitialLoading && (
                        <PageSection>
                            <div className="space-y-4">
                                {[0, 1, 2].map((idx) => (
                                    <Card className="animate-pulse" key={idx} padding="lg">
                                        <div className="flex items-center justify-between">
                                            <div className="h-6 w-48 rounded bg-surface-hover" />
                                            <div className="h-5 w-5 rounded-full bg-surface-hover" />
                                        </div>
                                        <div className="mt-4 space-y-2">
                                            <div className="h-4 w-full rounded bg-surface-hover" />
                                            <div className="h-4 w-3/4 rounded bg-surface-hover" />
                                            <div className="h-4 w-2/3 rounded bg-surface-hover" />
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        </PageSection>
                    )}

                    {/* Error State */}
                    {isError && (
                        <PageSection>
                            <Card className="text-center" padding="lg">
                                <p className="mb-4 text-muted">
                                    Could not load the changelog. {errorMessage}
                                </p>
                                <Button
                                    isLoading={isLoading}
                                    leftIcon={<ArrowPathIcon className="h-4 w-4" />}
                                    onClick={fetchData}
                                    variant="secondary"
                                >
                                    Retry
                                </Button>
                            </Card>
                        </PageSection>
                    )}

                    {/* Empty State */}
                    {!(isInitialLoading || isError) && releases.length === 0 && (
                        <PageSection>
                            <Card className="text-center" padding="lg">
                                <p className="text-muted">No changelog entries yet.</p>
                            </Card>
                        </PageSection>
                    )}

                    {/* Releases List */}
                    {!isInitialLoading && releases.length > 0 && (
                        <PageSection>
                            <div className="space-y-4">
                                {releases.map((release, index) => {
                                    const isExpanded = expandedVersions.has(release.version);
                                    const isCurrentVersion = release.version === appVersion;
                                    const isLatest = index === 0;

                                    return (
                                        <Card
                                            className={`overflow-hidden transition-all ${
                                                isCurrentVersion ? "ring-2 ring-primary" : ""
                                            }`}
                                            key={release.tagName || release.version}
                                            padding="none"
                                        >
                                            {/* Release Header */}
                                            <button
                                                className="flex w-full items-center justify-between px-6 py-4 transition-colors hover:bg-surface-hover"
                                                onClick={() => toggleVersion(release.version)}
                                                type="button"
                                            >
                                                <div className="flex items-center gap-4">
                                                    <TagIcon className="h-5 w-5 shrink-0 text-default" />
                                                    <div className="flex flex-col items-start gap-1 text-left">
                                                        <div className="flex flex-wrap items-baseline gap-3">
                                                            <div className="flex items-center gap-2">
                                                                <a
                                                                    className="font-semibold text-xl transition-colors hover:text-primary"
                                                                    href={release.htmlUrl}
                                                                    onClick={(e) =>
                                                                        e.stopPropagation()
                                                                    }
                                                                    rel="noopener noreferrer"
                                                                    target="_blank"
                                                                >
                                                                    v{release.version}
                                                                </a>
                                                                <div className="flex items-center gap-2">
                                                                    {isLatest && (
                                                                        <button
                                                                            className="inline-flex min-w-[74px] cursor-pointer items-center justify-center gap-1.5 rounded bg-primary px-2 py-0.5 font-medium text-white text-xs transition-colors hover:bg-primary-hover"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                copyUpdateCommand();
                                                                            }}
                                                                            type="button"
                                                                        >
                                                                            {copied ? (
                                                                                <CheckIcon className="h-3 w-3" />
                                                                            ) : (
                                                                                <ClipboardDocumentIcon className="h-3 w-3" />
                                                                            )}
                                                                            <span>
                                                                                {copied
                                                                                    ? "Copied!"
                                                                                    : "Latest"}
                                                                            </span>
                                                                        </button>
                                                                    )}
                                                                    {isCurrentVersion && (
                                                                        <Badge
                                                                            size="sm"
                                                                            variant="success"
                                                                        >
                                                                            <CheckIcon className="mr-1 h-3 w-3" />
                                                                            Current
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                                {release.isPreRelease && (
                                                                    <Badge
                                                                        size="sm"
                                                                        variant="warning"
                                                                    >
                                                                        Pre-release
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            <span className="text-muted text-sm">
                                                                {/* release.date is a plain YYYY-MM-DD string, which
                                  Date parses as UTC midnight - rendering it in the
                                  viewer's local timezone (anyone west of UTC, e.g.
                                  the project's own default America/Los_Angeles)
                                  showed every release one calendar day early. Since
                                  these are date-only values with no meaningful time
                                  component, display in UTC too so it always matches
                                  the literal date string regardless of viewer TZ. */}
                                                                {new Date(
                                                                    release.date
                                                                ).toLocaleDateString("en-US", {
                                                                    day: "numeric",
                                                                    month: "long",
                                                                    timeZone: "UTC",
                                                                    year: "numeric",
                                                                })}
                                                            </span>
                                                        </div>
                                                        {release.title && (
                                                            <p className="font-medium text-default text-sm">
                                                                {release.title}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                                {isExpanded ? (
                                                    <ChevronUpIcon className="h-5 w-5 text-muted" />
                                                ) : (
                                                    <ChevronDownIcon className="h-5 w-5 text-muted" />
                                                )}
                                            </button>

                                            {/* Release Content */}
                                            <AnimatePresence>
                                                {isExpanded && (
                                                    <motion.div
                                                        animate={{ height: "auto", opacity: 1 }}
                                                        className="overflow-hidden border-default border-t"
                                                        exit={{ height: 0, opacity: 0 }}
                                                        initial={{ height: 0, opacity: 0 }}
                                                        transition={{ duration: 0.2 }}
                                                    >
                                                        <div className="space-y-6 px-6 py-6">
                                                            {/* Features */}
                                                            {release.features.length > 0 && (
                                                                <div>
                                                                    <h3 className="mb-3 flex items-center gap-2 font-semibold text-base text-default">
                                                                        <SparklesIcon className="h-4 w-4 text-primary" />
                                                                        <span>Features</span>
                                                                    </h3>
                                                                    <ul className="space-y-2">
                                                                        {release.features.map(
                                                                            (feature, idx) => (
                                                                                <li
                                                                                    className="relative pl-4 text-muted text-sm before:absolute before:left-0 before:text-muted before:content-['•']"
                                                                                    key={idx}
                                                                                >
                                                                                    {capitalizeFirst(
                                                                                        feature
                                                                                    )}
                                                                                </li>
                                                                            )
                                                                        )}
                                                                    </ul>
                                                                </div>
                                                            )}

                                                            {/* Bug Fixes */}
                                                            {release.bugFixes.length > 0 && (
                                                                <div>
                                                                    <h3 className="mb-3 flex items-center gap-2 font-semibold text-base text-default">
                                                                        <BugAntIcon className="h-4 w-4 text-error" />
                                                                        <span>Bug Fixes</span>
                                                                    </h3>
                                                                    <ul className="space-y-2">
                                                                        {release.bugFixes.map(
                                                                            (fix, idx) => (
                                                                                <li
                                                                                    className="relative pl-4 text-muted text-sm before:absolute before:left-0 before:text-muted before:content-['•']"
                                                                                    key={idx}
                                                                                >
                                                                                    {capitalizeFirst(
                                                                                        fix
                                                                                    )}
                                                                                </li>
                                                                            )
                                                                        )}
                                                                    </ul>
                                                                </div>
                                                            )}

                                                            {/* Misc Chores */}
                                                            {release.miscChores.length > 0 && (
                                                                <div>
                                                                    <h3 className="mb-3 flex items-center gap-2 font-semibold text-base text-default">
                                                                        <WrenchScrewdriverIcon className="h-4 w-4 text-secondary" />
                                                                        <span>Chores</span>
                                                                    </h3>
                                                                    <ul className="space-y-2">
                                                                        {release.miscChores.map(
                                                                            (chore, idx) => (
                                                                                <li
                                                                                    className="relative pl-4 text-muted text-sm before:absolute before:left-0 before:text-muted before:content-['•']"
                                                                                    key={idx}
                                                                                >
                                                                                    {capitalizeFirst(
                                                                                        chore
                                                                                    )}
                                                                                </li>
                                                                            )
                                                                        )}
                                                                    </ul>
                                                                </div>
                                                            )}

                                                            {/* Other Sections */}
                                                            {release.otherSections.map((section) =>
                                                                section.items.length > 0 ? (
                                                                    <div
                                                                        key={`${release.version}-${section.title}`}
                                                                    >
                                                                        <h3 className="mb-3 flex items-center gap-2 font-semibold text-base text-default">
                                                                            <DocumentTextIcon className="h-4 w-4 text-secondary" />
                                                                            <span>
                                                                                {capitalizeFirst(
                                                                                    section.title
                                                                                )}
                                                                            </span>
                                                                        </h3>
                                                                        <ul className="space-y-2">
                                                                            {section.items.map(
                                                                                (item, idx) => (
                                                                                    <li
                                                                                        className="relative pl-4 text-muted text-sm before:absolute before:left-0 before:text-muted before:content-['•']"
                                                                                        key={idx}
                                                                                    >
                                                                                        {capitalizeFirst(
                                                                                            item
                                                                                        )}
                                                                                    </li>
                                                                                )
                                                                            )}
                                                                        </ul>
                                                                    </div>
                                                                ) : null
                                                            )}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </Card>
                                    );
                                })}
                            </div>
                        </PageSection>
                    )}

                    {/* Footer */}
                    <PageSection className="mt-12">
                        <Card className="text-center" padding="lg">
                            <p className="text-muted text-sm">
                                View all releases on{" "}
                                <a
                                    className="font-medium text-primary underline hover:text-primary-hover"
                                    href="https://github.com/slicknsliding/slicksync/releases"
                                    rel="noopener noreferrer"
                                    target="_blank"
                                >
                                    GitHub
                                </a>
                            </p>
                        </Card>
                    </PageSection>
                </div>
            </div>
        </>
    );
}
