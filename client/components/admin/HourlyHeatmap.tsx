"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HourlyActivity } from "@/lib/api";

interface HourlyHeatmapProps {
    hourlyActivity: HourlyActivity[];
    peakHour: number;
}

export function HourlyHeatmap({ hourlyActivity, peakHour }: HourlyHeatmapProps) {
    const formatHour = (hour: number) => {
        const period = hour >= 12 ? "PM" : "AM";
        const displayHour = hour % 12 || 12;
        return `${displayHour} ${period}`;
    };

    const data = hourlyActivity.map((h) => ({
        ...h,
        hourLabel: formatHour(h.hour),
        isPeak: h.hour === peakHour,
    }));

    return (
        <div className="space-y-4">
            <div className="text-muted text-sm">
                Peak activity at{" "}
                <span className="font-medium text-primary">{formatHour(peakHour)}</span>
            </div>
            <div className="h-48">
                <ResponsiveContainer height="100%" width="100%">
                    <BarChart data={data}>
                        <CartesianGrid stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                        <XAxis dataKey="hourLabel" fontSize={10} interval={2} stroke="#64748b" />
                        <YAxis fontSize={12} stroke="#64748b" />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: "rgba(20, 20, 35, 0.95)",
                                border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: "12px",
                            }}
                        />
                        <Bar dataKey="sessions" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
