"use client";

import {
    CheckIcon,
    PaintBrushIcon,
    SparklesIcon,
    Squares2X2Icon,
    SwatchIcon,
    TrashIcon,
} from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import { memo, useEffect, useId, useRef, useState } from "react";
import { Header } from "@/components/layout/Header";
import { NebulaPageHeading } from "@/components/layout/NebulaTopbar";
import { PageSection } from "@/components/layout/PageContainer";
import { Badge, Button, Card, ConfirmModal } from "@/components/ui";
import { toast } from "@/components/ui/Toast";
import { ViewModeToggle } from "@/components/ui/ViewModeToggle";
import { copyToClipboard } from "@/lib/clipboard";
import { type LayoutModeId, layoutModeIds, layoutModeMeta, useLayoutMode } from "@/lib/layout-mode";
import {
    type CustomTheme,
    decodeThemeShareCode,
    encodeThemeShareCode,
    FONT_OPTIONS,
    type FontId,
    RADIUS_LABELS,
    RADIUS_PRESETS,
    type RadiusId,
    type SavedCustomTheme,
    TEXT_SCALE_FACTORS,
    TEXT_SCALE_LABELS,
    TEXT_SCALE_PRESETS,
    type TextScaleId,
    THEME_REAL_COLORS,
    type ThemeId,
    themeIds,
    themeMeta,
    useTheme,
} from "@/lib/theme";
import { useDefaultViewMode } from "@/lib/viewMode";
import { ThemeCard } from "./ThemeChoice";

// Same visual card shape as ThemeCard, but takes a user-created SavedCustomTheme
// (which has no themeMeta entry) and adds a delete affordance in the corner —
// built-in themes shouldn't ever be deletable, so this is a separate component
// rather than a `deletable?` prop on ThemeCard.
const CustomThemeCard = memo(function CustomThemeCard({
    theme,
    isSelected,
    onSelect,
    onDelete,
}: {
    theme: SavedCustomTheme;
    isSelected: boolean;
    onSelect: () => void;
    onDelete: () => void;
}) {
    // Derive the base theme's structural colors for the mini-mockup preview so
    // the card visually resembles the built-in one it's based on.
    const base = themeMeta[theme.base];
    return (
        <div className="relative">
            <motion.button
                aria-pressed={isSelected}
                className={`theme-choice relative w-full rounded-2xl border-2 p-4 text-left transition-colors ${
                    isSelected ? "border-primary bg-primary-muted" : "border-default"
                }`}
                onClick={onSelect}
                type="button"
                whileHover={undefined}
                whileTap={{ scale: 0.98 }}
            >
                {isSelected && (
                    <div className="absolute top-2 right-8 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                        <CheckIcon className="h-3 w-3" style={{ color: "var(--color-bg)" }} />
                    </div>
                )}
                {/* Mini mockup — reuses the base theme's structural colors but paints
          the accents from the custom's own primary/secondary. */}
                <div
                    className="mb-2 h-20 w-full overflow-hidden rounded-lg border border-default"
                    style={{ backgroundColor: base.colors.bg }}
                >
                    <div className="flex h-full">
                        <div
                            className="flex h-full w-8 flex-col gap-1 p-1.5"
                            style={{ backgroundColor: base.colors.surface }}
                        >
                            <div
                                className="h-1.5 w-full rounded-full"
                                style={{ backgroundColor: theme.primary }}
                            />
                            <div
                                className="h-1 w-full rounded-full opacity-30"
                                style={{ backgroundColor: "#fff" }}
                            />
                            <div
                                className="h-1 w-full rounded-full opacity-30"
                                style={{ backgroundColor: "#fff" }}
                            />
                        </div>
                        <div className="flex flex-1 flex-col gap-1.5 p-2">
                            <div
                                className="h-1.5 w-12 rounded-full opacity-40"
                                style={{ backgroundColor: "#fff" }}
                            />
                            <div className="mt-1 flex gap-1">
                                <div
                                    className="h-6 w-6 rounded"
                                    style={{ backgroundColor: base.colors.surface }}
                                />
                                <div
                                    className="h-6 w-6 rounded"
                                    style={{ backgroundColor: base.colors.surface }}
                                />
                                <div
                                    className="h-6 w-6 rounded"
                                    style={{ backgroundColor: theme.primary, opacity: 0.3 }}
                                />
                            </div>
                            <div
                                className="mt-auto h-2 w-8 rounded"
                                style={{
                                    background: `linear-gradient(90deg, ${theme.primary}, ${theme.secondary})`,
                                }}
                            />
                        </div>
                    </div>
                </div>

                <div className="mb-2 flex gap-1">
                    <div
                        className="h-4 w-4 rounded-full border border-white/10"
                        style={{ backgroundColor: base.colors.bg }}
                        title="Background (from base)"
                    />
                    <div
                        className="h-4 w-4 rounded-full border border-white/10"
                        style={{ backgroundColor: base.colors.surface }}
                        title="Surface (from base)"
                    />
                    <div
                        className="h-4 w-4 rounded-full border border-white/10"
                        style={{ backgroundColor: theme.primary }}
                        title="Primary"
                    />
                    <div
                        className="h-4 w-4 rounded-full border border-white/10"
                        style={{ backgroundColor: theme.secondary }}
                        title="Secondary"
                    />
                </div>

                <p className="truncate font-medium text-default text-sm">{theme.name}</p>
                <p className="text-muted text-xs">Custom · based on {base.name}</p>
            </motion.button>
            {/* Keep deletion separate from the theme selection button. */}
            <button
                aria-label={`Delete ${theme.name}`}
                className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-surface-hover text-muted transition-colors hover:bg-red-500/70 hover:text-white"
                onClick={onDelete}
                title={`Delete ${theme.name}`}
                type="button"
            >
                <TrashIcon className="h-3 w-3" />
            </button>
        </div>
    );
});

// The Build-your-own theme's color-override inputs all follow the same shape:
// a color picker seeded with a fallback when there's no override, a hex label,
// and a "reset" affordance to clear the override back to the base theme's own
// value. Extracted so adding a new override is one JSX line, not thirty.
const ColorOverride = memo(function ColorOverride({
    label,
    value,
    seed,
    onSet,
    onClear,
}: {
    label: string;
    value: string;
    seed: string;
    onSet: (v: string) => void;
    onClear: () => void;
}) {
    const accessibleFieldId1 = useId();
    return (
        <div>
            <label
                className="mb-2 block font-medium text-muted text-xs"
                htmlFor={`${accessibleFieldId1}-1`}
            >
                {label}
            </label>
            <div className="flex items-center gap-2">
                <input
                    className="h-10 w-12 cursor-pointer rounded-lg border border-default bg-transparent p-0.5"
                    id={`${accessibleFieldId1}-1`}
                    onChange={(e) => onSet(e.target.value)}
                    type="color"
                    value={value || seed}
                />
                {value ? (
                    <>
                        <span className="font-mono text-muted text-xs uppercase">{value}</span>
                        <button
                            className="text-[11px] text-muted transition-colors hover:text-default"
                            onClick={onClear}
                            title="Clear override — use the base theme's own value"
                            type="button"
                        >
                            reset
                        </button>
                    </>
                ) : (
                    <span className="text-[11px] text-muted italic">using base</span>
                )}
            </div>
        </div>
    );
});

