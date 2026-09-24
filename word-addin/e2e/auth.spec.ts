// AXERLY modified 2026-09-24.
import { test, expect } from "./support/fixtures";

test.describe("password authentication", () => {
  test("shows only the password login form when signed out", async ({ addin, page }) => {
    await addin.gotoTaskpane();
    await expect(page.getByRole("heading", { name: "Log In" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
    expect(await addin.getToken()).toBeNull();
  });

  test("shows a generic credential failure", async ({ addin, page }) => {
    await addin.mockLogin({ error: "Invalid email or password." });
    await addin.gotoTaskpane();
    await page.getByRole("textbox", { name: "Email" }).fill("wrong@firm.com");
    await page.getByRole("textbox", { name: "Password" }).fill("bad-password-value");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid email or password.");
  });

  test("valid credentials establish a cookie session", async ({ addin, page }) => {
    await addin.mockLogin({ ok: true, accessToken: "cookie-session" });
    await addin.gotoTaskpane();
    await page.getByRole("textbox", { name: "Email" }).fill("lawyer@firm.com");
    await page.getByRole("textbox", { name: "Password" }).fill("correct-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await addin.expectAuthedShell();
    expect(await addin.getToken()).toBeNull();
  });
});
