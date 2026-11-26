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
    rate, duration, spacing = 24000, 0.170, 0.075
    # A soft D/A fifth: overlapping rounded plucks, with a little warm body
    # and a rapidly fading upper partial. No alarm-like gap or hard cutoff.
    notes = (587.33, 880.0) if cue == 'start' else (880.0, 587.33)
    samples = [0.0] * int(rate * (duration + spacing))
    count = int(rate * duration)
    for index, frequency in enumerate(notes):
        onset = int(rate * spacing * index)
        level = (0.20, 0.24)[index]
        for i in range(count):
            t = i / rate
            attack = 1 - math.exp(-t / 0.004)
            release = min(1.0, (count - 1 - i) / (rate * 0.045))
            envelope = attack * math.exp(-t / 0.070) * math.sin(math.pi * release / 2) ** 2
            phase = 2 * math.pi * frequency * t
            tone = (0.83 * math.sin(phase) + 0.13 * math.sin(phase / 2)
                    + 0.10 * math.exp(-t / 0.035) * math.sin(phase * 2))
            samples[onset + i] += level * envelope * tone
    samples = [round(32767 * sample) for sample in samples]
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