// The base theme's own corner scale, used as the preview mockup's fallback
// when the builder's radius preset is 'default' (RADIUS_PRESETS['default']
// is null there, meaning "don't override" — the mockup still needs a value
// to render with).
const BASE_RADIUS_PX = { lg: "14px", md: "10px", sm: "6px", xl: "20px" };

// Resolves the builder's overrides against its base theme's own palette, so
// the preview mockup always has something sensible to show for fields the
// user hasn't touched yet — same fallback semantics as what applyCustomTheme
// does to the real page, just computed locally so the mockup doesn't depend
// on document.documentElement having already re-rendered.
function resolvePreviewPalette(
    base: ThemeId,
    o: {
        primary: string;
        secondary: string;
        text: string;
        textMuted: string;
        background: string;
        surface: string;
        bgMuted: string;
        border: string;
        progressBar: string;
        success: string;
        error: string;
    }
) {
    const meta = themeMeta[base].colors;
    const real = THEME_REAL_COLORS[base];
    return {
        bg: o.background || meta.bg,
        bgMuted: o.bgMuted || real.bgMuted,
        border: o.border || real.border,
        error: o.error || real.error,
        primary: o.primary || meta.primary,
        // No fallback constant here — a blank override means "keep the default
        // primary→secondary gradient," which the caller renders itself.
        progressBar: o.progressBar || null,
        secondary: o.secondary || meta.secondary,
        success: o.success || real.success,
        surface: o.surface || meta.surface,
        text: o.text || real.text,
        textMuted: o.textMuted || real.textMuted,
    };
}

// Layout mode card - structure preview only (sidebar-vs-topbar), not colors,
// since layout mode is orthogonal to the Theme setting and should read as
// "shape," not "another color choice."
const LayoutModeCard = memo(function LayoutModeCard({
    layoutId,
    isSelected,
    onSelect,
}: {
    layoutId: LayoutModeId;
    isSelected: boolean;
    onSelect: () => void;
}) {
    const meta = layoutModeMeta[layoutId];

    return (
        <motion.button
            aria-pressed={isSelected}
            className={`theme-choice relative w-full rounded-2xl border-2 p-4 text-left transition-colors ${
                isSelected ? "border-primary bg-primary-muted" : "border-default"
            }`}
            onClick={onSelect}
            type="button"
            whileHover={undefined}
            whileTap={{ scale: 0.98 }}
        >
            {isSelected && (
                <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <CheckIcon className="h-3 w-3" style={{ color: "var(--color-bg)" }} />
                </div>
            )}

            <div
                className="mb-2 h-20 w-full overflow-hidden rounded-lg border border-default"
                style={{ backgroundColor: "var(--color-bg)" }}
            >
                {layoutId === "current" ? (
                    <div className="flex h-full">
                        <div
                            className="flex h-full w-8 flex-col gap-1 p-1.5"
                            style={{ backgroundColor: "var(--color-surface)" }}
                        >
                            <div
                                className="h-1.5 w-full rounded-full"
                                style={{ backgroundColor: "var(--color-primary)" }}
                            />
                            <div className="h-1 w-full rounded-full bg-white opacity-30" />
                            <div className="h-1 w-full rounded-full bg-white opacity-30" />
                        </div>
                        <div className="flex flex-1 flex-col gap-1.5 p-2">
                            <div className="flex gap-1">
                                <div
                                    className="h-6 w-6 rounded"
                                    style={{ backgroundColor: "var(--color-surface)" }}
                                />
                                <div
                                    className="h-6 w-6 rounded"
                                    style={{ backgroundColor: "var(--color-surface)" }}
                                />
                            </div>
                            <div
                                className="mt-1 flex-1 rounded"
                                style={{ backgroundColor: "var(--color-surface)" }}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="flex h-full flex-col gap-1.5 p-1.5">
                        <div
                            className="flex h-4 items-center justify-center gap-0.5 rounded-full"
                            style={{ backgroundColor: "var(--color-surface)" }}
                        >
                            <div
                                className="h-1.5 w-1.5 rounded-full"
                                style={{
                                    background:
                                        "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
                                }}
                            />
                            <div className="h-1 w-4 rounded-full bg-white opacity-40" />
                        </div>
                        <div className="flex flex-1 gap-1">
                            <div
                                className="flex-1 rounded-lg"
                                style={{ backgroundColor: "var(--color-surface)", opacity: 0.8 }}
                            />
                            <div
                                className="w-6 rounded-lg"
                                style={{ backgroundColor: "var(--color-surface)", opacity: 0.5 }}
                            />
                            <div
                                className="w-6 rounded-lg"
                                style={{ backgroundColor: "var(--color-surface)", opacity: 0.5 }}
                            />
                        </div>
                    </div>
                )}
            </div>

            <p className="font-medium text-default text-sm">{meta.name}</p>
            <p className="text-muted text-xs">{meta.description}</p>
        </motion.button>
    );
});

