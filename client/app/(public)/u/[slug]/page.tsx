"use client";

import { ClockIcon, FilmIcon, FireIcon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

interface PublicStats {
    avatarUrl: string | null;
    colorIndex: number | null;
    streak: number;
    topTitles: Array<{ name: string; poster: string | null }>;
    totalTitles: number;
    totalWatchHours: number;
    username: string;
}

// Genuinely public, unauthenticated - no session, no cookie, no auth header.
// The slug in the URL IS the access control (server/routes/users.js's GET
// /users/public-stats/:slug): a random unguessable token, not a real id, and
// the endpoint only ever returns the small curated set of fields this page
// renders - never email, provider details, or anything else on the account.
export default function PublicStatsPage() {
    const params = useParams();
    const slug = params?.slug as string;
    const [stats, setStats] = useState<PublicStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    // Asked too often from this address - not the same thing as a link that is off.
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!slug) {
            return;
        }
        fetch(`${API_BASE}/users/public-stats/${encodeURIComponent(slug)}`)
            .then(async (res) => {
                if (res.status === 429) {
                    setBusy(true);
                    return;
                }
                if (!res.ok) {
                    setNotFound(true);
                    return;
                }
                const data = await res.json();
                setStats(data);
            })
            .catch(() => setNotFound(true))
            .finally(() => setLoading(false));
    }, [slug]);

    if (loading) {
        return (
            <div
                className="flex min-h-screen items-center justify-center"
                style={{ background: "var(--color-bg)" }}
            >
                <div
                    className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent"
                    style={{ color: "var(--color-primary)" }}
                />
            </div>
        );
    }

    if (busy) {
        return (
            <div
                className="flex min-h-screen items-center justify-center p-6"
                style={{ background: "var(--color-bg)" }}
            >
                <div className="text-center">
                    <h1
                        className="mb-2 font-semibold text-xl"
                        style={{ color: "var(--color-text)" }}
                    >
                        Try again in a moment
                    </h1>
                    <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                        This page has been opened a lot in the last minute.
                    </p>
                </div>
            </div>
        );
    }

    if (notFound || !stats) {
        return (
            <div
                className="flex min-h-screen items-center justify-center p-6"
                style={{ background: "var(--color-bg)" }}
            >
                <div className="text-center">
                    <h1
                        className="mb-2 font-semibold text-xl"
                        style={{ color: "var(--color-text)" }}
                    >
                        This stats page isn't available
                    </h1>
                    <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                        The link may have been disabled by its owner.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen px-4 py-12" style={{ background: "var(--color-bg)" }}>
            <div className="mx-auto max-w-2xl">
                <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-10 flex flex-col items-center text-center"
                    initial={{ opacity: 0, y: 12 }}
                >
                    <Avatar
                        colorIndex={stats.colorIndex ?? undefined}
                        name={stats.username}
                        size="lg"
                        src={stats.avatarUrl || undefined}
                    />
                    <h1
                        className="mt-4 font-bold font-display text-2xl"
                        style={{ color: "var(--color-text)" }}
                    >
                        {stats.username}'s Watch Stats
                    </h1>
                    <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        Powered by SlickSync
                    </p>
                </motion.div>

                <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8 grid grid-cols-3 gap-3"
                    initial={{ opacity: 0, y: 12 }}
                    transition={{ delay: 0.05 }}
                >
                    {[
                        {
                            icon: <ClockIcon className="h-5 w-5" />,
                            label: "Hours watched",
                            value: stats.totalWatchHours.toLocaleString(),
                        },
                        {
                            icon: <FilmIcon className="h-5 w-5" />,
                            label: "Titles watched",
                            value: stats.totalTitles.toLocaleString(),
                        },
                        {
                            icon: <FireIcon className="h-5 w-5" />,
                            label: "Day streak",
                            value: stats.streak.toLocaleString(),
                        },
                    ].map((s) => (
                        <div
                            className="rounded-xl p-4 text-center"
                            key={s.label}
                            style={{
                                background: "var(--color-surface)",
                                border: "1px solid var(--color-surface-border)",
                            }}
                        >
                            <div
                                className="mb-2 flex justify-center"
                                style={{ color: "var(--color-primary)" }}
                            >
                                {s.icon}
                            </div>
                            <p
                                className="font-bold font-display text-xl"
                                style={{ color: "var(--color-text)" }}
                            >
                                {s.value}
                            </p>
                            <p
                                className="mt-0.5 text-xs"
                                style={{ color: "var(--color-text-muted)" }}
                            >
                                {s.label}
                            </p>
                        </div>
                    ))}
                </motion.div>

                {stats.topTitles.length > 0 && (
                    <motion.div
                        animate={{ opacity: 1, y: 0 }}
                        initial={{ opacity: 0, y: 12 }}
                        transition={{ delay: 0.1 }}
                    >
                        <h2
                            className="mb-3 font-semibold text-sm"
                            style={{ color: "var(--color-text)" }}
                        >
                            Top Watched
                        </h2>
                        <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
                            {stats.topTitles.map((t, i) => (
                                <div className="space-y-1.5" key={`${t.name}-${i}`}>
                                    <div
                                        className="aspect-[2/3] overflow-hidden rounded-lg"
                                        style={{
                                            background: "var(--color-surface)",
                                            border: "1px solid var(--color-surface-border)",
                                        }}
                                    >
                                        {t.poster ? (
                                            <img
                                                alt={t.name}
                                                className="h-full w-full object-cover"
                                                src={t.poster}
                                            />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center">
                                                <FilmIcon
                                                    className="h-6 w-6"
                                                    style={{ color: "var(--color-text-muted)" }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <p
                                        className="truncate text-[11px] leading-tight"
                                        style={{ color: "var(--color-text-muted)" }}
                                        title={t.name}
                                    >
                                        {t.name}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
