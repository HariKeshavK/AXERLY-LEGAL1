// AXERLY modified 2026-09-24.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamManagement } from "./TeamManagement";

const mocks = vi.hoisted(() => ({
  listTeams: vi.fn(), listTeamMembers: vi.fn(), createTeam: vi.fn(), updateTeam: vi.fn(),
  deleteTeam: vi.fn(), addTeamMember: vi.fn(), removeTeamMember: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()), ...mocks,
}));

const teams = [
  { id: "team-a", org_id: "firm", name: "Litigation", member_count: 1, is_member: true },
  { id: "team-b", org_id: "firm", name: "Corporate", member_count: 0, is_member: false },
];
const firmMembers = [
  { id: "row-1", user_id: "u1", email: "one@example.test", display_name: "One", role: "member" as const },
  { id: "row-2", user_id: "u2", email: "two@example.test", display_name: "Two", role: "member" as const },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTeams.mockResolvedValue(teams);
  mocks.listTeamMembers.mockResolvedValue([{ user_id: "u1", email: "one@example.test", created_at: "today" }]);
  mocks.createTeam.mockResolvedValue({});
  mocks.updateTeam.mockResolvedValue({});
  mocks.deleteTeam.mockResolvedValue(undefined);
  mocks.addTeamMember.mockResolvedValue(undefined);
  mocks.removeTeamMember.mockResolvedValue(undefined);
});

describe("TeamManagement", () => {
  it("shows a member their teams without management controls or inherited document claims", async () => {
    render(<TeamManagement isAdmin={false} firmMembers={firmMembers} />);
    expect(await screen.findByRole("button", { name: /Litigation/ })).toBeInTheDocument();
    expect(screen.getByText("Corporate")).toBeInTheDocument();
    expect(screen.getByText(/membership alone does not reveal private projects/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("New team name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete team" })).not.toBeInTheDocument();
  });

  it("lets a firm admin create a team and add a current firm member", async () => {
    const user = userEvent.setup();
    render(<TeamManagement isAdmin firmMembers={firmMembers} />);
    await screen.findByText("Corporate");
    await user.type(screen.getByLabelText("New team name"), "Tax");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mocks.createTeam).toHaveBeenCalledWith("Tax"));
    await user.selectOptions(screen.getByLabelText("Add firm member"), "u2");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(mocks.addTeamMember).toHaveBeenCalledWith("team-a", "u2"));
  });
});
