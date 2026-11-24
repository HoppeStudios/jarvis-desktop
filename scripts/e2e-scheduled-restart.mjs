#!/usr/bin/env node
// Real Host processes, durable SQLite and RPC. No installed profile or model.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { Host, resolveHostBinary } from "./e2e/host.mjs";

const scratch = resolve(process.env.PI_SCRATCH_DIR || tmpdir());
const temp = await mkdtemp(join(scratch, "scheduled-restart-e2e-"));
const host = new Host(resolveHostBinary(), join(temp, "data"), { quiet: true });
const interval = 600 * 60_000;
try {
  await host.start();
  const { task } = await host.call("scheduled.create", { title: "Restart fixture", prompt: "Fixture only",
    cadence: "interval", schedule: { hour: 0, minute: 0, weekday: 0, intervalMinutes: 600 } });
  const read = async () => (await host.call("scheduled.list")).tasks.find(row => row.id === task.id);
  for (let n = 0; n < 2; n++) {
    await host.restart();
    assert.equal((await read()).nextRunAt, task.nextRunAt, "restart must retain the original ten-hour deadline");
  }
  // Only the isolated fixture's supported config input supplies test time.
  const due = Date.now() - 1_000;
  await host.call("scheduled.update", { id: task.id, configJson: { nextRunAt: due } });
  await host.restart();
  assert.equal(Date.parse((await read()).nextRunAt), due);
  assert.deepEqual((await host.call("scheduled.due")).ids, [task.id]);
  const { runId } = await host.call("scheduled.run", { id: task.id });
  assert.deepEqual((await host.call("scheduled.due")).ids, [], "running work cannot overlap");
  await host.call("scheduled.finishRun", { runId, status: "completed" });

  const before = Date.now();
  await host.call("scheduled.update", { id: task.id, configJson: { nextRunAt: before - 120_000 } });
  await host.restart();
  const next = Date.parse((await read()).nextRunAt);
  assert(next >= before + interval && next <= Date.now() + interval, "stale occurrence rearms in the future");
  assert.deepEqual((await host.call("scheduled.due")).ids, [], "no missed-run replay");
  await host.call("scheduled.update", { id: task.id, enabled: false });
  const paused = await read();
  await host.restart();
  assert.equal((await read()).enabled, false);
  assert.equal((await read()).nextRunAt, paused.nextRunAt);
  assert.deepEqual((await host.call("scheduled.due")).ids, []);
  console.log("PASS scheduled restart: durable ten-hour deadline, due grace, overlap, stale rearm and pause");
} finally {
  await host.stop();
  assert(resolve(temp).startsWith(scratch + sep), "cleanup stays inside the explicit scratch root");
  await rm(temp, { recursive: true, force: true });
}
