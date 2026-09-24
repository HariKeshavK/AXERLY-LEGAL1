// AXERLY modified 2026-09-24.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordSettingsSection } from "./PasswordSettingsSection";

const state = vi.hoisted(() => ({
    user: {
        id: "user-1",
        email: "alex@example.com",
        role: "member" as const,
        status: "active" as const,
    },
    setPassword: vi.fn(),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: state.user, setPassword: state.setPassword }),
}));

describe("PasswordSettingsSection", () => {
    beforeEach(() => {
        state.setPassword.mockReset();
        state.setPassword.mockResolvedValue(undefined);
    });

    it("changes the password and reports session revocation", async () => {
        const user = userEvent.setup();
        render(<PasswordSettingsSection />);

        expect(screen.getByText("Change password", { selector: "p" })).toBeVisible();
        await user.click(
            screen.getByRole("button", { name: "Change password" }),
        );

        const dialog = screen.getByRole("dialog", { name: "Set password" });
        await waitFor(() =>
            expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus(),
        );
        await user.type(
            within(dialog).getByLabelText("Password"),
            "securepass12",
        );
        await user.type(
            within(dialog).getByLabelText("Confirm password"),
            "securepass12",
        );
        await user.click(
            within(dialog).getByRole("button", { name: "Set password" }),
        );

        await waitFor(() =>
            expect(state.setPassword).toHaveBeenCalledWith("securepass12"),
        );
        expect(screen.getByText("Password changed. Sign in again with the new password.")).toBeVisible();
    });
});
