/** Read display text without assuming that a rejected value is an Error. */
export function readErrorMessage(
    value: unknown,
    fallback = "An unexpected error occurred."
): string {
    if (typeof value === "string") {
        return value || fallback;
    }
    if (typeof value === "object" && value !== null && "message" in value) {
        const message = value.message;
        if (typeof message === "string" && message) {
            return message;
        }
    }
    return fallback;
}

export function readErrorName(value: unknown): string {
    if (
        typeof value === "object" &&
        value !== null &&
        "name" in value &&
        typeof value.name === "string"
    ) {
        return value.name;
    }
    return "Error";
}

export interface ErrorPayload {
    code?: string;
    details?: { availableAddonIds?: string[] };
    error?: string;
    message?: string;
    [key: string]: unknown;
}
