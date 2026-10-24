'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import { CheckIcon } from '@heroicons/react/24/outline';
import { themeMeta, type ThemeId } from '@/lib/theme';

// Memoized theme card component
export const ThemeCard = memo(function ThemeCard({
  themeId,
  meta,
  isSelected,
  onSelect,
}: {
  themeId: ThemeId;
  meta: typeof themeMeta[ThemeId];
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { colors } = meta;

  return (
    <motion.button
      whileHover={undefined}
      whileTap={{ scale: 0.98 }}
      type="button"
      aria-pressed={isSelected}
      onClick={onSelect}
      className={`theme-choice relative p-4 rounded-2xl border-2 transition-colors text-left w-full ${
        isSelected ? 'border-primary bg-primary-muted' : 'border-default'
      }`}
    >
      {isSelected && (
        <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center bg-primary">
          <CheckIcon className="w-3 h-3 text-default" style={{ color: 'var(--color-bg)' }} />
        </div>
      )}

      {/* Theme preview - mini mockup */}
      <div
        className="w-full h-20 rounded-lg mb-2 overflow-hidden border border-default"
        style={{ backgroundColor: colors.bg }}
      >
        {/* Mini sidebar */}
        <div className="flex h-full">
          <div
            className="w-8 h-full flex flex-col gap-1 p-1.5"
            style={{ backgroundColor: colors.surface }}
          >
            <div
              className="w-full h-1.5 rounded-full"
              style={{ backgroundColor: colors.primary }}
            />
            <div
              className="w-full h-1 rounded-full opacity-30"
              style={{ backgroundColor: '#fff' }}
            />
            <div
              className="w-full h-1 rounded-full opacity-30"
              style={{ backgroundColor: '#fff' }}
            />
          </div>
          {/* Mini content area */}
          <div className="flex-1 p-2 flex flex-col gap-1.5">
            {/* Header bar */}
            <div
              className="w-12 h-1.5 rounded-full opacity-40"
              style={{ backgroundColor: '#fff' }}
            />
            {/* Cards row */}
            <div className="flex gap-1 mt-1">
              <div
                className="w-6 h-6 rounded"
                style={{ backgroundColor: colors.surface }}
              />
              <div
                className="w-6 h-6 rounded"
                style={{ backgroundColor: colors.surface }}
              />
              <div
                className="w-6 h-6 rounded"
                style={{ backgroundColor: colors.primary, opacity: 0.3 }}
              />
            </div>
            {/* Button */}
            <div
              className="w-8 h-2 rounded mt-auto"
              style={{ backgroundColor: colors.primary }}
            />
          </div>
        </div>
      </div>

      {/* Color swatches */}
      <div className="flex gap-1 mb-2">
        <div
          className="w-4 h-4 rounded-full border border-white/10"
          style={{ backgroundColor: colors.bg }}
          title="Background"
        />
        <div
          className="w-4 h-4 rounded-full border border-white/10"
          style={{ backgroundColor: colors.surface }}
          title="Surface"
        />
        <div
          className="w-4 h-4 rounded-full border border-white/10"
          style={{ backgroundColor: colors.primary }}
          title="Primary"
        />
        <div
          className="w-4 h-4 rounded-full border border-white/10"
          style={{ backgroundColor: colors.secondary }}
          title="Secondary"
        />
      </div>

      <p className="font-medium text-sm text-default">
        {meta.name}
      </p>
      <p className="text-xs text-muted">
        {meta.description}
      </p>
    </motion.button>
  );
});
