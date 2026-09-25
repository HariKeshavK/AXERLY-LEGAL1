"use client";
// AXERLY modified 2026-09-25.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onboardingRequest, OnboardingApiError } from "@/app/lib/onboardingApi";
import { useAuth } from "@/app/contexts/AuthContext";

type JoinDetails = { code: string; password: string };
const messages: Record<string, string> = {
    invalid_license: "That license key could not be activated.", license_expired: "This license has expired.",
    license_suspended: "This license is suspended.", activation_limit: "This license has reached its activation limit.",
    rate_limited: "Too many attempts. Please try again later.", license_unreachable: "The license server is unavailable. Please retry.",
    join_failed: "The organization code or password is incorrect.", seat_limit: "This firm's license has no available seats.",
    already_created: "This firm has already been created. Choose Join instead.",
};

export default function SetupPage() {
    const router = useRouter();
    const { refreshSession } = useAuth();
    const [mode, setMode] = useState<"choose" | "create" | "join">("choose");
    const [step, setStep] = useState<"license" | "admin" | "credentials">("license");
    const [name, setName] = useState("");
    const [licenseKey, setLicenseKey] = useState("");
    const [code, setCode] = useState("");
    const [joinPassword, setJoinPassword] = useState("");
    const [joinToken, setJoinToken] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [details, setDetails] = useState<JoinDetails | null>(null);
    const [storageKey, setStorageKey] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => { void onboardingRequest<{ created: boolean }>("/setup/status").then(({ created }) => {
        if (created && mode === "choose") setMode("join");
    }).catch(() => undefined); }, [mode]);
    async function run(action: () => Promise<void>) {
        setBusy(true); setError("");
        try { await action(); }
        catch (cause) { setError(cause instanceof OnboardingApiError ? messages[cause.code] ?? "Unable to complete this step. Please retry." : "Unable to connect. Please retry."); }
        finally { setBusy(false); }
    }
    const field = (label: string, value: string, set: (value: string) => void, type = "text") =>
        <label className="block text-sm">{label}<input className="mt-1 w-full rounded border border-gray-400 p-2 text-gray-950" type={type} value={value} onChange={e => set(e.target.value)} required /></label>;
    const button = (text: string, disabled = false) => <button disabled={busy || disabled} className="rounded bg-gray-950 px-5 py-2 text-white disabled:opacity-50">{busy ? "Please wait…" : text}</button>;
    return <main className="min-h-dvh bg-gray-950 p-6 text-gray-100"><div className="mx-auto max-w-lg space-y-6 pt-12">
        <h1 className="text-3xl font-semibold">AXERLY</h1>
        {mode === "choose" && <section className="space-y-4"><h2 className="text-xl">Welcome</h2>
            <p>One installation serves one firm. Teams are created inside that firm.</p>
            <button className="mr-3 underline" onClick={() => setMode("create")}>Create an organization</button>
            <button className="underline" onClick={() => setMode("join")}>Join an organization</button></section>}
        {mode === "create" && step === "license" && <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(async () => {
            const result = await onboardingRequest<{ practice_name: string }>("/setup/activate", "POST", { license_key: licenseKey });
            setName(result.practice_name); setStep("admin");
        }); }}><h2 className="text-xl">Activate your license</h2>{field("AXERLY license key", licenseKey, setLicenseKey)}{button("Continue")}</form>}
        {mode === "create" && step === "admin" && <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(async () => {
            const result = await onboardingRequest<{ join: JoinDetails }>("/setup/create", "POST", { name, email, password });
            setDetails(result.join); setStep("credentials"); await refreshSession();
            try {
                const recovery = await onboardingRequest<{ recovery_key: string | null }>("/auth/storage-recovery/pending", "POST");
                setStorageKey(recovery.recovery_key);
            } catch { setError("The firm was created, but the storage recovery key could not be loaded. Log in again to save it."); }
        }); }}><h2 className="text-xl">Create your firm and first administrator</h2>{field("Firm name", name, setName)}
            {field("Administrator email", email, setEmail, "email")}{field("Password (at least 12 characters)", password, setPassword, "password")}{button("Create firm")}</form>}
        {mode === "create" && step === "credentials" && details && <section className="space-y-4">
            <h2 className="text-xl">Save your joining details</h2><p>These credentials are shown once. Share them privately with your colleagues. The host address and TLS fingerprint will be available when desktop host mode is configured.</p>
            <p>Organization code: <code>{details.code}</code></p><p>Joining password: <code>{details.password}</code></p>
            {storageKey && <div className="rounded border border-amber-300 p-3"><p>Storage recovery key — save separately from this computer. Losing it can make encrypted files unrecoverable after host failure.</p><code className="break-all">{storageKey}</code></div>}
            <button className="underline" onClick={() => void navigator.clipboard.writeText(`AXERLY firm: ${name}\nOrganization code: ${details.code}\nJoining password: ${details.password}`)}>Copy joining details</button>
            <label className="block"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} /> I have saved these details securely.</label>
            <button className="rounded bg-white px-5 py-2 text-gray-950 disabled:opacity-50" disabled={!saved} onClick={() => void run(async () => {
                if (storageKey) await onboardingRequest("/auth/storage-recovery/acknowledge", "POST");
                router.replace("/onboarding/profile");
            })}>Continue</button></section>}
        {mode === "join" && !joinToken && <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(async () => {
            const result = await onboardingRequest<{ join_token: string }>("/join/verify", "POST", { code, password: joinPassword }); setJoinToken(result.join_token);
        }); }}><h2 className="text-xl">Join your firm</h2>{field("Organization code", code, setCode)}{field("Joining password", joinPassword, setJoinPassword, "password")}{button("Verify details")}</form>}
        {mode === "join" && joinToken && <form className="space-y-4" onSubmit={e => { e.preventDefault(); void run(async () => {
            await onboardingRequest("/register", "POST", { join_token: joinToken, email, password });
            await refreshSession(); router.replace("/onboarding/profile");
        }); }}><h2 className="text-xl">Create your account</h2>{field("Email", email, setEmail, "email")}
            {field("Password (at least 12 characters)", password, setPassword, "password")}{button("Join firm")}</form>}
        {error && <p role="alert" className="text-red-300">{error}</p>}
        {mode !== "choose" && !details && <button className="text-sm underline" onClick={() => { setMode("choose"); setJoinToken(""); setError(""); }}>Back</button>}
    </div></main>;
}
