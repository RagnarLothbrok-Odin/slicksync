import type { ReactNode } from "react";

interface MetricStripProps {
    items: { label: string; value: string | number; icon?: ReactNode }[];
}

/** Secondary totals share one reading line, leaving the content in focus. */
export function MetricStrip({ items }: MetricStripProps) {
    return (
        <dl className="metric-strip">
            {items.map((item) => (
                <div className="metric-strip-item" key={item.label}>
                    <dt className="flex items-center gap-2 text-muted text-xs">
                        {item.icon && (
                            <span aria-hidden className="metric-strip-icon">
                                {item.icon}
                            </span>
                        )}
                        {item.label}
                    </dt>
                    <dd className="interface-stat-value mt-2 font-semibold text-2xl text-default">
                        {item.value}
                    </dd>
                </div>
            ))}
        </dl>
    );
}
