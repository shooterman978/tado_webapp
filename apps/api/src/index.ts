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
import { maybeSeedOnBoot } from "./modules/heatup/service.js";
import { tryOutdoorTemperature } from "./modules/heatup/outdoor.js";
import { logProtocolEvent } from "./modules/protocol/event-log.js";

const app = createApp();

void (async () => {
  try {
    await maybeSeedOnBoot();
  } catch (err) {
    console.warn(
      "[heatup] boot seed failed:",
      err instanceof Error ? err.message : err,
    );
  }
  try {
    const outdoor = await tryOutdoorTemperature();
    if (outdoor) {
      console.info(
        `[heatup] outdoor ${outdoor.tempC.toFixed(1)}°C via ${outdoor.source} (${config.outdoorLat},${config.outdoorLon})`,
      );
    }
  } catch (err) {
    console.warn(
      "[heatup] outdoor warm-up failed:",
      err instanceof Error ? err.message : err,
    );
  }
})();

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
    console.log(
      `[heizplan-api] heatup=${config.heatupEnabled ? "on" : "off"} outdoor=${config.outdoorProvider}→${config.outdoorFallback ?? "none"}`,
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
        logProtocolEvent({
          category: "polling",
          type: "polling.calendar",
          message: "Kalender geprüft (Änderungen)",
          actor: { kind: "poll", label: "Kalender-Abfrage" },
          detail: {
            matched: result.matched,
            applied: result.applied,
            cleared: result.cleared,
          },
        });
        console.log("[calendar]", result.message);
      }
    } catch (err) {
      // Do not log credentials; CalDavError messages are path/status only.
      const message = err instanceof Error ? err.message : String(err);
      console.error("[calendar] poll failed:", message);
      logProtocolEvent({
        category: "feedback",
        type: "feedback.error",
        message: "Kalender-Poll fehlgeschlagen",
        actor: { kind: "system", label: "System" },
        detail: { message: message.slice(0, 200) },
      });
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
