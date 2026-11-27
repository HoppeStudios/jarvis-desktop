import { Buffer } from "node:buffer";

type Read = (source: { sessionId: string; turnId: string }) => Promise<any>;
const unavailable = () => Object.assign(new Error("Completed result unavailable"), { errorCode: "LIVE_WORK_NOT_READY" });

/** Read one actual completed Codex turn; never accept caller-provided speech. */
export async function readCompletedResult(read: Read, source: { sessionId: string; turnId: string }): Promise<string> {
  const turn = await read(source);
  if (turn?.id !== source.turnId || turn.status !== "completed") throw unavailable();
  const answers = (turn.items ?? []).filter((item: any) => item?.type === "agentMessage" &&
    item.phase === "final_answer" && typeof item.text === "string" && item.text.trim());
  if (!answers.length) throw unavailable();
  const text: string = answers[0].text.trim();
  // Keep playback short. Code-point truncation cannot split UTF-8 sequences.
  let excerpt = "";
  for (const character of text) {
    if (Buffer.byteLength(excerpt + character, "utf8") > 700) break;
    excerpt += character;
  }
  return excerpt;
}
