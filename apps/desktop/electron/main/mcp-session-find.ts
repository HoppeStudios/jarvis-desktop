import { parseRemoteSessionId } from "./remote/backend-router";
type Query = { query: string; includeArchived?: boolean; project?: string; limit?: number; owner?: "codex" };
type Session = { id: string; title: string; projectPath?: string; source?: string; remoteHostKey?: string; archived: boolean; score: number; exact: boolean };
const invalid = () => Object.assign(new Error("Invalid session find query"), { code: "INVALID_PARAMS" });
const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");

export function sessionFindQuery(args: readonly unknown[]): Query {
  const value = args[0] as Query;
  if (args.length !== 1 || !value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some(key => !["query", "includeArchived", "project", "limit", "owner"].includes(key)) ||
    typeof value.query !== "string" || value.query.length > 200 || normalize(value.query).length < 2 ||
    normalize(value.query).split(" ").length > 24 ||
    value.includeArchived !== undefined && typeof value.includeArchived !== "boolean" ||
    value.project !== undefined && (typeof value.project !== "string" || !normalize(value.project) || value.project.length > 300) ||
    value.limit !== undefined && (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 8) ||
    value.owner !== undefined && value.owner !== "codex") throw invalid();
  return value;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}

/** Same conservative token/edit-distance strategy as the existing Codex title resolver. */
function score(query: string, title: string): number {
  if (query === title) return 1;
  const words = query.split(" "), available = title.split(" "), titleWords = available.length;
  if (words.every(word => available.includes(word))) return 0.93 + 0.03 * words.length / available.length;
  let sum = 0;
  for (const word of words) {
    let best = 0, at = -1;
    available.forEach((candidate, index) => { const value = similarity(word, candidate); if (value > best) { best = value; at = index; } });
    if (at >= 0) available.splice(at, 1);
    sum += best;
  }
  return Math.max(similarity(query, title), sum / words.length * (0.78 + 0.18 * Math.min(1, words.length / titleWords)));
}

/** One native metadata inventory, bounded result; never transcripts, navigation or work. */
export function findSessionMetadata(raw: unknown, query: Query, preferences: unknown) {
  const inventory = raw as { sessions?: unknown[] };
  if (!Array.isArray(inventory?.sessions)) throw Object.assign(new Error("Session inventory unavailable"), { code: "HOST_UNAVAILABLE" });
  const meta = (preferences as any)?.sessionMeta ?? {};
  const name = normalize(query.query), project = query.project ? normalize(query.project) : undefined;
  const seen = new Set<string>();
  const candidates: Session[] = [];
  for (const entry of inventory.sessions) {
    const item = entry as any;
    if (typeof item?.id !== "string" || !item.id || typeof item.title !== "string" || seen.has(item.id)) continue;
    seen.add(item.id);
    // Original native owner IDs are verified namespaces, not title-based deduplication.
    if (query.owner === "codex" && (item.source !== "codex" || parseRemoteSessionId(item.id)?.hostKey !== "codex-shared")) continue;
    const archived = item.archived === true || meta[item.id]?.archived === true;
    if (archived && !query.includeArchived) continue;
    const projectPath = typeof item.projectPath === "string" ? item.projectPath : undefined;
    if (project && !normalize(projectPath ?? "").includes(project)) continue;
    const title = normalize(item.title.slice(0, 300));
    const sameTerms = name.split(" ").sort().join(" ") === title.split(" ").sort().join(" ");
    const confidence = sameTerms ? 1 : score(name, title);
    if (confidence < 0.78) continue;
    candidates.push({ id: item.id, title: item.title.slice(0, 300), projectPath,
      source: typeof item.source === "string" ? item.source : undefined,
      remoteHostKey: typeof item.remoteHostKey === "string" ? item.remoteHostKey : undefined,
      archived, score: confidence, exact: sameTerms });
  }
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const exact = candidates.filter(item => item.exact);
  const ambiguous = exact.length > 1 || exact.length === 0 && candidates.length > 1 && candidates[0].score - candidates[1].score < 0.1;
  const match = exact.length === 1 ? exact[0] : !ambiguous ? candidates[0] : undefined;
  return { status: match ? "matched" : candidates.length ? "ambiguous" : "not-found",
    ...(match ? { match } : {}), candidates: candidates.slice(0, query.limit ?? 3),
    observedAt: new Date().toISOString(), readOnly: true, scope: "native metadata only; not live activity or voice transfer" };
}
