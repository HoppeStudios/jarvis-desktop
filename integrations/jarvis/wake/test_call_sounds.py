import concurrent.futures
import io
import json
import os
import struct
from pathlib import Path
import tempfile
import unittest
import uuid
import wave

from call_sounds import observe, transition, wave_bytes


class CallSoundTests(unittest.TestCase):
    def test_receipt_poll_and_stale_connected_do_not_duplicate(self):
        call = str(uuid.uuid4())
        history = {}
        played = []
        for phase in ('connecting', 'connected', 'connected', 'ending', 'ended', 'ended', 'connected'):
            history, cue = transition(history, {'callId':call, 'phase':phase})
            if cue:
                played.append(cue)
        self.assertEqual(played, ['start', 'end'])

    def test_failed_start_and_unobserved_old_end_are_silent(self):
        for phase in ('failed', 'ended'):
            history, cue = transition({}, {'callId':str(uuid.uuid4()), 'phase':phase})
            self.assertIsNone(cue)
        self.assertEqual(transition({}, None), ({}, None))

    def test_connected_failure_ends_once_and_new_call_can_start(self):
        first, second = str(uuid.uuid4()), str(uuid.uuid4())
        history, _ = transition({}, {'callId':first, 'phase':'connected'})
        history, cue = transition(history, {'callId':first, 'phase':'failed'})
        self.assertEqual(cue, 'end')
        history, cue = transition(history, {'callId':second, 'phase':'connected'})
        self.assertEqual(cue, 'start')

    def test_invalid_ids_and_history_are_bounded(self):
        self.assertEqual(transition({}, {'callId':'not-a-call', 'phase':'connected'}), ({}, None))
        history = {}
        for _ in range(90):
            history, _ = transition(history, {'callId':str(uuid.uuid4()), 'phase':'ended'})
        self.assertEqual(len(history), 64)

    def test_distinct_bounded_pcm_tones(self):
        self.assertNotEqual(wave_bytes('start'), wave_bytes('end'))
        for cue in ('start', 'end'):
            with wave.open(io.BytesIO(wave_bytes(cue)), 'rb') as audio:
                self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate()), (1, 2, 24000))
                self.assertLess(audio.getnframes() / audio.getframerate(), 0.25)
                pcm = audio.readframes(audio.getnframes())
                samples = struct.unpack('<' + 'h' * (len(pcm) // 2), pcm)
                self.assertEqual((samples[0], samples[-1]), (0, 0))
                self.assertLess(max(abs(sample) for sample in samples), 32767)

    @unittest.skipUnless(os.name == 'nt', 'Windows worker locking')
    def test_overlapping_workers_and_restarts_play_once(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'data').mkdir()
            call = {'callId':str(uuid.uuid4()), 'phase':'connected'}
            played = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _:observe(root, call, played.append), range(8)))
            self.assertTrue(all('error' not in r for r in results))
            self.assertEqual(played, ['start'])
            observe(root, call, played.append)
            observe(root, {**call, 'phase':'ended'}, played.append)
            observe(root, {**call, 'phase':'ended'}, played.append)
            self.assertEqual(played, ['start', 'end'])

    @unittest.skipUnless(os.name == 'nt', 'Windows worker locking')
    def test_audio_error_does_not_repeat_or_raise(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'data').mkdir()
            call = {'callId':str(uuid.uuid4()), 'phase':'connected'}
            def unavailable(_):
                raise RuntimeError('device unavailable')
            self.assertIn('error', observe(root, call, unavailable))
            self.assertEqual(observe(root, call, unavailable), {'played':None})


if __name__ == '__main__':
    unittest.main()
