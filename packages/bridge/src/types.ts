/**
 * HomeKit / Tado V3 bridge layer contracts.
 *
 * This package owns the *interface* and pairing preparation.
 * Full HAP (HomeKit Accessory Protocol) controller logic lands iteratively —
 * either in-process (TypeScript library) or as a sibling Python service
 * (e.g. aiohomekit) behind the same {@link BridgeClient} surface.
 *
 * @package @heizplan/bridge
 */

import type { BridgePairingState, Zone } from "@heizplan/shared";

/** Opaque pairing credentials — never log or commit. */
export interface PairingCredentials {
  /** Controller identity stored under BRIDGE_DATA_DIR. */
  controllerId: string;
  /** Path to encrypted pairing store (volume). */
  storePath: string;
}

export interface PairingPrepareResult {
  state: BridgePairingState;
  /** Human-readable next step for Ops / UI. */
  instructions: string;
  /** Whether a HomeKit setup code (PIN) is required next. */
  pinRequired: boolean;
}

export interface DiscoverOptions {
  /** Optional mDNS timeout in ms. */
  timeoutMs?: number;
}

export interface DiscoveredBridge {
  id: string;
  name: string;
  address: string;
  port: number;
}

/**
 * Sole HomeKit-slot holder toward the Tado V3 Internet Bridge.
 * Implementations must not share the slot with HA HomeKit or Spike-TadoLocal.
 */
export interface BridgeClient {
  /** Current pairing / connection summary. */
  getStatus(): Promise<{
    state: BridgePairingState;
    paired: boolean;
    message: string;
  }>;

  /**
   * Prepare pairing: ensure data dir, stop conflicting controllers (ops),
   * ready mDNS discovery. Does not yet complete HAP handshake.
   */
  preparePairing(): Promise<PairingPrepareResult>;

  /**
   * Discover candidate bridges on the LAN (stub until HAP lands).
   */
  discover(options?: DiscoverOptions): Promise<DiscoveredBridge[]>;

  /**
   * Complete pairing with the 8-digit HomeKit setup code.
   * Full HAP implementation is iterative — stub throws NotImplemented.
   */
  pairWithPin(pin: string): Promise<void>;

  /** List heating zones mapped to domain {@link Zone}. */
  listZones(): Promise<Zone[]>;

  /** Set target temperature (°C) for a zone. */
  setTargetTemperature(zoneId: string, tempC: number): Promise<void>;

  /** Clear overlay / return to schedule (semantics TBD with HAP). */
  clearOverlay(zoneId: string): Promise<void>;
}
