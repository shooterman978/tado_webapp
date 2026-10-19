/**
 * @heizplan/bridge — HomeKit / Tado V3 bridge contracts + HAP client.
 *
 * Library choice: **hap-controller** (Node) in-process behind {@link BridgeClient}.
 * Keeps the monorepo TypeScript-native; pairing state on a volume.
 * Fallback path (not implemented): Python aiohomekit sidecar with the same contract
 * if hap-controller ceases to fit Tado/HAP needs.
 *
 * @package @heizplan/bridge
 */

export type {
  BridgeClient,
  DiscoveredBridge,
  DiscoverOptions,
  PairingCredentials,
  PairingPrepareResult,
} from "./types.js";

export { StubBridgeClient } from "./stub-client.js";
export type { StubBridgeOptions } from "./stub-client.js";

export { HapBridgeClient } from "./hap-client.js";
export type { HapBridgeOptions } from "./hap-client.js";

export {
  loadPairing,
  savePairing,
  clearPairing,
  ensureDataDir,
} from "./pairing-store.js";
export type { PersistedPairing } from "./pairing-store.js";
