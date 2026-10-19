/**
 * Lightweight smoke for CloudQuota day-key / midnight helpers (no network).
 * Run: pnpm --filter @heizplan/api exec tsx src/modules/cloud/quota.test.ts
 *
 * @package @heizplan/api
 */

import assert from "node:assert/strict";
import { berlinDayKey, nextBerlinMidnightIso } from "./quota.js";

function main(): void {
  const now = new Date();
  const day = berlinDayKey(now);
  assert.match(day, /^\d{4}-\d{2}-\d{2}$/);

  const resets = nextBerlinMidnightIso(now);
  const resetsAt = new Date(resets);
  assert.ok(resetsAt.getTime() > now.getTime(), "resetsAt must be in the future");
  assert.ok(
    resetsAt.getTime() - now.getTime() <= 36 * 3_600_000,
    "resetsAt within 36h",
  );
  assert.notEqual(berlinDayKey(resetsAt), day, "resetsAt must be next Berlin day");

  console.log("quota helpers ok", { day, resetsAt: resets });
}

main();
