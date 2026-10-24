"use client";

import {
    ArrowLeftIcon,
    ArrowPathIcon,
    CheckIcon,
    MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import md5 from "crypto-js/md5";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
    DICEBEAR_BASE,
    DICEBEAR_STYLES,
    diceBearSelection,
    diceBearUrl,
    styleName,
} from "@/lib/dicebear";

const COLORS = ["e8ecff", "d5f2e8", "fce7d5", "f6dfe9", "dceafa", "fff0ba", "c7c9d1", "20232d"];

export function DiceBearPicker({
    name,
    initialUrl,
    onChange,
}: {
    name: string;
    initialUrl?: string | null;
    onChange: (url: string) => void;
}) {
    const saved = diceBearSelection(initialUrl);
    const [styles, setStyles] = useState<string[]>([...DICEBEAR_STYLES]);
    const [style, setStyle] = useState(saved?.style || "voxel-bot");
    const [seed, setSeed] = useState(saved?.seed || md5(`slicksync-picker:${name}`).toString());
    const [anchorSeed, setAnchorSeed] = useState(seed);
    const [background, setBackground] = useState(saved?.background || "");
    const [choosingStyle, setChoosingStyle] = useState(!saved);
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(0);
    const [capabilities, setCapabilities] = useState<{ style: string; background: boolean } | null>(
        null
    );
    const supportsBackground = capabilities?.style === style && capabilities.background;
    const reduceMotion = useReducedMotion();

    useEffect(() => {
        const controller = new AbortController();
        fetch(DICEBEAR_BASE, { signal: controller.signal })
            .then((response) => response.json())
            .then((data) => {
                if (Array.isArray(data.styles)) {
                    const valid = data.styles.filter(
                        (value: unknown): value is string =>
                            typeof value === "string" && /^[a-z0-9-]+$/.test(value)
                    );
                    if (valid.length) {
                        setStyles(valid);
                    }
                }
            })
            .catch(() => {
                /* The bundled index keeps the picker usable offline. */
            });
        return () => controller.abort();
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        fetch(`${DICEBEAR_BASE}/${style}/options.json`, { signal: controller.signal })
            .then((response) => response.json())
            .then((options) => {
                setCapabilities({ background: !!options.backgroundColor, style });
            })
            .catch(() => {
                /* Keep unsupported controls hidden until capabilities are known. */
            });
        return () => controller.abort();
    }, [style]);

    useEffect(() => {
        onChange(diceBearUrl(style, seed, supportsBackground ? background : undefined));
    }, [style, seed, background, supportsBackground, onChange]);

    const variants = Array.from({ length: 12 }, (_, index) =>
        md5(`${name}:${style}:${page}:${index}`).toString()
    );
    const checker = {
        backgroundColor: "var(--color-surface)",
        backgroundImage:
            "conic-gradient(var(--color-surface-hover) 25%, transparent 0 50%, var(--color-surface-hover) 0 75%, transparent 0)",
        backgroundSize: "12px 12px",
    };

    return (
        <div className="space-y-5">
            {choosingStyle ? (
                <>
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h3 className="font-semibold text-base text-default">
                                Find your style
                            </h3>
                            <p className="mt-1 text-muted text-sm">
                                Faces, robots, pixels, patterns. All {styles.length} sets.
                            </p>
                        </div>
                        <Button onClick={() => setChoosingStyle(false)} size="sm" variant="ghost">
                            Back to avatar
                        </Button>
                    </div>
                    <label className="flex items-center gap-2 rounded-xl border border-default bg-surface-hover px-3 py-2.5">
                        <MagnifyingGlassIcon className="h-4 w-4 text-muted" />
                        <input
                            aria-label="Search avatar styles"
                            className="w-full min-w-0 bg-transparent text-default text-sm outline-none"
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search styles"
                            value={query}
                        />
                    </label>
                    <fieldset
                        aria-label="Avatar styles"
                        className="mx-0 grid min-w-0 grid-cols-3 gap-2 border-0 p-0 sm:grid-cols-4"
                    >
                        {styles
                            .filter((value) =>
                                styleName(value).toLowerCase().includes(query.toLowerCase())
                            )
                            .map((value) => (
                                <button
                                    aria-pressed={value === style}
                                    className={`rounded-2xl border p-2 text-center transition-colors ${value === style ? "border-primary bg-primary/10" : "border-default hover:bg-surface-hover"}`}
                                    key={value}
                                    onClick={() => {
                                        setStyle(value);
                                        setPage(0);
                                        setChoosingStyle(false);
                                    }}
                                    type="button"
                                >
                                    <img
                                        alt=""
                                        className="mx-auto h-14 w-14 rounded-xl bg-surface-hover"
                                        decoding="async"
                                        height={56}
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                        src={diceBearUrl(value, "style-preview")}
                                        width={56}
                                    />
                                    <span className="mt-2 block font-medium text-default text-xs leading-snug">
                                        {styleName(value)}
                                    </span>
                                </button>
                            ))}
                    </fieldset>
                    {!styles.some((value) =>
                        styleName(value).toLowerCase().includes(query.toLowerCase())
                    ) && (
                        <p className="py-4 text-center text-muted text-sm" role="status">
                            No styles match your search.
                        </p>
                    )}
                </>
            ) : (
                <>
                    <div className="flex items-center justify-between gap-2">
                        <Button
                            leftIcon={<ArrowLeftIcon className="h-4 w-4" />}
                            onClick={() => setChoosingStyle(true)}
                            size="sm"
                            variant="ghost"
                        >
                            Styles
                        </Button>
                        <h3 className="font-semibold text-base text-default">{styleName(style)}</h3>
                        <Button
                            leftIcon={<ArrowPathIcon className="h-4 w-4" />}
                            onClick={() => {
                                setAnchorSeed(seed);
                                setPage((value) => value + 1);
                            }}
                            size="sm"
                            variant="ghost"
                        >
                            More
                        </Button>
                    </div>
                    <motion.div
                        animate={{ opacity: 1 }}
                        aria-label="Avatar characters"
                        className="grid grid-cols-4 gap-2"
                        initial={reduceMotion ? false : { opacity: 0 }}
                        key={`${style}:${page}`}
                        role="group"
                        transition={{ duration: 0.15 }}
                    >
                        {[anchorSeed, ...variants.filter((value) => value !== anchorSeed)]
                            .slice(0, 12)
                            .map((value, index) => (
                                <button
                                    aria-label={`Choose avatar ${index + 1}`}
                                    aria-pressed={seed === value}
                                    className={`relative aspect-square rounded-2xl border-2 p-1 transition-colors ${seed === value ? "border-primary bg-primary/10" : "border-transparent hover:bg-surface-hover"}`}
                                    key={value}
                                    onClick={() => setSeed(value)}
                                    type="button"
                                >
                                    <img
                                        alt=""
                                        className="h-full w-full rounded-xl"
                                        height={128}
                                        loading="lazy"
                                        referrerPolicy="no-referrer"
                                        src={diceBearUrl(style, value)}
                                        style={
                                            background && background !== "ffffff00"
                                                ? { backgroundColor: `#${background}` }
                                                : checker
                                        }
                                        width={128}
                                    />
                                    {seed === value && (
                                        <span className="absolute right-0 bottom-0 rounded-full bg-primary p-0.5 text-on-primary">
                                            <CheckIcon className="h-3.5 w-3.5" />
                                        </span>
                                    )}
                                </button>
                            ))}
                    </motion.div>
                    {supportsBackground && (
                        <fieldset className="space-y-3">
                            <legend className="font-semibold text-default text-sm">
                                Background
                            </legend>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    aria-pressed={background === ""}
                                    onClick={() => setBackground("")}
                                    size="sm"
                                    variant={background === "" ? "primary" : "secondary"}
                                >
                                    Original
                                </Button>
                                <Button
                                    aria-pressed={background === "ffffff00"}
                                    onClick={() => setBackground("ffffff00")}
                                    size="sm"
                                    variant={background === "ffffff00" ? "primary" : "secondary"}
                                >
                                    Clear
                                </Button>
                                {COLORS.map((color) => (
                                    <button
                                        aria-label={`Background #${color}`}
                                        aria-pressed={background === color}
                                        className={`h-9 w-9 rounded-full border-2 ${background === color ? "border-primary ring-2 ring-primary/30" : "border-default"}`}
                                        key={color}
                                        onClick={() => setBackground(color)}
                                        style={{ backgroundColor: `#${color}` }}
                                        type="button"
                                    />
                                ))}
                                <label
                                    className="relative h-9 w-9 cursor-pointer overflow-hidden rounded-full border border-default"
                                    title="Custom background colour"
                                >
                                    <span className="absolute inset-0 flex items-center justify-center bg-surface-hover text-default text-lg">
                                        +
                                    </span>
                                    <input
                                        aria-label="Custom background colour"
                                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                        onChange={(event) =>
                                            setBackground(event.target.value.slice(1))
                                        }
                                        type="color"
                                        value={`#${background.length === 6 ? background : "e8ecff"}`}
                                    />
                                </label>
                            </div>
                            <p className="text-muted text-xs">
                                Clear removes the outer background. Some styles include colour
                                inside the artwork.
                            </p>
                        </fieldset>
                    )}
                    <a
                        className="inline-block text-muted text-xs underline underline-offset-4"
                        href={`https://www.dicebear.com/styles/${style}/`}
                        rel="noreferrer"
                        target="_blank"
                    >
                        About this style and its artist
                    </a>
                </>
            )}
        </div>
    );
}
