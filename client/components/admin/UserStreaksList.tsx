"use client";

import { ArrowTrendingUpIcon, FireIcon } from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { UserAvatar } from "@/components/ui";
import { api } from "@/lib/api";

interface UserData {
    avatarUrl?: string | null;
    email?: string;
    id: string;
    name: string;
    useGravatar?: boolean;
}

interface UserStreaksData {
    avatarUrl?: string | null;
    currentStreak: number;
    email?: string;
    longestStreak: number;
    useGravatar?: boolean;
    userId: string;
    username: string;
}

interface UserStreaksListProps {
    users: UserData[];
}

export function UserStreaksList({ users }: UserStreaksListProps) {
    const [streaks, setStreaks] = useState<UserStreaksData[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchStreaks() {
            if (users.length === 0) {
                setLoading(false);
                return;
            }

            try {
                const streaksData = await Promise.all(
                    users.slice(0, 5).map(async (user) => {
                        try {
                            const data = await api.getUserStreaks(user.id);
                            return {
                                avatarUrl: user.avatarUrl,
                                currentStreak: data.currentStreak || 0,
                                email: user.email,
                                longestStreak: data.longestStreak || 0,
                                useGravatar: user.useGravatar,
                                userId: user.id,
                                username: user.name,
                            };
                        } catch {
                            return null;
                        }
                    })
                );

                setStreaks(streaksData.filter(Boolean) as UserStreaksData[]);
            } catch (error) {
                console.error("Error fetching streaks:", error);
            } finally {
                setLoading(false);
            }
        }

        fetchStreaks();
    }, [users]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="flex items-center gap-2 text-muted text-sm">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    <span>Loading streaks...</span>
                </div>
            </div>
        );
    }

    if (streaks.length === 0) {
        return <div className="py-8 text-center text-muted text-sm">No streak data available</div>;
    }

    // Sort by current streak
    const sortedStreaks = [...streaks].sort((a, b) => b.currentStreak - a.currentStreak);

    return (
        <div className="space-y-3">
            {sortedStreaks.map((user, index) => (
                <motion.div
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-4 overflow-hidden rounded-xl bg-surface-hover p-4"
                    initial={{ opacity: 0, x: -20 }}
                    key={user.userId}
                    transition={{ delay: index * 0.1 }}
                >
                    <div className="flex-shrink-0">
                        <UserAvatar
                            email={user.email}
                            name={user.username}
                            size="md"
                            src={user.useGravatar ? undefined : (user.avatarUrl ?? undefined)}
                            useGravatar={user.useGravatar}
                            userId={user.userId}
                        />
                    </div>

                    <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-default">{user.username}</p>
                        <div className="mt-1 flex items-center gap-4 text-muted text-sm">
                            <span className="flex items-center gap-1">
                                <FireIcon className="h-4 w-4" />
                                {user.currentStreak} day{user.currentStreak === 1 ? "" : "s"}{" "}
                                current
                            </span>
                            <span className="flex items-center gap-1">
                                <ArrowTrendingUpIcon className="h-4 w-4" />
                                {user.longestStreak} day{user.longestStreak === 1 ? "" : "s"} best
                            </span>
                        </div>
                    </div>
                </motion.div>
            ))}
        </div>
    );
}
