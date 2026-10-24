"use client";

import { ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { Alert } from "@/lib/api";

interface AlertBannerProps {
    alerts: {
        critical: Alert[];
        warnings: Alert[];
        total: number;
        hasCritical: boolean;
    };
}

export function AlertBanner({ alerts }: AlertBannerProps) {
    const [dismissed, setDismissed] = useState(false);

    if (dismissed || !(alerts.critical.length || alerts.warnings.length)) {
        return null;
    }

    return (
        <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
            exit={{ opacity: 0, y: -20 }}
            initial={{ opacity: 0, y: -20 }}
        >
            <AnimatePresence>
                {alerts.critical.map((alert, idx) => (
                    <motion.div
                        animate={{ height: "auto", opacity: 1 }}
                        className="mb-3 flex items-center gap-4 rounded-xl border border-error/20 bg-error-muted p-4"
                        exit={{ height: 0, opacity: 0 }}
                        initial={{ height: 0, opacity: 0 }}
                        key={`critical-${idx}`}
                    >
                        <ExclamationTriangleIcon className="h-6 w-6 flex-shrink-0 text-error" />
                        <div className="flex-1">
                            <p className="font-medium text-error">{alert.message}</p>
                            {alert.users && alert.users.length > 0 && (
                                <p className="mt-1 text-error/70 text-sm">
                                    Users: {alert.users.join(", ")}
                                    {alert.count > alert.users.length &&
                                        ` +${alert.count - alert.users.length} more`}
                                </p>
                            )}
                        </div>
                        <button
                            className="rounded-lg p-1 text-error hover:bg-error/10"
                            onClick={() => setDismissed(true)}
                            type="button"
                        >
                            <XMarkIcon className="h-5 w-5" />
                        </button>
                    </motion.div>
                ))}
            </AnimatePresence>
        </motion.div>
    );
}
