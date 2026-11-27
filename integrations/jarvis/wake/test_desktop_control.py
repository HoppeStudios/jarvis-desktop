import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('worker', Path(__file__).with_name('desktop_control.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class FakeClient:
    def __init__(self): self.calls = []
    def invoke(self, op, args=None, confirm=False):
        self.calls.append((op, args, confirm))
        return {'call':None}


class WakeWorkerTests(unittest.TestCase):
    def test_inactive_endpoint_is_specific_and_never_attempts_transport(self):
        with patch.object(Path,'read_text',return_value='{"active":false,"token":"secret-do-not-echo"}'), patch.object(worker,'transport') as transport:
            with self.assertRaises(worker.ControlUnavailable) as raised:worker.Client()
        self.assertEqual(raised.exception.code,'PI_CONTROL_INACTIVE')
        self.assertNotIn('secret-do-not-echo',str(raised.exception))
        transport.assert_not_called()

    def test_missing_endpoint_does_not_claim_shared_queue_or_permission_failure(self):
        with patch.object(Path,'read_text',side_effect=FileNotFoundError), patch.object(worker,'transport') as transport:
            with self.assertRaises(worker.ControlUnavailable) as raised:worker.Client()
        self.assertEqual(raised.exception.code,'PI_CONTROL_NOT_STARTED')
        transport.assert_not_called()

    def test_wake_uses_fresh_native_coordinator_and_ordered_intent(self):
        c = FakeClient()
        request = dict(operation='voice', action='wake', requestId='id', intentId='intent', intentSequence=4)
        worker.execute(c, request, Path('.'))
        op, args, confirm = c.calls[0]
        self.assertEqual(op, 'voice/control'); self.assertTrue(confirm)
        self.assertEqual(args[0], dict(action='wake', requestId='id', intentId='intent', intentSequence=4,
                                       freshCoordinator=True, initialMuted=False, presenceGreeting=False))

    def test_end_never_requests_new_chat_or_microphone(self):
        c = FakeClient()
        worker.execute(c, dict(operation='voice', action='end', requestId='id', intentId='intent',
                               intentSequence=5, expectedCallId='own-call'), Path('.'))
        payload = c.calls[0][1][0]
        self.assertEqual(payload['expectedCallId'], 'own-call')
        self.assertNotIn('freshCoordinator', payload); self.assertNotIn('initialMuted', payload)

    def test_only_timeout_end_forwards_cleanup_intent(self):
        c = FakeClient()
        worker.execute(c, dict(operation='voice', action='end', requestId='id', intentId='intent',
                               intentSequence=5, expectedCallId='own-call', cleanupUnanswered=True), Path('.'))
        self.assertIs(c.calls[0][1][0]['cleanupUnanswered'], True)
        c = FakeClient()
        worker.execute(c, dict(operation='voice', action='wake', requestId='id', intentId='intent',
                               intentSequence=6, cleanupUnanswered=True), Path('.'))
        self.assertNotIn('cleanupUnanswered', c.calls[0][1][0])

    def test_poll_returns_only_queue_summary(self):
        c = FakeClient()
        with patch.object(worker, 'queue_poll', return_value={'pendingCount':3, 'lastInvitation':1}):
            result = worker.execute(c, {'operation':'poll'}, Path('.'))
        self.assertEqual(result['pendingCount'], 3)
        self.assertEqual(c.calls, [('voice/status', None, False)])

    def test_unknown_actions_do_not_reach_native_app(self):
        c = FakeClient()
        with self.assertRaises(ValueError):
            worker.execute(c, dict(operation='voice', action='send-message'), Path('.'))
        self.assertEqual(c.calls, [])


if __name__ == '__main__': unittest.main()
