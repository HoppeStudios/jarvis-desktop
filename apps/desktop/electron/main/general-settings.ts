/** Non-secret desktop preferences exposed to authorized local MCP clients. */
const ENUMS: Record<string, readonly string[]> = {
  defaultPermissionMode: ["ask", "accept-edits", "auto"],
  defaultMode: ["agent", "plan"],
  updatePreference: ["automatic", "manual"],
};
const IDS = new Set(["defaultProviderId", "defaultModelId"]);
const BOOLEANS = new Set(["codemodeEnabled", "backgroundJobContinuationEnabled"]);

export function validateGeneralSettingsPatch(value: unknown): Record<string, unknown> {
  const invalid = (): never => {
    throw Object.assign(new Error("Unsupported general settings patch"), { errorCode: "INVALID_PARAMS" });
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const entries = Object.entries(value);
  if (!entries.length) return invalid();
  for (const [key, field] of entries) {
    if (IDS.has(key)) {
      if (typeof field !== "string" || !field.trim() || field.trim() !== field || field.length > 256) return invalid();
    } else if (Object.hasOwn(ENUMS, key)) {
      if (typeof field !== "string" || !ENUMS[key].includes(field)) return invalid();
    } else if (BOOLEANS.has(key)) {
      if (typeof field !== "boolean") return invalid();
    } else return invalid();
  }
  return Object.fromEntries(entries);
}
