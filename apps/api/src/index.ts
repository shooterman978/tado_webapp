/**
 * API process entry.
 *
 * @package @heizplan/api
 */

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { config } from "./config.js";

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
