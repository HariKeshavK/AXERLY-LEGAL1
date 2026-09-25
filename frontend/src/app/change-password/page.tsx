"use client";
// AXERLY modified 2026-09-25.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/contexts/AuthContext";

export default function ChangePasswordPage() {
    const { setPassword } = useAuth();
    const router = useRouter();
    const [password, setValue] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    return <main className="min-h-dvh bg-gray-950 p-8 text-gray-100"><form className="mx-auto max-w-md space-y-4 pt-16" onSubmit={event => {
        event.preventDefault(); setBusy(true); setError("");
        void setPassword(password).then(() => router.replace("/login")).catch(() => setError("Could not change your password. Please try again.")).finally(() => setBusy(false));
    }}><h1 className="text-2xl">Change your temporary password</h1>
        <p>Your administrator reset your password. Choose a new one before accessing the firm.</p>
        <label className="block">New password (at least 12 characters)<input type="password" minLength={12} required value={password} onChange={event => setValue(event.target.value)} className="mt-1 w-full rounded p-2 text-gray-950" /></label>
        {error && <p role="alert" className="text-red-300">{error}</p>}
        <button disabled={busy} className="rounded bg-white px-4 py-2 text-gray-950 disabled:opacity-50">Save password</button></form></main>;
}
