// AXERLY modified 2026-09-23.
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { DirectDatabase } from "./database";

function databaseReturning(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({
    rows,
    rowCount: rows.length,
    fields: [],
  }));
  const release = vi.fn();
  const pool = {
    connect: vi.fn(async () => ({ query, release })),
    query,
  } as unknown as Pool;
  return { db: new DirectDatabase(pool), query, release };
}

describe("direct PostgreSQL query facade", () => {
  it("parameterizes values and validates identifiers", async () => {
    const { db, query, release } = databaseReturning([{ id: "p1" }]);
    const result = await db
      .from("projects")
      .select("id")
      .eq("user_id", "u1")
      .in("status", ["active", "archived"])
      .order("created_at", { ascending: false })
      .limit(10);

    expect(result.error).toBeNull();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('where "user_id" = $1 and "status" = any($2)'),
      ["u1", ["active", "archived"]],
    );
    expect(query.mock.calls[0]?.[0]).toContain('order by "created_at" desc limit 10');
    expect(release).toHaveBeenCalledOnce();
    expect(() => db.from("projects; drop table users" )).toThrow("Unsafe SQL identifier");
  });

  it("rejects PostgREST relationship syntax instead of issuing ambiguous SQL", async () => {
    const { db } = databaseReturning();
    const result = await db.from("projects").select("*, users!inner(*)");
    expect(result.error?.message).toContain("Nested PostgREST selects");
  });
});
