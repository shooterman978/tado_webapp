/**
 * API process entry.
 *
 * @package @heizplan/api
 */

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { config } from "./config.js";
import {
  evaluateCalendar,
  getConnectionStatus,
  maybeBootstrapFromEnv,
} from "./modules/calendar/service.js";

const app = createApp();

serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    console.log(
      `[heizplan-api] listening on http://${info.address}:${info.port} (${config.nodeEnv})`,
    );
  },
);

void maybeBootstrapFromEnv().catch((err) => {
  console.error(
    "[calendar] env bootstrap failed:",
    err instanceof Error ? err.message : err,
  );
});

if (config.calendarPollMs > 0) {
  const tick = async (): Promise<void> => {
    try {
      const conn = await getConnectionStatus();
      if (!conn.configured) {
        return;
      }
      const result = await evaluateCalendar();
      if (result.applied > 0 || result.cleared > 0) {
        console.log("[calendar]", result.message);
      }
    } catch (err) {
      // Do not log credentials; CalDavError messages are path/status only.
      console.error(
        "[calendar] poll failed:",
        err instanceof Error ? err.message : err,
      );
    }
  };
  setInterval(() => {
    void tick();
  }, config.calendarPollMs);
  // First pass shortly after boot (bridge may still be pairing).
  setTimeout(() => {
    void tick();
  }, 8_000);
}
