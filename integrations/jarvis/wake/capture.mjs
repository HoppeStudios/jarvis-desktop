// Local, on-demand ASR using the existing pinned Pi transcription runtime.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function decodeWave(bytes) {
  if (bytes.length > 4_000_000 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WAVE') throw Error('Invalid capture');
  let format, audio;
  for (let at = 12; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(at + 4), start = at + 8;
    if (start + length > bytes.length) throw Error('Truncated capture');
    const tag = bytes.toString('ascii', at, at + 4);
    if (tag === 'fmt ' && length >= 16) format = {
      type: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2),
      rate: bytes.readUInt32LE(start + 4), bits: bytes.readUInt16LE(start + 14),
    };
    if (tag === 'data') audio = bytes.subarray(start, start + length);
    at = start + length + (length % 2);
  }
  if (!format || !audio || format.type !== 1 || format.channels !== 1 || format.bits !== 16 ||
      format.rate < 8000 || format.rate > 48000 || audio.length % 2) throw Error('Unsupported capture');
  const duration = audio.length / 2 / format.rate;
  if (duration < 0.3 || duration > 30) throw Error('Capture duration outside limit');
  const pcm = new Float32Array(Math.floor(duration * 16000));
  for (let i = 0; i < pcm.length; i++) {
    const source = i * format.rate / 16000, low = Math.floor(source);
    const a = audio.readInt16LE(Math.min(low, audio.length / 2 - 1) * 2);
    const b = audio.readInt16LE(Math.min(low + 1, audio.length / 2 - 1) * 2);
    pcm[i] = (a + (b - a) * (source - low)) / 32768;
  }
  return pcm;
}

const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function extractCommand(transcript, wakePhrases, endings = []) {
  if (typeof transcript !== 'string' || transcript.length > 4000) throw Error('Invalid transcript');
  let text = transcript.trim(), matched = false;
  for (const wake of [...wakePhrases].sort((a, b) => b.length - a.length)) {
    const pattern = escaped(wake.trim()).replace(/\s+/g, '[\\s,.:;!?]+');
    const prefix = new RegExp('^' + pattern + '(?=$|[\\s,.:;!?])', 'iu');
    if (prefix.test(text)) { text = text.replace(prefix, '').replace(/^[\s,.:;!?]+/u, ''); matched = true; break; }
  }
  if (!matched) throw Error('Wake prefix not confirmed by local transcription');
  for (const ending of [...endings].sort((a, b) => b.length - a.length)) {
    const suffix = new RegExp('(?:^|[\\s,.:;!?])' + escaped(ending.trim()) + '[\\s,.:;!?]*$', 'iu');
    if (suffix.test(text)) { text = text.replace(suffix, '').trim(); break; }
  }
  if (!text || text.length > 2000) throw Error('Empty or oversized command');
  return text;
}

async function verify(path, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected ?? '') ||
      createHash('sha256').update(await readFile(path)).digest('hex') !== expected) throw Error('Pinned ASR artifact changed');
}

export async function transcribeCapture(request, runtime) {
  // There is no network fallback and no API credential handling here.
  await verify(runtime.module, runtime.moduleSha256);
  await verify(runtime.library, runtime.librarySha256);
  await verify(runtime.model, runtime.modelSha256);
  for (const file of runtime.files ?? []) await verify(file.path, file.sha256);
  const pcm = decodeWave(Buffer.from(request.wave, 'base64'));
  process.env.TRANSCRIBE_LIBRARY = runtime.library;
  const { TranscribeModel } = await import(pathToFileURL(runtime.module).href);
  const model = await TranscribeModel.load(runtime.model, { backend: 'cpu' });
  let session;
  try {
    session = model.createSession({ nThreads: 3 });
    const result = await session.run(pcm, { language: request.language || 'cs', task: 'transcribe',
      family: { kind: 'whisper', conditionOnPrevTokens: false, temperature: 0 } });
    if (result.aborted || result.truncated) throw Error('Incomplete transcription');
    return extractCommand(result.text, request.wakePhrases, request.endPhrases);
  } finally { session?.dispose(); model.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, config] = process.argv.slice(2);
  let result;
  try {
    const raw = await readFile(input);
    if (raw.length > 5_500_000) throw Error('Oversized capture request');
    const text = await transcribeCapture(JSON.parse(raw), JSON.parse(await readFile(config, 'utf8')));
    result = { ok: true, text };
  } catch { result = { ok: false, error: 'Local command transcription failed; nothing was sent.' }; }
  await writeFile(output + '.tmp', JSON.stringify(result), { mode: 0o600 });
  await rename(output + '.tmp', output);
}
