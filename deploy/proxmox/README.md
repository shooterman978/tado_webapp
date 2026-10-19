# Proxmox (Prod) — Kurzhinweise

Ziel: Docker Compose im **LXC** (nicht Docker auf dem Proxmox-Host).

## Voraussetzungen

- Unprivileged LXC mit Nesting (Docker-fähig), Debian 12 oder 13
- Gleiches LAN wie die Tado V3 Internet Bridge
- Spike-TadoLocal-CT **gelöscht** (nicht nur gestoppt), HomeKit-Slot frei
- Kein Apple Home / HA HomeKit auf der Bridge

## Ablauf (Skizze)

1. CT anlegen, Docker + Compose installieren.
2. Repo klonen, `.env` aus `.env.example` (starke Secrets).
3. `docker compose -f docker-compose.yml -f compose.prod.yml up -d --build`
4. PWA: `http://<ct-ip>/` — API: `http://<ct-ip>:3080/api/health`
5. Volume `heizplan_bridge` in Backup-Plan aufnehmen (Pairing-State).

Details und Dual-Deploy: Root-[README](../../README.md).
