'use client';

import type { ComponentType } from 'react';
import { ChevronRightIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

export interface SettingsSection {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  group: string;
}

/** Admin and personal settings share wayfinding, including the mobile picker. */
export function SettingsNavigation({ sections, activeKey, onChange, query, onQueryChange }: {
  sections: SettingsSection[];
  activeKey: string;
  onChange: (key: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return (
    <aside className="settings-navigation">
      <label className="settings-search flex items-center gap-2.5 rounded-xl px-3.5 py-3">
        <MagnifyingGlassIcon className="w-4 h-4 text-muted shrink-0" />
        <input type="search" aria-label="Find a setting" placeholder="Find a setting" value={query} onChange={event => onQueryChange(event.target.value)} className="bg-transparent text-sm text-default min-w-0 w-full outline-none" />
      </label>
      <nav aria-label="Settings sections" className="settings-section-list mt-5">
        {[...new Set(sections.map(section => section.group))].map(group => (
          <div key={group} className="mb-5">
            <p className="settings-nav-label">{group}</p>
            {sections.filter(section => section.group === group).map(section => {
              const Icon = section.icon;
              return <button key={section.key} type="button" aria-pressed={section.key === activeKey} onClick={() => onChange(section.key)} className="settings-section-button flex items-center gap-3 w-full text-left rounded-xl px-3.5 py-3">
                <Icon className="w-[18px] h-[18px] shrink-0" /><span className="text-sm font-medium flex-1">{section.label}</span>{activeKey === section.key && <ChevronRightIcon className="w-3.5 h-3.5" />}
              </button>;
            })}
          </div>
        ))}
      </nav>
      <label className="settings-mobile-picker mt-3">
        <span className="sr-only">Settings section</span>
        <select aria-label="Settings section" value={activeKey} onChange={event => onChange(event.target.value)} className="interface-field w-full rounded-xl px-4 py-3 text-sm text-default bg-surface border border-default">
          {sections.map(section => <option key={section.key} value={section.key}>{section.label}</option>)}
        </select>
      </label>
    </aside>
  );
}
