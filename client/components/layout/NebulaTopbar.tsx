'use client';

import { ReactNode, useEffect, useState } from 'react';
import {
  HomeIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  ChartBarIcon,
  UsersIcon,
  UserGroupIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
  EnvelopeIcon,
  RectangleStackIcon,
} from '@heroicons/react/24/outline';
import { TopbarActions } from '@/components/layout/TopbarActions';
import { PanelSwitcher } from './PanelSwitcher';
import { api } from '@/lib/api';
import { useMobileMenu } from '@/app/(admin)/AdminClientLayout';
import { NebulaBar, type NebulaNavSection } from './NebulaBar';

// Navigation keeps the same destinations as the sidebar. Account and system
// actions remain available through PanelSwitcher in both layouts.
const NEBULA_NAV_SECTIONS: NebulaNavSection[] = [
  {
    id: 'overview',
    items: [
      { href: '/', label: 'Dashboard', icon: HomeIcon },
      { href: '/activity', label: 'Activity', icon: ClockIcon },
      { href: '/metrics', label: 'Metrics', icon: ChartBarIcon },
      { href: '/users', label: 'Users', icon: UsersIcon },
      { href: '/groups', label: 'Groups', icon: UserGroupIcon },
    ],
  },
  {
    id: 'management',
    items: [
      { href: '/discover', label: 'Discover', icon: MagnifyingGlassIcon },
      { href: '/catalogs', label: 'Catalogs', icon: RectangleStackIcon },
      { href: '/addons', label: 'Addons', icon: PuzzlePieceIcon },
      { href: '/vault', label: 'Vault', icon: ShieldCheckIcon },
      { href: '/invitations', label: 'Invitations', icon: EnvelopeIcon },
    ],
  },
];

/** The admin pages' bar: their nav rows, and the admin account button. */
export function NebulaTopbar() {
  // Reuses the same open/close state Original layout's Sidebar drawer
  // already gets from AdminClientLayout - the two never render at once.
  const menu = useMobileMenu();
  // Mirrors Sidebar.tsx's own account-info fetch - Nebula's topbar had no
  // equivalent of the sidebar's bottom "Administrator" panel switcher at
  // all, so there was no way to see who's logged in, switch to the User
  // panel, or log out from this layout.
  const [accountInfo, setAccountInfo] = useState<{ username?: string; email?: string | null; uuid?: string | null; linkedProvider?: 'stremio' | 'nuvio' | null; avatarUrl?: string | null } | null>(null);
  const isPublicInstance = (process.env.NEXT_PUBLIC_INSTANCE_TYPE || 'private') === 'public';

  useEffect(() => {
    api.getAccountStats()
      .then((stats) => {
        const uuid = stats.uuid || null;
        const email = stats.email || null;
        setAccountInfo({
          username: isPublicInstance ? (uuid || email || 'Admin') : 'Administrator',
          email,
          uuid,
          linkedProvider: stats.linkedProvider || null,
          avatarUrl: stats.avatarUrl || null,
        });
      })
      .catch(() => {});
  }, [isPublicInstance]);

  // Ends the session on the server too (api.logout) - dropping the local
  // token alone left the cookies, and so the session, alive.
  const handleLogout = async () => {
    await api.logout();
    window.location.href = '/login?mode=admin';
  };

  return (
    <NebulaBar
      sections={NEBULA_NAV_SECTIONS}
      homeHref="/"
      menu={menu}
      account={<PanelSwitcher mode="admin" userInfo={accountInfo} onLogout={handleLogout} variant="compact" align="left" />}
    />
  );
}

/** Page identity and actions share a stable, left-aligned reading axis. */
export function NebulaPageHeading({ title, subtitle, actions, stats, leading }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  stats?: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <div className="interface-heading flex flex-col gap-5">
      {leading && <div className="flex items-center">{leading}</div>}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-default">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 flex-wrap max-w-full ml-auto">
          {actions}
          <TopbarActions />
        </div>
      </div>
      {stats && <div className="flex items-center">{stats}</div>}
    </div>
  );
}

// Compact inline KPI strip for NebulaPageHeading's `stats` slot - a row of
// separate NebulaCompactStatCards with a gap between them (same individual-
// card look Groups/Users use in their own stat row), not one shared pill.
// An earlier version used one continuous box with divide-x border lines
// between segments, which read as visually different from - and less
// polished than - the separate-card look everywhere else Nebula's compact
// stats show up.
export function NebulaHeaderStats({
  stats,
}: {
  stats: Array<{ label: string; value: string | number; icon?: ReactNode }>;
}) {
  return (
    // On a phone, an even full-width row of three - the same as the stat row
    // on Users and Groups - rather than cards shrunk to their text.
    <div className="w-full grid grid-cols-3 gap-2 md:w-auto md:flex md:items-center md:gap-4">
      {stats.map((s, i) => (
        <NebulaCompactStatCard key={s.label} label={s.label} value={s.value} icon={s.icon} colorIndex={i} />
      ))}
    </div>
  );
}

