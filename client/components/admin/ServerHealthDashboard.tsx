"use client";

import {
    ArrowPathIcon,
    CheckCircleIcon,
    CircleStackIcon,
    ExclamationTriangleIcon,
    FolderIcon,
    SignalIcon,
    XCircleIcon,
} from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui";

interface ServerHealthDashboardProps {
    checks: {
        syncQueue?: {
            status: "healthy" | "warning" | "critical" | "unknown";
            message: string;
            totalUsers?: number;
            staleUsers?: number;
        };
        storage?: {
            status: "healthy" | "warning" | "critical" | "unknown";
            message: string;
            sizeMB?: number;
            fileCount?: number;
        };
        database?: {
            status: "healthy" | "warning" | "critical" | "unknown";
            message: string;
        };
        activity?: {
            status: "healthy" | "warning" | "critical" | "unknown";
            message: string;
            activeSessions?: number;
        };
    };
    metrics: {
        activeSessions: number;
        serverTime: string;
    };
    status: "healthy" | "warning" | "critical";
}

export function ServerHealthDashboard({ status, checks, metrics }: ServerHealthDashboardProps) {
    const statusConfig = {
        critical: { color: "error", icon: XCircleIcon, label: "Critical Issues Detected" },
        healthy: { color: "success", icon: CheckCircleIcon, label: "All Systems Operational" },
        warning: { color: "warning", icon: ExclamationTriangleIcon, label: "Degraded Performance" },
    } as const;

    const currentStatus = statusConfig[status];
    const StatusIcon = currentStatus.icon;

    return (
        <div className="space-y-6">
            {/* Overall Status */}
            <motion.div
                animate={{ opacity: 1, y: 0 }}
                className={`flex items-center gap-4 rounded-xl p-4 bg-${currentStatus.color}-muted border border-${currentStatus.color}/20`}
                initial={{ opacity: 0, y: -10 }}
            >
                <StatusIcon className={`h-8 w-8 text-${currentStatus.color}`} />
                <div className="flex-1">
                    <p className={`font-medium text-${currentStatus.color}`}>
                        {currentStatus.label}
                    </p>
                    <p className="text-muted text-sm">
                        {metrics.activeSessions} active sessions • Server time:{" "}
                        {new Date(metrics.serverTime).toLocaleTimeString()}
                    </p>
                </div>
                <Badge variant={currentStatus.color}>{status.toUpperCase()}</Badge>
            </motion.div>

            {/* Health Checks Grid */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <HealthCheckCard
                    check={checks.database}
                    icon={<CircleStackIcon className="h-5 w-5" />}
                    title="Database Connection"
                />
                <HealthCheckCard
                    check={checks.storage}
                    icon={<FolderIcon className="h-5 w-5" />}
                    title="Library Storage"
                />
                <HealthCheckCard
                    check={checks.syncQueue}
                    icon={<ArrowPathIcon className="h-5 w-5" />}
                    title="Sync Queue"
                />
                <HealthCheckCard
                    check={checks.activity}
                    icon={<SignalIcon className="h-5 w-5" />}
                    title="Active Sessions"
                />
            </div>
        </div>
    );
}

interface HealthCheckCardProps {
    check?: {
        status: "healthy" | "warning" | "critical" | "unknown";
        message: string;
        totalUsers?: number;
        staleUsers?: number;
        sizeMB?: number;
        fileCount?: number;
        activeSessions?: number;
    };
    icon: React.ReactNode;
    title: string;
}

function HealthCheckCard({ title, icon, check }: HealthCheckCardProps) {
    const statusColors = {
        critical: "error",
        healthy: "success",
        unknown: "default",
        warning: "warning",
    };

    const status = check?.status || "unknown";
    const color = statusColors[status];

    return (
        <motion.div
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl bg-surface-hover p-4"
            initial={{ opacity: 0, scale: 0.95 }}
        >
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className={`rounded-lg p-2 bg-${color}-muted`}>{icon}</div>
                    <div>
                        <p className="truncate font-medium text-default">{title}</p>
                        <p className="text-muted text-sm">{check?.message || "Status unknown"}</p>
                    </div>
                </div>
                <div className={`h-2 w-2 rounded-full bg-${color}`} />
            </div>

            {check && (
                <div className="mt-3 grid grid-cols-2 gap-2 border-default border-t pt-3 text-sm">
                    {check.totalUsers !== undefined && (
                        <div>
                            <span className="text-muted">Total Users:</span>{" "}
                            <span className="text-default">{check.totalUsers}</span>
                        </div>
                    )}
                    {check.staleUsers !== undefined && (
                        <div>
                            <span className="text-muted">Need Sync:</span>{" "}
                            <span
                                className={check.staleUsers > 10 ? "text-warning" : "text-default"}
                            >
                                {check.staleUsers}
                            </span>
                        </div>
                    )}
                    {check.sizeMB !== undefined && (
                        <div>
                            <span className="text-muted">Storage:</span>{" "}
                            <span className={check.sizeMB > 500 ? "text-warning" : "text-default"}>
                                {check.sizeMB} MB
                            </span>
                        </div>
                    )}
                    {check.fileCount !== undefined && (
                        <div>
                            <span className="text-muted">Files:</span>{" "}
                            <span className="text-default">{check.fileCount}</span>
                        </div>
                    )}
                    {check.activeSessions !== undefined && (
                        <div>
                            <span className="text-muted">Active:</span>{" "}
                            <span className="text-default">{check.activeSessions}</span>
                        </div>
                    )}
                </div>
            )}
        </motion.div>
    );
}
