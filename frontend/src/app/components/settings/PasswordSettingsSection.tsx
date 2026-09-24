"use client";
// AXERLY modified 2026-09-24.

import { useState } from "react";
import { authInputClassName } from "@/app/components/auth/authStyles";
import {
  MIN_PASSWORD_LENGTH,
  minimumPasswordMessage,
} from "@/app/components/auth/passwordPolicy";
import { Modal } from "@/app/components/modals/Modal";
import { Input } from "@/app/components/ui/input";
import { PillButtonUI } from "@/shared/ui/PillButtonUI";
import { useAuth } from "@/app/contexts/AuthContext";
import { SettingsCard } from "./SettingsCard";
import { SettingsHeading } from "./SettingsHeading";
import { SettingsRow } from "./SettingsRow";
import { SettingsDescription, SettingsLabel } from "./SettingsText";
import { FieldLabel } from "@/app/components/ui/form-field";

export function PasswordSettingsSection() {
  const { setPassword } = useAuth();
  const [setPasswordOpen, setSetPasswordOpen] = useState(false);
  const [password, setPasswordValue] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSetError, setPasswordSetError] = useState<string | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);

  async function addPassword() {
    setPasswordSetError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordSetError(`${minimumPasswordMessage}.`);
      return;
    }
    if (password !== confirmPassword) {
      setPasswordSetError("Passwords do not match.");
      return;
    }

    setPasswordSaving(true);
    try {
      await setPassword(password);
      setPasswordValue("");
      setConfirmPassword("");
      setSetPasswordOpen(false);
      setPasswordStatus("Password changed. Sign in again with the new password.");
    } catch (error) {
      setPasswordSetError(
        error instanceof Error ? error.message : "Unable to set your password.",
      );
    } finally {
      setPasswordSaving(false);
    }
  }

  function closeSetPassword() {
    if (passwordSaving) return;
    setSetPasswordOpen(false);
    setPasswordSetError(null);
    setPasswordValue("");
    setConfirmPassword("");
  }

  return (
    <section className="space-y-3">
      <SettingsHeading>Password</SettingsHeading>
      <SettingsCard>
        <SettingsRow>
          <div className="min-w-0 space-y-1">
            <SettingsLabel>
              Change password
            </SettingsLabel>
            <SettingsDescription>
              Set a new password. All existing sessions will be revoked.
            </SettingsDescription>
            {passwordStatus && (
              <p className="text-xs text-gray-500">{passwordStatus}</p>
            )}
          </div>
          <PillButtonUI
            tone="black"
            size="sm"
            onClick={() => setSetPasswordOpen(true)}
            disabled={passwordSaving}
            className="shrink-0"
          >
            Change password
          </PillButtonUI>
        </SettingsRow>
      </SettingsCard>

      <Modal
        open={setPasswordOpen}
        onClose={closeSetPassword}
        breadcrumbs={["Security", "Set password"]}
        size="sm"
        className="h-auto"
        cancelAction={{
          label: "Cancel",
          onClick: closeSetPassword,
          disabled: passwordSaving,
        }}
        primaryAction={{
          label: passwordSaving ? "Setting..." : "Set password",
          onClick: () => void addPassword(),
          disabled: passwordSaving || !password || !confirmPassword,
        }}
      >
        <div className="space-y-4 pb-5">
          <p className="text-sm text-gray-500">
            Use at least {MIN_PASSWORD_LENGTH} characters.
          </p>
          <div>
            <FieldLabel htmlFor="new-account-password">Password</FieldLabel>
            <Input
              id="new-account-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPasswordValue(event.target.value)}
              className={`w-full ${authInputClassName}`}
            />
          </div>
          <div>
            <FieldLabel htmlFor="confirm-account-password">
              Confirm password
            </FieldLabel>
            <Input
              id="confirm-account-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={`w-full ${authInputClassName}`}
            />
          </div>
          {passwordSetError && (
            <p className="text-sm text-red-600" role="alert">
              {passwordSetError}
            </p>
          )}
        </div>
      </Modal>
    </section>
  );
}
