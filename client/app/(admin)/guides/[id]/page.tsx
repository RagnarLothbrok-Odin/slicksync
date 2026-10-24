"use client";

import {
    ArrowLeftIcon,
    ArrowRightIcon,
    ArrowTopRightOnSquareIcon,
    BoltIcon,
    ChevronRightIcon,
    LightBulbIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AutomationPanel } from "@/components/automation/AutomationPanel";
import { Breadcrumbs, Header } from "@/components/layout/Header";
import { NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { PageSection } from "@/components/layout/PageContainer";
import { Button, Card, Modal } from "@/components/ui";
import { guideReturn } from "@/lib/guideReturn";
import { getHelpEntry, type HelpEntry } from "@/lib/helpContent";
import { useLayoutMode } from "@/lib/layout-mode";

// A full page per help topic, rather than the cramped inline blurb the
// command palette used to be limited to. That's the whole point: the palette
// stays fast and answers-at-a-glance, and anything that needs real
// step-by-step instructions, caveats, or "here's why it behaves like this"
// gets room to actually say it.
export default function GuideTopicPage() {
    const params = useParams();
    const id =
        typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";
    const { layoutMode } = useLayoutMode();
    const router = useRouter();
    const [embedOpen, setEmbedOpen] = useState(false);
    // Opened from somewhere in the app: Back returns there, scroll and all.
    // Read after mount - it lives in this tab's session storage.
    const [back, setBack] = useState<ReturnType<typeof guideReturn>>(null);
    useEffect(() => {
        setBack(guideReturn());
    }, [id]);

    const entry = getHelpEntry(id);

    const related = (entry?.related || [])
        .map((rid) => getHelpEntry(rid))
        .filter((e): e is HelpEntry => Boolean(e));

    // The footer "Browse all guides" link only earns its place on a page long
    // enough that the back link at the top has scrolled away. On a short
    // summary-only topic the two sit within a few hundred pixels of each
    // other and just read as two back buttons.
    const hasLongContent = Boolean(
        (entry?.steps && entry.steps.length > 0) ||
            (entry?.details && entry.details.length > 0) ||
            (entry?.tips && entry.tips.length > 0) ||
            related.length > 0
    );

    return (
        <>
            {layoutMode !== "nebula" && (
                <Header
                    title={
                        <Breadcrumbs
                            className="font-semibold text-xl"
                            items={[
                                { href: "/guides", label: "Guides" },
                                { label: entry ? entry.title : "Not found" },
                            ]}
                        />
                    }
                />
            )}
            <div className={layoutMode === "nebula" ? "px-4 pt-6 pb-8 md:px-6" : "p-8"}>
                <div
                    className={layoutMode === "nebula" ? "mx-auto" : ""}
                    style={layoutMode === "nebula" ? { maxWidth: "min(64rem, 92vw)" } : undefined}
                >
                    {layoutMode === "nebula" && entry && (
                        <NebulaPageHeading subtitle={entry.category} title={entry.title} />
                    )}

                    <PageSection className="mb-4" delay={0.05}>
                        <button
                            className="inline-flex items-center gap-1.5 font-medium text-sm transition-opacity hover:opacity-80"
                            onClick={() => (back ? back.go() : router.push("/guides"))}
                            style={{ color: "var(--color-secondary)" }}
                        >
                            <ArrowLeftIcon className="h-4 w-4" />
                            {back ? back.label : "All guides"}
                        </button>
                    </PageSection>

                    {entry ? (
                        <>
                            {/* Summary - the same text the command palette shows inline */}
                            <PageSection className="mb-5" delay={0.1}>
                                <Card padding="lg">
                                    {layoutMode !== "nebula" && (
                                        <>
                                            <p
                                                className="mb-1.5 font-semibold text-[10px] uppercase tracking-wider"
                                                style={{ color: "var(--color-primary)" }}
                                            >
                                                {entry.category}
                                            </p>
                                            <h1 className="mb-3 font-bold font-display text-default text-xl">
                                                {entry.title}
                                            </h1>
                                        </>
                                    )}
                                    <p
                                        className="text-sm leading-relaxed"
                                        style={{ color: "var(--color-text)" }}
                                    >
                                        {entry.answer}
                                    </p>
                                    {/* Prefer opening the feature right here over navigating
                      away - the steps stay on screen while you follow them,
                      instead of the instructions ending up on the page you
                      just left. Only guides whose feature is a genuinely
                      self-contained component can do this; the rest still
                      deep-link. */}
                                    {entry.embed ? (
                                        <div className="mt-5">
                                            <Button
                                                leftIcon={<BoltIcon className="h-4 w-4" />}
                                                onClick={() => setEmbedOpen(true)}
                                                size="sm"
                                                variant="primary"
                                            >
                                                Open Automation here
                                            </Button>
                                            <p
                                                className="mt-2 text-xs"
                                                style={{ color: "var(--color-text-muted)" }}
                                            >
                                                Opens on this page, so the steps below stay visible.
                                            </p>
                                        </div>
                                    ) : entry.href ? (
                                        <div className="mt-5">
                                            <Button
                                                onClick={() => router.push(entry.href!)}
                                                rightIcon={
                                                    <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                                                }
                                                size="sm"
                                                variant="primary"
                                            >
                                                {entry.linkLabel || "Go there"}
                                            </Button>
                                        </div>
                                    ) : null}
                                </Card>
                            </PageSection>

                            {/* Steps */}
                            {entry.steps && entry.steps.length > 0 && (
                                <PageSection className="mb-5" delay={0.14}>
                                    <Card padding="lg">
                                        <h2 className="mb-4 font-display font-semibold text-base text-default">
                                            Step by step
                                        </h2>
                                        <ol className="flex flex-col gap-3">
                                            {entry.steps.map((step, i) => (
                                                <li className="flex items-start gap-3" key={i}>
                                                    <span
                                                        className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-semibold text-xs"
                                                        style={{
                                                            background:
                                                                "var(--color-primary-muted)",
                                                            color: "var(--color-primary)",
                                                        }}
                                                    >
                                                        {i + 1}
                                                    </span>
                                                    <span
                                                        className="flex-1 text-sm leading-relaxed"
                                                        style={{ color: "var(--color-text)" }}
                                                    >
                                                        {step}
                                                    </span>
                                                </li>
                                            ))}
                                        </ol>
                                    </Card>
                                </PageSection>
                            )}

                            {/* Details */}
                            {entry.details && entry.details.length > 0 && (
                                <PageSection className="mb-5" delay={0.18}>
                                    <Card padding="lg">
                                        <h2 className="mb-4 font-display font-semibold text-base text-default">
                                            How it works
                                        </h2>
                                        <div className="flex flex-col gap-3">
                                            {entry.details.map((d, i) => (
                                                <p
                                                    className="text-sm leading-relaxed"
                                                    key={i}
                                                    style={{ color: "var(--color-text-muted)" }}
                                                >
                                                    {d}
                                                </p>
                                            ))}
                                        </div>
                                    </Card>
                                </PageSection>
                            )}

                            {/* Tips / gotchas */}
                            {entry.tips && entry.tips.length > 0 && (
                                <PageSection className="mb-5" delay={0.22}>
                                    <Card padding="lg">
                                        <div className="mb-4 flex items-center gap-3">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning-muted">
                                                <LightBulbIcon className="h-5 w-5 text-warning" />
                                            </div>
                                            <h2 className="font-display font-semibold text-base text-default">
                                                Worth knowing
                                            </h2>
                                        </div>
                                        <ul className="flex flex-col gap-3">
                                            {entry.tips.map((tip, i) => (
                                                <li className="flex items-start gap-2.5" key={i}>
                                                    <span
                                                        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                                                        style={{
                                                            background: "var(--color-warning)",
                                                        }}
                                                    />
                                                    <span
                                                        className="flex-1 text-sm leading-relaxed"
                                                        style={{ color: "var(--color-text)" }}
                                                    >
                                                        {tip}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </Card>
                                </PageSection>
                            )}

                            {/* Related */}
                            {related.length > 0 && (
                                <PageSection delay={0.26}>
                                    <Card padding="lg">
                                        <h2 className="mb-4 font-display font-semibold text-base text-default">
                                            Related
                                        </h2>
                                        <div className="flex flex-col gap-1">
                                            {related.map((r) => (
                                                <Link
                                                    className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-hover"
                                                    href={`/guides/${r.id}`}
                                                    key={r.id}
                                                >
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block font-medium text-default text-sm">
                                                            {r.title}
                                                        </span>
                                                        <span
                                                            className="mt-1 line-clamp-2 block text-xs"
                                                            style={{
                                                                color: "var(--color-text-muted)",
                                                            }}
                                                        >
                                                            {r.answer}
                                                        </span>
                                                    </span>
                                                    <ChevronRightIcon
                                                        className="mt-0.5 h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                                                        style={{ color: "var(--color-text-muted)" }}
                                                    />
                                                </Link>
                                            ))}
                                        </div>
                                    </Card>
                                </PageSection>
                            )}

                            {hasLongContent && (
                                <PageSection className="mt-5" delay={0.3}>
                                    <Link
                                        className="inline-flex items-center gap-1.5 font-medium text-sm transition-opacity hover:opacity-80"
                                        href="/guides"
                                        style={{ color: "var(--color-secondary)" }}
                                    >
                                        Browse all guides
                                        <ArrowRightIcon className="h-4 w-4" />
                                    </Link>
                                </PageSection>
                            )}
                        </>
                    ) : (
                        <PageSection delay={0.1}>
                            <Card padding="lg">
                                <h2 className="mb-2 font-display font-semibold text-default text-lg">
                                    Topic not found
                                </h2>
                                <p
                                    className="mb-5 text-sm"
                                    style={{ color: "var(--color-text-muted)" }}
                                >
                                    There&apos;s no help topic with the id &quot;{id}&quot;. It may
                                    have been renamed or removed.
                                </p>
                                <Button
                                    onClick={() => router.push("/guides")}
                                    size="sm"
                                    variant="primary"
                                >
                                    Browse all topics
                                </Button>
                            </Card>
                        </PageSection>
                    )}
                </div>
            </div>

            {/* The real Automation panel, rendered on the guide page itself. It's
          the same self-contained component the Tasks page mounts, so rules
          created here are the real thing, not a preview. */}
            {entry?.embed === "automation" && (
                <Modal
                    isOpen={embedOpen}
                    onClose={() => setEmbedOpen(false)}
                    size="xl"
                    title="Automation"
                >
                    <AutomationPanel />
                </Modal>
            )}
        </>
    );
}
