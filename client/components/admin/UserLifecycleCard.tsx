"use client";

import { CheckIcon, UserIcon, UsersIcon } from "@heroicons/react/24/outline";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { StatCard } from "@/components/ui";
import type { AdminMetrics } from "@/lib/api";

interface UserLifecycleCardProps {
    lifecycle: AdminMetrics["userLifecycle"];
    userJoins: Array<{ date: string; count: number }>;
}

export function UserLifecycleCard({ lifecycle, userJoins }: UserLifecycleCardProps) {
    const { retention } = lifecycle;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard
                    icon={<UsersIcon className="h-5 w-5" />}
                    label="Total Users"
                    value={retention.total.toString()}
                />
                <StatCard
                    icon={<CheckIcon className="h-5 w-5" />}
                    label="Active (7d)"
                    value={`${retention.active7d} (${retention.rate7d}%)`}
                />
                <StatCard
                    icon={<CheckIcon className="h-5 w-5" />}
                    label="Active (30d)"
                    value={`${retention.active30d} (${retention.rate30d}%)`}
                />
                <StatCard
                    icon={<UserIcon className="h-5 w-5" />}
                    label="At Risk"
                    value={lifecycle.atRisk.length.toString()}
                />
            </div>

            <div className="h-48">
                <ResponsiveContainer height="100%" width="100%">
                    <AreaChart data={userJoins}>
                        <defs>
                            <linearGradient id="colorSignups" x1="0" x2="0" y1="0" y2="1">
                                <stop
                                    offset="5%"
                                    stopColor="var(--color-primary)"
                                    stopOpacity={0.3}
                                />
                                <stop
                                    offset="95%"
                                    stopColor="var(--color-primary)"
                                    stopOpacity={0}
                                />
                            </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                        <XAxis
                            dataKey="date"
                            fontSize={12}
                            stroke="#64748b"
                            tickFormatter={(value) => {
                                const date = new Date(
                                    typeof value === "number" ? value : String(value)
                                );
                                return date.toLocaleDateString("en-US", {
                                    day: "numeric",
                                    month: "short",
                                    timeZone: "UTC",
                                });
                            }}
                        />
                        <YAxis fontSize={12} stroke="#64748b" />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: "rgba(20, 20, 35, 0.95)",
                                border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: "12px",
                            }}
                            labelFormatter={(value) => {
                                const date = new Date(
                                    typeof value === "number" ? value : String(value)
                                );
                                return date.toLocaleDateString("en-US", {
                                    day: "numeric",
                                    month: "long",
                                    timeZone: "UTC",
                                    year: "numeric",
                                });
                            }}
                        />
                        <Area
                            dataKey="count"
                            fill="url(#colorSignups)"
                            fillOpacity={1}
                            stroke="var(--color-primary)"
                            type="monotone"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
