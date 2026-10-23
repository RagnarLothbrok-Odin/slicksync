'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';
import { PageContainer } from '@/components/layout/PageContainer';

interface UserPageContainerProps {
  children: ReactNode;
  className?: string;
}

/**
 * Page container for a person's own pages: the admin pages' own container
 * and background under the shared top bar (PersonTopbar), with the content
 * as wide as the bar so the two line up.
 */
export function UserPageContainer({ children, className }: UserPageContainerProps) {
  return (
    <PageContainer noSidebarOffset className={className}>
      <div className="mx-auto" style={{ maxWidth: 'min(120rem, 92vw)' }}>
        {children}
      </div>
    </PageContainer>
  );
}

// Page header component for user pages
interface UserPageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function UserPageHeader({ title, subtitle, actions }: UserPageHeaderProps) {
  // No menu button here any more - the top bar above carries the navigation.
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      className="interface-heading flex items-end justify-between mb-7 gap-4 flex-wrap"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <h1
            className="font-bold font-display break-words"
            style={{ color: 'var(--color-text)' }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center justify-end gap-3 flex-wrap ml-auto max-w-full">{actions}</div>}
    </motion.div>
  );
}
