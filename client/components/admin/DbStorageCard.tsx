"use client";

import { CircleStackIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { Card } from "@/components/ui";
import { api, type DbSizeReport } from "@/lib/api";

const TOOLTIP_STYLE = {
    backdropFilter: "blur(12px)",
    backgroundColor: "rgba(20, 20, 35, 0.95)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "12px",
} as const;

const TOOLTIP_LABEL_STYLE = { color: "#fff" } as const;

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = -1;
    do {
        value /= 1024;
        unitIndex++;
    } while (value >= 1024 && unitIndex < units.length - 1);
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

// Read-only reporting card: SQLite file size over time, on a small VPS with
// finite disk this is the only warning you'd otherwise get before the disk
// just fills up. Renders nothing in public/Postgres mode (no single file to
// track) or before at least two samples exist (nothing to chart yet).
export function DbStorageCard() {
    const [report, setReport] = useState<DbSizeReport | null>(null);

    useEffect(() => {
        api.getDbSizeReport()
            .then(setReport)
            .catch(() => setReport({ supported: false }));
    }, []);

    if (!report?.supported) {
        return null;
    }

    const samples = report.samples || [];
    const chartData = samples.map((s) => ({
        date: s.createdAt,
        mb: Number(s.bytes) / (1024 * 1024),
    }));

    return (
        <Card className="mb-6" padding="lg">
            <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20">
                    <CircleStackIcon className="h-5 w-5 text-sky-400" />
                </div>
                <div>
                    <h3 className="font-display font-semibold text-base text-default">Database</h3>
                    <p className="text-muted text-xs">
                        SQLite file size over time - read-only, no actions here
                    </p>
                </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-6">
                {typeof report.currentBytes === "number" && (
                    <div>
                        <p className="text-muted text-xs">Current size</p>
                        <p className="font-semibold text-default text-lg">
                            {formatBytes(report.currentBytes)}
                        </p>
                    </div>
                )}
                <div>
                    <p className="text-muted text-xs">Growth</p>
                    <p className="text-default text-sm">
                        {report.growthBytesPerDay
                            ? report.growthBytesPerDay > 0
                                ? `~${formatBytes(report.growthBytesPerDay * 7)}/week`
                                : "Shrinking or flat"
                            : "Not enough history yet"}
                    </p>
                </div>
                {typeof report.projectedDaysUntilFull === "number" && (
                    <div>
                        <p className="text-muted text-xs">At this rate</p>
                        <p className="text-default text-sm">
                            ~{report.projectedDaysUntilFull} days until disk is full
                        </p>
                    </div>
                )}
            </div>

            {chartData.length >= 2 ? (
                <div style={{ height: 180, width: "100%" }}>
                    <ResponsiveContainer height="100%" width="100%">
                        <AreaChart data={chartData}>
                            <defs>
                                <linearGradient id="colorDbSize" x1="0" x2="0" y1="0" y2="1">
                                    <stop
                                        offset="5%"
                                        stopColor="var(--color-chart-1)"
                                        stopOpacity={0.4}
                                    />
                                    <stop
                                        offset="95%"
                                        stopColor="var(--color-chart-1)"
                                        stopOpacity={0}
                                    />
                                </linearGradient>
                            </defs>
                            <CartesianGrid stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                            <XAxis
                                dataKey="date"
                                fontSize={12}
                                stroke="#64748b"
                                tickFormatter={(value) =>
                                    new Date(
                                        typeof value === "number" ? value : String(value)
                                    ).toLocaleDateString("en-US", {
                                        day: "numeric",
                                        month: "short",
                                    })
                                }
                            />
                            <YAxis
                                fontSize={12}
                                stroke="#64748b"
                                tickFormatter={(value) => `${Math.round(value)}MB`}
                            />
                            <Tooltip
                                contentStyle={TOOLTIP_STYLE}
                                formatter={(value) => [`${Number(value).toFixed(1)} MB`, "Size"]}
                                labelFormatter={(value) =>
                                    new Date(
                                        typeof value === "number" ? value : String(value)
                                    ).toLocaleString("en-US", {
                                        day: "numeric",
                                        hour: "numeric",
                                        minute: "2-digit",
                                        month: "short",
                                    })
                                }
                                labelStyle={TOOLTIP_LABEL_STYLE}
                            />
                            <Area
                                dataKey="mb"
                                fill="url(#colorDbSize)"
                                fillOpacity={1}
                                isAnimationActive={false}
                                stroke="var(--color-chart-1)"
                                strokeWidth={2}
                                type="monotone"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            ) : (
                <p className="text-muted text-xs">
                    Check back in a bit — need a little more history before there's a trend to
                    chart.
                </p>
            )}
        </Card>
    );
}
