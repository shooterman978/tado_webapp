/**
 * @heizplan/bridge — HomeKit / Tado V3 bridge contracts + stub client.
 *
 * Stack note: TypeScript interface first for shared types with the API.
 * Full controller may stay in TS (if a maintained library fits) or move to a
 * small Python service (aiohomekit-class maturity) behind this same contract.
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
