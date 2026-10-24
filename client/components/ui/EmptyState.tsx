import type { ReactNode } from "react";

interface EmptyStateProps {
    action?: ReactNode;
    description: string;
    icon?: ReactNode;
    title: string;
}

/** A quiet explanation of what belongs here and how it will appear. */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
    return (
        <div className="interface-empty flex flex-col items-center px-5 py-10 text-center">
            {icon && (
                <div
                    aria-hidden
                    className="interface-empty-icon mb-4 flex items-center justify-center rounded-2xl"
                >
                    {icon}
                </div>
            )}
            <p className="font-semibold text-default text-sm">{title}</p>
            <p className="mt-2 text-muted text-sm leading-relaxed" style={{ maxWidth: "19rem" }}>
                {description}
            </p>
            {action && <div className="mt-5">{action}</div>}
        </div>
    );
}
