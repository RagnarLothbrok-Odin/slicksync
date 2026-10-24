'use client';

import type { ReactNode } from 'react';
import { useLayoutMode } from '@/lib/layout-mode';
import { PageSection } from '@/components/layout/PageContainer';
import { Card } from './Card';

/** Both dashboards use the same section chrome for the selected layout. */
export function ContinueWatchingSection({ children }: { children: ReactNode }) {
  const { layoutMode } = useLayoutMode();
  if (layoutMode === 'nebula') {
    return (
      <section className="interface-media-section my-7" aria-label="Continue watching">
        <h2 className="text-xl font-semibold font-display text-default mb-4">Continue Watching</h2>
        {children}
      </section>
    );
  }
  return (
    <PageSection className="mb-6" delay={0.18}>
      <Card padding="lg">
        <h3 className="text-base font-semibold font-display text-default mb-4">Continue Watching</h3>
        {children}
      </Card>
    </PageSection>
  );
}
