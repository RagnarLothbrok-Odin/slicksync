import { ReactNode } from 'react';

interface MetricStripProps {
  items: { label: string; value: string | number; icon?: ReactNode }[];
}

/** Secondary totals share one reading line, leaving the content in focus. */
export function MetricStrip({ items }: MetricStripProps) {
  return (
    <dl className="metric-strip">
      {items.map((item) => (
        <div key={item.label} className="metric-strip-item">
          <dt className="flex items-center gap-2 text-xs text-muted">
            {item.icon && <span aria-hidden className="metric-strip-icon">{item.icon}</span>}
            {item.label}
          </dt>
          <dd className="interface-stat-value text-2xl font-semibold text-default mt-2">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