// Retain the shared exports used by page layouts. Content panels are solid;
// translucency belongs to the floating navigation, not every nested card.
export const NEBULA_GLASS_CLASS = 'interface-panel relative rounded-2xl overflow-hidden';
export const nebulaGlassStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-surface-border)',
};

/** Kept as a no-op for pages that still include the former accent stripe. */
export function NebulaGlassStripe() {
  return null;
}

// Nebula's stat-card equivalent of Current mode's <StatCard> - same
// label/value/icon shape, so other pages can swap between the two based on
// layoutMode without restructuring the surrounding grid. Icon color
// alternates primary/secondary by index so a row of these doesn't read as
// one flat block of a single hue.
export function NebulaStatCard({
  label,
  value,
  icon,
  colorIndex = 0,
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
  colorIndex?: number;
}) {
  const isPrimary = colorIndex % 2 === 0;
  return (
    <div className={`${NEBULA_GLASS_CLASS} p-5 flex items-center justify-between`} style={nebulaGlassStyle}>
      <NebulaGlassStripe />
      <div>
        <p className="text-sm text-muted mb-1">{label}</p>
        <p className="interface-stat-value text-3xl font-semibold text-default">{value}</p>
      </div>
      {icon && (
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: isPrimary ? 'var(--color-primary-muted)' : 'var(--color-secondary-muted)',
            color: isPrimary ? 'var(--color-primary)' : 'var(--color-secondary)',
          }}
        >
          {icon}
        </div>
      )}
    </div>
  );
}

// Smaller variant of NebulaStatCard - same glass card + icon-badge
// language, scaled down on mobile so 3-4 of them fit comfortably in one row
// instead of stacking full-width/full-height one per row (the full-size
// NebulaStatCard's p-5 padding and 44px icon badge only really work at 1-2
// per row on a phone; forcing that into 3 columns crammed the icon and
// padding into most of a card's width, leaving barely anything for the
// number). From md up, scales to match Dashboard's own Groups/Addons stat
// cards exactly (p-5, 44px icon, text-3xl value) per explicit request -
// "smaller" was specifically about mobile and the previous full-width-per-
// card layout, not about reading small on desktop too. Built for
// Groups/Users/Metrics.
export function NebulaCompactStatCard({
  label,
  value,
  icon,
  colorIndex = 0,
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
  colorIndex?: number;
}) {
  const isPrimary = colorIndex % 2 === 0;
  return (
    // Phone: the number sits beside the icon and the label gets the tile's
    // whole width underneath (three tiles in a row left it ~45px, so labels
    // were cut). From md up: icon on the left, number over label.
    <div className={`${NEBULA_GLASS_CLASS} p-2.5 sm:p-3 md:p-5 flex flex-col md:flex-row md:items-center gap-1.5 md:gap-4 min-w-0`} style={nebulaGlassStyle}>
      <NebulaGlassStripe />
      <div className="contents md:hidden">
        <div className="flex items-center gap-2 min-w-0">
          {icon && (
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: isPrimary ? 'var(--color-primary-muted)' : 'var(--color-secondary-muted)',
                color: isPrimary ? 'var(--color-primary)' : 'var(--color-secondary)',
              }}
            >
              {icon}
            </div>
          )}
          <p className="text-lg font-bold font-display text-default leading-none truncate">{value}</p>
        </div>
        <p className="text-[11px] leading-tight text-muted">{label}</p>
      </div>
      {icon && (
        <div
          className="hidden md:flex w-11 h-11 rounded-xl items-center justify-center shrink-0"
          style={{
            background: isPrimary ? 'var(--color-primary-muted)' : 'var(--color-secondary-muted)',
            color: isPrimary ? 'var(--color-primary)' : 'var(--color-secondary)',
          }}
        >
          {icon}
        </div>
      )}
      <div className="hidden md:block min-w-0">
        <p className="interface-stat-value text-3xl font-semibold font-display text-default leading-none truncate">{value}</p>
        <p className="text-sm text-muted mt-1 truncate">{label}</p>
      </div>
    </div>
  );
}
