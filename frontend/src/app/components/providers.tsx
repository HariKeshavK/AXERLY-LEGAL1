"use client";
// AXERLY modified 2026-09-24.

import { Suspense } from "react";
import { AuthProvider } from "@/app/contexts/AuthContext";
import { UserProfileProvider } from "@/app/contexts/UserProfileContext";
import { FullScreenLoader } from "@/app/components/shared/FullScreenLoader";
import { OnboardingGate } from "@/app/components/auth/OnboardingGate";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <AuthProvider>
            <UserProfileProvider>
                <Suspense fallback={<FullScreenLoader />}>
                    <OnboardingGate>{children}</OnboardingGate>
                </Suspense>
            </UserProfileProvider>
        </AuthProvider>
    );
}
