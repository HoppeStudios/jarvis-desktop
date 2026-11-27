/** Explicit environment policy wins; otherwise the persisted Jarvis opt-in applies. */
export function shouldStartMcpControl(environment: string | undefined, jarvisEnabled: unknown): boolean {
  return environment === undefined ? jarvisEnabled === true : environment === "1";
}
