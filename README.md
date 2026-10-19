# Heizplan — eigener Tado-V3-Stack

Lokale Heizungssteuerung ohne TadoLocal als Dependency oder Backend:

```
PWA (Heizplan) → API → Bridge-Schicht (HomeKit) → Tado V3 Bridge → Thermostate
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
| Bridge | **`@heizplan/bridge` Interface + Stub** | Zuerst Vertrag & Pairing-Vorbereitung; volle HAP iterativ. Falls TS-Controller-Libs unreif → Python-Microservice (z. B. aiohomekit) hinter demselben Interface |
| DB | **PostgreSQL** (Compose) | Für Regeln, Learning-Samples, Sync-Audit ab Phase 1; MVP nutzt sie noch kaum |
| Deploy | **Docker Compose** | Gleiche Images: Dev = Docker Desktop/WSL, Prod = Proxmox LXC |

Kein Framework-Hype: Lesbarkeit, Modulgrenzen und dokumentierte Pairing-/Sicherheitsregeln haben Vorrang.

---

## Monorepo-Struktur

```
apps/
  api/          # Backend — /api/health, /api/zones, /api/bridge/*
  web/          # Progressive Web App
packages/
  shared/       # Zone-, Health-, Hook-Typen
  bridge/       # BridgeClient-Interface + StubBridgeClient
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
# APP_SESSION_SECRET und POSTGRES_PASSWORD setzen

docker compose -f docker-compose.yml -f compose.dev.yml up --build
```

- PWA: http://localhost:8080  
- API Health: http://localhost:3080/api/health  
- Zones (Mock): http://localhost:3080/api/zones  

### Ohne Docker (schnelle UI/API-Iteration)

```bash
pnpm install
pnpm dev:api    # :3080
pnpm dev:web    # :5173, proxied /api → API
```

### Pairing / mDNS unter WSL

Docker Desktop NAT erschwert oft HomeKit-Discovery. UI- und API-Arbeit unter WSL ist fine; **echtes Bridge-Pairing** bevorzugt auf Proxmox im LAN validieren.

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
| GET | `/api/zones` | Raumliste (Mock oder Bridge) |
| GET | `/api/bridge/status` | Pairing-State |
| POST | `/api/bridge/prepare-pairing` | Pairing-Vorbereitung (Instruktionen) |
| POST | `/api/bridge/pair` | Platzhalter 501 — HAP folgt |

---

## Sicherheit (Grundlagen)

- Secrets nur in `.env` / Docker secrets — **nie committen**
- DB nicht auf `0.0.0.0` publishen (Default)
- PWA/API im LAN oder hinter VPN; HTTPS später per Proxy
- HomeKit-PIN und Pairing-Store nur serverseitig / Volume
- HA-Token und CalDAV App-Passwort später nur API-seitig
- Ein HomeKit-Controller: unsere Bridge-Schicht allein

---

## Erweiterungspunkte (noch nicht gebaut)

- Kalenderregeln (CalDAV) → `CalendarRuleHook` in `@heizplan/shared`
- Heat-up-Learning → `HeatupLearningHook`
- HA-Sync (REST/WS, kein zweiter HomeKit-Slot)

---

## Produktname

Arbeitsname **Heizplan** — eigenes Design (Schiefer + Ember), keine TadoLocal-UI.
