/** Jarvis is a persistent opt-in; explicit launch overrides remain authoritative. */
export function shouldStartLocalControl(environment: string | undefined, jarvisEnabled: unknown): boolean {
  return environment === undefined ? jarvisEnabled === true : environment === "1";
}
