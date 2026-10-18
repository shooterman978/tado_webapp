# tado_webapp

Self-hosted Heizungssteuerung über **TadoLocal** (HomeKit → Tado V3) auf Proxmox, später mit Kalender/Regeln/PWA und Sync zur bestehenden Home-Assistant-VM.

## Spike: TadoLocal auf Proxmox

Fertiges Deploy-Paket (Compose + LXC-Vorbereitung):

- **[`deploy/tadolocal/`](deploy/tadolocal/)** — Docker Compose (pin `1.1.2`), `.env.example`, Prepare-Script  
- **[`docs/proxmox-tadolocal-spike.md`](docs/proxmox-tadolocal-spike.md)** — Anleitung für Jonas (LXC → Pairing → `GET /zones`)

Kurz: LXC anlegen → Docker installieren → Compose starten → UI `:4407` → HomeKit + Cloud → Smoke-Test. **Keine** HA-Anbindung in diesem Spike.
