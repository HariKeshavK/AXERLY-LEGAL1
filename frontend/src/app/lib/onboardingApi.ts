// AXERLY modified 2026-09-25.
export class OnboardingApiError extends Error {
    constructor(readonly status: number, readonly code: string) { super(code); }
}

export async function onboardingRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const csrf = typeof document === "undefined" ? "" : document.cookie.split(";")
        .map((part) => part.trim()).find((part) => part.startsWith("__Host-axerly-csrf="))?.split("=")[1] ?? "";
    const response = await fetch(`/api${path}`, {
        method, credentials: "include", cache: "no-store",
        headers: { ...(body ? { "Content-Type": "application/json" } : {}),
            ...(csrf && !["GET", "HEAD"].includes(method) ? { "X-CSRF-Token": decodeURIComponent(csrf) } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new OnboardingApiError(response.status, typeof result?.code === "string" ? result.code : "request_failed");
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
}
