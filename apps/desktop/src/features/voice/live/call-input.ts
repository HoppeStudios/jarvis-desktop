import type { LiveCallInput } from "@pi-desktop/shared";

/** Exact call-local routing. No physical-mic fallback or saved settings writes. */
export async function requestCallMicrophone(media: Pick<MediaDevices, "enumerateDevices" | "getUserMedia">, input: LiveCallInput, reservation: Promise<unknown> = Promise.resolve()): Promise<MediaStream> {
  // Main's existing media check deliberately hides devices without an owned
  // reservation. Enumerating before prepare settles races that privacy gate.
  await reservation;
  const devices = (await media.enumerateDevices()).filter(device => device.kind === "audioinput");
  const matches = devices.filter(device =>
    device.deviceId !== "default" && device.deviceId !== "communications" && device.label === input.label);
  if (matches.length !== 1 || !matches[0]!.deviceId) {
    // Counts only: browser labels/IDs and unrelated hardware names stay private.
    const bounded = (count:number) => Math.min(count, 99);
    const code = `LIVE_INPUT_ENUM_A${bounded(devices.length)}_L${bounded(devices.filter(device => !!device.label).length)}_C${bounded(matches.length)}`;
    throw Object.assign(new Error(code), { errorCode: code });
  }
  return media.getUserMedia({ audio: { deviceId: { exact: matches[0]!.deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
}
