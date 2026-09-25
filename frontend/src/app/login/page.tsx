"use client";
// AXERLY modified 2026-09-24; AXERLY modified 2026-09-25.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeStorageRecoveryKey, pendingStorageRecoveryKey, login } from "@/app/lib/authApi";
import { Input } from "@/app/components/ui/input";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { SiteLogo } from "@/app/components/site-logo";
import { useAuth } from "@/app/contexts/AuthContext";
import { cn } from "@/app/lib/utils";
import {
    authGlassCardClassName,
    authInputClassName,
} from "@/app/components/auth/authStyles";
import { FieldLabel } from "@/app/components/ui/form-field";
import { knownErrorCodeMessage } from "@/app/lib/userFacingError";

const LOGIN_ERROR_MESSAGES = {
    invalid_credentials: "The email or password is incorrect.",
} as const;

export default function LoginPage() {
    const router = useRouter();
    const {
        isAuthenticated,
        user,
        authLoading,
        authError,
        refreshSession,
        retrySession,
    } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
    const [savedRecoveryKey, setSavedRecoveryKey] = useState(false);

    useEffect(() => {
        if (authLoading || !isAuthenticated || loading || recoveryKey || user?.must_change_password) return;
        let cancelled = false;
        void pendingStorageRecoveryKey().then((key) => {
            if (cancelled) return;
            if (key) setRecoveryKey(key);
            else router.replace("/onboarding/profile");
        }).catch(() => {
            if (!cancelled) setError("Unable to load the storage recovery key. Please retry.");
        });
        return () => { cancelled = true; };
    }, [authLoading, isAuthenticated, loading, recoveryKey, router, user?.must_change_password]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const result = await login(email, password);
            if (result.user.must_change_password) {
                await refreshSession();
                router.push("/change-password");
                return;
            }
            const key = await pendingStorageRecoveryKey();
            if (key) setRecoveryKey(key);
            await refreshSession();
            if (!key) router.push("/onboarding/profile");
        } catch (error: unknown) {
            setError(
                knownErrorCodeMessage(
                    error,
                    LOGIN_ERROR_MESSAGES,
                    "Unable to log in right now. Please try again.",
                ),
            );
        } finally {
            setLoading(false);
        }
    };

    const continueAfterRecovery = async () => {
        setLoading(true);
        setError(null);
        try {
            await acknowledgeStorageRecoveryKey();
            router.push("/onboarding/profile");
        } catch {
            setError("Could not confirm the recovery key. Please retry.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative flex min-h-dvh items-center justify-center bg-gray-50/80 px-6 py-10">
            <div className="absolute top-4 md:top-8 left-1/2 -translate-x-1/2">
                <SiteLogo size="lg" asLink />
            </div>
            <div className="w-full max-w-md">
                {recoveryKey ? (
                    <div className={cn(authGlassCardClassName, "mb-4 space-y-4")}>
                        <h2 className="text-2xl font-medium font-serif text-gray-950">Save your storage recovery key</h2>
                        <p className="text-sm text-gray-700">This key is shown only once. Store it somewhere safe outside this computer. Without it, encrypted firm files cannot be recovered if the host loses its secrets.</p>
                        <code className="block break-all rounded bg-gray-100 p-3 text-sm text-gray-950" data-testid="storage-recovery-key">{recoveryKey}</code>
                        <label className="flex items-start gap-2 text-sm text-gray-800">
                            <input type="checkbox" checked={savedRecoveryKey} onChange={(event) => setSavedRecoveryKey(event.target.checked)} />
                            I have saved this recovery key in a safe place.
                        </label>
                        {error && <p className="text-sm text-red-600">{error}</p>}
                        <PillButtonUI type="button" tone="black" size="normal" disabled={!savedRecoveryKey || loading}
                            onClick={() => void continueAfterRecovery()} className="w-full">
                            Continue
                        </PillButtonUI>
                    </div>
                ) : (
                <div className={cn(authGlassCardClassName, "mb-4")}>
                    <h2 className="mb-6 text-left text-2xl font-medium font-serif text-gray-950">
                        Log In
                    </h2>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <FieldLabel htmlFor="email">Email</FieldLabel>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className={`w-full ${authInputClassName}`}
                            />
                        </div>

                        <div>
                            <FieldLabel htmlFor="password">Password</FieldLabel>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className={`w-full ${authInputClassName}`}
                            />
                        </div>

                        {(error || authError) && (
                            <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
                                {error ?? authError}
                                {!error && authError && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            void retrySession().catch(() => {})
                                        }
                                        className="ml-2 underline underline-offset-2"
                                    >
                                        Retry
                                    </button>
                                )}
                            </div>
                        )}

                        <div className="pt-2">
                            <PillButtonUI
                                type="submit"
                                tone="black"
                                size="normal"
                                disabled={loading}
                                className="w-full"
                            >
                                {loading ? "Logging in..." : "Log in"}
                            </PillButtonUI>
                        </div>
                    </form>
                    <a className="mt-4 block text-sm underline" href="/setup">Create or join an organization</a>
                </div>
                )}
            </div>
        </div>
    );
}
