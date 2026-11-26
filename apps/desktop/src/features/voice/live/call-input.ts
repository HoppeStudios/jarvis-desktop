import type { LiveCallInput } from "@pi-desktop/shared";

/** Exact call-local routing. No physical-mic fallback or saved settings writes. */
export async function requestCallMicrophone(media: Pick<MediaDevices, "enumerateDevices" | "getUserMedia">, input: LiveCallInput): Promise<MediaStream> {
  const matches = (await media.enumerateDevices()).filter(device => device.kind === "audioinput" &&
    device.deviceId !== "default" && device.deviceId !== "communications" && device.label === input.label);
  if (matches.length !== 1 || !matches[0]!.deviceId) throw Object.assign(new Error("LIVE_INPUT_UNAVAILABLE"), { errorCode: "LIVE_INPUT_UNAVAILABLE" });
  return media.getUserMedia({ audio: { deviceId: { exact: matches[0]!.deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
}
