// AXERLY modified 2026-09-24.
export const AUTH_SESSION_INVALIDATED_EVENT = "mike:auth-session-invalidated";

function csrfToken(): string | undefined {
    if (typeof document === "undefined") return undefined;
    const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("__Host-axerly-csrf="));
    return entry ? decodeURIComponent(entry.slice(entry.indexOf("=") + 1)) : undefined;
}

/**
 * Fetch an authenticated application resource and immediately invalidate the
 * browser's in-memory auth state when the backend rejects the session.
 */
export async function authenticatedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<Response> {
    const method = (init?.method ?? "GET").toUpperCase();
    const csrf = !["GET", "HEAD", "OPTIONS"].includes(method) ? csrfToken() : undefined;
    const response = await globalThis.fetch(input, {
        ...init,
        credentials: "include",
        headers: { ...(init?.headers as Record<string, string> | undefined), ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
    });

    if (response.status === 401 && typeof window !== "undefined") {
        window.dispatchEvent(new Event(AUTH_SESSION_INVALIDATED_EVENT));
    }

    return response;
}
