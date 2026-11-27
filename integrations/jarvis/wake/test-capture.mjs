import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeWave, extractCommand} from './capture.mjs';

test('preserves the full Czech command and removes only the explicit endpoint', () => {
  assert.equal(extractCommand('Hej Jarvisi, otevři Ukázkový projekt a ukaž výsledky. Konec.',
    ['Hey Jarvis', 'Hej Jarvisi'], ['konec']), 'otevři Ukázkový projekt a ukaž výsledky.');
});
test('does not strip words inside a task or execute mentions/negations of the wake', () => {
  assert.equal(extractCommand('Hey Jarvis, explain the word finish please.', ['Hey Jarvis'], ['finish']), 'explain the word finish please.');
  for (const value of ['I said Hey Jarvis open it', 'Neříkám Hey Jarvis otevři to', 'Hey Jarvis', 'noise']) {
    assert.throws(() => extractCommand(value, ['Hey Jarvis'], ['finish']));
  }
});
test('wake names are literal, not regex input', () => {
  assert.equal(extractCommand('A.I., open it', ['A.I.']), 'open it');
  assert.throws(() => extractCommand('AxIx open it', ['A.I.']));
});
test('rejects oversized and malformed input', () => {
  assert.throws(() => decodeWave(Buffer.alloc(100)));
  assert.throws(() => extractCommand('Hey Jarvis ' + 'a'.repeat(2001), ['Hey Jarvis']));
});
function wave(rate, seconds) {
  const bytes=Buffer.alloc(44 + rate * seconds * 2);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVE',8);
  bytes.write('fmt ',12);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(rate,24);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
  bytes.writeInt16LE(16384,44);return bytes;
}
test('retains onset and resamples bounded mono PCM', () => {
  const pcm=decodeWave(wave(32000,1));assert.equal(pcm.length,16000);assert.equal(pcm[0],0.5);
  assert.throws(() => decodeWave(wave(16000,31)));
  const invalid=wave(16000,1);invalid.writeUInt16LE(2,22);assert.throws(() => decodeWave(invalid));
});
