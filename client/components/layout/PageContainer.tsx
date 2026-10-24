'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface PageContainerProps {
  children: ReactNode;
  className?: string;
  // Set by AdminClientLayout when Nebula layout mode is rendering its own
  // top-nav chrome instead of the sidebar for this page - without this, the
  // page content would still be offset by the sidebar's width even though
  // nothing is actually reserving that space.
  noSidebarOffset?: boolean;
}

export function PageContainer({ children, className, noSidebarOffset }: PageContainerProps) {
  const offsetClass = noSidebarOffset ? '' : 'ml-0 md:ml-60';
  return (
    <motion.main
      initial={false} // shown at once - no fade on every page open
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={`${offsetClass} min-h-screen ${className || ''}`}
      style={{ background: 'var(--color-bg)' }}
    >
      {/* Content */}
      <div className="relative">
        {children}
      </div>
    </motion.main>
  );
}

// Page section with animation
interface PageSectionProps {
  children: ReactNode;
  delay?: number;
  className?: string;
}

export function PageSection({ children, delay = 0, className }: PageSectionProps) {
  return (
    <motion.section
      initial={false} // at once, not one section after another
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

// Staggered list container - only animates on first mount
interface StaggerContainerProps {
  children: ReactNode;
  className?: string;
}

export function StaggerContainer({ children, className }: StaggerContainerProps) {
  return (
    <div className={className}>
      {children}
    </div>
  );
}

// Stagger item - the wrapper around individual rows/cards in most lists.
interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  /** Opt in to Framer's layout animation, which smoothly slides siblings
      when an item is reordered or removed.
     
      Off by default, and that default is load-bearing. `layout` makes
      Framer measure EVERY element carrying it on any layout change
      anywhere in the tree, then animate each one. This component wraps
      every row on a dozen pages, so on a list of any real size a single
      unrelated change - closing a modal, a filter toggling, a route
      transition - turned into hundreds of getBoundingClientRect calls plus
      hundreds of concurrent animations. On desktop that reads as a stutter;
      on an iPhone it's a multi-second freeze, and it got steadily worse as
      more list pages were added.
     
      Turn it on only for a list that genuinely reorders in place AND is
      short. Note that it actively fights dnd-kit, which applies its own
      transforms to the same element during a drag. */
  animateLayout?: boolean;
}

export function StaggerItem({ children, className, animateLayout = false }: StaggerItemProps) {
  return (
    <motion.div
      layout={animateLayout}
      initial={false} // at once; the exit below still plays when a row is removed
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
