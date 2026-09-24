// AXERLY modified 2026-09-24.
import React, { useState } from "react";
import { useAuth } from "./useAuth";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { WordAddinLogo } from "../components/shell/WordAddinLogo";
import { PillButtonUI as PillButton } from "@mike/pill-button-ui";
import {
  authGlassCardUIClassName,
  authInputUIClassName,
} from "@mike/auth-styles-ui";

export function LoginPage(): React.ReactElement {
  const { login, loading, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    await login(email.trim(), password);
  };

  return (
    <div className="h-full overflow-y-auto bg-gray-50/80">
      <main className="relative flex min-h-full items-center justify-center px-6 py-10">
        <div className="absolute top-5 left-1/2 -translate-x-1/2 @sm:top-6">
          <WordAddinLogo size="lg" />
        </div>

        <div data-testid="login-panel" className="w-full max-w-md">
          <div
            data-testid="login-card"
            className={`${authGlassCardUIClassName} mb-4`}
          >
            <h1 className="mb-6 text-left font-serif text-2xl font-medium text-gray-950">
              Log In
            </h1>

            <form
              data-testid="login-form"
              onSubmit={handleSubmit}
              className="space-y-4"
            >
              <div>
                <Label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className={`w-full ${authInputUIClassName}`}
                />
              </div>

              <div>
                <Label htmlFor="password" className="mb-2 block text-sm font-medium text-gray-700">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className={`w-full ${authInputUIClassName}`}
                />
              </div>

              {error && (
                <div
                  className="rounded bg-red-50 p-3 text-sm text-red-600"
                  role="alert"
                >
                  {error}
                </div>
              )}

              <div className="pt-2">
                <PillButton
                  type="submit"
                  tone="black"
                  size="normal"
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? "Logging in..." : "Log in"}
                </PillButton>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
