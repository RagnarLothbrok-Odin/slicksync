"use client";

import { ChevronRightIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import type { ComponentType } from "react";

export interface SettingsSection {
    group: string;
    icon: ComponentType<{ className?: string }>;
    key: string;
    label: string;
}

/** Admin and personal settings share wayfinding, including the mobile picker. */
export function SettingsNavigation({
    sections,
    activeKey,
    onChange,
    query,
    onQueryChange,
}: {
    sections: SettingsSection[];
    activeKey: string;
    onChange: (key: string) => void;
    query: string;
    onQueryChange: (query: string) => void;
}) {
    return (
        <aside className="settings-navigation">
            <label className="settings-search flex items-center gap-2.5 rounded-xl px-3.5 py-3">
                <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-muted" />
                <input
                    aria-label="Find a setting"
                    className="w-full min-w-0 bg-transparent text-default text-sm outline-none"
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="Find a setting"
                    type="search"
                    value={query}
                />
            </label>
            <nav aria-label="Settings sections" className="settings-section-list mt-5">
                {[...new Set(sections.map((section) => section.group))].map((group) => (
                    <div className="mb-5" key={group}>
                        <p className="settings-nav-label">{group}</p>
                        {sections
                            .filter((section) => section.group === group)
                            .map((section) => {
                                const Icon = section.icon;
                                return (
                                    <button
                                        aria-pressed={section.key === activeKey}
                                        className="settings-section-button flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left"
                                        key={section.key}
                                        onClick={() => onChange(section.key)}
                                        type="button"
                                    >
                                        <Icon className="h-[18px] w-[18px] shrink-0" />
                                        <span className="flex-1 font-medium text-sm">
                                            {section.label}
                                        </span>
                                        {activeKey === section.key && (
                                            <ChevronRightIcon className="h-3.5 w-3.5" />
                                        )}
                                    </button>
                                );
                            })}
                    </div>
                ))}
            </nav>
            <label className="settings-mobile-picker mt-3">
                <span className="sr-only">Settings section</span>
                <select
                    aria-label="Settings section"
                    className="interface-field w-full rounded-xl border border-default bg-surface px-4 py-3 text-default text-sm"
                    onChange={(event) => onChange(event.target.value)}
                    value={activeKey}
                >
                    {sections.map((section) => (
                        <option key={section.key} value={section.key}>
                            {section.label}
                        </option>
                    ))}
                </select>
            </label>
        </aside>
    );
}
