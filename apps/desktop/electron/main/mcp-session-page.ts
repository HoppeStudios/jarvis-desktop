type Query = { includeArchived?: boolean; offset?: number; limit?: number; search?: string };
export function sessionListQuery(args: readonly unknown[]): Query {
  const value = args.length ? args[0] : {};
  const fail = () => { throw Object.assign(new Error("Invalid session list query"), { code: "INVALID_PARAMS" }); };
  if (args.length > 1 || !value || typeof value !== "object" || Array.isArray(value)) return fail();
  const q = value as Query;
  if (Object.keys(q).some(k => !["includeArchived", "offset", "limit", "search"].includes(k)) ||
    (q.includeArchived !== undefined && typeof q.includeArchived !== "boolean") ||
    (q.offset !== undefined && (!Number.isSafeInteger(q.offset) || q.offset < 0)) ||
    (q.limit !== undefined && (!Number.isSafeInteger(q.limit) || q.limit < 1 || q.limit > 100)) ||
    (q.search !== undefined && (typeof q.search !== "string" || q.search.length > 200))) return fail();
  return q;
}

export function sessionListPage(value: unknown, query: Query, preferences: unknown): unknown {
  if (!value || typeof value !== "object" || !Array.isArray((value as any).sessions)) return value;
  const root = value as Record<string, any>;
  const meta = (preferences as any)?.sessionMeta ?? {};
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const search = normalize(query.search?.trim() ?? "");
  const sessions = root.sessions.filter((session: any) =>
    (query.includeArchived || !(session.archived === true || meta[session.id]?.archived === true)) &&
    (!search || normalize(String(session.title ?? "")).includes(search)));
  const offset = query.offset ?? 0, limit = query.limit ?? 50;
  return { ...root, sessions: sessions.slice(offset, offset + limit).map((session: any) => ({
    ...session, archived: session.archived === true || meta[session.id]?.archived === true,
  })), total: sessions.length, offset, limit, nextOffset: offset + limit < sessions.length ? offset + limit : null };
}
