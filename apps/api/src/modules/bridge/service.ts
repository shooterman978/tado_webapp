/**
 * Bridge module boundary — API talks only through BridgeClient.
 *
 * @package @heizplan/api
 */

import { HapBridgeClient, type BridgeClient } from "@heizplan/bridge";
import { config } from "../../config.js";

let client: BridgeClient | null = null;
let hapClient: HapBridgeClient | null = null;

export function getBridgeClient(): BridgeClient {
  if (!client) {
    hapClient = new HapBridgeClient({
      dataDir: config.bridgeDataDir,
      bridgeAddress: config.bridgeIp,
      bridgePort: config.bridgePort,
    });
    client = hapClient;
  }
  return client;
}

export function getHapBridgeClient(): HapBridgeClient {
  getBridgeClient();
  if (!hapClient) {
    throw new Error("HAP bridge client not initialised");
  }
  return hapClient;
}

/** Test / DI hook. */
export function setBridgeClient(next: BridgeClient): void {
  client = next;
  hapClient = next instanceof HapBridgeClient ? next : null;
}
