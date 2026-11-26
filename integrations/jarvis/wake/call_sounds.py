"""Short original call cues, deduplicated across the listener's worker processes."""
import io
import json
import math
import os
from pathlib import Path
import struct
import time
import uuid
import wave
from contextlib import contextmanager


def transition(history, call):
    """Only confirmed connection and a subsequent terminal state make a sound."""
    history = dict(history)
    if not isinstance(call, dict):
        return history, None
    call_id, phase = call.get('callId'), call.get('phase')
    try:
        uuid.UUID(call_id)
    except (ValueError, TypeError, AttributeError):
        return history, None
    previous = history.get(call_id)
    cue = None
    if phase == 'connected' and previous is None:
        history[call_id], cue = 'connected', 'start'
    elif phase in ('ended', 'failed'):
        history[call_id] = 'ended'
        if previous == 'connected':
            cue = 'end'
    # A delayed connected poll cannot resurrect a terminal call. Keep enough
    # history for overlapping receipts, without accumulating conversations.
    return dict(list(history.items())[-64:]), cue


def wave_bytes(cue):
    rate, seconds = 24000, 0.085
    notes = (660, 880) if cue == 'start' else (880, 550)
    samples = []
    for frequency in notes:
        count = int(rate * seconds)
        for i in range(count):
            envelope = math.sin(math.pi * i / (count - 1)) ** 2
            samples.append(int(32767 * 0.18 * envelope * math.sin(2 * math.pi * frequency * i / rate)))
        samples.extend([0] * int(rate * 0.015))
    out = io.BytesIO()
    with wave.open(out, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(struct.pack('<' + 'h' * len(samples), *samples))
    return out.getvalue()


def play(cue):
    import winsound
    winsound.PlaySound(wave_bytes(cue), winsound.SND_MEMORY | winsound.SND_NODEFAULT)


@contextmanager
def locked(path):
    # One-byte Windows lock also serializes overlapping native receipts/polls.
    import msvcrt
    with path.open('a+b') as handle:
        if path.stat().st_size == 0:
            handle.write(b'0')
            handle.flush()
        deadline = time.monotonic() + 0.8
        while True:
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.02)
        try:
            yield
        finally:
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def observe(root, call, player=play):
    data = Path(root) / 'data'
    path = data / 'call-sounds.json'
    try:
        with locked(data / 'call-sounds.lock'):
            history = {}
            if path.exists():
                if path.stat().st_size > 16384:
                    raise ValueError('oversized cue history')
                history = json.loads(path.read_text(encoding='utf-8'))
                if not isinstance(history, dict):
                    raise ValueError('invalid cue history')
            updated, cue = transition(history, call)
            if updated != history:
                temporary = path.with_suffix('.tmp')
                temporary.write_text(json.dumps(updated), encoding='utf-8')
                os.replace(temporary, path)
            # Persist before playback: a crash must not repeat the same cue.
            if cue:
                player(cue)
            return {'played': cue}
    except (OSError, ValueError, RuntimeError):
        # Audio is optional; failure must never fail/stop a native call.
        return {'error': 'Call sound unavailable.'}
