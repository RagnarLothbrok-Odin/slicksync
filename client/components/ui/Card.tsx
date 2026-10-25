"use client";

import clsx from "clsx";
import { type HTMLMotionProps, motion, useReducedMotion } from "framer-motion";
import { useLayoutMode } from "@/lib/layout-mode";

interface CardProps extends HTMLMotionProps<"div"> {
    children: React.ReactNode;
    padding?: "none" | "sm" | "md" | "lg";
    variant?: "default" | "elevated" | "bordered" | "interactive" | "aurora";
}

const paddingStyles = {
    lg: "p-5",
    md: "p-4",
    none: "",
    sm: "p-3",
};

// Card and StatCard both check layoutMode directly rather than requiring
// every page that renders one to pass a prop through - pages like Settings
// and Tasks are built almost entirely out of independent <Card> sections
// (not the toolbar+grid shape Dashboard/Activity/Users/Groups/Addons have),
// so making the shared component itself Nebula-aware upgrades all of them
// to the glass-panel look for free, instead of needing a second styled
// copy of every section on every such page.
export function Card({
    variant = "default",
    padding = "md",
    children,
    className,
    style,
    ...props
}: CardProps) {
    const { layoutMode } = useLayoutMode();
    const isInteractive = variant === "interactive";
    const isAurora = variant === "aurora";
    const isNebula = layoutMode === "nebula" && !isAurora;

    return (
        <motion.div
            className={clsx(
                "interface-card relative overflow-hidden rounded-2xl",
                isInteractive && "interface-card-interactive",
                paddingStyles[padding],
                variant === "bordered" && "accent-border",
                !isAurora && (isNebula ? "card-bg-nebula" : "card-bg-plain"),
                className
            )}
            style={{
                background: isAurora
                    ? "linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%)"
                    : undefined,

                border: isAurora ? "none" : "1px solid var(--color-surface-border)",
                boxShadow: isAurora
                    ? "0 12px 32px -12px var(--color-primary)"
                    : "0 1px 2px rgb(0 0 0 / 0.04)",
                ...style,
            }}
            transition={{ bounce: 0, duration: 0.3, type: "spring" }}
            whileHover={undefined}
            {...props}
        >
            {children}
        </motion.div>
    );
}

// Stat Card Component
interface StatCardProps {
    delay?: number;
    icon?: React.ReactNode;
    label: string;
    onClick?: () => void;
    trend?: { value: number; isPositive: boolean };
    value: string | number;
}

export function StatCard({ label, value, icon, trend, delay = 0, onClick }: StatCardProps) {
    const { layoutMode } = useLayoutMode();
    const reduceMotion = useReducedMotion();
    const isNebula = layoutMode === "nebula";
    return (
        <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={`interface-card group relative min-h-[112px] overflow-hidden rounded-2xl p-5 ${onClick ? "cursor-pointer" : ""} ${isNebula ? "card-bg-nebula" : "card-bg-plain"}`}
            initial={false}
            onClick={onClick}
            onKeyDown={
                onClick
                    ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onClick();
                          }
                      }
                    : undefined
            }
            role={onClick ? "button" : undefined}
            style={{
                border: "1px solid var(--color-surface-border)",
            }}
            tabIndex={onClick ? 0 : undefined}
            transition={{ delay, duration: 0.4 }}
            whileHover={onClick && !reduceMotion ? { y: -2 } : undefined}
        >
            {/* Hover glow */}
            <div
                className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{ background: "var(--color-primaryMuted)" }}
            />

            <div className="relative flex h-full items-start justify-between">
                <div className="flex h-full flex-col justify-between">
                    <p className="font-medium text-xs" style={{ color: "var(--color-text-muted)" }}>
                        {label}
                    </p>
                    <div>
                        <motion.p
                            animate={{ scale: 1 }}
                            className="font-bold font-display text-2xl"
                            initial={false}
                            style={{ color: "var(--color-text)" }}
                            transition={{ delay: delay + 0.1, stiffness: 200, type: "spring" }}
                        >
                            {typeof value === "number" ? value.toLocaleString() : value}
                        </motion.p>
                        {trend ? (
                            <div
                                className={`mt-0.5 flex items-center gap-1 font-medium text-xs ${trend.isPositive ? "text-success" : "text-error"}`}
                            >
                                <span>{trend.isPositive ? "↑" : "↓"}</span>
                                <span>{Math.abs(trend.value)}%</span>
                            </div>
                        ) : (
                            <div className="h-4" /> /* Spacer for consistent height */
                        )}
                    </div>
                </div>
                {icon && (
                    <div
                        className="flex h-9 w-9 items-center justify-center rounded-lg"
                        style={{
                            background: "var(--color-primaryMuted)",
                            color: "var(--color-primary)",
                        }}
                    >
                        {icon}
                    </div>
                )}
            </div>
        </motion.div>
    );
}
