import { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

/** A quiet explanation of what belongs here and how it will appear. */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="interface-empty flex flex-col items-center text-center px-5 py-10">
      {icon && <div aria-hidden className="interface-empty-icon flex items-center justify-center rounded-2xl mb-4">{icon}</div>}
      <p className="text-sm font-semibold text-default">{title}</p>
      <p className="text-sm text-muted mt-2 leading-relaxed" style={{ maxWidth: '19rem' }}>{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
