/**
 * Protocol event-log ring buffer smoke (temp dir, no network).
 * Run: pnpm --filter @heizplan/api exec tsx src/modules/protocol/event-log.test.ts
 *
 * @package @heizplan/api
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function main(): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "heizplan-protocol-"));
  process.env.BRIDGE_DATA_DIR = dir;

  // Dynamic import after env so config.bridgeDataDir picks up the temp dir.
  const { appendProtocolEvent, getProtocolEvents } = await import("./event-log.js");

  const a = await appendProtocolEvent({
    category: "calendar",
    type: "calendar.override_apply",
    message: "Termin-Override aktiv: Yoga",
    roomId: "room-1",
    detail: { ruleName: "Yoga", token: "should-strip" },
  });
  assert.ok(a);
  assert.equal(a?.detail?.token, undefined);
  assert.equal(a?.detail?.ruleName, "Yoga");

  await appendProtocolEvent({
    category: "user",
    type: "user.setpoint",
    message: "Solltemperatur 21.0 °C",
    roomId: "room-2",
  });
  await appendProtocolEvent({
    category: "polling",
    type: "polling.zones",
    message: "Räume aktualisiert",
  });

  const all = await getProtocolEvents({ limit: 50 });
  assert.equal(all.entries.length, 3);
  assert.equal(all.entries[0]?.category, "polling");

  const filtered = await getProtocolEvents({ category: "calendar", limit: 50 });
  assert.equal(filtered.entries.length, 1);
  assert.equal(filtered.entries[0]?.type, "calendar.override_apply");

  const searched = await getProtocolEvents({ q: "yoga", limit: 50 });
  assert.equal(searched.entries.length, 1);

  console.log("protocol event-log ok", { dir, retained: all.retained });
  await rm(dir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
