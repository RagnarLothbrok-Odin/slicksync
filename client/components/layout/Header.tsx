'use client';

import { motion } from 'framer-motion';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { TopbarActions } from './TopbarActions';
import { useMobileMenu } from '@/app/(admin)/AdminClientLayout';

interface HeaderProps {
  title: React.ReactNode;
  subtitle?: string;
  actions?: React.ReactNode;
  // Navigation controls precede the title; page actions stay at the end
  // of the row, matching NebulaPageHeading.
  leading?: React.ReactNode;
  activities?: any[];
  inviteHistory?: any[];
  taskHistory?: any[];
  onMenuClick?: () => void;
  isMobileMenuOpen?: boolean;
}

export function Header({
  title,
  subtitle,
  actions,
  leading,
  activities = [],
  inviteHistory = [],
  taskHistory = [],
  onMenuClick: onMenuClickProp,
  isMobileMenuOpen: isMobileMenuOpenProp
}: HeaderProps) {
  const { onOpen: onMenuClickContext, isOpen: isMobileMenuOpenContext } = useMobileMenu();
  
  // Use provided props or fall back to context
  const onMenuClick = onMenuClickProp || onMenuClickContext;
  const isMobileMenuOpen = isMobileMenuOpenProp !== undefined ? isMobileMenuOpenProp : isMobileMenuOpenContext;


  return (
    <header className="interface-page-header sticky top-0 z-30">
      <div className="px-4 md:px-8 py-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={onMenuClick}
            className="md:hidden p-2 rounded-xl hover:bg-surface-hover text-default"
            aria-label="Open navigation" aria-expanded={isMobileMenuOpen}>
            <Bars3Icon className="w-5 h-5" />
          </button>
          <div>
            {leading && <div className="mb-3">{leading}</div>}
            <h1 className="text-2xl md:text-3xl font-bold font-display text-default">{title}</h1>
            {subtitle && <p className="text-sm text-muted mt-2">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 flex-wrap ml-auto">
          {actions}
          <TopbarActions activities={activities} inviteHistory={inviteHistory} taskHistory={taskHistory} />
        </div>
      </div>
    </header>
  );
}

// Breadcrumbs component
interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav className={`flex items-center gap-2 ${className || 'text-sm'}`} style={{ color: 'var(--color-text-muted)' }}>
      {items.map((item, index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.05 }}
          className="flex items-center gap-2"
        >
          {index > 0 && <span style={{ color: 'var(--color-text-subtle)' }}>/</span>}
          {item.href ? (
            <a
              href={item.href}
              className="transition-colors hover:text-[var(--color-text)]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {item.label}
            </a>
          ) : (
            <span style={{ color: 'var(--color-text)' }}>{item.label}</span>
          )}
        </motion.div>
      ))}
    </nav>
  );
}
