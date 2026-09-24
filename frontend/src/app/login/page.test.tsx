// AXERLY modified 2026-09-24.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

const { login, pendingStorageRecoveryKey, acknowledgeStorageRecoveryKey, refreshSession, replace, push } = vi.hoisted(
    () => ({
        login: vi.fn(),
        pendingStorageRecoveryKey: vi.fn(),
        acknowledgeStorageRecoveryKey: vi.fn(),
        refreshSession: vi.fn(),
        replace: vi.fn(),
        push: vi.fn(),
    }),
);

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace, push }),
}));

vi.mock("@/app/lib/authApi", () => ({
    login,
    pendingStorageRecoveryKey,
    acknowledgeStorageRecoveryKey,
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({
        isAuthenticated: false,
        authLoading: false,
        refreshSession,
    }),
}));

vi.mock("@/app/components/site-logo", () => ({
    SiteLogo: () => <div>Mike</div>,
}));

describe("LoginPage", () => {
    beforeEach(() => {
        login.mockReset();
        pendingStorageRecoveryKey.mockReset();
        pendingStorageRecoveryKey.mockResolvedValue(null);
        acknowledgeStorageRecoveryKey.mockReset();
        acknowledgeStorageRecoveryKey.mockResolvedValue(undefined);
        refreshSession.mockReset();
        refreshSession.mockResolvedValue(null);
        replace.mockReset();
        push.mockReset();
    });

    it("shows the first admin the recovery key before continuing", async () => {
        login.mockResolvedValue({ user: { id: "admin-1" } });
        pendingStorageRecoveryKey.mockResolvedValue("AXERLY-TEST-KEY");
        const user = userEvent.setup();
        render(<LoginPage />);
        await user.type(screen.getByRole("textbox", { name: "Email" }), "admin@example.com");
        await user.type(screen.getByLabelText("Password"), "a-long-password");
        await user.click(screen.getByRole("button", { name: "Log in" }));
        expect(await screen.findByTestId("storage-recovery-key")).toHaveTextContent("AXERLY-TEST-KEY");
        expect(push).not.toHaveBeenCalled();
        await user.click(screen.getByRole("checkbox", { name: /saved this recovery key/i }));
        await user.click(screen.getByRole("button", { name: "Continue" }));
        expect(acknowledgeStorageRecoveryKey).toHaveBeenCalled();
        expect(push).toHaveBeenCalledWith("/onboarding/profile");
    });

    it("allows an existing account to submit a password shorter than the new minimum", async () => {
        login.mockResolvedValue({ user: { id: "user-1" } });
        const user = userEvent.setup();
        render(<LoginPage />);

        expect(screen.getByLabelText("Password")).not.toHaveAttribute(
            "placeholder",
        );

        await user.type(
            screen.getByRole("textbox", { name: "Email" }),
            "existing@example.com",
        );
        await user.type(screen.getByLabelText("Password"), "oldpass");
        await user.click(screen.getByRole("button", { name: "Log in" }));

        expect(login).toHaveBeenCalledWith("existing@example.com", "oldpass");
        expect(push).toHaveBeenCalledWith("/onboarding/profile");
    });

});
