/**
 * Stub BridgeClient for MVP scaffold — no live HomeKit I/O.
 *
 * @package @heizplan/bridge
 */

import type { BridgePairingState, Zone } from "@heizplan/shared";
import type {
  BridgeClient,
  DiscoverOptions,
  DiscoveredBridge,
  PairingPrepareResult,
} from "./types.js";

export interface StubBridgeOptions {
  /** When true, listZones returns sample rooms for UI development. */
  useMockZones?: boolean;
  dataDir?: string;
}

const MOCK_ZONES: Zone[] = [
  {
    id: "zone-living",
    name: "Wohnzimmer",
    currentTempC: 19.4,
    targetTempC: 21.0,
    overlayActive: false,
    onSchedule: true,
    heatingPowerPercent: 42,
    humidityPercent: 48,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "zone-office",
    name: "Büro",
    currentTempC: 18.1,
    targetTempC: null,
    overlayActive: false,
    onSchedule: false,
    heatingPowerPercent: 0,
    humidityPercent: 40,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "zone-bath",
    name: "Bad",
    currentTempC: 20.2,
    targetTempC: 22.0,
    overlayActive: true,
    onSchedule: false,
    heatingPowerPercent: 65,
    humidityPercent: 60,
    updatedAt: new Date().toISOString(),
  },
];

/**
 * In-memory stub: pairing prep is documented, HAP calls are no-ops / empty.
 */
export class StubBridgeClient implements BridgeClient {
  private state: BridgePairingState = "unpaired";
  private readonly useMockZones: boolean;
  private readonly dataDir: string;

  constructor(options: StubBridgeOptions = {}) {
    this.useMockZones = options.useMockZones ?? true;
    this.dataDir = options.dataDir ?? "/data/bridge";
  }

  async getStatus(): Promise<{
    state: BridgePairingState;
    paired: boolean;
    message: string;
  }> {
    return {
      state: this.state,
      paired: this.state === "paired",
      message:
        this.state === "paired"
          ? "Stub paired (no live HAP)."
          : "Not paired — run preparePairing, free HomeKit slot, then pairWithPin.",
    };
  }

  async preparePairing(): Promise<PairingPrepareResult> {
    this.state = "awaiting_pin";
    return {
      state: this.state,
      pinRequired: true,
      instructions: [
        "1. Spike-TadoLocal-CT stoppen und löschen (Stop allein reicht nicht).",
        "2. Kein Apple Home / HA HomeKit auf der V3-Bridge.",
        "3. Pairing-State-Volume sichern: " + this.dataDir,
        "4. Setup-Code der Bridge bereithalten; pairWithPin(pin) aufrufen.",
        "5. HAP-Controller-Implementierung folgt iterativ (Library oder Python-Service).",
      ].join(" "),
    };
  }

  async discover(_options?: DiscoverOptions): Promise<DiscoveredBridge[]> {
    return [];
  }

  async pairWithPin(pin: string): Promise<void> {
    const normalized = pin.replace(/\D/g, "");
    if (normalized.length !== 8) {
      this.state = "error";
      throw new Error("HomeKit setup code must be 8 digits.");
    }
    this.state = "error";
    throw new Error(
      "HAP pairing not implemented yet. Interface ready; implement BridgeClient.pairWithPin.",
    );
  }

  async listZones(): Promise<Zone[]> {
    if (this.state !== "paired" && this.useMockZones) {
      return MOCK_ZONES.map((z) => ({
        ...z,
        updatedAt: new Date().toISOString(),
      }));
    }
    if (this.state !== "paired") {
      return [];
    }
    return MOCK_ZONES.map((z) => ({
      ...z,
      updatedAt: new Date().toISOString(),
    }));
  }

  async setTargetTemperature(zoneId: string, tempC: number): Promise<void> {
    if (!zoneId || Number.isNaN(tempC)) {
      throw new Error("zoneId and tempC are required.");
    }
    throw new Error("setTargetTemperature: HAP not implemented yet.");
  }

  async clearOverlay(zoneId: string): Promise<void> {
    if (!zoneId) {
      throw new Error("zoneId is required.");
    }
    throw new Error("clearOverlay: HAP not implemented yet.");
  }

  async setPowerMode(zoneId: string, mode: "heat" | "off"): Promise<void> {
    if (!zoneId || (mode !== "heat" && mode !== "off")) {
      throw new Error("zoneId and mode are required.");
    }
    throw new Error("setPowerMode: HAP not implemented yet.");
  }
}
