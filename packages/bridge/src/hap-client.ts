/**
 * Real HomeKit controller for the Tado V3 Internet Bridge.
 *
 * Library: hap-controller (Node) — kept in-process behind {@link BridgeClient}
 * so the API/PWA stay TypeScript-native. Python/aiohomekit remains a fallback
 * if this stack proves insufficient; the contract does not change.
 *
 * Pairing is IP + PIN based (TADO_BRIDGE_IP / TADO_BRIDGE_PIN). mDNS discovery
 * is best-effort under WSL/Docker Desktop NAT and is not required.
 *
 * @package @heizplan/bridge
 */

import { createRequire } from "node:module";
import type {
  BridgePairingState,
  HapCapabilitiesReport,
  Zone,
} from "@heizplan/shared";
import type {
  BridgeClient,
  DiscoverOptions,
  DiscoveredBridge,
  PairingPrepareResult,
} from "./types.js";
import {
  clearPairing,
  ensureDataDir,
  loadPairing,
  savePairing,
  type PersistedPairing,
} from "./pairing-store.js";

// hap-controller ships CJS; import via createRequire for ESM packages.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const hap = require("hap-controller") as typeof import("hap-controller");
const { HttpClient, IPDiscovery, Characteristic, Service } = hap;

/** HomeKit TargetHeatingCoolingState: Heat */
const HEAT_MODE = 1;

const THERMOSTAT_UUID = "0000004A-0000-1000-8000-0026BB765291";
const CONTACT_SENSOR_UUID = "00000080-0000-1000-8000-0026BB765291";
/** ContactSensorState: 0 = contact (closed), 1 = no contact (open). */
const CONTACT_OPEN = 1;

export interface HapBridgeOptions {
  dataDir: string;
  /** Fixed LAN address of the V3 Internet Bridge. */
  bridgeAddress?: string;
  /** HAP HTTP port (default 80). */
  bridgePort?: number;
  /**
   * When true and unpaired, listZones returns empty (no mock).
   * Mock zones live in the API layer when BRIDGE_USE_MOCK_ZONES=true.
   */
  useMockZones?: boolean;
}

interface ThermostatRef {
  aid: number;
  name: string;
  targetTempIid: number;
  currentTempIid: number;
  targetHeatIid: number;
  currentHeatIid: number;
  humidityIid: number;
  batteryLowIid: number;
  /** ContactSensorState iid when a Contact Sensor service exists on the accessory. */
  contactStateIid: number;
}

/** HomeKit TargetHeatingCoolingState: Off */
const OFF_MODE = 0;

