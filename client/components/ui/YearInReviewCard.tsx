"use client";

import {
    ArrowDownTrayIcon,
    ArrowPathIcon,
    FilmIcon,
    SparklesIcon,
    TrophyIcon,
    TvIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState } from "react";
import { ScrollRow } from "@/components/ui/ScrollRow";
import { toast } from "@/components/ui/Toast";
import { api, type YearInReview, type YearInReviewTitle } from "@/lib/api";
import { downloadBlob, renderWrappedCard } from "@/lib/wrappedCard";
import { Button } from "./Button";
import { Card } from "./Card";
import { MediaDetailModal } from "./MediaDetailModal";

// Year in Review (roadmap #8): a "Wrapped"-style yearly summary card for the
// Metrics page. Read-only - it just visualizes what the metrics tables already
// hold. Self-fetching so the Metrics page only drops <YearInReviewCard/> in.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDuration(sec: number): string {
    if (!sec || sec < 60) {
        return "0m";
    }
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    if (h === 0) {
        return `${m}m`;
    }
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="rounded-lg bg-surface-hover px-3 py-2 text-center">
            <p className="font-semibold text-default text-lg tabular-nums">{value}</p>
            <p className="text-[11px] text-muted">{label}</p>
        </div>
    );
}

function TitleStrip({
    titles,
    onOpen,
    badge,
}: {
    titles: YearInReviewTitle[];
    onOpen: (t: YearInReviewTitle) => void;
    badge: (t: YearInReviewTitle) => string;
}) {
    return (
        <ScrollRow className="flex gap-2 pb-1">
            {titles.map((t) => (
                <button
                    className="w-16 flex-shrink-0 text-left"
                    key={t.id}
                    onClick={() => onOpen(t)}
                    type="button"
                >
                    <div className="flex h-24 w-16 items-center justify-center overflow-hidden rounded-md bg-surface-hover">
                        {t.poster ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt="" className="h-full w-full object-cover" src={t.poster} />
                        ) : t.type === "series" ? (
                            <TvIcon className="h-5 w-5 text-subtle" />
                        ) : (
                            <FilmIcon className="h-5 w-5 text-subtle" />
                        )}
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-muted">{badge(t)}</p>
                </button>
            ))}
        </ScrollRow>
    );
}