// The whole Themes UI, extracted from what used to be its own page so it can
// live inside Settings as a section (user's call - it is a preference, and it
// was the only preference living outside Settings). `embedded` drops the page
// chrome - header, heading and page padding - since Settings supplies those.
export function ThemesPanel({
    embedded = false,
    showLayout = true,
}: {
    embedded?: boolean;
    showLayout?: boolean;
}) {
    const groupLabelId1 = useId();
    const fieldId1 = useId();
    const {
        themeId,
        setTheme,
        isCustom,
        activeCustomTheme,
        savedCustomThemes,
        saveCustomTheme,
        updateCustomTheme,
        deleteCustomTheme,
        previewCustom,
        cancelPreview,
    } = useTheme();
    const { layoutMode, setLayoutMode } = useLayoutMode();
    const { viewMode, setViewMode } = useDefaultViewMode();
    // Confirmation modal for deleting a saved custom theme.
    const [pendingDelete, setPendingDelete] = useState<SavedCustomTheme | null>(null);

    // Custom-theme builder working state. When a custom is active, seed from it
    // (so the builder shows what you're currently using); otherwise fresh defaults.
    const [builderName, setBuilderName] = useState<string>(activeCustomTheme?.name || "");
    const [builderBase, setBuilderBase] = useState<ThemeId>(activeCustomTheme?.base || "nebula");
    const [builderPrimary, setBuilderPrimary] = useState(activeCustomTheme?.primary || "#8b7ec8");
    const [builderSecondary, setBuilderSecondary] = useState(
        activeCustomTheme?.secondary || "#5fd4c4"
    );
    // All below are optional: null/'default' means "use the base theme's own
    // value". A concrete value overrides on top.
    const [builderText, setBuilderText] = useState<string>(activeCustomTheme?.text || "");
    const [builderTextMuted, setBuilderTextMuted] = useState<string>(
        activeCustomTheme?.textMuted || ""
    );
    const [builderBackground, setBuilderBackground] = useState<string>(
        activeCustomTheme?.background || ""
    );
    const [builderSurface, setBuilderSurface] = useState<string>(activeCustomTheme?.surface || "");
    const [builderBgMuted, setBuilderBgMuted] = useState<string>(activeCustomTheme?.bgMuted || "");
    const [builderBorder, setBuilderBorder] = useState<string>(activeCustomTheme?.border || "");
    const [builderProgressBar, setBuilderProgressBar] = useState<string>(
        activeCustomTheme?.progressBar || ""
    );
    const [builderSuccess, setBuilderSuccess] = useState<string>(activeCustomTheme?.success || "");
    const [builderError, setBuilderError] = useState<string>(activeCustomTheme?.error || "");
    const [builderFont, setBuilderFont] = useState<FontId>(
        (activeCustomTheme?.fontDisplay as FontId) || "default"
    );
    const [builderRadius, setBuilderRadius] = useState<RadiusId>(
        (activeCustomTheme?.radius as RadiusId) || "default"
    );
    const [builderTextScale, setBuilderTextScale] = useState<TextScaleId>(
        (activeCustomTheme?.textScale as TextScaleId) || "default"
    );
    // Assemble the current builder state into a CustomTheme so every change site
    // can call `previewCustom(buildDraft())` without repeating every field.
    const buildDraft = (): CustomTheme => ({
        background: builderBackground.trim() ? builderBackground.trim() : null,
        base: builderBase,
        bgMuted: builderBgMuted.trim() ? builderBgMuted.trim() : null,
        border: builderBorder.trim() ? builderBorder.trim() : null,
        error: builderError.trim() ? builderError.trim() : null,
        fontDisplay: builderFont,
        primary: builderPrimary,
        progressBar: builderProgressBar.trim() ? builderProgressBar.trim() : null,
        radius: builderRadius,
        secondary: builderSecondary,
        success: builderSuccess.trim() ? builderSuccess.trim() : null,
        surface: builderSurface.trim() ? builderSurface.trim() : null,
        text: builderText.trim() ? builderText.trim() : null,
        textMuted: builderTextMuted.trim() ? builderTextMuted.trim() : null,
        textScale: builderTextScale,
    });

    // Theme sharing via a compact copy-paste code - no server round-trip,
    // themes are already purely client-side. See lib/theme.tsx's own comment.
    const [showImportCode, setShowImportCode] = useState(false);
    const [importCodeValue, setImportCodeValue] = useState("");

    const handleExportCode = async () => {
        const code = encodeThemeShareCode(
            buildDraft(),
            builderName.trim() || activeCustomTheme?.name || "My theme"
        );
        try {
            await copyToClipboard(code);
            toast.success("Theme code copied - paste it anywhere to share");
        } catch {
            toast.error("Failed to copy - your browser may be blocking clipboard access");
        }
    };

    const handleImportCode = () => {
        const decoded = decodeThemeShareCode(importCodeValue);
        if (!decoded) {
            toast.error("That doesn't look like a valid theme code");
            return;
        }
        saveCustomTheme(decoded.theme, decoded.name);
        toast.success(`Imported "${decoded.name}"`);
        setImportCodeValue("");
        setShowImportCode(false);
    };

    // Re-seed the builder when the active custom theme changes out from under
    // it (cross-device sync, or the user selects a different custom to edit).
    useEffect(() => {
        setBuilderName(activeCustomTheme?.name || "");
        setBuilderBase(activeCustomTheme?.base || "nebula");
        setBuilderPrimary(activeCustomTheme?.primary || "#8b7ec8");
        setBuilderSecondary(activeCustomTheme?.secondary || "#5fd4c4");
        setBuilderText(activeCustomTheme?.text || "");
        setBuilderTextMuted(activeCustomTheme?.textMuted || "");
        setBuilderBackground(activeCustomTheme?.background || "");
        setBuilderSurface(activeCustomTheme?.surface || "");
        setBuilderBgMuted(activeCustomTheme?.bgMuted || "");
        setBuilderBorder(activeCustomTheme?.border || "");
        setBuilderProgressBar(activeCustomTheme?.progressBar || "");
        setBuilderSuccess(activeCustomTheme?.success || "");
        setBuilderError(activeCustomTheme?.error || "");
        setBuilderFont((activeCustomTheme?.fontDisplay as FontId) || "default");
        setBuilderRadius((activeCustomTheme?.radius as RadiusId) || "default");
        setBuilderTextScale((activeCustomTheme?.textScale as TextScaleId) || "default");
    }, [activeCustomTheme]);
    // Revert any unsaved live preview when leaving this page (a saved theme is
    // a no-op here since cancelPreview just re-applies whatever's active). Kept
    // in a ref so the unmount cleanup uses the latest active-theme state, not a
    // stale closure from first render.
    const cancelPreviewRef = useRef(cancelPreview);
    cancelPreviewRef.current = cancelPreview;
    useEffect(() => () => cancelPreviewRef.current(), []);

    return (
        <>
            {!embedded && layoutMode !== "nebula" && (
                <Header subtitle="Pick a built-in theme, or build your own" title="Themes" />
            )}

            <div
                className={
                    embedded
                        ? ""
                        : layoutMode === "nebula"
                          ? "px-4 pt-6 pb-8 md:px-6"
                          : "p-6 lg:p-8"
                }
            >
                <div
                    className={embedded ? "" : layoutMode === "nebula" ? "mx-auto" : "max-w-4xl"}
                    style={
                        !embedded && layoutMode === "nebula"
                            ? { maxWidth: "min(84rem, 92vw)" }
                            : undefined
                    }
                >
                    {!embedded && layoutMode === "nebula" && (
                        <NebulaPageHeading
                            subtitle="Pick a built-in theme, or build your own"
                            title="Themes"
                        />
                    )}

                    {/* Navigation layout is independent of the theme palette. */}
                    {showLayout && (
                        <PageSection className="mb-6">
                            <Card padding="lg">
                                <div className="mb-5 flex items-center gap-3">
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted">
                                        <Squares2X2Icon className="h-5 w-5 text-primary" />
                                    </div>
                                    <div>
                                        <h3 className="font-display font-semibold text-base text-default">
                                            Layout
                                        </h3>
                                        <p className="text-muted text-xs">
                                            Choose how you move through SlickSync
                                        </p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                                    {layoutModeIds.map((id) => (
                                        <LayoutModeCard
                                            isSelected={layoutMode === id}
                                            key={id}
                                            layoutId={id}
                                            onSelect={() => setLayoutMode(id)}
                                        />
                                    ))}
                                </div>

                                {/* Moved here from Settings -> Other Settings - a display
                arrangement choice belongs alongside Layout, not off on its
                own page. */}
                                <div className="mt-3 flex items-center justify-between rounded-lg bg-subtle p-4">
                                    <div>
                                        <p className="font-medium text-default text-sm">
                                            Default View Mode
                                        </p>
                                        <p className="text-muted text-xs">
                                            Choose how lists are displayed by default
                                        </p>
                                    </div>
                                    <div className="hidden md:block">
                                        <ViewModeToggle
                                            mode={viewMode}
                                            onChange={setViewMode}
                                            showLabels={false}
                                        />
                                    </div>
                                    <span
                                        className="text-right text-muted text-xs md:hidden"
                                        style={{ maxWidth: "120px" }}
                                    >
                                        Grid view only on mobile
                                    </span>
                                </div>
                            </Card>
                        </PageSection>
                    )}

                    {/* Theme Selection */}
                    <PageSection className="mb-6" delay={0.05}>
                        <Card padding="lg">
                            <div className="mb-5 flex items-center gap-3">
                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-muted">
                                    <PaintBrushIcon className="h-5 w-5 text-primary" />
                                </div>
                                <div>
                                    <h3 className="font-display font-semibold text-base text-default">
                                        Theme
                                    </h3>
                                    <p className="text-muted text-xs">
                                        Choose your preferred color scheme
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                                {themeIds.map((id) => (
                                    <ThemeCard
                                        isSelected={themeId === id}
                                        key={id}
                                        meta={themeMeta[id]}
                                        onSelect={() => setTheme(id)}
                                        themeId={id}
                                    />
                                ))}
                                {/* User-created themes rendered alongside the built-ins, with a
                  delete button. Built-ins are never deletable. */}
                                {savedCustomThemes.map((t) => (
                                    <CustomThemeCard
                                        isSelected={themeId === t.id}
                                        key={t.id}
                                        onDelete={() => setPendingDelete(t)}
                                        onSelect={() => setTheme(t.id)}
                                        theme={t}
                                    />
                                ))}
                            </div>
                        </Card>
                    </PageSection>

                    {/* Custom Theme builder - pick your own accent colors on top of any
            base theme's structure, live-preview, and save. */}
                    <PageSection className="mb-6" delay={0.1}>
                        <Card padding="lg">
                            <div className="mb-5 flex items-center gap-3">
                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary-muted">
                                    <SwatchIcon className="h-5 w-5 text-secondary" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-display font-semibold text-base text-default">
                                        Build your own theme
                                    </h3>
                                    <p className="text-muted text-xs">
                                        Pick a base for the background &amp; text, then your own
                                        accent colors. Preview updates live.
                                    </p>
                                </div>
                                {isCustom && (
                                    <Badge size="sm" variant="success">
                                        Active
                                    </Badge>
                                )}
                            </div>

                            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[380px_1fr]">
                                <div className="space-y-5 lg:sticky lg:top-6">
                                    {/* Live mockup — a small "app screenshot" rendered with the
                  builder's own resolved colors/font/radius/text-scale: brand
                  mark + wordmark, a stat row, the real Continue Watching
                  progress bar, tag pills, body copy, and buttons + a toggle.
                  Deliberately samples a bit of everything the builder
                  controls, not just accents, so nothing is a surprise once
                  it's applied for real. Independent of
                  document.documentElement so it's accurate even mid-drag on a
                  color input. */}
                                    <fieldset
                                        aria-labelledby={`${groupLabelId1}-1`}
                                        className="mx-0 min-w-0 border-0 p-0"
                                    >
                                        <p
                                            className="mb-2 block font-medium text-muted text-xs"
                                            id={`${groupLabelId1}-1`}
                                        >
                                            Preview
                                        </p>
                                        {(() => {
                                            const p = resolvePreviewPalette(builderBase, {
                                                background: builderBackground,
                                                bgMuted: builderBgMuted,
                                                border: builderBorder,
                                                error: builderError,
                                                primary: builderPrimary,
                                                progressBar: builderProgressBar,
                                                secondary: builderSecondary,
                                                success: builderSuccess,
                                                surface: builderSurface,
                                                text: builderText,
                                                textMuted: builderTextMuted,
                                            });
                                            const radiusScale =
                                                builderRadius === "default"
                                                    ? null
                                                    : RADIUS_PRESETS[builderRadius];
                                            const rLg = radiusScale?.lg || BASE_RADIUS_PX.lg;
                                            const rMd = radiusScale?.md || BASE_RADIUS_PX.md;
                                            const rSm = radiusScale?.sm || BASE_RADIUS_PX.sm;
                                            const fontFamily =
                                                FONT_OPTIONS.find((f) => f.id === builderFont)
                                                    ?.family || undefined;
                                            const scale = TEXT_SCALE_FACTORS[builderTextScale];
                                            const progressFill =
                                                p.progressBar ||
                                                `linear-gradient(90deg, ${p.primary}, ${p.secondary})`;
                                            const progressAccent = p.progressBar || p.primary;
                                            return (
                                                <>
                                                    <div
                                                        className="relative overflow-hidden"
                                                        style={{
                                                            border: `1px solid ${p.border}`,
                                                            borderRadius: rLg,
                                                            boxShadow:
                                                                "0 12px 28px -14px rgba(0,0,0,0.45)",
                                                        }}
                                                    >
                                                        {/* accent strip — the accent pairing at a glance before reading anything else */}
                                                        <div
                                                            className="h-[3px] w-full"
                                                            style={{
                                                                background: `linear-gradient(90deg, ${p.primary}, ${p.secondary})`,
                                                            }}
                                                        />
                                                        <div
                                                            className="p-5"
                                                            style={{ background: p.bg, fontFamily }}
                                                        >
                                                            {/* mini app header: brand mark + wordmark + avatar */}
                                                            <div className="mb-4 flex items-center gap-2.5">
                                                                <div
                                                                    className="flex h-7 w-7 shrink-0 items-center justify-center"
                                                                    style={{
                                                                        background: `linear-gradient(135deg, ${p.primary}, ${p.secondary})`,
                                                                        borderRadius: rMd,
                                                                    }}
                                                                >
                                                                    <SparklesIcon
                                                                        className="h-3.5 w-3.5"
                                                                        style={{ color: "#fff" }}
                                                                    />
                                                                </div>
                                                                <span
                                                                    className="truncate font-bold"
                                                                    style={{
                                                                        color: p.text,
                                                                        fontSize: `${14.5 * scale}px`,
                                                                    }}
                                                                >
                                                                    {builderName.trim() ||
                                                                        "SlickSync"}
                                                                </span>
                                                                <div
                                                                    className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-semibold"
                                                                    style={{
                                                                        background: p.bgMuted,
                                                                        color: p.textMuted,
                                                                        fontSize: `${9.5 * scale}px`,
                                                                    }}
                                                                >
                                                                    A
                                                                </div>
                                                            </div>

                                                            {/* status dots — same green/red health-check language as the
                              real Addons list, so Success/Error accents show up somewhere too */}
                                                            <div className="mb-4 flex items-center gap-3">
                                                                <span className="flex items-center gap-1.5">
                                                                    <span
                                                                        className="h-2 w-2 shrink-0 rounded-full"
                                                                        style={{
                                                                            background: p.success,
                                                                        }}
                                                                    />
                                                                    <span
                                                                        style={{
                                                                            color: p.textMuted,
                                                                            fontSize: `${10 * scale}px`,
                                                                        }}
                                                                    >
                                                                        Online
                                                                    </span>
                                                                </span>
                                                                <span className="flex items-center gap-1.5">
                                                                    <span
                                                                        className="h-2 w-2 shrink-0 rounded-full"
                                                                        style={{
                                                                            background: p.error,
                                                                        }}
                                                                    />
                                                                    <span
                                                                        style={{
                                                                            color: p.textMuted,
                                                                            fontSize: `${10 * scale}px`,
                                                                        }}
                                                                    >
                                                                        Offline
                                                                    </span>
                                                                </span>
                                                            </div>

                                                            {/* stat tiles — each in a different accent so primary/secondary/text all show up somewhere */}
                                                            <div className="mb-4 grid grid-cols-3 gap-2">
                                                                {[
                                                                    {
                                                                        c: p.primary,
                                                                        l: "Watched",
                                                                        n: "1.2K",
                                                                    },
                                                                    {
                                                                        c: p.secondary,
                                                                        l: "This week",
                                                                        n: "42h",
                                                                    },
                                                                    {
                                                                        c: p.text,
                                                                        l: "Active",
                                                                        n: "12",
                                                                    },
                                                                ].map((s) => (
                                                                    <div
                                                                        className="px-1 py-2 text-center"
                                                                        key={s.l}
                                                                        style={{
                                                                            background: p.bgMuted,
                                                                            borderRadius: rSm,
                                                                        }}
                                                                    >
                                                                        <p
                                                                            className="font-bold leading-tight"
                                                                            style={{
                                                                                color: s.c,
                                                                                fontSize: `${14 * scale}px`,
                                                                            }}
                                                                        >
                                                                            {s.n}
                                                                        </p>
                                                                        <p
                                                                            className="mt-0.5 uppercase leading-tight tracking-wide"
                                                                            style={{
                                                                                color: p.textMuted,
                                                                                fontSize: `${8.5 * scale}px`,
                                                                            }}
                                                                        >
                                                                            {s.l}
                                                                        </p>
                                                                    </div>
                                                                ))}
                                                            </div>

                                                            {/* Continue Watching card, bound to the real progress-bar override */}
                                                            <div
                                                                className="mb-4 p-3"
                                                                style={{
                                                                    background: p.surface,
                                                                    border: `1px solid ${p.border}`,
                                                                    borderRadius: rMd,
                                                                }}
                                                            >
                                                                <div className="mb-2 flex items-center justify-between">
                                                                    <span
                                                                        className="font-medium"
                                                                        style={{
                                                                            color: p.text,
                                                                            fontSize: `${12 * scale}px`,
                                                                        }}
                                                                    >
                                                                        Continue Watching
                                                                    </span>
                                                                    <span
                                                                        className="px-1.5 py-0.5 font-semibold"
                                                                        style={{
                                                                            background: `${progressAccent}26`,
                                                                            borderRadius: rSm,
                                                                            color: progressAccent,
                                                                            fontSize: `${10 * scale}px`,
                                                                        }}
                                                                    >
                                                                        62%
                                                                    </span>
                                                                </div>
                                                                <div
                                                                    className="h-1.5 w-full overflow-hidden"
                                                                    style={{
                                                                        background: p.bgMuted,
                                                                        borderRadius: rSm,
                                                                    }}
                                                                >
                                                                    <div
                                                                        className="h-full w-2/3"
                                                                        style={{
                                                                            background:
                                                                                progressFill,
                                                                        }}
                                                                    />
                                                                </div>
                                                            </div>

                                                            {/* tag pills — genre/tag chips, same visual language as Discover + Addons */}
                                                            <div className="mb-4 flex flex-wrap items-center gap-1.5">
                                                                <span
                                                                    className="px-2 py-0.5 font-medium"
                                                                    style={{
                                                                        background: `${p.primary}22`,
                                                                        borderRadius: rSm,
                                                                        color: p.primary,
                                                                        fontSize: `${10 * scale}px`,
                                                                    }}
                                                                >
                                                                    Action
                                                                </span>
                                                                <span
                                                                    className="px-2 py-0.5 font-medium"
                                                                    style={{
                                                                        background: `${p.secondary}22`,
                                                                        borderRadius: rSm,
                                                                        color: p.secondary,
                                                                        fontSize: `${10 * scale}px`,
                                                                    }}
                                                                >
                                                                    4K
                                                                </span>
                                                                <span
                                                                    className="px-2 py-0.5 font-medium"
                                                                    style={{
                                                                        background: p.bgMuted,
                                                                        borderRadius: rSm,
                                                                        color: p.textMuted,
                                                                        fontSize: `${10 * scale}px`,
                                                                    }}
                                                                >
                                                                    Kids
                                                                </span>
                                                            </div>

                                                            {/* body copy, on the resolved muted color */}
                                                            <p
                                                                className="mb-4"
                                                                style={{
                                                                    color: p.textMuted,
                                                                    fontSize: `${11.5 * scale}px`,
                                                                    lineHeight: 1.5,
                                                                }}
                                                            >
                                                                The quick brown fox jumps over the
                                                                lazy dog — body text and captions
                                                                render like this.
                                                            </p>

                                                            {/* buttons + a toggle switch */}
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span
                                                                    className="px-3 py-1.5 font-semibold"
                                                                    style={{
                                                                        background: p.primary,
                                                                        borderRadius: rMd,
                                                                        color: "#fff",
                                                                        fontSize: `${12 * scale}px`,
                                                                    }}
                                                                >
                                                                    Primary
                                                                </span>
                                                                <span
                                                                    className="px-3 py-1.5 font-semibold"
                                                                    style={{
                                                                        background: "transparent",
                                                                        border: `1px solid ${p.primary}`,
                                                                        borderRadius: rMd,
                                                                        color: p.primary,
                                                                        fontSize: `${12 * scale}px`,
                                                                    }}
                                                                >
                                                                    Secondary
                                                                </span>
                                                                <span
                                                                    className="ml-auto flex h-[18px] w-8 shrink-0 items-center rounded-full px-0.5"
                                                                    style={{
                                                                        background: p.primary,
                                                                    }}
                                                                >
                                                                    <span className="ml-auto block h-3.5 w-3.5 rounded-full bg-white" />
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <p className="mt-2 text-[11px] text-muted">
                                                        Based on {themeMeta[builderBase].name}
                                                    </p>
                                                </>
                                            );
                                        })()}
                                    </fieldset>

                                    <div>
                                        <label
                                            className="mb-2 block font-medium text-muted text-xs"
                                            htmlFor={`${fieldId1}-3`}
                                        >
                                            Theme name
                                        </label>
                                        <input
                                            className="input-base w-full max-w-xs px-3 py-2 text-sm"
                                            id={`${fieldId1}-3`}
                                            onChange={(e) => setBuilderName(e.target.value)}
                                            placeholder={`Custom theme ${savedCustomThemes.length + 1}`}
                                            type="text"
                                            value={builderName}
                                        />
                                        <p className="mt-1 text-[11px] text-muted">
                                            Saved themes appear alongside the built-in ones above.
                                        </p>
                                    </div>

                                    <div>
                                        <label
                                            className="mb-2 block font-medium text-muted text-xs"
                                            htmlFor={`${fieldId1}-4`}
                                        >
                                            Base (background, surfaces, text)
                                        </label>
                                        <select
                                            className="input-base w-full max-w-xs px-3 py-2 text-sm"
                                            id={`${fieldId1}-4`}
                                            onChange={(e) => {
                                                const v = e.target.value as ThemeId;
                                                const nextPrimary = themeMeta[v].colors.primary;
                                                const nextSecondary = themeMeta[v].colors.secondary;
                                                setBuilderBase(v);
                                                setBuilderPrimary(nextPrimary);
                                                setBuilderSecondary(nextSecondary);
                                                previewCustom({
                                                    ...buildDraft(),
                                                    base: v,
                                                    primary: nextPrimary,
                                                    secondary: nextSecondary,
                                                });
                                            }}
                                            value={builderBase}
                                        >
                                            {themeIds.map((id) => (
                                                <option key={id} value={id}>
                                                    {themeMeta[id].name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-3 pt-1">
                                        {/* When a custom is currently active, offer BOTH: update it in
                    place OR fork the current builder state into a brand new
                    saved theme. When nothing custom is active, only "Save as
                    new" makes sense. */}
                                        {activeCustomTheme ? (
                                            <>
                                                <Button
                                                    onClick={() => {
                                                        updateCustomTheme(
                                                            activeCustomTheme.id,
                                                            buildDraft(),
                                                            builderName
                                                        );
                                                        toast.success(
                                                            `Updated "${builderName.trim() || activeCustomTheme.name}"`
                                                        );
                                                    }}
                                                    size="sm"
                                                    variant="primary"
                                                >
                                                    Update &quot;{activeCustomTheme.name}&quot;
                                                </Button>
                                                <Button
                                                    onClick={() => {
                                                        const id = saveCustomTheme(
                                                            buildDraft(),
                                                            builderName
                                                        );
                                                        const created =
                                                            builderName.trim() ||
                                                            `Custom theme ${savedCustomThemes.length + 1}`;
                                                        toast.success(
                                                            `Saved "${created}" as a new theme`
                                                        );
                                                        void id;
                                                    }}
                                                    size="sm"
                                                    variant="secondary"
                                                >
                                                    Save as new theme
                                                </Button>
                                            </>
                                        ) : (
                                            <Button
                                                onClick={() => {
                                                    saveCustomTheme(buildDraft(), builderName);
                                                    const created =
                                                        builderName.trim() ||
                                                        `Custom theme ${savedCustomThemes.length + 1}`;
                                                    toast.success(
                                                        `Saved "${created}" as a new theme`
                                                    );
                                                }}
                                                size="sm"
                                                variant="primary"
                                            >
                                                Save as new theme
                                            </Button>
                                        )}
                                        <button
                                            className="text-muted text-xs transition-colors hover:text-default"
                                            onClick={() => {
                                                // Discard the live preview, re-applying the active theme,
                                                // and reset every builder input to the active custom's
                                                // values (or defaults, if no custom is active).
                                                cancelPreview();
                                                setBuilderName(activeCustomTheme?.name || "");
                                                setBuilderBase(activeCustomTheme?.base || "nebula");
                                                setBuilderPrimary(
                                                    activeCustomTheme?.primary || "#8b7ec8"
                                                );
                                                setBuilderSecondary(
                                                    activeCustomTheme?.secondary || "#5fd4c4"
                                                );
                                                setBuilderText(activeCustomTheme?.text || "");
                                                setBuilderTextMuted(
                                                    activeCustomTheme?.textMuted || ""
                                                );
                                                setBuilderBackground(
                                                    activeCustomTheme?.background || ""
                                                );
                                                setBuilderSurface(activeCustomTheme?.surface || "");
                                                setBuilderBgMuted(activeCustomTheme?.bgMuted || "");
                                                setBuilderBorder(activeCustomTheme?.border || "");
                                                setBuilderProgressBar(
                                                    activeCustomTheme?.progressBar || ""
                                                );
                                                setBuilderSuccess(activeCustomTheme?.success || "");
                                                setBuilderError(activeCustomTheme?.error || "");
                                                setBuilderFont(
                                                    (activeCustomTheme?.fontDisplay as FontId) ||
                                                        "default"
                                                );
                                                setBuilderRadius(
                                                    (activeCustomTheme?.radius as RadiusId) ||
                                                        "default"
                                                );
                                                setBuilderTextScale(
                                                    (activeCustomTheme?.textScale as TextScaleId) ||
                                                        "default"
                                                );
                                            }}
                                            type="button"
                                        >
                                            Reset preview
                                        </button>
                                    </div>

                                    {/* Theme sharing via a compact copy-paste code - no server
                  round-trip needed, themes are already purely client-side. */}
                                    <div
                                        className="pt-3"
                                        style={{
                                            borderTop: "1px solid var(--color-surface-border)",
                                        }}
                                    >
                                        <div className="flex flex-wrap items-center gap-3">
                                            <Button
                                                onClick={handleExportCode}
                                                size="sm"
                                                variant="secondary"
                                            >
                                                Copy theme code
                                            </Button>
                                            <button
                                                className="text-muted text-xs transition-colors hover:text-default"
                                                onClick={() => setShowImportCode((v) => !v)}
                                                type="button"
                                            >
                                                {showImportCode
                                                    ? "Cancel import"
                                                    : "Import from a code"}
                                            </button>
                                        </div>
                                        {showImportCode && (
                                            <div className="mt-3 flex items-center gap-2">
                                                <input
                                                    className="flex-1 rounded-lg px-3 py-2 font-mono text-sm"
                                                    onChange={(e) =>
                                                        setImportCodeValue(e.target.value)
                                                    }
                                                    placeholder="Paste a theme code here (starts with SST1:)"
                                                    style={{
                                                        background: "var(--color-subtle)",
                                                        border: "1px solid var(--color-surface-border)",
                                                        color: "var(--color-text)",
                                                    }}
                                                    type="text"
                                                    value={importCodeValue}
                                                />
                                                <Button
                                                    disabled={!importCodeValue.trim()}
                                                    onClick={handleImportCode}
                                                    size="sm"
                                                    variant="primary"
                                                >
                                                    Import
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Right column - the long tail of optional overrides, grouped
                under section labels instead of one flat wrapping list, so
                the page reads as "a few clear groups" rather than a wall of
                identical-looking color pickers. */}
                                <div className="space-y-6">
                                    <section>
                                        <h4 className="mb-3 font-semibold text-[11px] text-muted uppercase tracking-wider">
                                            Accent colors
                                        </h4>
                                        <div className="grid max-w-sm grid-cols-2 gap-4">
                                            <div>
                                                <label
                                                    className="mb-2 block font-medium text-muted text-xs"
                                                    htmlFor={`${fieldId1}-5`}
                                                >
                                                    Primary
                                                </label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        className="h-10 w-12 cursor-pointer rounded-lg border border-default bg-transparent p-0.5"
                                                        id={`${fieldId1}-5`}
                                                        onChange={(e) => {
                                                            setBuilderPrimary(e.target.value);
                                                            previewCustom({
                                                                ...buildDraft(),
                                                                primary: e.target.value,
                                                            });
                                                        }}
                                                        type="color"
                                                        value={builderPrimary}
                                                    />
                                                    <span className="font-mono text-muted text-xs uppercase">
                                                        {builderPrimary}
                                                    </span>
                                                </div>
                                            </div>
                                            <div>
                                                <label
                                                    className="mb-2 block font-medium text-muted text-xs"
                                                    htmlFor={`${fieldId1}-6`}
                                                >
                                                    Secondary
                                                </label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        className="h-10 w-12 cursor-pointer rounded-lg border border-default bg-transparent p-0.5"
                                                        id={`${fieldId1}-6`}
                                                        onChange={(e) => {
                                                            setBuilderSecondary(e.target.value);
                                                            previewCustom({
                                                                ...buildDraft(),
                                                                secondary: e.target.value,
                                                            });
                                                        }}
                                                        type="color"
                                                        value={builderSecondary}
                                                    />
                                                    <span className="font-mono text-muted text-xs uppercase">
                                                        {builderSecondary}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    <section
                                        className="pt-5"
                                        style={{
                                            borderTop: "1px solid var(--color-surface-border)",
                                        }}
                                    >
                                        <h4 className="mb-3 font-semibold text-[11px] text-muted uppercase tracking-wider">
                                            Text &amp; surface colors
                                        </h4>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
                                            <ColorOverride
                                                label="Text color"
                                                onClear={() => {
                                                    setBuilderText("");
                                                    previewCustom({ ...buildDraft(), text: null });
                                                }}
                                                onSet={(v) => {
                                                    setBuilderText(v);
                                                    previewCustom({ ...buildDraft(), text: v });
                                                }}
                                                seed={THEME_REAL_COLORS[builderBase].text}
                                                value={builderText}
                                            />
                                            <ColorOverride
                                                label="Muted text"
                                                onClear={() => {
                                                    setBuilderTextMuted("");
                                                    previewCustom({
                                                        ...buildDraft(),
                                                        textMuted: null,
                                                    });
                                                }}
                                                onSet={(v) => {
                                                    setBuilderTextMuted(v);
                                                    previewCustom({
                                                        ...buildDraft(),
                                                        textMuted: v,
                                                    });
                                                }}
                                                seed={THEME_REAL_COLORS[builderBase].textMuted}
                                                value={builderTextMuted}
                                            />
                                            <ColorOverride
                                                label="Background"
                                                onClear={() => {
                                                    setBuilderBackground("");
                                                    previewCustom({
                                                        ...buildDraft(),
                                                        background: null,
                                                    });
                                                }}
                                                onSet={(v) => {
                                                    setBuilderBackground(v);
                                                    previewCustom({
                                                        ...buildDraft(),
                                                        background: v,
                                                    });
                                                }}
                                                seed={themeMeta[builderBase].colors.bg}
                                                value={builderBackground}
                                            />
                                            <ColorOverride
                                                label="Surface / cards"
                                                onClear={() => {
                                                    setBuilderSurface("");
                                                    previewCustom({
                                                        ...buildDraft(),
                                                        surface: null,
                                                    });
                                                }}
                                                onSet={(v) => {
                                                    setBuilderSurface(v);
                                                    previewCustom({ ...buildDraft(), surface: v });
                                                }}
                                                seed={themeMeta[builderBase].colors.surface}
                                                value={builderSurface}
                                            />
                                            <ColorOverride
                                                label="Subtle fill"
                                                onClear={() => {
                                                    setBuilderBgMuted("");
                                                    previewCustom({
                                                        ...buildDraft(),
                                                        bgMuted: null,
                                                    });
                                                }}
                                                onSet={(v) => {
                                                    setBuilderBgMuted(v);
                                                    previewCustom({ ...buildDraft(), bgMuted: v });
                                                }}
                                                seed={THEME_REAL_COLORS[builderBase].bgMuted}
                                                value={builderBgMuted}
                                            />
                                            <ColorOverride
                                                label="Card borders"
                                                onClear={() => {
                                                    setBuilderBorder("");
                                                    previewCustom({
                                                        ...buildDraft(),
                                                        border: null,
                                                    });
                                                }}
                                                onSet={(v) => {
                                                    setBuilderBorder(v);
                                                    previewCustom({ ...buildDraft(), border: v });
                                                }}
                                                seed={THEME_REAL_COLORS[builderBase].border}
                                                value={builderBorder}
                                            />
                                        </div>
                                        <p className="mt-1 text-[11px] text-muted">
                                            All optional - each falls back to the base theme's own
                                            value until set.
                                        </p>
                                    </section>

                                    <section
                                        className="pt-5"
                                        style={{
                                            borderTop: "1px solid var(--color-surface-border)",
                                        }}
                                    >
                                        <h4 className="mb-3 font-semibold text-[11px] text-muted uppercase tracking-wider">
                                            Status &amp; accents
                                        </h4>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
                                            <ColorOverride
                                                label="Progress bar"
                                                onClear={() => {
                                                    setBuilderProgressBar("");
                                                    previewCustom({
                                                        ...buildDraft(),
                                                        progressBar: null,
                                                    });
                                                }}
                                                onSet={(v) => {
                                                    setBuilderProgressBar(v);
                                                    previewCustom({
                                                        ...buildDraft(),
                                                        progressBar: v,
                                                    });
                                                }}
                                                seed={builderPrimary}
                                                value={builderProgressBar}
                                            />
                                            <ColorOverride
                                                label="Success accent"
                                                onClear={() => {
                                                    setBuilderSuccess("");
                                                    previewCustom({
                                                        ...buildDraft(),
                                                        success: null,
                                                    });
                                                }}
                                                onSet={(v) => {
                                                    setBuilderSuccess(v);
                                                    previewCustom({ ...buildDraft(), success: v });
                                                }}
                                                seed={THEME_REAL_COLORS[builderBase].success}
                                                value={builderSuccess}
                                            />
                                            <ColorOverride
                                                label="Error accent"
                                                onClear={() => {
                                                    setBuilderError("");
                                                    previewCustom({ ...buildDraft(), error: null });
                                                }}
                                                onSet={(v) => {
                                                    setBuilderError(v);
                                                    previewCustom({ ...buildDraft(), error: v });
                                                }}
                                                seed={THEME_REAL_COLORS[builderBase].error}
                                                value={builderError}
                                            />
                                        </div>
                                        <p className="mt-1 text-[11px] text-muted">
                                            Progress bar overrides the resume-progress fill on
                                            Dashboard → Continue Watching (blank keeps the default
                                            primary→secondary gradient). Success/Error recolor
                                            health-check dots, badges, and confirmation toasts
                                            across the whole app.
                                        </p>
                                    </section>

                                    <section
                                        className="pt-5"
                                        style={{
                                            borderTop: "1px solid var(--color-surface-border)",
                                        }}
                                    >
                                        <h4 className="mb-3 font-semibold text-[11px] text-muted uppercase tracking-wider">
                                            Shape
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {(Object.keys(RADIUS_PRESETS) as RadiusId[]).map(
                                                (id) => (
                                                    <button
                                                        className={`px-3 py-1.5 text-sm transition-colors ${
                                                            builderRadius === id
                                                                ? "bg-primary text-white"
                                                                : "bg-surface-hover text-muted hover:text-default"
                                                        }`}
                                                        key={id}
                                                        onClick={() => {
                                                            setBuilderRadius(id);
                                                            previewCustom({
                                                                ...buildDraft(),
                                                                radius: id,
                                                            });
                                                        }}
                                                        style={{
                                                            // Preview each preset's own corner style ON the button
                                                            // itself — square button for "Square", pill-ish for
                                                            // "Extra rounded", etc. Reads as a live legend.
                                                            borderRadius:
                                                                id === "square"
                                                                    ? "2px"
                                                                    : id === "rounded"
                                                                      ? "14px"
                                                                      : id === "extra"
                                                                        ? "20px"
                                                                        : "10px",
                                                        }}
                                                        type="button"
                                                    >
                                                        {RADIUS_LABELS[id]}
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    </section>

                                    <section
                                        className="pt-5"
                                        style={{
                                            borderTop: "1px solid var(--color-surface-border)",
                                        }}
                                    >
                                        <h4 className="mb-3 font-semibold text-[11px] text-muted uppercase tracking-wider">
                                            Typography
                                        </h4>
                                        <div className="space-y-4">
                                            <fieldset
                                                aria-labelledby={`${groupLabelId1}-2`}
                                                className="mx-0 min-w-0 border-0 p-0"
                                            >
                                                <p
                                                    className="mb-2 block font-medium text-muted text-xs"
                                                    id={`${groupLabelId1}-2`}
                                                >
                                                    Font
                                                </p>
                                                <div className="flex flex-wrap gap-2">
                                                    {FONT_OPTIONS.map((f) => (
                                                        <button
                                                            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                                                                builderFont === f.id
                                                                    ? "bg-primary text-white"
                                                                    : "bg-surface-hover text-muted hover:text-default"
                                                            }`}
                                                            key={f.id}
                                                            onClick={() => {
                                                                setBuilderFont(f.id);
                                                                previewCustom({
                                                                    ...buildDraft(),
                                                                    fontDisplay: f.id,
                                                                });
                                                            }}
                                                            style={
                                                                f.family
                                                                    ? { fontFamily: f.family }
                                                                    : undefined
                                                            }
                                                            type="button"
                                                        >
                                                            {f.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </fieldset>

                                            <fieldset
                                                aria-labelledby={`${groupLabelId1}-3`}
                                                className="mx-0 min-w-0 border-0 p-0"
                                            >
                                                <p
                                                    className="mb-2 block font-medium text-muted text-xs"
                                                    id={`${groupLabelId1}-3`}
                                                >
                                                    Text size
                                                </p>
                                                <div className="flex flex-wrap gap-2">
                                                    {(
                                                        Object.keys(
                                                            TEXT_SCALE_PRESETS
                                                        ) as TextScaleId[]
                                                    ).map((id) => (
                                                        <button
                                                            className={`rounded-lg px-3 py-1.5 transition-colors ${
                                                                builderTextScale === id
                                                                    ? "bg-primary text-white"
                                                                    : "bg-surface-hover text-muted hover:text-default"
                                                            }`}
                                                            key={id}
                                                            onClick={() => {
                                                                setBuilderTextScale(id);
                                                                previewCustom({
                                                                    ...buildDraft(),
                                                                    textScale: id,
                                                                });
                                                            }}
                                                            style={{
                                                                fontSize: `${13 * TEXT_SCALE_FACTORS[id]}px`,
                                                            }}
                                                            type="button"
                                                        >
                                                            {TEXT_SCALE_LABELS[id]}
                                                        </button>
                                                    ))}
                                                </div>
                                                <p className="mt-1.5 text-[11px] text-muted">
                                                    Scales body text and most UI chrome app-wide,
                                                    not just this builder.
                                                </p>
                                            </fieldset>
                                        </div>
                                    </section>
                                </div>
                            </div>
                        </Card>
                    </PageSection>
                </div>
            </div>

            {/* Confirm delete for a saved custom theme. Deleting reverts to Nebula
          if it was the active theme (handled inside deleteCustomTheme). */}
            <ConfirmModal
                confirmText="Delete"
                description={
                    pendingDelete ? `Delete "${pendingDelete.name}"? This can't be undone.` : ""
                }
                isOpen={!!pendingDelete}
                onClose={() => setPendingDelete(null)}
                onConfirm={() => {
                    if (!pendingDelete) {
                        return;
                    }
                    const name = pendingDelete.name;
                    deleteCustomTheme(pendingDelete.id);
                    setPendingDelete(null);
                    toast.success(`Deleted "${name}"`);
                }}
                title="Delete custom theme"
                variant="danger"
            />
        </>
    );
}
