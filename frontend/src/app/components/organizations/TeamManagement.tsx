"use client";
// AXERLY modified 2026-09-24.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addTeamMember, createTeam, deleteTeam, listTeamMembers, listTeams,
  removeTeamMember, updateTeam, type OrgMember, type Team, type TeamMember,
} from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";

/** Team membership is a share/model-access target, never implicit document access. */
export function TeamManagement({ isAdmin, firmMembers }: {
  isAdmin: boolean; firmMembers: OrgMember[];
}) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roster, setRoster] = useState<TeamMember[]>([]);
  const [name, setName] = useState("");
  const [rename, setRename] = useState("");
  const [addUserId, setAddUserId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await listTeams();
    setTeams(next);
    setSelectedId((current) => current && next.some((item) => item.id === current)
      ? current : next[0]?.id ?? null);
    return next;
  }, []);

  useEffect(() => {
    void refresh().catch((cause) => setError(userFacingApiError(cause, "Could not load teams.")));
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) { setRoster([]); return; }
    let cancelled = false;
    void listTeamMembers(selectedId).then((next) => {
      if (!cancelled) setRoster(next);
    }).catch((cause) => {
      if (!cancelled) setError(userFacingApiError(cause, "Could not load team members."));
    });
    return () => { cancelled = true; };
  }, [selectedId]);

  const selected = teams?.find((team) => team.id === selectedId) ?? null;
  useEffect(() => { setRename(selected?.name ?? ""); }, [selected?.id, selected?.name]);
  const available = useMemo(() => firmMembers.filter(
    (member) => !roster.some((item) => item.user_id === member.user_id),
  ), [firmMembers, roster]);

  async function mutate(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      const next = await refresh();
      if (selectedId && next.some((item) => item.id === selectedId)) {
        setRoster(await listTeamMembers(selectedId));
      }
    } catch (cause) {
      setError(userFacingApiError(cause, "Could not update the team."));
    } finally { setBusy(false); }
  }

  return <div className="mx-4 mb-6 grid gap-6 rounded-2xl border border-gray-200 p-5 md:mx-8 md:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)]">
    <section aria-label="Teams">
      <h2 className="mb-3 font-serif text-xl">Teams</h2>
      <p className="mb-4 text-sm text-gray-600">Team membership alone does not reveal private projects or documents.</p>
      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
      {teams === null ? <p>Loading teams…</p> : teams.length === 0 ? <p className="text-sm text-gray-500">No teams yet.</p> : (
        <ul className="space-y-1">{teams.map((team) => <li key={team.id}>
          <button type="button" className="w-full rounded px-3 py-2 text-left hover:bg-gray-100"
            aria-current={team.id === selectedId ? "true" : undefined}
            onClick={() => { setSelectedId(team.id); setRename(team.name); setConfirmDelete(false); }}>
            {team.name} <span className="text-xs text-gray-500">({team.member_count})</span>
          </button>
        </li>)}</ul>
      )}
      {isAdmin && <form className="mt-5 flex gap-2" onSubmit={(event) => {
        event.preventDefault();
        void mutate(async () => { await createTeam(name); setName(""); });
      }}>
        <input aria-label="New team name" value={name} maxLength={120} required
          onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 rounded border px-2 py-1" />
        <button disabled={busy || !name.trim()} className="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-50">Create</button>
      </form>}
    </section>
    <section aria-label="Team members">
      {selected ? <>
        <h3 className="mb-3 font-serif text-lg">{selected.name}</h3>
        {isAdmin && <form className="mb-4 flex gap-2" onSubmit={(event) => {
          event.preventDefault();
          void mutate(async () => { await updateTeam(selected.id, rename); });
        }}>
          <input aria-label="Rename team" value={rename} maxLength={120}
            onChange={(event) => setRename(event.target.value)} className="min-w-0 flex-1 rounded border px-2 py-1" />
          <button disabled={busy || !rename.trim() || rename.trim() === selected.name} className="rounded border px-3 py-1 disabled:opacity-50">Rename</button>
        </form>}
        <ul className="space-y-2">{roster.map((member) => <li key={member.user_id} className="flex items-center justify-between gap-3 text-sm">
          <span>{member.email}</span>
          {isAdmin && <button type="button" disabled={busy} className="text-red-700 underline"
            onClick={() => void mutate(async () => { await removeTeamMember(selected.id, member.user_id); })}>Remove</button>}
        </li>)}</ul>
        {roster.length === 0 && <p className="text-sm text-gray-500">No members in this team.</p>}
        {isAdmin && <>
          <form className="mt-5 flex gap-2" onSubmit={(event) => {
            event.preventDefault();
            void mutate(async () => { await addTeamMember(selected.id, addUserId); setAddUserId(""); });
          }}>
            <select aria-label="Add firm member" value={addUserId} onChange={(event) => setAddUserId(event.target.value)}
              className="min-w-0 flex-1 rounded border px-2 py-1">
              <option value="">Select firm member</option>
              {available.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || member.email || member.user_id}</option>)}
            </select>
            <button disabled={busy || !addUserId} className="rounded border px-3 py-1 disabled:opacity-50">Add</button>
          </form>
          <div className="mt-6">
            {!confirmDelete ? <button type="button" className="text-sm text-red-700 underline"
              onClick={() => setConfirmDelete(true)}>Delete team</button> : <div className="flex items-center gap-3 text-sm">
              <span>Delete {selected.name}?</span>
              <button type="button" disabled={busy} className="text-red-700 underline"
                onClick={() => void mutate(async () => { await deleteTeam(selected.id); setConfirmDelete(false); })}>Confirm delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>}
          </div>
        </>}
      </> : <p className="text-sm text-gray-500">Select a team to view its members.</p>}
    </section>
  </div>;
}
