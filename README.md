# Heizplan — eigener Tado-V3-Stack

**Fokus jetzt:** UI-Parität + Smart-Schedule-Cloud-Sync (sichtbar in der offiziellen Tado-App) mit generischer CloudQuota. Ist/Soll weiter lokal (HomeKit). Keine Markenassets. Kalender kommt als Override-Layer danach.

Lokale Heizungssteuerung ohne TadoLocal als Dependency oder Backend:

```
PWA (Heizplan) → API → Bridge-Schicht (HomeKit / hap-controller) → Tado V3 Bridge → Thermostate
                         └── Sync später → Home Assistant (bestehende VM)
```

**Nicht enthalten:** TadoLocal, Kalender/Learning (nur Erweiterungspunkte), Secrets.

Spike-Artefakte unter `deploy/tadolocal/` und [PR #1](https://github.com/shooterman978/tado_webapp/pull/1) bleiben Lernreferenz — dieser Stack ist das Zielprodukt.

---

## Tech-Stack (Begründung)

| Schicht | Wahl | Warum |
|---|---|---|
| Monorepo | **pnpm + TypeScript** | Eine Sprache für API, PWA und Shared-Types; klare Paketgrenzen; gute DX unter WSL |
| API | **Hono** auf Node 22 | Klein, typsicher, schnell genug für Homelab; Module `bridge` / `zones` getrennt |
| PWA | **Vite + React + vite-plugin-pwa** | Installierbar, responsiv, schlankes App-Shell |
| Bridge | **`hap-controller` hinter `@heizplan/bridge`** | Wartbare Node-HAP-Controller-Lib (Pair/Accessories/Characteristics). Gleiches `BridgeClient`-Interface; kein TadoLocal-Fork. Fallback später: Python/aiohomekit-Sidecar hinter demselben Vertrag, falls nötig |
| DB | **PostgreSQL** (Compose) | Für Regeln, Learning-Samples, Sync-Audit ab Phase 1; MVP nutzt sie noch kaum |
| Deploy | **Docker Compose** | Gleiche Images: Dev = Docker Desktop/WSL, Prod = Proxmox LXC |

Kein Framework-Hype: Lesbarkeit, Modulgrenzen und dokumentierte Pairing-/Sicherheitsregeln haben Vorrang.

### Warum hap-controller (nicht TadoLocal / nicht HAP von Null)?

- Passt zum bestehenden TS-Monorepo (kein zweiter Runtime-Stack für MVP).
- Deckte Pairing-API (`pairSetup`, `getAccessories`, `get/setCharacteristics`).
- BLE-Native-Deps (`noble`) werden nicht gebaut — nur IP/HTTP zur V3-Bridge.
- Pairing-State liegt verschlüsselt-relevant in `BRIDGE_DATA_DIR` (Compose-Volume).

---

## Monorepo-Struktur

```
apps/
  api/          # Backend — /api/health, /api/zones, /api/bridge/*
  web/          # Progressive Web App
packages/
  shared/       # Zone-, Health-, Hook-Typen
  bridge/       # BridgeClient + HapBridgeClient (hap-controller) + Stub
deploy/
  proxmox/      # Prod-Kurzhinweise
docker-compose.yml
compose.dev.yml
compose.prod.yml
```

---

## Lokal starten (WSL / Docker Desktop)

Voraussetzungen: Docker Desktop mit WSL2-Backend, Node 22+ (für Dev ohne Docker optional), pnpm.

### Mit Compose (empfohlen)

```bash
cp .env.example .env
# APP_SESSION_SECRET, POSTGRES_PASSWORD,
# TADO_BRIDGE_IP, TADO_BRIDGE_PIN (XXX-XX-XXX) setzen — nie committen

docker compose -f docker-compose.yml -f compose.dev.yml up --build
```

- PWA: http://localhost:8080  
- API Health: http://localhost:3080/api/health  
- Zones: http://localhost:3080/api/zones  

### Pairing

```bash
curl -sS -X POST http://localhost:3080/api/bridge/prepare-pairing | jq
# PIN kommt aus .env (TADO_BRIDGE_PIN) — nicht in die Shell-History tippen:
curl -sS -X POST http://localhost:3080/api/bridge/pair
curl -sS http://localhost:3080/api/zones | jq
```

Nach erfolgreichem Pairing: `source=bridge`, Mock aus. Volume `heizplan_bridge` backupen.

### Ohne Docker (schnelle UI/API-Iteration)

```bash
pnpm install
pnpm dev:api    # :3080
pnpm dev:web    # :5173, proxied /api → API
```

### Pairing / Netz unter WSL & Docker Desktop

| Thema | Realität |
|---|---|
| **Feste Bridge-IP** | Bevorzugt (`TADO_BRIDGE_IP`). Wie im Spike: mDNS nicht nötig. |
| **mDNS / Bonjour** | Unter WSL oft kaputt (Multicast `EADDRINUSE` / keine Antworten). Discovery ist best-effort. |
| **Docker Desktop NAT** | Container können typischerweise **TCP zu LAN-IPs** (Bridge Port 80). `network_mode: host` verhält sich unter Docker Desktop **nicht** wie Linux-Host-Netz — eher meiden. |
| **Prod** | Proxmox LXC im gleichen LAN wie die V3-Bridge ist der robuste Pairing-Ort. |

---

## Deploy Proxmox (Prod)

Siehe [deploy/proxmox/README.md](./deploy/proxmox/README.md).

```bash
docker compose -f docker-compose.yml -f compose.prod.yml up -d --build
```

Vor erstem HAP-Pairing:

1. Spike-TadoLocal-CT **stoppen und löschen** (Stop allein reicht nicht).
2. Unpair / Bridge-HomeKit-Reset falls nötig (~10 s).
3. Kein Apple Home, kein HA HomeKit auf der V3-Bridge.
4. Pairing-Volume `heizplan_bridge` backupen.

---

## API (MVP)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/health` | Liveness + Bridge-Status |
| GET | `/api/zones` | Raumkacheln (aggregiert; Mock/Fixtures wenn unpaired) |
| POST | `/api/zones/:id/temperature` | Soll `{ "tempC": 20.5, "durationMinutes"?: number }` |
| POST | `/api/zones/:id/overlay/clear` | Manuell beenden / Zeitplan-Approx. |
| POST | `/api/zones/:id/power` | `{ "mode": "heat" \| "off" }` |
| POST | `/api/zones/:id/window` | Fenster manuell `{ "open": boolean }` (UI-Smoke / Fallback) |
| GET/PUT | `/api/zones/settings/open-window` | Auto-Aus bei offenem Fenster (lokal, kein Paywall) |
| POST | `/api/zones/quick-actions/:action` | `off` \| `boost` \| `resume` |
| GET | `/api/bridge/status` | Pairing-State |
| GET | `/api/bridge/hap-report` | HAP-Diagnose (ContactSensor / Services) |
| POST | `/api/bridge/prepare-pairing` | Pairing-Vorbereitung (Instruktionen) |
| POST | `/api/bridge/pair` | HAP-Pairing (PIN aus Env oder Body — nie geloggt) |
| GET | `/api/cloud/status` | Cloud-Metadaten-Link (Raumnamen) |
| GET | `/api/cloud/quota` | Generisches Tagesbudget aller Cloud-HTTP-Calls `{ used, limit, remaining, resetsAt, … }` |
| GET | `/api/cloud/quota/log` | Ringpuffer der gezählten Calls (`?today=1`, `?limit=100`) |
| PUT | `/api/cloud/quota` | Tageslimit setzen `{ "limit": 80 }` |
| POST | `/api/cloud/auth/start` | Device-Code-Login starten |
| POST | `/api/cloud/auth/poll` | Login abschließen / pollen |
| GET | `/api/cloud/sync` | Home-Sync-Status (Disk: `lastSyncedAt`, Auto-Intervall) — kein Cloud-HTTP |
| POST | `/api/cloud/sync` | Home Cloud-Sync (Metadaten + openWindow); Schedules nicht |
| GET | `/api/cloud/schedule/:roomId` | Schedule aus lokalem Cache (kein Cloud-HTTP; Cache-Miss → 404) |
| PUT | `/api/cloud/schedule/:roomId` | Schedule schreiben → sichtbar in Tado-App |
| POST | `/api/cloud/schedule/:roomId/sync` | Expliziter Cloud-Pull („Jetzt synchronisieren“) |

---

## Sicherheit (Grundlagen)

- Secrets nur in `.env` / Docker secrets — **nie committen**
- `TADO_BRIDGE_PIN` niemals in Logs, Chat, PR-Diff
- DB nicht auf `0.0.0.0` publishen (Default)
- PWA/API im LAN oder hinter VPN; HTTPS später per Proxy
- HomeKit-PIN und Pairing-Store nur serverseitig / Volume
- Ein HomeKit-Controller: unsere Bridge-Schicht allein
- Cloud-Tokens (`cloud-tokens.json`) nur im Volume — nie committen/loggen
- CloudQuota (`cloud-quota.json`): alle Cloud-HTTP-Calls, Default-Limit 80/Tag (Europe/Berlin), PIN/Tokens nie loggen

---

## CloudQuota & Schedule

- **Ein** Zähler für Metadaten, Schedule-Sync/PUT, openWindow beim Home-Sync, Auth-Refresh.
- Default-Limit: `CLOUD_DAILY_REQUEST_LIMIT=80` (konservativ unter ~100 ohne Abo); optional Header-Hint `X-RateLimit-Limit`.
- Home-Sync: manuell (Button) + Auto alle `CLOUD_AUTO_SYNC_HOURS` (Default **4**). Room-Enter holt weder Schedule noch Metadata aus der Cloud.
- Schedule: GET = Cache; Cloud nur über Sync-Button. UI zeigt `lastSyncedAt` (Home + Raum/Zeitplan).
- UI: Badge „Heute: X / Y Cloud-Requests“; bei Limit → 429 + klare Meldung.
- Smart Schedule: Home = Timetable-Blöcke; Away = `awayConfiguration` (fester Soll in der Tado-API).

### CalendarOverride (CalDAV / iPhone)

Priorität: `CalendarOverride` (zeitlich) > manuelles Raum-Overlay > Smart Schedule (Cloud-Baseline).

1. Settings / Mehr / Zeitplan → **Kalenderregeln**: iCloud CalDAV (Apple-ID + App-Passwort).
2. Regel z. B. Titel enthält „Büro“ → Räume + Soll; Apply-Pfad default **HAP-Overlay** (0 Cloud).
3. `POST /api/calendar/evaluate` bzw. Poll (`CALENDAR_POLL_MS`); Cloud-Writes nur wenn `applyPath=cloud_write` und `remaining > 0`.
4. Secrets nur in Volume `calendar-credentials.json` — nie committen/loggen.
5. Baseline weiter via Schedule-Cache / Sync-Button (`getCachedZoneSchedule`).

---

## Erweiterungspunkte (noch nicht gebaut)

- Heat-up-Learning → `HeatupLearningHook`
- HA-Sync (REST/WS, kein zweiter HomeKit-Slot)
- Temporäre Cloud-Timetable-Mutation für Calendar (aktuell HAP-Fallback)

---

## Produktname

Arbeitsname **Heizplan** — dunkles Tado-nahes UI (eigenes CSS/Icons), keine TadoLocal-UI / keine Markenlogos.
