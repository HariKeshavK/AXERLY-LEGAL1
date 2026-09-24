// AXERLY modified 2026-09-24.
import { describeNetworkFailure } from "../lib/networkError";

const API_BASE = (process.env.REACT_APP_API_BASE_URL || "/api").replace(/\/+$/, "");
export interface AddinAuthUser { id: string; email: string; role: "admin" | "member"; status: "active" | "disabled"; }
interface SessionState { user: AddinAuthUser | null; loading: boolean; error: string | null; }

let _user: AddinAuthUser | null = null;
let _loading = true;
let _error: string | null = null;
let _initialized = false;
let _sessionGeneration = 0;
let _sessionPromise: Promise<AddinAuthUser | null> | null = null;
const _subscribers = new Set<() => void>();
const broadcast = () => _subscribers.forEach((subscriber) => subscriber());
export function subscribe(fn: () => void): () => void { _subscribers.add(fn); return () => _subscribers.delete(fn); }
export function getSessionState(): SessionState { return { user: _user, loading: _loading, error: _error }; }

function csrfToken(): string | undefined {
  const value = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("__Host-axerly-csrf="));
  return value ? decodeURIComponent(value.slice(value.indexOf("=") + 1)) : undefined;
}
async function parseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { detail?: unknown };
  return typeof body.detail === "string" && body.detail ? `${body.detail} (HTTP ${response.status}).` : `Authentication failed (HTTP ${response.status}).`;
}
async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${API_BASE}${path}`;
  const csrf = csrfToken();
  try {
    return await fetch(url, { ...init, credentials: "include", headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...(init?.headers as Record<string, string> | undefined) } });
  } catch (error) { throw new Error(describeNetworkFailure(error, { method: init?.method ?? "GET", url }), { cause: error }); }
}
async function requestSession(): Promise<AddinAuthUser | null> {
  const response = await authFetch("/auth/me", { cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(await parseError(response));
  return ((await response.json()) as { user: AddinAuthUser }).user;
}
export function refreshSession(): Promise<AddinAuthUser | null> {
  _sessionPromise ??= requestSession().finally(() => { _sessionPromise = null; });
  return _sessionPromise.then((user) => { _user = user; _error = null; broadcast(); return user; });
}
export function initialize(): void {
  if (_initialized) return;
  _initialized = true;
  void refreshSession().catch((error: unknown) => { _user = null; _error = error instanceof Error ? error.message : "Login failed"; }).finally(() => { _loading = false; broadcast(); });
}
export async function signIn(email: string, password: string): Promise<void> {
  const generation = ++_sessionGeneration;
  _loading = true; _error = null; broadcast();
  try {
    const response = await authFetch("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    if (!response.ok) throw new Error(await parseError(response));
    if (generation === _sessionGeneration) _user = ((await response.json()) as { user: AddinAuthUser }).user;
  } catch (error) {
    if (generation === _sessionGeneration) { _user = null; _error = error instanceof Error ? error.message : "Login failed"; }
  } finally { if (generation === _sessionGeneration) { _loading = false; broadcast(); } }
}
export async function signOut(): Promise<void> {
  _sessionGeneration += 1; _error = null;
  try {
    const response = await authFetch("/auth/logout", { method: "POST", body: JSON.stringify({ scope: "local" }) });
    if (!response.ok) throw new Error(await parseError(response));
    _user = null;
  } catch (error) { _error = error instanceof Error ? error.message : "Unable to sign out. Please try again."; }
  broadcast();
}
