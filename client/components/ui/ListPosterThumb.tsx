import { FilmIcon, TvIcon } from "@heroicons/react/24/outline";
import type { CustomListItem } from "@/lib/api";
import { usePersonalFeatures } from "@/lib/hooks/usePersonalFeatures";
import { posterUrl } from "@/lib/posterUrl";

// Small poster tile shared between the Lists index and a list's own detail
// page (roadmap #7) - kept out of either page.tsx since Next's App Router
// only expects a fixed set of named exports from a page file.
export function PosterThumb({
    item,
    className = "",
}: {
    item: CustomListItem;
    className?: string;
}) {
    const { rpdbEnabled } = usePersonalFeatures();
    const src = posterUrl(item, rpdbEnabled);
    return (
        <div
            className={`flex items-center justify-center overflow-hidden rounded-md bg-surface-hover ${className}`}
        >
            {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" className="h-full w-full object-cover" src={src} />
            ) : item.type === "series" ? (
                <TvIcon className="h-5 w-5 text-subtle" />
            ) : (
                <FilmIcon className="h-5 w-5 text-subtle" />
            )}
        </div>
    );
}
