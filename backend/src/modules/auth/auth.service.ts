// AXERLY modified 2026-09-24.
import { z } from "zod";
import type { Db } from "../../lib/database";
import { MIN_PASSWORD_LENGTH, type AuthUser } from "../../lib/localAuth";

export const emailSchema = z.string().trim().toLowerCase().email().max(320);
export const credentialsSchema = z.object({ email: emailSchema, password: z.string().min(MIN_PASSWORD_LENGTH).max(4096) });
export const passwordSchema = z.object({ password: z.string().min(MIN_PASSWORD_LENGTH).max(4096), signOut: z.boolean().optional() });
export type Credentials = z.infer<typeof credentialsSchema>;
export const signInWithPassword = (client: Db, input: Credentials) => client.auth.signInWithPassword(input);
export const bootstrapAdmin = (client: Db, input: Credentials) => client.auth.bootstrap(input);
export async function currentUser(client: Db): Promise<{ user: AuthUser | null; error: unknown }> { const { data, error } = await client.auth.getUser(); return { user: data.user, error }; }
export const signOut = (client: Db, scope: "global" | "local") => client.auth.signOut({ scope });
export const updatePassword = (client: Db, password: string) => client.auth.updateUser({ password });
export const updateEmail = (client: Db, email: string) => client.auth.updateUser({ email });
