// AXERLY modified 2026-09-23.
// Transitional filename: this module now uses node-postgres directly.
import { Pool, type PoolClient, type QueryResult as PgQueryResult } from "pg";
import { LocalAuthApi, type AuthTokenTransport } from "./localAuth";

export interface DatabaseError extends Error {
  code?: string;
  details?: string;
  hint?: string;
}
export interface DatabaseResult<T = any[]> {
  data: T | null;
  error: DatabaseError | null;
  count: number | null;
}
type Operation = "select" | "insert" | "update" | "upsert" | "delete";
type Cardinality = "many" | "single" | "maybeSingle";
type Filter = { sql: string; values: unknown[] };

function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}
function columnIdentifier(value: string): string {
  if (value.includes("->")) {
    const pieces = value.split(/(->>|->)/);
    let sql = identifier(pieces.shift() ?? "");
    while (pieces.length) {
      const operator = pieces.shift();
      const key = pieces.shift() ?? "";
      if ((operator !== "->" && operator !== "->>") || !/^[a-z0-9_]+$/i.test(key)) {
        throw new Error(`Unsafe JSON column expression: ${value}`);
      }
      sql += `${operator}'${key}'`;
    }
    return sql;
  }
  return value.split(".").map(identifier).join(".");
}
function postgresError(error: unknown): DatabaseError {
  const source = error as { message?: string; code?: string; detail?: string; hint?: string };
  return Object.assign(new Error(source.message ?? "Database operation failed"), {
    code: source.code,
    details: source.detail,
    hint: source.hint,
  });
}
function selectList(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "*") return "*";
  if (trimmed.includes("(") || trimmed.includes("!")) {
    throw new Error("Nested PostgREST selects require an explicit repository query");
  }
  return trimmed.split(",").map((entry) => {
    const part = entry.trim();
    const alias = part.match(/^([a-z_][a-z0-9_]*):([a-z_][a-z0-9_]*)$/i);
    return alias ? `${identifier(alias[2])} as ${identifier(alias[1])}` : columnIdentifier(part);
  }).join(", ");
}
function parseOrExpression(expression: string) {
  return expression.split(",").map((entry) => {
    const match = entry.trim().match(/^([a-z_][a-z0-9_]*)\.(eq|neq|is|gt|gte|lt|lte|like|ilike)\.(.*)$/i);
    if (!match) throw new Error(`Unsupported OR filter: ${entry}`);
    return { column: match[1], operator: match[2].toLowerCase(), value: match[3] };
  });
}

export class DirectQueryBuilder<T = any[]> implements PromiseLike<DatabaseResult<T>> {
  private operation: Operation = "select";
  private columns = "*";
  private payload: Record<string, unknown> | Array<Record<string, unknown>> | null = null;
  private filters: Filter[] = [];
  private ordering: string[] = [];
  private maxRows: number | null = null;
  private offsetRows = 0;
  private cardinality: Cardinality = "many";
  private shouldReturn = true;
  private countExact = false;
  private head = false;
  private conflictColumns: string[] = [];
  private ignoreDuplicates = false;
  private promise: Promise<DatabaseResult<T>> | null = null;

