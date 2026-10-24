"use client";

// The last resort: an error thrown in the root layout itself, where even
// the app's stylesheet and theme are gone. Deliberately self-contained -
// plain markup and inline colours, no imports beyond React.
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html lang="en">
            <body
                style={{
                    background: "#050308",
                    color: "#e8e6ef",
                    fontFamily: "system-ui, -apple-system, sans-serif",
                    margin: 0,
                }}
            >
                <div
                    style={{
                        alignItems: "center",
                        display: "flex",
                        justifyContent: "center",
                        minHeight: "100vh",
                        padding: 24,
                    }}
                >
                    <div style={{ maxWidth: 420, textAlign: "center" }}>
                        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
                            SlickSync could not start this page
                        </h2>
                        <p style={{ fontSize: 14, marginTop: 8, opacity: 0.7 }}>
                            Trying again usually clears it. If it keeps happening, the server log
                            will say why.
                        </p>
                        {error?.message && (
                            <p
                                style={{
                                    fontSize: 12,
                                    marginTop: 12,
                                    opacity: 0.55,
                                    wordBreak: "break-word",
                                }}
                            >
                                {error.message}
                            </p>
                        )}
                        <button
                            onClick={reset}
                            style={{
                                background: "#7c5cff",
                                border: 0,
                                borderRadius: 8,
                                color: "#fff",
                                cursor: "pointer",
                                fontSize: 14,
                                marginTop: 20,
                                padding: "8px 16px",
                            }}
                        >
                            Try again
                        </button>
                    </div>
                </div>
            </body>
        </html>
    );
}
