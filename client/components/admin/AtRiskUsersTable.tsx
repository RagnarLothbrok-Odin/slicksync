"use client";

import { motion } from "framer-motion";
import { Avatar, Badge } from "@/components/ui";
import type { AtRiskUser } from "@/lib/api";

interface AtRiskUsersTableProps {
    atRiskUsers: AtRiskUser[];
    criticalUsers: AtRiskUser[];
    onUserClick: (user: AtRiskUser) => void;
}

export function AtRiskUsersTable({
    atRiskUsers,
    criticalUsers,
    onUserClick,
}: AtRiskUsersTableProps) {
    const allUsers = [...criticalUsers, ...atRiskUsers];

    if (allUsers.length === 0) {
        return (
            <div className="py-8 text-center text-muted">
                No at-risk users - everyone is active!
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {allUsers.map((user, index) => (
                <motion.div
                    animate={{ opacity: 1, x: 0 }}
                    className="flex cursor-pointer items-center gap-4 rounded-xl bg-surface-hover p-3 transition-colors hover:bg-surface"
                    initial={{ opacity: 0, x: -20 }}
                    key={user.id}
                    onClick={() => onUserClick(user)}
                    transition={{ delay: index * 0.05 }}
                >
                    <Avatar name={user.username} size="md" />

                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="truncate font-medium text-default">
                                {user.username}
                            </span>
                            {user.neverWatched ? (
                                <Badge size="sm" variant="error">
                                    Never Watched
                                </Badge>
                            ) : user.daysInactive >= 60 ? (
                                <Badge size="sm" variant="error">
                                    Critical
                                </Badge>
                            ) : (
                                <Badge size="sm" variant="warning">
                                    At Risk
                                </Badge>
                            )}
                        </div>
                        <p className="truncate text-muted text-sm">{user.email}</p>
                    </div>

                    <div className="text-right">
                        <p className="font-medium text-default text-sm">
                            {user.daysInactive} days inactive
                        </p>
                        <p className="text-muted text-xs">
                            {user.totalWatchTimeHours}h total watch time
                        </p>
                    </div>
                </motion.div>
            ))}
        </div>
    );
}
