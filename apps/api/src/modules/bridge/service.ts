/**
 * Bridge module boundary — API talks only through BridgeClient.
 *
 * @package @heizplan/api
 */

import { StubBridgeClient, type BridgeClient } from "@heizplan/bridge";
import { config } from "../../config.js";

let client: BridgeClient | null = null;

export function getBridgeClient(): BridgeClient {
  if (!client) {
    client = new StubBridgeClient({
      useMockZones: config.useMockZones,
      dataDir: config.bridgeDataDir,
    });
  }
  return client;
}

/** Test / future DI hook when a real HAP client replaces the stub. */
export function setBridgeClient(next: BridgeClient): void {
  client = next;
}
