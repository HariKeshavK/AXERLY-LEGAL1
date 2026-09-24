// AXERLY modified 2026-09-24.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MikeApiError } from "@/app/lib/mikeApi";
import { OrganizationsOverview } from "./OrganizationsOverview";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  listOrgs: vi.fn(),
  listMyOrgInvitations: vi.fn(),
  acceptOrgInvitation: vi.fn(),
  declineOrgInvitation: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
// Spread the real module: userFacingApiError resolves MikeApiError from this
// same module, so a bare object mock leaves its `instanceof` check with an
// undefined right-hand side.
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  listOrgs: mocks.listOrgs,
  listMyOrgInvitations: mocks.listMyOrgInvitations,
  acceptOrgInvitation: mocks.acceptOrgInvitation,
  declineOrgInvitation: mocks.declineOrgInvitation,
}));

const ORG = {
  id: "org-1",
  name: "Elite Law LLP",
  created_by: "me",
  created_at: "2026-09-01T00:00:00.000Z",
  role: "admin" as const,
  member_count: 3,
};

const INVITATION = {
  id: "invite-1",
  org_id: "org-invited",
  org_name: "Inviting Chambers",
  email: "me@example.com",
  role: "member" as const,
  invited_by: "inviter-1",
  status: "pending" as const,
  expires_at: "2026-09-10T00:00:00.000Z",
  created_at: "2026-09-01T00:00:00.000Z",
  accepted_at: null,
  declined_at: null,
  cancelled_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  mocks.listOrgs.mockResolvedValue([ORG]);
  mocks.listMyOrgInvitations.mockResolvedValue([]);
});

describe("OrganizationsOverview", () => {
  it("renders organizations through the shared table columns and opens a row", async () => {
    const user = userEvent.setup();
    render(<OrganizationsOverview />);

    expect(await screen.findByText("Elite Law LLP")).toBeInTheDocument();
    expect(screen.getByText("3 members")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sort by organization name" }),
    ).toBeInTheDocument();

    const organizationRow = screen.getByRole("link", {
      name: "Open Elite Law LLP",
    });

    await user.click(organizationRow);
    expect(mocks.push).toHaveBeenCalledWith("/organizations/org-1");
  });

  it("does not expose a second-firm creation action", async () => {
    render(<OrganizationsOverview />);
    await screen.findByText("Elite Law LLP");
    expect(screen.queryByRole("button", { name: "New organization" })).not.toBeInTheDocument();
  });

  it("directs an unconfigured installation to first-launch setup", async () => {
    mocks.listOrgs.mockResolvedValue([]);
    render(<OrganizationsOverview />);
    expect(await screen.findByText("Firm not configured")).toBeInTheDocument();
    expect(screen.getByText("Firm setup is completed during first launch.")).toBeInTheDocument();
  });

  it("shows the same single firm to a member without a separate Joined tab", async () => {
    mocks.listOrgs.mockResolvedValue([{ ...ORG, role: "member" }]);
    render(<OrganizationsOverview />);
    expect(await screen.findByText("Elite Law LLP")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Joined" })).not.toBeInTheDocument();
  });

  it("shows active invitations and their count under the Invites pill", async () => {
    const user = userEvent.setup();
    mocks.listMyOrgInvitations.mockResolvedValueOnce([INVITATION]);
    render(<OrganizationsOverview />);

    const invites = await screen.findByRole("button", {
      name: "Invites (1)",
    });
    expect(screen.queryByText("Inviting Chambers")).not.toBeInTheDocument();

    await user.click(invites);
    expect(screen.getByText("Inviting Chambers")).toBeInTheDocument();
    expect(screen.getByText(/invited you as Member/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(mocks.acceptOrgInvitation).toHaveBeenCalledWith("invite-1"),
    );
    expect(
      await screen.findByRole("button", { name: "Invites" }),
    ).toBeInTheDocument();
  });

  it("reports a failed invitations fetch instead of claiming there are none", async () => {
    const user = userEvent.setup();
    mocks.listMyOrgInvitations
      .mockRejectedValueOnce(
        new MikeApiError({ status: 503, message: "upstream down" }),
      )
      .mockResolvedValue([INVITATION]);
    render(<OrganizationsOverview />);
    await screen.findByText("Elite Law LLP");

    // The tab itself has to say so: an unopened "Invites" looked identical
    // whether the inbox was empty or the fetch had failed, and only one of
    // those is worth a click.
    await user.click(
      screen.getByRole("button", { name: "Invites (unavailable)" }),
    );
    expect(
      screen.getByText("Could not load your invitations."),
    ).toBeInTheDocument();
    // The old swallowed catch rendered this instead, which reads as "nobody
    // invited you" rather than "we could not check".
    expect(
      screen.queryByText("You have no active organization invitations."),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Inviting Chambers")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Invites (1)" }),
    ).toBeInTheDocument();
  });

  it("shows the server's own wording when the organizations fetch is refused", async () => {
    // The invitations half of the same load already did this; the orgs half
    // threw the server's sentence away for a hardcoded one.
    mocks.listOrgs.mockRejectedValue(
      new MikeApiError({
        status: 403,
        message: "Your account is not permitted to list organizations",
      }),
    );
    render(<OrganizationsOverview />);

    expect(
      await screen.findByText(
        "Your account is not permitted to list organizations",
      ),
    ).toBeInTheDocument();
  });

  it("keeps a failing reload from being reported as a failed answer", async () => {
    // The re-read is bookkeeping that runs after the server has already
    // accepted, so it sits outside the try: a failure there must not become
    // "Could not answer that invitation" about an invitation that was taken.
    const user = userEvent.setup();
    mocks.listMyOrgInvitations.mockResolvedValueOnce([INVITATION]);
    mocks.acceptOrgInvitation.mockResolvedValue(undefined);
    render(<OrganizationsOverview />);

    await user.click(
      await screen.findByRole("button", { name: "Invites (1)" }),
    );
    mocks.listOrgs.mockRejectedValue(new Error("network"));
    mocks.listMyOrgInvitations.mockRejectedValue(new Error("network"));
    await user.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(mocks.acceptOrgInvitation).toHaveBeenCalledWith("invite-1"),
    );
    expect(
      screen.queryByText("Could not answer that invitation."),
    ).not.toBeInTheDocument();
  });

});
