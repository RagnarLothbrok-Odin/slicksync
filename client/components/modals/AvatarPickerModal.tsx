"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { Avatar, AvatarColorSwatches, avatarColorFill } from "@/components/ui/Avatar";
import { toast } from "@/components/ui/Toast";
import { api, type NuvioCommunityCover } from "@/lib/api";
import { diceBearSelection } from "@/lib/dicebear";
import { readErrorMessage } from "@/lib/errors";
import { useIsMobile } from "@/lib/hooks/useIsMobile";
import { DiceBearPicker } from "./DiceBearPicker";

interface AvatarPickerModalProps {
    currentAvatarUrl?: string | null;
    currentColorIndex?: number;
    isOpen: boolean;
    name: string;
    // Optional - when given a SlickSync-managed Nuvio user's id, an extra
    // "Nuvio Covers" tab appears, browsing nuvio.tv's own public Community
    // Covers gallery (GIFs/JPG/PNG) and letting a pick fill the Image URL tab
    // instead of the caller having to find+paste a URL from that site
    // manually. Omitted (the default) for every other AvatarPickerModal use
    // (Users/Groups/Catalogs avatars) - that gallery is Nuvio-cover-art
    // specific, not a generic avatar source.
    nuvioCoversUserId?: string;
    onClose: () => void;
    onSave: (data: {
        avatarUrl?: string | null;
        colorIndex?: number;
        alsoOnServer?: boolean;
    }) => Promise<void>;
    onUpload?: (file: File) => Promise<{ url: string }>;
    previewShape?: "circle" | "rect";
    // For someone signed in to a Jellyfin, AIOStreams or AIOMetadata server:
    // its name, which adds "Also use it on their <server>" - the picture is
    // set there too, and the two stay in step (server/utils/serverAvatars.js).
    serverLabel?: string;
    // Cover pickers need real room - a big preview, a legible grid of Nuvio
    // covers - the original 'md' avatar-picker size was cramped for that.
    // 'full' (896px, Modal's own largest size) is for the Nuvio Collections
    // folder-cover entry point specifically - genuinely the primary place
    // people browse this gallery, so it gets the roomiest treatment.
    size?: "md" | "lg" | "xl" | "full";
    // This component is reused for both circular person/account avatars and
    // rectangular cover art (Catalogs, Nuvio Collections/folders) - the
    // "Change Avatar" title and round preview only made sense for the former.
    // Cover-art callers pass '' (no title bar at all - the redesigned rect
    // preview + tabs already read as a cover picker with no label needed)
    // and 'rect' here instead.
    title?: string;
}

type Tab = "dicebear" | "color" | "url" | "upload" | "nuvio";

