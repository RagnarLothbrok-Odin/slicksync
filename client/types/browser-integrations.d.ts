export {};

declare global {
    interface YouTubePlayer {
        destroy: () => void;
        stopVideo: () => void;
        unMute: () => void;
    }

    interface Window {
        Capacitor?: {
            Plugins?: {
                App?: {
                    addListener: (
                        event: "backButton",
                        listener: (event: { canGoBack: boolean }) => void
                    ) => Promise<{ remove: () => void }>;
                    exitApp: () => Promise<void>;
                };
            };
        };
        onYouTubeIframeAPIReady?: () => void;
        YT?: {
            Player: new (
                element: HTMLIFrameElement,
                options: Record<string, unknown>
            ) => YouTubePlayer;
        };
    }

    interface Navigator {
        userAgentData?: { platform: string };
    }
}
