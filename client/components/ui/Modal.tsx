"use client";

import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useReducedMotion } from "framer-motion";
import { Fragment, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { cachedImageUrl } from "@/lib/posterUrl";
import { Button } from "./Button";

interface ModalProps {
    ariaLabel?: string;
    /** Optional ambient art behind the whole panel (e.g. a title's backdrop),
     * not just a header strip - a large, blurred, dimmed version fading into
     * the panel's normal surface color. Unmounts with the rest of the modal
     * on close, nothing extra needed there. Omit for the plain solid panel.
     * Caller should omit this while playing a trailer/video in the same
     * modal - blurring a large layer is real rasterization cost, and doing
     * it at the same moment a video is trying to start competes for the
     * same paint/compositing budget (confirmed real perceived slowdown). */
    backdropImage?: string;
    children: React.ReactNode;
    description?: string;
    /** Suppress the built-in overlaid close button - for content (e.g. an
     * embedded video player) that has its own top-right controls the button
     * would otherwise sit on top of. The caller is responsible for providing
     * another way to close (backdrop click and Escape still work). */
    hideCloseButton?: boolean;
    isOpen: boolean;
    /** Render without the dialog library's page-wide hooks. The library marks
     * the whole page inert on open and again on close, and flips the page's
     * scroll container on and off - each a full style and layout pass over
     * every element on the page, then a repaint, which on a phone is most of
     * what a close costs on a long page. This shell keeps the behaviour that
     * matters (backdrop tap and Escape close it, focus stays inside and is
     * handed back on close, screen readers see a modal dialog) and never
     * touches the page: scrolling is contained by the panel's own scroll
     * behaviour and by the overlay swallowing touches and wheel. No enter or
     * exit motion either way - the library shell had none in practice. */
    lightweight?: boolean;
    onClose: () => void;
    size?: "sm" | "md" | "lg" | "xl" | "full";
    title?: string;
}

const sizeStyles = {
    full: "max-w-4xl",
    lg: "max-w-lg",
    md: "max-w-md",
    sm: "max-w-sm",
    xl: "max-w-xl",
};

const sizeMaxWidthPx = {
    full: "896px",
    lg: "512px",
    md: "448px",
    sm: "384px",
    xl: "576px",
};

export function Modal({
    isOpen,
    onClose,
    title,
    ariaLabel,
    description,
    size = "md",
    children,
    hideCloseButton = false,
    backdropImage,
    lightweight = false,
}: ModalProps) {
    // On a phone or tablet the close is a plain fade. The default close also
    // shrinks and slides the panel, and a transform on a panel whose backdrop
    // art is a large blurred image makes WebKit re-rasterize that image on
    // every frame of the exit; a fade alone composites for free. The open
    // keeps its motion - the content has to be painted then regardless.
    const coarse = useCoarsePointer();
    const reduceMotion = useReducedMotion();
    // The library's own title element inside its shell; a plain heading in
    // the lightweight one, wired to the dialog by id for screen readers.
    const TitleTag: React.ElementType = lightweight ? "h2" : DialogTitle;
    const generatedTitleId = useId();
    const titleId = lightweight ? generatedTitleId : undefined;
    const panelBody = (
        <>
            {!(title || lightweight) && (
                <DialogTitle className="sr-only">{ariaLabel || "Details"}</DialogTitle>
            )}
            {/* Ambient backdrop art - z-0, sits behind the header/content
          below (both explicitly z-10) rather than relying on default
          paint order, which would otherwise put this absolutely-
          positioned layer above their static-flow content. Sized to
          the panel itself (capped at max-h-[85vh] above), not the
          scrollable content, so the fade-to-solid point stays fixed
          regardless of how long the content is. */}
            {backdropImage && (
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
                >
                    {/* Phones and tablets get the 64px copy of the art from the
              poster cache, stretched to fill: an image scaled up that
              far is a blur already, with no filter for the GPU to
              recompute whenever the panel repaints. The dimming is an
              opacity over the panel's own surface, which composites
              for free as well. Desktops keep the real blur. */}
                    {coarse ? (
                        <img
                            alt=""
                            className="absolute inset-0 h-full w-full scale-110 object-cover"
                            decoding="async"
                            height={360}
                            src={cachedImageUrl(backdropImage, 64) || backdropImage}
                            style={{ opacity: 0.45 }}
                            width={640}
                        />
                    ) : (
                        <img
                            alt=""
                            className="absolute inset-0 h-full w-full scale-110 object-cover"
                            decoding="async"
                            height={360}
                            src={backdropImage}
                            style={{ filter: "blur(20px) brightness(0.55)" }}
                            width={640}
                        />
                    )}
                    <div
                        className="absolute inset-0"
                        style={{
                            background:
                                "linear-gradient(180deg, transparent 0%, var(--color-surface) 65%)",
                        }}
                    />
                </div>
            )}

            {/* Close button - unconditional (not tied to title/description) and
          positioned on the panel itself, not inside the scrollable content,
          so it stays put regardless of what's rendered below (a custom
          hero-image header, a title, or nothing) and regardless of scroll.
          Skipped entirely when hideCloseButton is set. */}
            {!hideCloseButton && (
                <button
                    aria-label="Close"
                    className="absolute top-3 right-3 z-20 rounded-full p-2.5 backdrop-blur-sm transition-colors"
                    onClick={onClose}
                    style={{
                        background: "color-mix(in srgb, var(--color-surface) 70%, transparent)",
                        color: "var(--color-text-muted)",
                    }}
                    type="button"
                >
                    <XMarkIcon className="h-5 w-5" />
                </button>
            )}

            {/* Header */}
            {(title || description) && (
                <div
                    className="relative z-10 shrink-0 px-6 pt-6 pr-14 pb-4"
                    style={{ borderBottom: "1px solid var(--color-surface-border)" }}
                >
                    {title && (
                        <TitleTag
                            className="font-display font-semibold text-xl"
                            id={titleId}
                            style={{ color: "var(--color-text)" }}
                        >
                            {title}
                        </TitleTag>
                    )}
                    {description && (
                        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                            {description}
                        </p>
                    )}
                </div>
            )}

            {/* Content */}
            <div className="relative z-10 overflow-y-auto overscroll-contain p-6">{children}</div>
        </>
    );

    if (lightweight) {
        return (
            <LightShell
                ariaLabel={ariaLabel}
                isOpen={isOpen}
                onClose={onClose}
                size={size}
                titleId={title ? titleId : undefined}
            >
                {panelBody}
            </LightShell>
        );
    }
    // The close fade is unconditional again. A previous diagnostic skipped
    // the leave transition on mobile while chasing a reported "closing any
    // modal freezes the page" bug - that investigation concluded the freeze
    // was specific to the reporter's Safari app itself (the same build is
    // smooth in another WebKit browser on the same phone), not to anything
    // this component does, so the instant-close degradation had no earned
    // benefit and is reverted.
    return (
        <Transition as={Fragment} show={isOpen}>
            <Dialog className="relative z-50" onClose={onClose}>
                {/* Backdrop */}
                <TransitionChild
                    as={Fragment}
                    enter="ease-out duration-200"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-150"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div
                        // A dimming scrim separates the task without re-blurring the
                        // entire page during every frame of the dialog transition.
                        className="fixed inset-0"
                        style={{ background: "rgba(0, 0, 0, 0.55)" }}
                    />
                </TransitionChild>

                {/* Modal container */}
                <div className="fixed inset-0 flex items-center justify-center p-4">
                    <TransitionChild
                        as={Fragment}
                        enter="ease-out duration-200"
                        enterFrom={
                            reduceMotion ? "opacity-0" : "opacity-0 scale-[0.98] translate-y-2"
                        }
                        enterTo="opacity-100 scale-100 translate-y-0"
                        leave="ease-in duration-150"
                        leaveFrom={
                            coarse || reduceMotion
                                ? "opacity-100"
                                : "opacity-100 scale-100 translate-y-0"
                        }
                        leaveTo={
                            coarse || reduceMotion
                                ? "opacity-0"
                                : "opacity-0 scale-[0.98] translate-y-2"
                        }
                    >
                        <DialogPanel
                            className={clsx(
                                "interface-modal relative flex max-h-[85dvh] w-full flex-col",
                                sizeStyles[size],
                                "overflow-hidden rounded-2xl p-0"
                            )}
                            style={{
                                background: "var(--color-surface)",
                                border: "1px solid var(--color-surface-border)",
                                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
                                maxWidth: sizeMaxWidthPx[size],
                            }}
                        >
                            {panelBody}
                        </DialogPanel>
                    </TransitionChild>
                </div>
            </Dialog>
        </Transition>
    );
}

// The shell behind `lightweight` - see that prop's comment on Modal.
function LightShell({
    isOpen,
    onClose,
    size,
    titleId,
    ariaLabel,
    children,
}: {
    isOpen: boolean;
    onClose: () => void;
    size: NonNullable<ModalProps["size"]>;
    titleId?: string;
    ariaLabel?: string;
    children: React.ReactNode;
}) {
    const panelRef = useRef<HTMLDivElement>(null);
    const restoreFocusTo = useRef<Element | null>(null);
    const closeRef = useRef(onClose);
    useEffect(() => {
        closeRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        restoreFocusTo.current = document.activeElement;
        const panel = panelRef.current;
        // Focus the panel itself so Escape and Tab land inside it.
        panel?.focus({ preventScroll: true });
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                closeRef.current();
                return;
            }
            if (e.key !== "Tab" || !panel) {
                return;
            }
            // Keep Tab inside the panel.
            const focusable = Array.from(
                panel.querySelectorAll<HTMLElement>(
                    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                )
            ).filter(
                (element) =>
                    element.tabIndex >= 0 &&
                    element.getClientRects().length > 0 &&
                    getComputedStyle(element).visibility !== "hidden"
            );
            if (focusable.length === 0) {
                e.preventDefault();
                return;
            }
            const first = focusable[0],
                last = focusable.at(-1);
            if (!(first && last)) {
                e.preventDefault();
                return;
            }
            if (
                e.shiftKey &&
                (document.activeElement === first || document.activeElement === panel)
            ) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("keydown", onKey);
            const el = restoreFocusTo.current as HTMLElement | null;
            if (el && typeof el.focus === "function" && el.isConnected) {
                el.focus({ preventScroll: true });
            }
        };
    }, [isOpen]);

    if (!isOpen || typeof document === "undefined") {
        return null;
    }
    return createPortal(
        <div className="fixed inset-0 z-50">
            {/* Overlay: closes on tap, and swallows touch and wheel so the page
          underneath never scrolls - without ever changing the page. */}
            <div
                aria-hidden="true"
                className="fixed inset-0"
                onClick={onClose}
                onWheel={(e) => e.preventDefault()}
                style={{ background: "rgba(0, 0, 0, 0.55)", touchAction: "none" }}
            />
            <div className="pointer-events-none fixed inset-0 flex items-center justify-center p-4">
                <div
                    aria-label={titleId ? undefined : ariaLabel || "Media details"}
                    aria-labelledby={titleId}
                    aria-modal="true"
                    className={clsx(
                        "pointer-events-auto relative flex max-h-[85dvh] w-full flex-col outline-none",
                        sizeStyles[size],
                        "overflow-hidden overscroll-contain rounded-2xl p-0"
                    )}
                    ref={panelRef}
                    role="dialog"
                    style={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-surface-border)",
                        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
                        maxWidth: sizeMaxWidthPx[size],
                    }}
                    tabIndex={-1}
                >
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}

// Confirmation modal
interface ConfirmModalProps {
    cancelText?: string;
    confirmText?: string;
    description: string;
    isLoading?: boolean;
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    variant?: "danger" | "warning" | "default";
}

export function ConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    description,
    confirmText = "Confirm",
    cancelText = "Cancel",
    variant = "default",
    isLoading,
}: ConfirmModalProps) {
    return (
        <Modal isOpen={isOpen} onClose={onClose} size="sm" title={title}>
            <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
                {description}
            </p>
            <div className="flex justify-end gap-3">
                <Button disabled={isLoading} onClick={onClose} variant="secondary">
                    {cancelText}
                </Button>
                <Button
                    isLoading={isLoading}
                    onClick={onConfirm}
                    variant={variant === "danger" ? "danger" : "primary"}
                >
                    {isLoading ? "Processing..." : confirmText}
                </Button>
            </div>
        </Modal>
    );
}