  constructor(private readonly pool: Pool, private readonly table: string) {
    identifier(table);
  }
  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    this.columns = columns;
    this.shouldReturn = true;
    this.countExact = options?.count === "exact";
    this.head = options?.head === true;
    return this;
  }
  insert(values: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.operation = "insert";
    this.payload = values;
    this.shouldReturn = false;
    return this;
  }
  update(values: Record<string, unknown>) {
    this.operation = "update";
    this.payload = values;
    this.shouldReturn = false;
    return this;
  }
  upsert(values: Record<string, unknown> | Array<Record<string, unknown>>, options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.operation = "upsert";
    this.payload = values;
    this.shouldReturn = false;
    this.conflictColumns = (options?.onConflict ?? "").split(",").map((part) => part.trim()).filter(Boolean);
    this.conflictColumns.forEach(identifier);
    this.ignoreDuplicates = options?.ignoreDuplicates === true;
    return this;
  }
  delete() {
    this.operation = "delete";
    this.shouldReturn = false;
    return this;
  }
  private addFilter(column: string, operator: string, value?: unknown) {
    this.filters.push({ sql: `${columnIdentifier(column)} ${operator}`, values: value === undefined ? [] : [value] });
    return this;
  }
  eq(column: string, value: unknown) { return value === null ? this.addFilter(column, "is null") : this.addFilter(column, "=", value); }
  neq(column: string, value: unknown) { return value === null ? this.addFilter(column, "is not null") : this.addFilter(column, "<>", value); }
  gt(column: string, value: unknown) { return this.addFilter(column, ">", value); }
  gte(column: string, value: unknown) { return this.addFilter(column, ">=", value); }
  lt(column: string, value: unknown) { return this.addFilter(column, "<", value); }
  lte(column: string, value: unknown) { return this.addFilter(column, "<=", value); }
  like(column: string, value: unknown) { return this.addFilter(column, "like", value); }
  ilike(column: string, value: unknown) { return this.addFilter(column, "ilike", value); }
  is(column: string, value: null | boolean) {
    return value === null ? this.addFilter(column, "is null") : this.addFilter(column, value ? "is true" : "is false");
  }
  in(column: string, values: unknown[]) { return this.addFilter(column, "= any", values); }
  contains(column: string, value: unknown) { return this.addFilter(column, "@>", value); }
  containedBy(column: string, value: unknown) { return this.addFilter(column, "<@", value); }
  overlaps(column: string, value: unknown) { return this.addFilter(column, "&&", value); }
  filter(column: string, operator: string, value: unknown) {
    const operators: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" };
    if (!operators[operator]) throw new Error(`Unsupported filter operator ${operator}`);
    return this.addFilter(column, operators[operator], value);
  }
  match(values: Record<string, unknown>) {
    for (const [column, value] of Object.entries(values)) this.eq(column, value);
    return this;
  }
  not(column: string, operator: string, value: unknown) {
    if (operator === "is") return value === null ? this.addFilter(column, "is not null") : this.addFilter(column, value ? "is not true" : "is not false");
    const operators: Record<string, string> = { eq: "<>", neq: "=", like: "not like", ilike: "not ilike" };
    if (!operators[operator]) throw new Error(`Unsupported NOT operator ${operator}`);
    return this.addFilter(column, operators[operator], value);
  }
  or(expression: string) {
    const values: unknown[] = [];
    const operators: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" };
    const sql = parseOrExpression(expression).map((part) => {
      const column = columnIdentifier(part.column);
      if (part.operator === "is" && part.value === "null") return `${column} is null`;
      values.push(part.value);
      return `${column} ${operators[part.operator]} $LOCAL${values.length}`;
    }).join(" or ");
    this.filters.push({ sql: `(${sql})`, values });
    return this;
  }
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    const direction = options?.ascending === false ? "desc" : "asc";
    const nulls = options?.nullsFirst === undefined ? "" : options.nullsFirst ? " nulls first" : " nulls last";
    this.ordering.push(`${columnIdentifier(column)} ${direction}${nulls}`);
    return this;
  }
  limit(value: number) { this.maxRows = Math.max(0, Math.trunc(value)); return this; }
  range(from: number, to: number) {
    this.offsetRows = Math.max(0, Math.trunc(from));
    this.maxRows = Math.max(0, Math.trunc(to) - this.offsetRows + 1);
    return this;
  }
  single(): DirectQueryBuilder<any> { this.cardinality = "single"; return this as unknown as DirectQueryBuilder<any>; }
  maybeSingle(): DirectQueryBuilder<any> { this.cardinality = "maybeSingle"; return this as unknown as DirectQueryBuilder<any>; }

  private whereClause(params: unknown[]): string {
    if (!this.filters.length) return "";
    const clauses = this.filters.map((filter) => {
      const base = params.length;
      params.push(...filter.values);
      const placeholder = `$${base + 1}`;
      return filter.sql
        .replace(/\$LOCAL(\d+)/g, (_whole, index) => `$${base + Number(index)}`)
        .replace(/= any$/, () => `= any(${placeholder})`)
        .replace(/(@>|<@|&&)$/, (_match, operator) => `${operator} ${placeholder}`)
        .replace(
          /(=|<>|>=|<=|>|<|like|ilike|not like|not ilike)$/,
          (_match, operator) => `${operator} ${placeholder}`,
        );
    });
    return ` where ${clauses.join(" and ")}`;
  }
  private returning() { return this.shouldReturn ? ` returning ${selectList(this.columns)}` : ""; }
  private insertSql(params: unknown[]): string {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
    if (!rows.length) return "select null where false";
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    if (!keys.length) throw new Error("Insert payload cannot be empty");
    keys.forEach(identifier);
    const tuples = rows.map((row) => `(${keys.map((key) => {
      params.push(row[key] ?? null);
      return `$${params.length}`;
    }).join(", ")})`);
    let sql = `insert into public.${identifier(this.table)} (${keys.map(identifier).join(", ")}) values ${tuples.join(", ")}`;
    if (this.operation === "upsert") {
      if (!this.conflictColumns.length) throw new Error("Upsert requires onConflict");
      sql += ` on conflict (${this.conflictColumns.map(identifier).join(", ")}) `;
      const mutable = keys.filter((key) => !this.conflictColumns.includes(key));
      sql += this.ignoreDuplicates || !mutable.length
        ? "do nothing"
        : `do update set ${mutable.map((key) => `${identifier(key)} = excluded.${identifier(key)}`).join(", ")}`;
    }
    return sql + this.returning();
  }
  private async executeWith(client: PoolClient): Promise<DatabaseResult<T>> {
    const params: unknown[] = [];
    let sql: string;
    if (this.operation === "select") {
      const where = this.whereClause(params);
      if (this.countExact && this.head) {
        const counted = await client.query(`select count(*)::int as count from public.${identifier(this.table)}${where}`, params);
        return { data: null, error: null, count: Number(counted.rows[0]?.count ?? 0) };
      }
      sql = `select ${selectList(this.columns)} from public.${identifier(this.table)}${where}`;
      if (this.ordering.length) sql += ` order by ${this.ordering.join(", ")}`;
      if (this.maxRows !== null) sql += ` limit ${this.maxRows}`;
      if (this.offsetRows) sql += ` offset ${this.offsetRows}`;
    } else if (this.operation === "insert" || this.operation === "upsert") {
      sql = this.insertSql(params);
    } else if (this.operation === "update") {
      const assignments = Object.entries(this.payload as Record<string, unknown>).map(([key, value]) => {
        params.push(value);
        return `${identifier(key)} = $${params.length}`;
      });
      if (!assignments.length) throw new Error("Update payload cannot be empty");
      sql = `update public.${identifier(this.table)} set ${assignments.join(", ")}${this.whereClause(params)}${this.returning()}`;
    } else {
      sql = `delete from public.${identifier(this.table)}${this.whereClause(params)}${this.returning()}`;
    }
    const result = await client.query(sql, params);
    const rows = result.rows;
    let data: unknown = this.shouldReturn ? rows : null;
    if (this.cardinality !== "many") {
      if (rows.length > 1 || (this.cardinality === "single" && rows.length !== 1)) {
        throw Object.assign(new Error("Expected exactly one database row"), { code: "PGRST116" });
      }
      data = rows[0] ?? null;
    }
    return { data: data as T | null, error: null, count: this.countExact ? result.rowCount : null };
  }
  private execute(): Promise<DatabaseResult<T>> {
    this.promise ??= this.pool.connect().then(async (client) => {
      try { return await this.executeWith(client); }
      catch (error) { return { data: null, error: postgresError(error), count: null }; }
      finally { client.release(); }
    });
    return this.promise;
  }
  then<TResult1 = DatabaseResult<T>, TResult2 = never>(
    onfulfilled?: ((value: DatabaseResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export class DirectDatabase {
  readonly auth: LocalAuthApi;
  constructor(readonly pool: Pool, authTransport?: AuthTokenTransport) {
    this.auth = new LocalAuthApi(
      <T extends Record<string, unknown>>(text: string, values?: unknown[]) => this.pool.query<T>(text, values),
      authTransport,
    );
  }
  from(table: string) { return new DirectQueryBuilder(this.pool, table); }
  async rpc(name: string, args: object = {}): Promise<DatabaseResult<any>> {
    try {
      const functionName = identifier(name);
      const entries = Object.entries(args as Record<string, unknown>);
      const invocation = entries.map(([key], index) => `${identifier(key)} => $${index + 1}`).join(", ");
      const result: PgQueryResult<Record<string, unknown>> = await this.pool.query(
        `select * from public.${functionName}(${invocation})`,
        entries.map(([, value]) => value),
      );
      const fields = result.fields.map((field) => field.name);
      const data = fields.length === 1 && fields[0] === name && result.rows.length === 1 ? result.rows[0][name] : result.rows;
      return { data, error: null, count: null };
    } catch (error) {
      return { data: null, error: postgresError(error), count: null };
    }
  }
}

// Keep the deliberately loose surface of the former generated PostgREST client.
// Domain modules validate and narrow rows at their boundaries; making this facade
// generic would require maintaining a generated schema/type layer.
export interface Db {
  auth: any;
  from(table: string): DirectQueryBuilder<any[]>;
  rpc(name: string, args?: object): Promise<DatabaseResult<any>>;
}
let cached: { url: string; pool: Pool; db: DirectDatabase } | null = null;
export function databasePool(): Pool {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (cached?.url === url) return cached.pool;
  if (cached) void cached.pool.end();
  const pool = new Pool({
    connectionString: url,
    max: Number.parseInt(process.env.DATABASE_POOL_SIZE ?? "10", 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  cached = { url, pool, db: new DirectDatabase(pool) };
  return pool;
}
export function createDatabase(): Db {
  const pool = databasePool();
  if (!cached || cached.pool !== pool) throw new Error("Database initialization failed");
  return cached.db as Db;
}
export function createRequestDatabase(transport: AuthTokenTransport): Db {
  return new DirectDatabase(databasePool(), transport) as Db;
}
export async function closeDatabasePool(): Promise<void> {
  const current = cached;
  cached = null;
  if (current) await current.pool.end();
}
