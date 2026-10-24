import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./interface.css";
import { MotionProvider } from "@/components/providers/MotionProvider";
import { UserCacheProvider } from "@/components/providers/UserCacheProvider";
import { BuildWatcher } from "@/components/pwa/BuildWatcher";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { ToastProvider } from "@/components/ui/Toast";
import { LayoutModeProvider } from "@/lib/layout-mode";
import { ThemeProvider } from "@/lib/theme";

export const metadata: Metadata = {
    // iOS only exposes the Push API to web apps launched in STANDALONE mode from
    // the Home Screen (iOS 16.4+). `apple-mobile-web-app-capable: yes` is what
    // makes iOS open the Home Screen icon as a standalone app rather than a
    // Safari-chrome tab — without it, `PushManager` never appears and the toggle
    // reports "not supported" no matter how many times it's re-added.
    appleWebApp: {
        capable: true,
        statusBarStyle: "black-translucent",
        title: "SlickSync",
    },
    applicationName: "SlickSync",
    description: "SlickSync - Nuvio & Stremio Addon and User Management System",
    icons: {
        // iOS reads exactly one apple-touch-icon and ignores media queries on
        // it, so this is the purpose-made 180px icon rather than the wordmark.
        apple: [{ sizes: "180x180", url: "/apple-touch-icon.png" }],
        icon: [
            { media: "(prefers-color-scheme: light)", url: "/logo-black.png" },
            { media: "(prefers-color-scheme: dark)", url: "/logo-white.png" },
        ],
    },
    manifest: "/site.webmanifest",
    title: "SlickSync - Users, Groups & Addons",
};

// viewport-fit=cover is what lets the page extend under the notch and the
// home indicator on an iPhone; the safe-area padding in globals.css is what
// keeps the actual UI out from under them. Without the first, a Home Screen
// install with a translucent status bar drew the top bar behind the clock.
export const viewport: Viewport = {
    initialScale: 1,
    themeColor: "#050308",
    viewportFit: "cover",
    width: "device-width",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    // data-scroll-behavior lets Next.js turn the smooth scrolling in
    // globals.css off while it changes page; without it the jump to the top of
    // a new page was animated and cut short, landing partway down.
    return (
        <html className="dark" data-scroll-behavior="smooth" lang="en" suppressHydrationWarning>
            <head>
                <link href="https://fonts.googleapis.com" rel="preconnect" />
                <link crossOrigin="anonymous" href="https://fonts.gstatic.com" rel="preconnect" />
                {/* Default typography uses the platform font. Optional theme fonts
            remain available through the theme picker below. */}
                {/* The other 10 families are Build-your-own-theme choices (Settings
            -> Themes) - deliberately picked to span very different
            aesthetics (classic serif, elegant serif, monospace, poster
            display, comic display, retro pixel, marker handwritten,
            graffiti, sci-fi geometric) so no two options feel the same, but
            the overwhelming majority of page loads never touch them (still
            on the default theme). Bundling all 12 families into one
            render-blocking stylesheet meant every single page load paid the
            fetch+parse cost of 10 fonts almost nobody was using that visit -
            confirmed real, measurable slowness on a real device, both on
            initial page load and (via the same general JS/render-thread
            pressure) noticeably during modal open/close. The media="print"
            trick loads this in the background without blocking first paint,
            then the onLoad flips it to apply once it's actually ready -
            standard deferred-CSS pattern, not custom/fragile. Not lazy-
            loaded on-demand from the theme picker itself (the more
            "correct" fix) because that needs the theme picker's own load
            path threaded through - this is the safe, low-risk half of the
            fix; picking a non-default theme still briefly shows fallback
            type until this finishes loading in the background, same as any
            deferred web font. A plain inline script flips media back to
            "all" once loaded (not a React onLoad handler - this file stays
            a Server Component for the `metadata` export, which can't ship
            client-side event-handler functions to a plain DOM element). */}
                <link
                    href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Merriweather:wght@300;400;700;900&family=Playfair+Display:wght@400;500;600;700;800;900&family=Bungee&family=Bangers&family=Press+Start+2P&family=Permanent+Marker&family=Luckiest+Guy&family=Orbitron:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
                    id="optional-theme-fonts"
                    media="print"
                    rel="stylesheet"
                    suppressHydrationWarning
                />
                <script>{`try{var l=document.getElementById('optional-theme-fonts');l.onload=function(){this.media='all'};if(l.sheet)l.media='all'}catch(e){}`}</script>
                <noscript>
                    <link
                        href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Merriweather:wght@300;400;700;900&family=Playfair+Display:wght@400;500;600;700;800;900&family=Bungee&family=Bangers&family=Press+Start+2P&family=Permanent+Marker&family=Luckiest+Guy&family=Orbitron:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
                        rel="stylesheet"
                    />
                </noscript>
                {/* The media detail modal's poster/background/cast images all come
            from these two CDNs - preconnecting warms up DNS/TLS ahead of the
            actual <img> requests instead of paying that setup cost right as
            the modal opens, which matters most on higher-latency mobile
            connections. */}
                <link href="https://images.metahub.space" rel="preconnect" />
                <link href="https://image.tmdb.org" rel="preconnect" />
                {/* iOS runs a Home Screen-launched web app (standalone display mode -
            see appleWebApp.capable above) in a separate WKWebView process
            with markedly worse backdrop-filter/blur compositing than the
            exact same page in a normal Safari tab - a known WebKit
            regression, not anything specific to this app's CSS. This app
            leans on blur heavily (nav bar, modals, dropdowns, cards), so
            that shows up as real jank opening/closing modals specifically
            when launched from the Home Screen icon, confirmed by direct
            user report (fast in Safari, slow from the Home Screen bookmark
            for the identical page). Sets data-standalone on <html> before
            first paint (blocking inline script, not a useEffect, so there's
            no flash of blurred-then-unblurred UI) - see globals.css for the
            actual blur kill-switch this attribute gates. navigator.standalone
            is iOS Safari's own flag; matchMedia covers Android/desktop PWA
            installs the same way. */}
                <script>{`try{if(window.navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches){document.documentElement.setAttribute('data-standalone','true')}}catch(e){}`}</script>
                {/* The saved theme, before first paint - the same blocking-script
            pattern as above. Without it every page opened in the default
            colours and switched once the app started (a light theme flashed
            dark first). A built-in theme is its class; a custom one starts
            from its base theme here, and its own colours follow at start-up
            (lib/theme.tsx). The id list mirrors themeIds there. */}
                <script>{`try{var t=localStorage.getItem('slicksync-theme'),b=['nebula','slick','velvet','midnight','ember','nord','verdant','slate','rose','daylight'];if(t&&b.indexOf(t)<0){var c=JSON.parse(localStorage.getItem('slicksync-custom-themes')||'[]').filter(function(x){return x&&x.id===t})[0];t=c&&c.base}if(t&&b.indexOf(t)>=0)document.documentElement.className=t}catch(e){}`}</script>
            </head>
            <body
                className="aurora-scrollbar overflow-x-hidden bg-page antialiased"
                style={{
                    color: "var(--color-text)",
                }}
            >
                <div className="relative z-10">
                    <MotionProvider>
                        <ThemeProvider>
                            <LayoutModeProvider>
                                <UserCacheProvider>
                                    <ToastProvider>
                                        <ServiceWorkerRegistrar />
                                        <BuildWatcher />
                                        {children}
                                    </ToastProvider>
                                </UserCacheProvider>
                            </LayoutModeProvider>
                        </ThemeProvider>
                    </MotionProvider>
                </div>
            </body>
        </html>
    );
}