export function AvatarPickerModal({
    isOpen,
    onClose,
    name,
    currentAvatarUrl,
    currentColorIndex,
    onSave,
    onUpload,
    nuvioCoversUserId,
    title = "Change Avatar",
    previewShape = "circle",
    size = "md",
    serverLabel,
}: AvatarPickerModalProps) {
    const [alsoOnServer, setAlsoOnServer] = useState(true);
    const serverPart = serverLabel ? { alsoOnServer } : {};
    // nuvioCoversUserId is only ever passed for the Nuvio folder/collection
    // cover picker - most people picking a cover there are browsing the
    // gallery, not pasting a URL, so it wins the default tab even when a
    // cover is already set (editing an existing folder's cover otherwise
    // landed on the URL tab just because currentAvatarUrl was non-null).
    const [tab, setTab] = useState<Tab>(
        nuvioCoversUserId
            ? "nuvio"
            : previewShape === "circle" &&
                (!currentAvatarUrl || diceBearSelection(currentAvatarUrl))
              ? "dicebear"
              : "url"
    );
    const [urlInput, setUrlInput] = useState(currentAvatarUrl || "");
    const [selectedColor, setSelectedColor] = useState(currentColorIndex ?? 0);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(currentAvatarUrl || null);
    // Each opening starts from what the thing has now. The dialog is mounted
    // with its page, often before the page's data has arrived, so the values
    // above were those of nothing-loaded-yet: a red group opened it with the
    // theme colour picked, and saving would have quietly undone the red.
    const [wasOpen, setWasOpen] = useState(isOpen);
    if (isOpen !== wasOpen) {
        setWasOpen(isOpen);
        if (isOpen) {
            setTab(
                nuvioCoversUserId
                    ? "nuvio"
                    : previewShape === "circle" &&
                        (!currentAvatarUrl || diceBearSelection(currentAvatarUrl))
                      ? "dicebear"
                      : "url"
            );
            setSelectedColor(currentColorIndex ?? 0);
            setUrlInput(currentAvatarUrl || "");
            setPreviewUrl(currentAvatarUrl || null);
        }
    }
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Infinite scroll for the Nuvio Covers grid, same IntersectionObserver
    // pattern Discover uses. Root is null (the browser viewport) rather than
    // a grid-local scroll container - the grid used to have its own nested
    // overflow-y-auto/max-h scroll region distinct from the Modal's own body
    // scroll, which read as two independent, fighting scrollbars on mobile
    // (confirmed by real feedback). Removed that nested scroll entirely so
    // the grid is just part of the Modal's single scrollable body -
    // IntersectionObserver with root:null still correctly accounts for
    // clipping through the Modal's own overflow-y-auto ancestor.
    const nuvioSentinelRef = useRef<HTMLDivElement | null>(null);
    // Sticky preview + collapse-on-scroll toolbar is a mobile-only fix -
    // desktop had plenty of room for the toolbar to just sit in normal flow
    // above the grid like every other tab, and real feedback was explicit
    // that PC was fine as it already was. Same breakpoint NebulaTopbar's own
    // nav-collapse-on-scroll uses.
    const isMobile = useIsMobile();
    // Sticking the whole toolbar (tabs/description/search/filters) alongside
    // the preview - the previous fix for this - ate too much of the modal's
    // height on a phone to comfortably see any covers at once (real
    // feedback). Now only the preview itself stays permanently visible;
    // everything below it collapses on scroll and re-expands back at the
    // top, the same isScrolled pattern NebulaTopbar already uses for its own
    // nav row (24px threshold, motion height/opacity animation) - this modal
    // has no access to that component, so it re-implements the same idea
    // locally against its own scroll container instead of the page's.
    const modalScrollRef = useRef<HTMLDivElement | null>(null);
    const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
    useEffect(() => {
        if (tab !== "nuvio" || !isMobile) {
            return;
        }
        // AvatarPickerModal doesn't own the Modal's scrollable div (Modal.tsx's
        // own "overflow-y-auto" wrapper around {children}) - it's this
        // component's own root's parentElement, found via a ref on that root
        // rather than threading a new prop through Modal for one caller.
        const scrollEl = modalScrollRef.current?.parentElement;
        if (!scrollEl) {
            return;
        }
        const onScroll = () => setToolbarCollapsed(scrollEl.scrollTop > 24);
        onScroll();
        scrollEl.addEventListener("scroll", onScroll, { passive: true });
        return () => scrollEl.removeEventListener("scroll", onScroll);
    }, [tab, isMobile]);

    const [nuvioCovers, setNuvioCovers] = useState<NuvioCommunityCover[]>([]);
    const [nuvioCoversLoading, setNuvioCoversLoading] = useState(false);
    const [nuvioCoversError, setNuvioCoversError] = useState<string | null>(null);
    const [nuvioPage, setNuvioPage] = useState(1);
    const [nuvioHasMore, setNuvioHasMore] = useState(false);
    const [nuvioOrientation, setNuvioOrientation] = useState<"all" | "landscape" | "portrait">(
        "all"
    );
    const [nuvioFormat, setNuvioFormat] = useState<"all" | "gif" | "jpg" | "png">("all");
    // Real server-side search - confirmed live against nuvio.tv/api/covers
    // (its own site search box never fires an observable request under the
    // live UI, but the underlying API accepts ?search= and filters
    // pagination.total correctly, with 0 results for garbage terms).
    const [nuvioSearch, setNuvioSearch] = useState("");

    const loadNuvioCovers = useCallback(
        async (page: number, replace: boolean) => {
            if (!nuvioCoversUserId) {
                return;
            }
            setNuvioCoversLoading(true);
            setNuvioCoversError(null);
            try {
                const data = await api.getNuvioCommunityCovers(nuvioCoversUserId, {
                    format: nuvioFormat,
                    limit: 24,
                    orientation: nuvioOrientation,
                    page,
                    search: nuvioSearch.trim() || undefined,
                    sort: "recent",
                });
                setNuvioCovers((prev) => (replace ? data.items : [...prev, ...data.items]));
                setNuvioHasMore(!!data.pagination?.hasNextPage);
                setNuvioPage(page);
            } catch (err) {
                setNuvioCoversError(readErrorMessage(err, "Failed to load Nuvio covers"));
            } finally {
                setNuvioCoversLoading(false);
            }
        },
        [nuvioCoversUserId, nuvioOrientation, nuvioFormat, nuvioSearch]
    );

    // (Re)load whenever the tab opens or a filter/search changes - debounced
    // so search doesn't fire a request per keystroke. Not on every render,
    // and never for callers without nuvioCoversUserId at all.
    useEffect(() => {
        if (tab !== "nuvio" || !nuvioCoversUserId) {
            return;
        }
        const t = setTimeout(() => loadNuvioCovers(1, true), nuvioSearch.trim() ? 350 : 0);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, nuvioOrientation, nuvioFormat, nuvioSearch, nuvioCoversUserId]);

    // Infinite scroll - same IntersectionObserver pattern as Discover's own
    // browse grid, root:null (viewport) since the grid no longer has its own
    // scroll container - see nuvioSentinelRef's comment above.
    useEffect(() => {
        if (tab !== "nuvio") {
            return;
        }
        const sentinel = nuvioSentinelRef.current;
        if (!sentinel) {
            return;
        }
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting) && nuvioHasMore && !nuvioCoversLoading) {
                    loadNuvioCovers(nuvioPage + 1, false);
                }
            },
            { root: null, rootMargin: "200px" }
        );
        io.observe(sentinel);
        return () => io.disconnect();
    }, [tab, nuvioHasMore, nuvioCoversLoading, nuvioPage, loadNuvioCovers]);

    const handlePickNuvioCover = (cover: NuvioCommunityCover) => {
        setUrlInput(cover.image_url);
        setPreviewUrl(cover.image_url);
        setTab("url");
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) {
            return;
        }
        setIsUploading(true);
        try {
            const result = await (onUpload ? onUpload(file) : api.uploadAvatar(file));
            setPreviewUrl(result.url);
            setUrlInput(result.url);
            toast.success("Image uploaded — click Save to apply it");
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to upload image"));
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };

    const handleSaveColor = async () => {
        setIsSaving(true);
        try {
            await onSave({ avatarUrl: null, colorIndex: selectedColor, ...serverPart });
            toast.success("Avatar updated");
            onClose();
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to update avatar"));
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveImage = async () => {
        const imageUrl = tab === "dicebear" ? previewUrl : urlInput;
        if (!imageUrl?.trim()) {
            toast.error("Enter an image URL or upload a file first");
            return;
        }
        setIsSaving(true);
        try {
            await onSave({ avatarUrl: imageUrl.trim(), ...serverPart });
            toast.success("Avatar updated");
            onClose();
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to update avatar"));
        } finally {
            setIsSaving(false);
        }
    };

    const handleRemoveImage = async () => {
        setIsSaving(true);
        try {
            await onSave({ avatarUrl: null, ...serverPart });
            toast.success("Reverted to default avatar");
            onClose();
        } catch (err) {
            toast.error(readErrorMessage(err, "Failed to update avatar"));
        } finally {
            setIsSaving(false);
        }
    };

    // A solid color block as "cover art" doesn't read as a real cover the way
    // it does as a fallback circular avatar - drop the Color tab entirely for
    // rect (Catalogs/Nuvio folder cover) callers, not just the circle ones.
    const tabs: Tab[] =
        previewShape === "rect"
            ? nuvioCoversUserId
                ? ["url", "upload", "nuvio"]
                : ["url", "upload"]
            : nuvioCoversUserId
              ? ["dicebear", "color", "url", "upload", "nuvio"]
              : ["dicebear", "color", "url", "upload"];
    const tabLabel: Record<Tab, string> = {
        color: "Colour",
        dicebear: "Avatars",
        nuvio: "Nuvio Covers",
        upload: "Upload",
        url: "Link",
    };

    const filterButtonClass = (active: boolean) =>
        `px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${active ? "" : "hover:bg-surface-hover"}`;
    const filterButtonStyle = (active: boolean) => ({
        background: active ? "var(--color-primary)" : "var(--color-surface-hover)",
        color: active ? "white" : "var(--color-text-muted)",
    });

    // The Nuvio Covers grid needs real room to actually be pickable from - a
    // 3-across grid of tiny thumbnails at modal-md width was the "how could
    // anyone choose from that" complaint this whole size/layout pass exists
    // to fix. More columns only at the wider sizes cover callers actually use.
    //
    // These column counts are keyed off `size` (the Modal's desktop max-width
    // preset), not the actual viewport - on a real phone the Modal itself
    // still only gets as wide as the screen, so a bare "grid-cols-5" for
    // size="full" packed 5 columns into ~350px of real width and made every
    // thumbnail unreadable. Tailwind breakpoints below floor it at 2 columns
    // under `sm` (640px) regardless of `size`, then scale up to each size's
    // intended column count only once there's actually room for it.
    const nuvioGridCols =
        size === "full"
            ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            : size === "xl"
              ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
              : size === "lg"
                ? "grid-cols-2 sm:grid-cols-3"
                : "grid-cols-2";

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size={tab === "dicebear" && size === "md" ? "lg" : size}
            title={title}
        >
            <div className="space-y-4" ref={modalScrollRef}>
                {/* Sticky only on the Nuvio Covers tab - that's the only tab with
            scrollable content below it. Pinned to the top of the Modal's
            own scroll container (not the grid's - the grid no longer has
            its own, see the scroll-nesting fix above). Only the preview
            itself always stays visible here; the tabs/description/search/
            filters toolbar below it collapses on scroll instead of staying
            expanded the whole time - floating the full toolbar (previous
            fix) ate too much of the modal's height on a phone to
            comfortably see any covers at once, per feedback. A solid
            background (not the semi-transparent bg-surface-hover/
            transparent defaults) is load-bearing here - without it,
            scrolled-past grid rows show through underneath while sticky. */}
                <div
                    className={
                        tab === "nuvio" && isMobile
                            ? "sticky top-0 z-10 -mx-6 bg-surface px-6 pb-3 shadow-lg"
                            : ""
                    }
                >
                    {previewShape === "circle" ? (
                        <div className="mb-2 flex justify-center">
                            <Avatar
                                colorIndex={selectedColor}
                                name={name}
                                size="2xl"
                                src={tab === "color" ? undefined : previewUrl || undefined}
                            />
                        </div>
                    ) : (
                        <div
                            className={`w-full ${size === "md" ? "aspect-video" : "aspect-[21/9]"} mb-2 overflow-hidden rounded-xl border border-default bg-surface-hover`}
                        >
                            {tab !== "color" && previewUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    alt=""
                                    className="h-full w-full object-cover"
                                    src={previewUrl}
                                />
                            ) : tab === "color" ? (
                                <div
                                    className="h-full w-full"
                                    style={{ background: avatarColorFill(selectedColor) }}
                                />
                            ) : (
                                <div className="flex h-full w-full items-center justify-center text-subtle text-xs">
                                    {name}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Collapses on scroll (and re-expands back at the top) - same
            isScrolled/motion.height pattern NebulaTopbar uses for its own
            nav row. AnimatePresence unmounts the collapsed content instead
            of just hiding it, so its own tab-switch/filter clicks can't
            fire while it's collapsed - it's not reachable anyway. */}
                    <AnimatePresence initial={false}>
                        {!(tab === "nuvio" && isMobile && toolbarCollapsed) && (
                            <motion.div
                                animate={{ height: "auto", opacity: 1 }}
                                className="overflow-hidden"
                                exit={{ height: 0, opacity: 0 }}
                                initial={
                                    tab === "nuvio" && isMobile ? { height: 0, opacity: 0 } : false
                                }
                                transition={{ duration: 0.2, ease: "easeInOut" }}
                            >
                                <div
                                    className="mt-2 flex gap-2 rounded-xl p-1"
                                    style={{ background: "var(--color-subtle)" }}
                                >
                                    {tabs.map((t) => (
                                        <button
                                            className={`flex-1 whitespace-nowrap rounded-lg py-2 font-medium text-sm capitalize transition-all ${tab === t ? "seg-on" : "seg-off"}`}
                                            key={t}
                                            onClick={() => setTab(t)}
                                            type="button"
                                        >
                                            {tabLabel[t]}
                                        </button>
                                    ))}
                                </div>

                                {tab === "nuvio" && nuvioCoversUserId && (
                                    <div className="mt-3 space-y-3">
                                        <p className="text-muted text-xs">
                                            Browsing nuvio.tv's community-submitted covers - hover
                                            one to preview it up top, click to use it.
                                        </p>

                                        <input
                                            className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                                            onChange={(e) => setNuvioSearch(e.target.value)}
                                            placeholder="Search by title (e.g. Netflix)..."
                                            style={{
                                                background: "var(--color-surface-hover)",
                                                border: "1px solid var(--color-surface-border)",
                                                color: "var(--color-text)",
                                            }}
                                            type="text"
                                            value={nuvioSearch}
                                        />

                                        <div
                                            className="flex flex-wrap items-center gap-2 rounded-xl p-2"
                                            style={{ background: "var(--color-subtle)" }}
                                        >
                                            <div className="flex gap-1">
                                                {(["all", "landscape", "portrait"] as const).map(
                                                    (o) => (
                                                        <button
                                                            className={`${filterButtonClass(nuvioOrientation === o)} capitalize`}
                                                            key={o}
                                                            onClick={() => setNuvioOrientation(o)}
                                                            style={filterButtonStyle(
                                                                nuvioOrientation === o
                                                            )}
                                                            type="button"
                                                        >
                                                            {o}
                                                        </button>
                                                    )
                                                )}
                                            </div>
                                            <span
                                                className="h-5 w-px"
                                                style={{
                                                    background: "var(--color-surface-border)",
                                                }}
                                            />
                                            <div className="flex gap-1">
                                                {(["all", "gif", "jpg", "png"] as const).map(
                                                    (f) => (
                                                        <button
                                                            className={`${filterButtonClass(nuvioFormat === f)} uppercase`}
                                                            key={f}
                                                            onClick={() => setNuvioFormat(f)}
                                                            style={filterButtonStyle(
                                                                nuvioFormat === f
                                                            )}
                                                            type="button"
                                                        >
                                                            {f === "all" ? "All formats" : f}
                                                        </button>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {serverLabel && tab !== "nuvio" && (
                    <label
                        className="flex cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5"
                        style={{ background: "var(--color-surface-hover)" }}
                    >
                        <input
                            checked={alsoOnServer}
                            className="mt-0.5 accent-primary"
                            onChange={(e) => setAlsoOnServer(e.target.checked)}
                            type="checkbox"
                        />
                        <span className="min-w-0">
                            <span className="block text-default text-sm">
                                Also use it on their {serverLabel}
                            </span>
                            <span className="block text-muted text-xs">
                                {tab === "color"
                                    ? "Their picture there is taken away, so the apps show their name."
                                    : `Their ${serverLabel} apps show it too, and a picture changed there later comes back here.`}
                            </span>
                        </span>
                    </label>
                )}

                {tab === "dicebear" && previewShape === "circle" && (
                    <>
                        <DiceBearPicker
                            initialUrl={currentAvatarUrl}
                            key={`${isOpen}:${currentAvatarUrl || name}`}
                            name={name}
                            onChange={setPreviewUrl}
                        />
                        <Button
                            className="w-full"
                            disabled={!diceBearSelection(previewUrl)}
                            isLoading={isSaving}
                            onClick={handleSaveImage}
                            variant="primary"
                        >
                            Save Avatar
                        </Button>
                    </>
                )}

                {tab === "color" && (
                    <div>
                        <div className="mb-4">
                            <AvatarColorSwatches
                                onChange={setSelectedColor}
                                value={selectedColor}
                            />
                        </div>
                        <Button
                            className="w-full"
                            isLoading={isSaving}
                            onClick={handleSaveColor}
                            variant="primary"
                        >
                            {previewShape === "circle" ? "Use Default Avatar" : "Use Color Cover"}
                        </Button>
                    </div>
                )}

                {tab === "url" && (
                    <div className="space-y-3">
                        <input
                            className="w-full rounded-xl px-4 py-3 focus:outline-none"
                            onChange={(e) => {
                                setUrlInput(e.target.value);
                                setPreviewUrl(e.target.value);
                            }}
                            placeholder="https://example.com/photo.jpg or .gif"
                            style={{
                                background: "var(--color-surface-hover)",
                                border: "1px solid var(--color-surface-border)",
                                color: "var(--color-text)",
                            }}
                            type="url"
                            value={urlInput}
                        />
                        <p className="text-center text-muted text-xs">
                            A .gif URL plays animated - any direct image link works, static or
                            animated.
                        </p>
                        <Button
                            className="w-full"
                            isLoading={isSaving}
                            onClick={handleSaveImage}
                            variant="primary"
                        >
                            Save Image/GIF URL
                        </Button>
                    </div>
                )}

                {tab === "upload" && (
                    <div className="space-y-3">
                        <input
                            accept="image/jpeg,image/png,image/gif,image/webp"
                            className="hidden"
                            onChange={handleFileSelect}
                            ref={fileInputRef}
                            type="file"
                        />
                        <Button
                            className="w-full"
                            isLoading={isUploading}
                            onClick={() => fileInputRef.current?.click()}
                            variant="secondary"
                        >
                            Choose Image File
                        </Button>
                        <p className="text-center text-muted text-xs">
                            JPG, PNG, WEBP, or GIF - animated GIFs stay animated, no re-encoding.
                        </p>
                        {previewUrl && urlInput && (
                            <Button
                                className="w-full"
                                isLoading={isSaving}
                                onClick={handleSaveImage}
                                variant="primary"
                            >
                                Save Uploaded Image
                            </Button>
                        )}
                    </div>
                )}

                {tab === "nuvio" && nuvioCoversUserId && (
                    <div className="space-y-3">
                        {/* Description, search, and orientation/format filters now live
                in the sticky toolbar above (with the preview and tabs) -
                see that block's comment for why. Only the actual results
                (grid/error/empty states) render here, as the page's normal
                scrolling content beneath the sticky toolbar. */}
                        {nuvioCoversError ? (
                            <p className="py-4 text-center text-error text-xs">
                                {nuvioCoversError}
                            </p>
                        ) : nuvioCovers.length === 0 &&
                          nuvioSearch.trim() &&
                          !nuvioCoversLoading ? (
                            <p className="py-4 text-center text-muted text-xs">
                                No covers matching &quot;{nuvioSearch.trim()}&quot;.
                            </p>
                        ) : (
                            <div className={`grid ${nuvioGridCols} gap-3`}>
                                {nuvioCovers.map((cover) => (
                                    <button
                                        className="group block w-full rounded-lg border-2 border-default text-left transition-colors hover:border-primary"
                                        key={cover.id}
                                        onClick={() => handlePickNuvioCover(cover)}
                                        onMouseEnter={() => setPreviewUrl(cover.image_url)}
                                        onMouseLeave={() => setPreviewUrl(urlInput || null)}
                                        title={cover.title || "Use this cover"}
                                        type="button"
                                    >
                                        {/* aspect-ratio + overflow-hidden live on this inner div,
                        not the <button> itself - mobile Safari doesn't
                        reliably constrain a <button>'s own aspect-ratio box
                        (it's inline-block by default), which let tall
                        multi-frame GIFs render at full intrinsic height
                        instead of being cropped, breaking the grid on
                        mobile. Same nesting FolderTile (Nuvio Collections)
                        already uses for the identical aspect-ratio+img case. */}
                                        <div className="relative aspect-video overflow-hidden rounded-lg bg-surface-hover">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                alt={cover.title || ""}
                                                className="h-full w-full object-cover"
                                                loading="lazy"
                                                src={cover.image_url}
                                            />
                                            {cover.title && (
                                                <div
                                                    className="absolute inset-x-0 bottom-0 truncate px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100"
                                                    style={{
                                                        background:
                                                            "linear-gradient(0deg, rgba(0,0,0,0.75) 0%, transparent 100%)",
                                                    }}
                                                >
                                                    {cover.title}
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                ))}
                                {nuvioCoversLoading &&
                                    Array.from({
                                        length: size === "full" ? 10 : size === "md" ? 4 : 8,
                                    }).map((_, i) => (
                                        <div
                                            className="aspect-video animate-pulse rounded-lg bg-surface-hover"
                                            key={`skeleton-${i}`}
                                        />
                                    ))}
                                {/* Infinite-scroll observer target - col-span-full so it
                    doesn't become a visible grid cell of its own. */}
                                {nuvioHasMore && (
                                    <div
                                        aria-hidden
                                        className="col-span-full h-px w-full"
                                        ref={nuvioSentinelRef}
                                    />
                                )}
                            </div>
                        )}
                    </div>
                )}

                {currentAvatarUrl && tab !== "nuvio" && (
                    <button
                        className="w-full rounded-xl py-2 font-medium text-sm transition-colors"
                        onClick={handleRemoveImage}
                        style={{ color: "var(--color-error)" }}
                        type="button"
                    >
                        Remove custom image
                    </button>
                )}
            </div>
        </Modal>
    );
}
