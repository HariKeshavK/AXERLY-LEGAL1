"use client";
// AXERLY modified 2026-09-25.
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/app/contexts/AuthContext";
import { onboardingRequest, OnboardingApiError } from "@/app/lib/onboardingApi";

type User = { id: string; email: string; role: "admin" | "member"; status: string; teams: string[]; must_change_password: boolean };
type Team = { id: string; name: string };
type TeamMember = { user_id: string; email: string };
type Firm = { name: string; org_code: string };
type Audit = { id: string; created_at: string; user_email: string | null; action: string; status: string; surface: string; target_id: string | null };
type License = { state: "active" | "read_only" | "unactivated"; plan?: string; max_users?: number; expires_at?: string; code?: string };

export default function AdminPage() {
    const { user } = useAuth();
    const [tab, setTab] = useState<"users" | "teams" | "firm" | "audit">("users");
    const [users, setUsers] = useState<User[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
    const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
    const [firm, setFirm] = useState<Firm | null>(null);
    const [audit, setAudit] = useState<Audit[]>([]);
    const [license, setLicense] = useState<License | null>(null);
    const [secret, setSecret] = useState("");
    const [error, setError] = useState("");
    const refresh = useCallback(async () => {
        try {
            const [nextUsers, nextTeams, nextFirm, nextAudit, nextLicense] = await Promise.all([
                onboardingRequest<User[]>("/admin/users"), onboardingRequest<Team[]>("/teams"),
                onboardingRequest<Firm>("/admin/firm"), onboardingRequest<Audit[]>("/admin/audit"),
                onboardingRequest<License>("/licensing/status"),
            ]);
            setUsers(nextUsers); setTeams(nextTeams); setFirm(nextFirm); setAudit(nextAudit); setLicense(nextLicense);
        } catch { setError("Could not load administration data."); }
    }, []);
    useEffect(() => {
        if (user?.role !== "admin") return;
        const timer = window.setTimeout(() => { void refresh(); }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh, user?.role]);
    async function act(task: () => Promise<unknown>, reveal?: (value: never) => string) {
        setError(""); setSecret("");
        try { const result = await task(); if (reveal) setSecret(reveal(result as never)); await refresh(); }
        catch (cause) { setError(cause instanceof OnboardingApiError && cause.code === "last_admin"
            ? "The firm must keep at least one active administrator." : "That action could not be completed."); }
    }
    async function openTeam(team: Team) {
        setSelectedTeam(team);
        try { setTeamMembers(await onboardingRequest<TeamMember[]>(`/teams/${team.id}/members`)); }
        catch { setError("Could not load team members."); }
    }
    if (user?.role !== "admin") return <main className="p-8">Not found.</main>;
    return <main className="space-y-6 overflow-y-auto p-8 text-gray-100">
        <h1 className="text-3xl">Firm administration</h1>
        <nav className="flex gap-5">{(["users", "teams", "firm", "audit"] as const).map(item =>
            <button key={item} aria-current={tab === item ? "page" : undefined} className="capitalize underline" onClick={() => setTab(item)}>{item}</button>)}</nav>
        {error && <p role="alert" className="text-red-300">{error}</p>}
        {secret && <div className="rounded border p-4"><p>Shown once. Save and share privately:</p><code className="break-all">{secret}</code>
            <button className="ml-4 underline" onClick={() => void navigator.clipboard.writeText(secret)}>Copy</button>
            <button className="ml-4 underline" onClick={() => setSecret("")}>Done</button></div>}
        {tab === "users" && <div className="space-y-3">{users.map(entry => <div key={entry.id} className="rounded border p-4">
            <p>{entry.email} — {entry.role}, {entry.status}{entry.must_change_password ? " · password change required" : ""}</p>
            <p className="text-sm">Teams: {entry.teams.length ? entry.teams.join(", ") : "None"}</p>
            <div className="mt-2 flex flex-wrap gap-4 text-sm underline">
                {entry.status === "active" && <><button onClick={() => void act(() => onboardingRequest(`/admin/users/${entry.id}/role`, "PATCH", { role: entry.role === "admin" ? "member" : "admin" }))}>{entry.role === "admin" ? "Demote" : "Promote"}</button>
                    <button onClick={() => void act(() => onboardingRequest<{ temporary_password: string }>(`/admin/users/${entry.id}/reset-password`, "POST"), value => (value as { temporary_password: string }).temporary_password)}>Reset password</button>
                    <button onClick={() => { if (window.confirm(`Remove ${entry.email} and revoke their sessions?`)) void act(() => onboardingRequest(`/admin/users/${entry.id}`, "DELETE")); }}>Remove</button></>}
            </div>
            {entry.status !== "active" && <form className="mt-3 flex flex-wrap gap-2 text-sm" onSubmit={event => {
                event.preventDefault(); const fields = new FormData(event.currentTarget);
                if (!window.confirm("Transfer this personal resource to the selected user? This action is audited.")) return;
                void act(() => onboardingRequest(`/admin/users/${entry.id}/transfer-ownership`, "POST", {
                    to_user_id: fields.get("to_user_id"), kind: fields.get("kind"), resource_id: fields.get("resource_id"),
                }));
            }}><select name="to_user_id" required className="rounded p-2 text-gray-950"><option value="">New owner</option>
                {users.filter(candidate => candidate.status === "active").map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.email}</option>)}</select>
                <select name="kind" className="rounded p-2 text-gray-950"><option value="project">Project</option><option value="workflow">Workflow</option><option value="document">Standalone document</option><option value="chat">Standalone chat</option></select>
                <input name="resource_id" type="text" required placeholder="Resource UUID" aria-label="Resource UUID" className="rounded p-2 text-gray-950" />
                <button className="underline">Transfer personal resource</button></form>}
        </div>)}</div>}
        {tab === "teams" && <div className="space-y-3"><p>Teams control sharing and model permissions; they do not create separate firms.</p>
            {teams.map(team => <button key={team.id} className="block underline" onClick={() => void openTeam(team)}>{team.name}</button>)}
            {selectedTeam && <div className="space-y-3 rounded border p-4"><h2>{selectedTeam.name}</h2>
                <form onSubmit={event => { event.preventDefault(); const field = event.currentTarget.elements.namedItem("name") as HTMLInputElement;
                    void act(() => onboardingRequest(`/teams/${selectedTeam.id}`, "PATCH", { name: field.value })).then(() => setSelectedTeam({ ...selectedTeam, name: field.value })); }} className="flex gap-2">
                    <input name="name" required defaultValue={selectedTeam.name} maxLength={120} aria-label="Rename team" className="rounded p-2 text-gray-950" /><button className="underline">Rename</button></form>
                <button className="text-red-300 underline" onClick={() => { if (window.confirm(`Delete team ${selectedTeam.name}?`)) void act(() => onboardingRequest(`/teams/${selectedTeam.id}`, "DELETE")).then(() => setSelectedTeam(null)); }}>Delete team</button>
                <h3>Members</h3>{teamMembers.map(member => <p key={member.user_id}>{member.email} <button className="underline" onClick={() => void act(() => onboardingRequest(`/teams/${selectedTeam.id}/members/${member.user_id}`, "DELETE")).then(() => void openTeam(selectedTeam))}>Remove</button></p>)}
                <form onSubmit={event => { event.preventDefault(); const field = event.currentTarget.elements.namedItem("user_id") as HTMLSelectElement;
                    void act(() => onboardingRequest(`/teams/${selectedTeam.id}/members`, "POST", { user_id: field.value })).then(() => void openTeam(selectedTeam)); }} className="flex gap-2">
                    <select name="user_id" required className="rounded p-2 text-gray-950"><option value="">Add member</option>{users.filter(candidate => candidate.status === "active" && !teamMembers.some(member => member.user_id === candidate.id)).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.email}</option>)}</select>
                    <button className="underline">Add</button></form></div>}
            <form onSubmit={event => { event.preventDefault(); const field = event.currentTarget.elements.namedItem("name") as HTMLInputElement;
                void act(() => onboardingRequest("/teams", "POST", { name: field.value })); field.value = ""; }} className="flex gap-2">
                <input name="name" required maxLength={120} aria-label="Team name" className="rounded p-2 text-gray-950" /><button className="underline">Create team</button></form></div>}
        {tab === "firm" && <div className="space-y-4"><p>Firm: {firm?.name}</p><p>Organization code: {firm?.org_code}</p>
            <p>License: {license?.state ?? "unknown"}{license?.plan ? ` · ${license.plan}` : ""}{license?.max_users ? ` · ${license.max_users} seats` : ""}</p>
            {license?.expires_at && <p>Expires: {new Date(license.expires_at).toLocaleDateString()}</p>}
            <button className="underline" onClick={() => void act(() => onboardingRequest("/licensing/refresh", "POST"))}>Refresh license</button>
            <button className="underline" onClick={() => { if (window.confirm("Rotate joining details? Existing unused invitations will stop working."))
                void act(() => onboardingRequest<{ code: string; password: string }>("/admin/firm/rotate-join", "POST"), value => {
                    const credentials = value as { code: string; password: string }; return `Code: ${credentials.code}\nPassword: ${credentials.password}`;
                }); }}>Rotate joining details</button></div>}
        {tab === "audit" && <div className="space-y-2">{audit.map(item => <p key={item.id}>{new Date(item.created_at).toLocaleString()} · {item.user_email ?? "Anonymous/System"} · {item.action}{item.target_id ? ` · ${item.target_id}` : ""} · {item.status} ({item.surface})</p>)}</div>}
    </main>;
}
