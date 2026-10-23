'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ComponentType, Fragment, ReactNode, useEffect, useId, useState, useSyncExternalStore, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { useIsTV } from '@/lib/hooks/useIsTV';
import { TVFocusable } from '@/components/tv/TVFocusable';
import { SlickSyncLogo } from '@/components/ui/SlickSyncLogo';
import { ScrollRow } from '@/components/ui/ScrollRow';

function isNavItemActive(pathname: string, href: string, homeHref = '/') {
  if (href === homeHref) return pathname === homeHref;
  return pathname === href || pathname.startsWith(href + '/');
}

export type NebulaNavSection = {
  id: string;
  items: { href: string; label: string; icon: ComponentType<{ className?: string }> }[];
};

function subscribeToViewport(onChange: () => void) {
  const query = window.matchMedia('(max-width: 1279px)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const compactViewport = () => window.matchMedia('(max-width: 1279px)').matches;
const serverViewport = () => false;

/** Shared admin and personal navigation. TV keeps every destination visible;
 * touch screens open an explicit menu, while desktop collapses on scroll. */
export function NebulaBar({ sections, homeHref, menu, account }: {
  sections: NebulaNavSection[];
  homeHref: string;
  menu: { isOpen: boolean; onOpen: () => void; onClose: () => void };
  account: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isTV = useIsTV();
  const reduceMotion = useReducedMotion();
  const navId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const isCompact = useSyncExternalStore(subscribeToViewport, compactViewport, serverViewport);
  const { isOpen, onOpen, onClose } = menu;

  useEffect(() => {
    if (isTV) return;
    // Hysteresis exceeds the space released by the nav. A collapse cannot
    // clamp the scroll position past the expand threshold and oscillate.
    let collapsed = window.scrollY > 160;
    let frame = requestAnimationFrame(() => setIsScrolled(collapsed));
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = collapsed ? window.scrollY > 8 : window.scrollY > 160;
        if (next !== collapsed) {
          collapsed = next;
          setIsScrolled(next);
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll); };
  }, [isTV]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); menuButtonRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const navVisible = isTV || isOpen || (!isCompact && !isScrolled);
  const showMenu = !isTV && (isCompact || isScrolled);

  return (
    <>
      <div className="interface-account fixed bottom-4 left-4 md:bottom-6 md:left-6 z-40">
        {account}
      </div>
      {/* The action cluster measures these two anchors when the page title
          scrolls out of view. Keep the logo row clear at the right edge. */}
      <header data-nebula-topbar data-menu-open={isOpen} className={`interface-topbar sticky top-0 z-30 ${isTV ? 'interface-topbar-tv' : ''}`}>
        <div className="nebula-bar-panel interface-nav-material">
          <div data-nebula-logo-row className="interface-brand-row relative flex items-center">
            {showMenu && (
              <button
                ref={menuButtonRef}
                type="button"
                onClick={isOpen ? onClose : onOpen}
                className="interface-menu-button flex items-center justify-center shrink-0 rounded-xl"
                aria-label={isOpen ? 'Close navigation' : 'Open navigation'}
                aria-expanded={isOpen}
                aria-controls={navId}
              >
                {isOpen ? <XMarkIcon className="w-5 h-5" /> : <Bars3Icon className="w-5 h-5" />}
              </button>
            )}
            <Link href={homeHref} aria-label="SlickSync home" className="interface-brand inline-flex items-center gap-2.5 min-w-0">
              <span className="interface-brand-mark flex items-center justify-center shrink-0 rounded-xl">
                <SlickSyncLogo className="w-5 h-5" />
              </span>
              <span className="text-base font-semibold tracking-tight text-default">SlickSync</span>
            </Link>
            <span className="interface-brand-caption text-xs text-muted">Your media, together.</span>
          </div>
          <AnimatePresence initial={false}>
            {navVisible && (
              <motion.nav
                id={navId}
                aria-label="Main navigation"
                initial={reduceMotion || isTV ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={reduceMotion ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="interface-nav-sections">
                  {sections.map((section) => (
                    <ScrollRow key={section.id} className="interface-nav-row flex flex-nowrap items-center gap-1 w-full">
                      {section.items.map((link) => {
                        const active = isNavItemActive(pathname, link.href, homeHref);
                        const Icon = link.icon;
                        const navLink = (
                          <Link
                            href={link.href}
                            tabIndex={isTV ? -1 : undefined}
                            onClick={onClose}
                            aria-current={active ? 'page' : undefined}
                            className={`interface-nav-link nav-item-hover-pill flex items-center gap-2 rounded-xl whitespace-nowrap ${active ? 'nebula-link-on' : 'text-muted'}`}
                          >
                            <Icon className="w-4 h-4 shrink-0" />
                            {link.label}
                          </Link>
                        );
                        // Fresh nodes avoid stale hover paint after navigation in
                        // Firefox. Norigin still owns activation on TV remotes.
                        return isTV ? (
                          <TVFocusable key={`${link.href}-${pathname}`} onEnterPress={() => router.push(link.href)}>{navLink}</TVFocusable>
                        ) : <Fragment key={`${link.href}-${pathname}`}>{navLink}</Fragment>;
                      })}
                    </ScrollRow>
                  ))}
                </div>
              </motion.nav>
            )}
          </AnimatePresence>
        </div>
      </header>
    </>
  );
}
