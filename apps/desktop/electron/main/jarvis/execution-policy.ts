/** Jarvis changes effort, never silently substitutes a different coding model. */
export function jarvisSessionPolicy<T extends Record<string, unknown>>(input: T, defaults: {
  jarvisEnabled?: boolean; defaultProviderId?: string;
}, creating = true): T {
  if (!defaults.jarvisEnabled) return input;
  return { ...input,
    ...(creating ? { providerId: input.providerId ?? defaults.defaultProviderId } : {}),
    ...(creating && input.thinkingLevel === undefined ? { thinkingLevel: "medium" } : {}),
    modelId: "gpt-6.1-sol", fastMode: true };
}