function normalizePin(pin: string): string {
  const digits = pin.replace(/\D/g, "");
  if (digits.length !== 8) {
    throw new Error("HomeKit setup code must be 8 digits (format XXX-XX-XXX).");
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function isThermostatService(type: string): boolean {
  const name = Service.serviceFromUuid(type);
  return (
    type === THERMOSTAT_UUID ||
    type.endsWith("4A") ||
    String(name).toLowerCase().includes("thermostat")
  );
}

function isContactSensorService(type: string): boolean {
  const name = Service.serviceFromUuid(type);
  const n = String(name).toLowerCase();
  return (
    type.toUpperCase() === CONTACT_SENSOR_UUID ||
    type.endsWith("80") ||
    n.includes("contact")
  );
}

function charName(type: string): string {
  return String(Characteristic.characteristicFromUuid(type)).toLowerCase();
}

function isContactStateChar(n: string): boolean {
  return (
    n.includes("contact-state") ||
    n.includes("contactsensorstate") ||
    n === "contact-state"
  );
}

/**
 * Live HAP bridge client — sole HomeKit-slot holder toward the V3 Bridge.
 */
export class HapBridgeClient implements BridgeClient {
  private state: BridgePairingState = "unpaired";
  private readonly dataDir: string;
  private readonly bridgeAddress: string | undefined;
  private readonly bridgePort: number;
  private persisted: PersistedPairing | null = null;
  private client: InstanceType<typeof HttpClient> | null = null;
  private lastError: string | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(options: HapBridgeOptions) {
    this.dataDir = options.dataDir;
    this.bridgeAddress = options.bridgeAddress;
    this.bridgePort = options.bridgePort ?? 80;
  }

  /** Load pairing store and open HttpClient if paired. */
  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    await this.initPromise;
  }

  private async doInit(): Promise<void> {
    await ensureDataDir(this.dataDir);
    this.persisted = await loadPairing(this.dataDir);
    if (!this.persisted) {
      this.state = "unpaired";
      return;
    }
    try {
      this.client = new HttpClient(
        this.persisted.deviceId,
        this.persisted.address,
        this.persisted.port,
        this.persisted.pairingData,
        { usePersistentConnections: true },
      );
      // Cheap connectivity check — accessories list.
      await this.client.getAccessories();
      this.state = "paired";
      this.lastError = null;
    } catch (err) {
      this.state = "error";
      this.lastError =
        err instanceof Error ? err.message : "Failed to reconnect to bridge";
      try {
        await this.client?.close();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
  }

  async getStatus(): Promise<{
    state: BridgePairingState;
    paired: boolean;
    message: string;
  }> {
    await this.init();
    if (this.state === "paired") {
      return {
        state: "paired",
        paired: true,
        message: "Paired with Tado V3 Internet Bridge (hap-controller).",
      };
    }
    if (this.state === "error") {
      return {
        state: "error",
        paired: false,
        message: this.lastError ?? "Bridge error — check LAN and pairing store.",
      };
    }
    if (this.state === "awaiting_pin" || this.state === "pairing") {
      return {
        state: this.state,
        paired: false,
        message: "Awaiting HomeKit setup code (XXX-XX-XXX).",
      };
    }
    return {
      state: "unpaired",
      paired: false,
      message:
        "Not paired. Set TADO_BRIDGE_IP + TADO_BRIDGE_PIN, then POST /api/bridge/pair.",
    };
  }

  async preparePairing(): Promise<PairingPrepareResult> {
    await this.init();
    await ensureDataDir(this.dataDir);
    this.state = "awaiting_pin";
    const addr = this.bridgeAddress ?? "(set TADO_BRIDGE_IP)";
    return {
      state: this.state,
      pinRequired: true,
      instructions: [
        "1. Ensure Spike-TadoLocal CT is deleted and no Apple Home / HA HomeKit holds the slot.",
        "2. Bridge HomeKit reset (~10s) if the slot still appears busy.",
        `3. Bridge must be reachable at ${addr}:${this.bridgePort} from this host/container.`,
        "4. Put TADO_BRIDGE_IP and TADO_BRIDGE_PIN (XXX-XX-XXX) in .env — never commit.",
        "5. POST /api/bridge/pair (PIN from env or body once; never logged).",
        `6. Pairing state persists under ${this.dataDir} (volume heizplan_bridge).`,
      ].join(" "),
    };
  }

  async discover(options?: DiscoverOptions): Promise<DiscoveredBridge[]> {
    const timeoutMs = options?.timeoutMs ?? 5000;
    const discovery = new IPDiscovery();
    const found = new Map<string, DiscoveredBridge>();

    return new Promise((resolve) => {
      const finish = (): void => {
        try {
          discovery.stop();
        } catch {
          /* ignore */
        }
        resolve([...found.values()]);
      };

      const timer = setTimeout(finish, timeoutMs);

      discovery.on("serviceUp", (service: {
        id?: string;
        name?: string;
        address?: string;
        addresses?: string[];
        port?: number;
      }) => {
        const id = service.id ?? "";
        if (!id || found.has(id)) {
          return;
        }
        const address =
          service.address ??
          (Array.isArray(service.addresses) ? service.addresses[0] : "") ??
          "";
        found.set(id, {
          id,
          name: service.name ?? id,
          address,
          port: service.port ?? 80,
        });
      });

      try {
        discovery.start();
      } catch {
        clearTimeout(timer);
        finish();
      }
    });
  }

  /**
   * Pair with the V3 Bridge.
   * Prefers configured TADO_BRIDGE_IP; optional pin argument (else env must be used by caller).
   */
  async pairWithPin(pin: string, addressOverride?: string): Promise<void> {
    await this.init();
    const address = addressOverride ?? this.bridgeAddress;
    if (!address) {
      this.state = "error";
      throw new Error("TADO_BRIDGE_IP is required for pairing.");
    }

    const normalized = normalizePin(pin);
    this.state = "pairing";

    // Placeholder device id — AccessoryPairingID from pair-setup replaces it in the store.
    const bootstrapId = "00:00:00:00:00:00";
    const client = new HttpClient(bootstrapId, address, this.bridgePort, undefined, {
      usePersistentConnections: true,
    });

    try {
      await client.pairSetup(normalized);
      const pairingData = client.getLongTermData();
      if (!pairingData) {
        throw new Error("Pairing completed but no long-term credentials returned.");
      }

      const deviceId = String(
        (pairingData as { AccessoryPairingID?: string }).AccessoryPairingID ??
          bootstrapId,
      );

      const persisted: PersistedPairing = {
        deviceId,
        address,
        port: this.bridgePort,
        pairingData,
        updatedAt: new Date().toISOString(),
      };
      await savePairing(this.dataDir, persisted);

      try {
        await this.client?.close();
      } catch {
        /* ignore */
      }
      try {
        await client.close();
      } catch {
        /* ignore */
      }

      this.persisted = persisted;
      this.client = new HttpClient(
        deviceId,
        address,
        this.bridgePort,
        pairingData,
        { usePersistentConnections: true },
      );
      await this.client.getAccessories();
      this.state = "paired";
      this.lastError = null;
    } catch (err) {
      this.state = "error";
      this.lastError = err instanceof Error ? err.message : "Pairing failed";
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      this.client = null;
      throw err;
    }
  }

  /** Remove local pairing store (does not always clear accessory-side slot). */
  async unpairLocal(): Promise<void> {
    await this.init();
    try {
      await this.client?.close();
    } catch {
      /* ignore */
    }
    this.client = null;
    this.persisted = null;
    await clearPairing(this.dataDir);
    this.state = "unpaired";
  }

  private requireClient(): InstanceType<typeof HttpClient> {
    if (!this.client || this.state !== "paired") {
      throw new Error("Bridge is not paired.");
    }
    return this.client;
  }

  private async listThermostatRefs(): Promise<ThermostatRef[]> {
    const client = this.requireClient();
    const db = await client.getAccessories();
    const refs: ThermostatRef[] = [];

    for (const accessory of db.accessories ?? []) {
      const aid = Number(accessory.aid);
      let humidityIid = -1;
      let batteryLowIid = -1;
      let contactStateIid = -1;
      let accessoryName: string | null = null;

      // Humidity / battery / contact often live on sibling services.
      for (const service of accessory.services ?? []) {
        const svcType = String(service.type);
        const isContact = isContactSensorService(svcType);
        for (const ch of service.characteristics ?? []) {
          const n = charName(String(ch.type));
          const iid = Number(ch.iid);
          if (n.includes("relative-humidity.current") || n === "currentrelativehumidity") {
            humidityIid = iid;
          } else if (n.includes("status-low-battery") || n.includes("statuslowbattery")) {
            batteryLowIid = iid;
          } else if (isContact && isContactStateChar(n)) {
            contactStateIid = iid;
          } else if (isContactStateChar(n) && contactStateIid < 0) {
            // Loose match if service UUID mapping is unknown.
            contactStateIid = iid;
          } else if (
            n === "name" &&
            ch.value != null &&
            !accessoryName
          ) {
            accessoryName = String(ch.value);
          }
        }
      }

      for (const service of accessory.services ?? []) {
        if (!isThermostatService(String(service.type))) {
          continue;
        }

        let name = accessoryName ?? `Zone ${aid}`;
        let targetTempIid = -1;
        let currentTempIid = -1;
        let targetHeatIid = -1;
        let currentHeatIid = -1;

        for (const ch of service.characteristics ?? []) {
          const n = charName(String(ch.type));
          const iid = Number(ch.iid);
          if (n.includes("name") && ch.value != null) {
            name = String(ch.value);
          } else if (n.includes("temperature.target") && !n.includes("heating")) {
            targetTempIid = iid;
          } else if (n.includes("temperature.current") && !n.includes("heating")) {
            currentTempIid = iid;
          } else if (n.includes("heating-cooling.target")) {
            targetHeatIid = iid;
          } else if (n.includes("heating-cooling.current")) {
            currentHeatIid = iid;
          }
        }

        if (targetTempIid < 0 || currentTempIid < 0) {
          continue;
        }

        refs.push({
          aid,
          name,
          targetTempIid,
          currentTempIid,
          targetHeatIid,
          currentHeatIid,
          humidityIid,
          batteryLowIid,
          contactStateIid,
        });
      }
    }

    return refs;
  }

  /**
   * Diagnostic: dump services/chars the paired bridge exposes.
   * Tado V3 typically: Thermostat + Humidity, no ContactSensor;
   * proprietary write-only service E44673A0-… is present but not readable.
   */
  async describeHapCapabilities(): Promise<HapCapabilitiesReport> {
    await this.init();
    if (this.state !== "paired") {
      return {
        generatedAt: new Date().toISOString(),
        paired: false,
        accessoryCount: 0,
        thermostatCount: 0,
        contactSensorCount: 0,
        note: "Bridge not paired — cannot dump HAP accessories.",
        accessories: [],
      };
    }

    const client = this.requireClient();
    const db = await client.getAccessories();
    let thermostatCount = 0;
    let contactSensorCount = 0;
    const accessories: HapCapabilitiesReport["accessories"] = [];

    for (const accessory of db.accessories ?? []) {
      const aid = Number(accessory.aid);
      let name = `aid ${aid}`;
      let hasThermostat = false;
      let hasContactSensor = false;
      let hasHumidity = false;
      let proprietaryServiceCount = 0;
      const services: HapCapabilitiesReport["accessories"][0]["services"] = [];

      for (const service of accessory.services ?? []) {
        const svcType = String(service.type);
        const svcName = String(Service.serviceFromUuid(svcType));
        if (isThermostatService(svcType)) {
          hasThermostat = true;
          thermostatCount += 1;
        }
        if (isContactSensorService(svcType)) {
          hasContactSensor = true;
          contactSensorCount += 1;
        }
        if (!String(svcName).startsWith("public.hap")) {
          proprietaryServiceCount += 1;
        }

        const characteristics = (service.characteristics ?? []).map(
          (ch: {
            iid?: number;
            type?: string;
            format?: string;
            perms?: string[];
            value?: unknown;
          }) => {
            const type = String(ch.type ?? "");
            const n = charName(type);
            if (
              n.includes("relative-humidity.current") ||
              n === "currentrelativehumidity"
            ) {
              hasHumidity = true;
            }
            if (n === "name" && ch.value != null && name.startsWith("aid ")) {
              name = String(ch.value);
            }
            return {
              iid: Number(ch.iid),
              type,
              name: String(Characteristic.characteristicFromUuid(type)),
              format: ch.format,
              perms: ch.perms,
              value: ch.value,
            };
          },
        );
        services.push({ type: svcType, name: svcName, characteristics });
      }

      accessories.push({
        aid,
        name,
        services,
        hasThermostat,
        hasContactSensor,
        hasHumidity,
        proprietaryServiceCount,
      });
    }

    const note =
      contactSensorCount === 0
        ? "No ContactSensor / contact-state on this V3 Bridge. Open-window is not exposed via readable HAP (proprietary E44673A0… is write-only). Use fixture/manual override or optional cloud openWindowDetected."
        : "ContactSensor present — windowOpen mapped from contact-state (1 = open).";

    console.info(
      `[hap] capabilities: ${accessories.length} accessories, ${thermostatCount} thermostats, ${contactSensorCount} contact sensors`,
    );

    return {
      generatedAt: new Date().toISOString(),
      paired: true,
      accessoryCount: accessories.length,
      thermostatCount,
      contactSensorCount,
      note,
      accessories,
    };
  }

  async listZones(): Promise<Zone[]> {
    await this.init();
    if (this.state !== "paired") {
      return [];
    }

    const refs = await this.listThermostatRefs();
    if (refs.length === 0) {
      return [];
    }

    const client = this.requireClient();
    const ids: string[] = [];
    for (const ref of refs) {
      ids.push(`${ref.aid}.${ref.currentTempIid}`);
      ids.push(`${ref.aid}.${ref.targetTempIid}`);
      if (ref.currentHeatIid >= 0) {
        ids.push(`${ref.aid}.${ref.currentHeatIid}`);
      }
      if (ref.targetHeatIid >= 0) {
        ids.push(`${ref.aid}.${ref.targetHeatIid}`);
      }
      if (ref.humidityIid >= 0) {
        ids.push(`${ref.aid}.${ref.humidityIid}`);
      }
      if (ref.batteryLowIid >= 0) {
        ids.push(`${ref.aid}.${ref.batteryLowIid}`);
      }
      if (ref.contactStateIid >= 0) {
        ids.push(`${ref.aid}.${ref.contactStateIid}`);
      }
    }

    const { characteristics } = await client.getCharacteristics(ids);
    const byKey = new Map<string, unknown>();
    for (const ch of characteristics) {
      const aid = Number(ch.aid);
      const iid = Number(ch.iid);
      byKey.set(`${aid}.${iid}`, ch.value);
    }

    const now = new Date().toISOString();
    return refs.map((ref) => {
      const current = Number(byKey.get(`${ref.aid}.${ref.currentTempIid}`));
      const target = Number(byKey.get(`${ref.aid}.${ref.targetTempIid}`));
      const heatTarget =
        ref.targetHeatIid >= 0
          ? Number(byKey.get(`${ref.aid}.${ref.targetHeatIid}`))
          : HEAT_MODE;
      const heatCurrent =
        ref.currentHeatIid >= 0
          ? Number(byKey.get(`${ref.aid}.${ref.currentHeatIid}`))
          : 0;
      const humidity =
        ref.humidityIid >= 0
          ? Number(byKey.get(`${ref.aid}.${ref.humidityIid}`))
          : NaN;
      const batteryRaw =
        ref.batteryLowIid >= 0
          ? Number(byKey.get(`${ref.aid}.${ref.batteryLowIid}`))
          : NaN;
      const contactRaw =
        ref.contactStateIid >= 0
          ? Number(byKey.get(`${ref.aid}.${ref.contactStateIid}`))
          : NaN;
      const windowOpen = Number.isFinite(contactRaw)
        ? contactRaw === CONTACT_OPEN
        : null;
      const heating = heatTarget === HEAT_MODE;
      const serialMatch = ref.name.match(/\b([A-Z]{2}[A-Z0-9]*\d{4,})\b/i);

      return {
        id: String(ref.aid),
        name: ref.name,
        currentTempC: Number.isFinite(current) ? current : null,
        targetTempC: heating && Number.isFinite(target) ? target : null,
        overlayActive: false,
        onSchedule: heating,
        heatingPowerPercent:
          heatCurrent === HEAT_MODE ? 100 : heatCurrent > 0 ? 50 : 0,
        humidityPercent: Number.isFinite(humidity) ? Math.round(humidity) : null,
        windowOpen: windowOpen === true,
        windowSource: windowOpen == null ? "none" : "hap",
        updatedAt: now,
        devices: [
          {
            id: String(ref.aid),
            name: ref.name,
            serialNo: serialMatch ? serialMatch[1].toUpperCase() : null,
            batteryLow: Number.isFinite(batteryRaw) ? batteryRaw > 0 : null,
            currentTempC: Number.isFinite(current) ? current : null,
            targetTempC: heating && Number.isFinite(target) ? target : null,
            windowOpen,
          },
        ],
      };
    });
  }

  async setTargetTemperature(zoneId: string, tempC: number): Promise<void> {
    await this.init();
    if (!zoneId || Number.isNaN(tempC)) {
      throw new Error("zoneId and tempC are required.");
    }
    if (tempC < 5 || tempC > 30) {
      throw new Error("tempC must be between 5 and 30 °C.");
    }

    const aid = Number(zoneId);
    const refs = await this.listThermostatRefs();
    const ref = refs.find((r) => r.aid === aid);
    if (!ref) {
      throw new Error(`Unknown zone: ${zoneId}`);
    }

    const client = this.requireClient();
    const payload: Record<string, number> = {
      [`${ref.aid}.${ref.targetTempIid}`]: Math.round(tempC * 10) / 10,
    };
    if (ref.targetHeatIid >= 0) {
      payload[`${ref.aid}.${ref.targetHeatIid}`] = HEAT_MODE;
    }
    await client.setCharacteristics(payload);
  }

  async clearOverlay(zoneId: string): Promise<void> {
    // Local semantics: return to heat mode (schedule approximation).
    await this.setPowerMode(zoneId, "heat");
  }

  async setPowerMode(zoneId: string, mode: "heat" | "off"): Promise<void> {
    await this.init();
    if (!zoneId) {
      throw new Error("zoneId is required.");
    }
    const aid = Number(zoneId);
    const refs = await this.listThermostatRefs();
    const ref = refs.find((r) => r.aid === aid);
    if (!ref || ref.targetHeatIid < 0) {
      throw new Error(`Unknown zone or no heat mode characteristic: ${zoneId}`);
    }
    const client = this.requireClient();
    await client.setCharacteristics({
      [`${ref.aid}.${ref.targetHeatIid}`]: mode === "heat" ? HEAT_MODE : OFF_MODE,
    });
  }
}