export function YearInReviewCard() {
    const now = new Date();
    const thisYear = now.getFullYear();
    const [year, setYear] = useState(thisYear);
    const [data, setData] = useState<YearInReview | null>(null);
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState<YearInReviewTitle | null>(null);
    const [downloading, setDownloading] = useState(false);

    const handleDownload = async () => {
        if (!data?.hasData) {
            return;
        }
        setDownloading(true);
        try {
            const blob = await renderWrappedCard(data);
            downloadBlob(blob, `slicksync-wrapped-${data.year}.png`);
        } catch {
            toast.error("Failed to generate image");
        } finally {
            setDownloading(false);
        }
    };

    const load = useCallback((y: number) => {
        setLoading(true);
        api.getYearInReview(y)
            .then(setData)
            .catch(() => setData(null))
            .finally(() => setLoading(false));
    }, []);
    useEffect(() => {
        load(year);
    }, [year, load]);

    const years = [thisYear, thisYear - 1, thisYear - 2];
    const maxMonth = data ? Math.max(1, ...data.byMonth) : 1;

    return (
        <Card className="mb-6" padding="lg">
            <div className="mb-4 flex items-center gap-2">
                <SparklesIcon className="h-5 w-5 text-primary" />
                <h3 className="font-display font-semibold text-base text-default">
                    Year in Review
                </h3>
                {data?.hasData && (
                    <Button
                        disabled={downloading}
                        leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
                        onClick={handleDownload}
                        size="sm"
                        variant="ghost"
                    >
                        {downloading ? "Generating…" : "Share"}
                    </Button>
                )}
                <div className="ml-auto flex gap-1">
                    {years.map((y) => (
                        <button
                            className={`rounded-lg px-2.5 py-1 font-medium text-xs transition-colors ${
                                y === year
                                    ? "bg-primary text-white"
                                    : "bg-surface-hover text-muted hover:text-default"
                            }`}
                            key={y}
                            onClick={() => setYear(y)}
                            type="button"
                        >
                            {y}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="h-40 animate-pulse rounded-lg bg-surface-hover" />
            ) : data?.hasData ? (
                <div className="space-y-5">
                    {/* Headline: total watch time + split */}
                    <div>
                        <p className="font-bold text-3xl text-default tabular-nums">
                            {fmtDuration(data.totalWatchTimeSeconds)}
                        </p>
                        <p className="text-muted text-xs">
                            watched in {year} · {fmtDuration(data.movieWatchTimeSeconds)} movies ·{" "}
                            {fmtDuration(data.seriesWatchTimeSeconds)} series
                        </p>
                    </div>

                    {/* Stat grid */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Stat label="Movies" value={data.moviesWatched} />
                        <Stat label="Finished" value={data.completedMovies} />
                        <Stat label="Episodes" value={data.episodesWatched} />
                        <Stat label="Shows" value={data.showsWatched} />
                    </div>

                    {/* Monthly bars. Each bar's height is a % of its immediate parent -
              that only resolves to something visible if the parent has a
              DEFINITE height (CSS spec: a percentage height inside a parent
              with no explicit height computes to nothing). The per-month
              column below used to be a bare flex-col with no height of its
              own, so every bar silently rendered at 0px regardless of the
              real value - h-full (inheriting the row's own h-20) plus
              justify-end anchors [bar, month-letter] as a group to the
              bottom, which is what actually makes the % height resolve. */}
                    <div>
                        <p className="mb-1.5 font-medium text-muted text-xs">By month</p>
                        <div className="flex h-20 items-end gap-1">
                            {data.byMonth.map((s, i) => (
                                <div
                                    className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                                    key={i}
                                    title={`${MONTHS[i]}: ${fmtDuration(s)}`}
                                >
                                    <div
                                        className={`w-full rounded-t ${i === data.busiestMonth ? "bg-primary" : "bg-primary/30"}`}
                                        style={{ height: `${Math.max(4, (s / maxMonth) * 100)}%` }}
                                    />
                                    <span className="text-[9px] text-subtle">{MONTHS[i][0]}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Top shows */}
                    {data.topShows.length > 0 && (
                        <div>
                            <p className="mb-1.5 flex items-center gap-1 font-medium text-muted text-xs">
                                <TrophyIcon className="h-3.5 w-3.5" /> Top shows
                            </p>
                            <TitleStrip
                                badge={(t) => `${t.episodeCount} ep`}
                                onOpen={setDetail}
                                titles={data.topShows}
                            />
                        </div>
                    )}

                    {/* Most rewatched */}
                    {data.mostRewatched.length > 0 && (
                        <div>
                            <p className="mb-1.5 flex items-center gap-1 font-medium text-muted text-xs">
                                <ArrowPathIcon className="h-3.5 w-3.5" /> Most rewatched
                            </p>
                            <TitleStrip
                                badge={(t) => `${(t.rewatchCount || 0) + 1}×`}
                                onOpen={setDetail}
                                titles={data.mostRewatched}
                            />
                        </div>
                    )}

                    {/* Household leaderboard (only if more than one watcher) */}
                    {data.perUser.length > 1 && (
                        <div>
                            <p className="mb-1.5 font-medium text-muted text-xs">
                                Who watched most
                            </p>
                            <div className="space-y-1.5">
                                {data.perUser.slice(0, 6).map((u, i) => (
                                    <div className="flex items-center gap-2" key={u.userId}>
                                        <span className="w-4 text-subtle text-xs tabular-nums">
                                            {i + 1}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-default text-sm">
                                            {u.username}
                                        </span>
                                        <div className="h-2 max-w-[40%] flex-1 overflow-hidden rounded-full bg-surface-hover">
                                            <div
                                                className="h-full rounded-full bg-primary"
                                                style={{
                                                    width: `${(u.seconds / (data.perUser[0].seconds || 1)) * 100}%`,
                                                }}
                                            />
                                        </div>
                                        <span className="w-16 text-right text-muted text-xs tabular-nums">
                                            {fmtDuration(u.seconds)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <p className="py-8 text-center text-muted text-sm">
                    No watch activity recorded for {year} yet.
                </p>
            )}

            {detail && (
                <MediaDetailModal
                    fallbackPoster={detail.poster || undefined}
                    fallbackTitle={detail.name}
                    isOpen={!!detail}
                    itemId={detail.id}
                    itemType={detail.type}
                    onClose={() => setDetail(null)}
                />
            )}
        </Card>
    );
}
