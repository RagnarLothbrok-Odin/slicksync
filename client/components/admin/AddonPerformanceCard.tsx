"use client";

import { ChartPieIcon, PuzzlePieceIcon, UsersIcon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Badge, StatCard } from "@/components/ui";
import type { AddonStat, ResourceStat } from "@/lib/api";

interface AddonPerformanceCardProps {
    activeAddons: number;
    byResource: ResourceStat[];
    topAddons: AddonStat[];
    totalAddons: number;
}

const COLORS = [
    "#7c3aed", // Violet
    "#ec4899", // Pink
    "#10b981", // Emerald
    "#f59e0b", // Amber
    "#3b82f6", // Blue
    "#ef4444", // Red
    "#06b6d4", // Cyan
    "#8b5cf6", // Purple
];

export function AddonPerformanceCard({
    totalAddons,
    activeAddons,
    topAddons,
    byResource,
}: AddonPerformanceCardProps) {
    const totalResourceCount = byResource.reduce((sum, r) => sum + r.count, 0);
    const pieData = byResource.slice(0, 4).map((r, index) => {
        const percentage =
            totalResourceCount > 0 ? Math.round((r.count / totalResourceCount) * 100) : 0;
        return {
            color: COLORS[index % COLORS.length],
            name: r.name,
            percentage,
            value: r.count,
        };
    });

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatCard
                    icon={<PuzzlePieceIcon className="h-5 w-5" />}
                    label="Total Addons"
                    value={totalAddons.toString()}
                />
                <StatCard
                    icon={<CheckIcon className="h-5 w-5" />}
                    label="Active Addons"
                    value={activeAddons.toString()}
                />
                <StatCard
                    icon={<UsersIcon className="h-5 w-5" />}
                    label="Top Addon Users"
                    value={topAddons[0]?.userCount?.toString() || "0"}
                />
                <StatCard
                    icon={<ChartPieIcon className="h-5 w-5" />}
                    label="Addon Type"
                    value={byResource.length.toString()}
                />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Top Addons List */}
                <div className="space-y-3">
                    <h4 className="font-medium text-default">Top Addons by Usage</h4>
                    <div className="space-y-2">
                        {topAddons.slice(0, 5).map((addon, index) => (
                            <motion.div
                                animate={{ opacity: 1, x: 0 }}
                                className="flex items-center gap-3 rounded-xl bg-surface-hover p-3"
                                initial={{ opacity: 0, x: -20 }}
                                key={addon.id}
                                transition={{ delay: index * 0.05 }}
                            >
                                {addon.iconUrl ? (
                                    <img
                                        alt={addon.name}
                                        className="h-10 w-10 rounded-lg object-cover"
                                        src={addon.iconUrl}
                                    />
                                ) : (
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface">
                                        <PuzzlePieceIcon className="h-5 w-5 text-muted" />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium text-default">
                                        {addon.name}
                                    </p>
                                    <div className="flex items-center gap-2 text-muted text-sm">
                                        <span>{addon.userCount} users</span>
                                        <span>•</span>
                                        <span>{addon.usageRate}% usage</span>
                                    </div>
                                </div>
                                <Badge size="sm" variant={addon.isActive ? "success" : "default"}>
                                    {addon.isActive ? "Active" : "Inactive"}
                                </Badge>
                            </motion.div>
                        ))}
                    </div>
                </div>

                {/* Resource Breakdown Pie Chart */}
                <div className="space-y-3">
                    <h4 className="font-medium text-default">Addon Type</h4>
                    <div className="h-48">
                        <ResponsiveContainer height="100%" width="100%">
                            <PieChart>
                                <Pie
                                    cx="50%"
                                    cy="50%"
                                    data={pieData}
                                    dataKey="value"
                                    innerRadius={40}
                                    label={({ percent = 0 }) => `${(percent * 100).toFixed(0)}%`}
                                    labelLine={false}
                                    outerRadius={65}
                                    paddingAngle={5}
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell fill={entry.color} key={`cell-${index}`} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    formatter={(value: any, name: any, props: any) => [
                                        `${value} (${props.payload.percentage}%)`,
                                        name,
                                    ]}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                        {pieData.map((item, _index) => (
                            <div className="group flex items-center gap-2" key={item.name}>
                                <div
                                    className="h-3.5 w-3.5 rounded-full shadow-sm transition-transform group-hover:scale-110"
                                    style={{ background: item.color }}
                                />
                                <div className="flex flex-col">
                                    <span className="font-medium text-default text-sm capitalize leading-none">
                                        {item.name}
                                    </span>
                                    <span className="font-bold text-[11px] text-primary">
                                        {item.percentage}%
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Helper icon component
function CheckIcon({ className }: { className?: string }) {
    return (
        <svg
            aria-hidden="true"
            className={className}
            fill="none"
            focusable="false"
            stroke="currentColor"
            viewBox="0 0 24 24"
        >
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
        </svg>
    );
}
