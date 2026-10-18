# TadoLocal Spike — Deploy-Paket

Fertig nutzbares Compose-Paket für **Spike A**: TadoLocal auf Proxmox-LXC starten, HomeKit pairen, REST smoke-testen.

**Nutzer-Anleitung (Deutsch, Schritt für Schritt):** [`docs/proxmox-tadolocal-spike.md`](../../docs/proxmox-tadolocal-spike.md) (gleiche Datei auch im Projekt-Store unter `docs/proxmox-tadolocal-spike.md`).

Upstream: [AmpScm/TadoLocal](https://github.com/AmpScm/TadoLocal) (Apache-2.0), pinbar auf Release **`1.1.2`**.

## Warum Docker-in-LXC (nicht nativ)?

| Weg | Vorteil | Nachteil |
|---|---|---|
| **Docker Compose im LXC** (gewählt) | Gleicher Stack wie Windows-Testpfad; Upstream-Dockerfile/Entrypoint; Volume für Pairing-DB; einfache Rebuilds auf Tag | Nesting/`keyctl` nötig; etwas mehr Features auf dem CT |
| Nativ `pip` + systemd im LXC | Kein Docker-in-LXC | Abweichung vom Dual-Deploy; manuelle Python-/Deps-Pflege |

Für diesen Spike und das Dual-Deploy-Zielbild (Prod = Compose im Container) ist **Docker im Debian/Ubuntu-LXC** der robustere Weg.

## Unprivileged vs. privileged

| Variante | Empfehlung Spike | Tradeoff |
|---|---|---|
| **Unprivileged + `nesting=1` + `keyctl=1`** | **Default (Weg A)** | Nesting in der Proxmox-UI wählbar; Docker-in-LXC-Standard auf PVE 8 |
| Privileged (+ Features per `pct set`) | Alternative (Weg B) | Nesting in der GUI oft **ausgegraut** (normal); mehr Rechte |

**Wichtig:** Privileged + Nesting-Checkbox in der UI = Sackgasse. Details: Spike-Anleitung §2–§4b.

**HomeKit/mDNS:** Compose mit `network_mode: host`, CT und Tado-Bridge im **selben LAN/VLAN**, Pairing über feste Bridge-IP in `.env`.

## Dateien

| Datei | Zweck |
|---|---|
| `docker-compose.yml` | Build von Upstream-Tag `1.1.2`, Volume, Host-Netz, Port 4407 |
| `docker-compose.bridge.yml` | Optional Bridge-Netz + Port-Publish (Caveats) |
| `.env.example` | Bridge-IP/PIN Vorlage (keine Secrets committen) |
| `scripts/prepare-proxmox-lxc.sh` | Docker CE im LXC-Gast installieren |

## Schnellstart (im LXC)

```bash
cd /opt/tadolocal   # oder Pfad zu diesem Ordner
cp .env.example .env
# Bridge-IP + HomeKit-PIN eintragen, dann:
docker compose up -d --build
curl -sS "http://127.0.0.1:4407/zones" | head
```

UI: `http://<LXC-IP>:4407` · API-Docs: `/docs`

Nach erfolgreichem Pairing: `TADO_BRIDGE_PIN` aus `.env` entfernen (IP behalten). Pairing-State liegt im Volume `tadolocal-data`.

## Netzwerk-Hinweise

| Modus | Wann | Hinweis |
|---|---|---|
| **host** (Default) | Proxmox-Spike | Beste Chance für HomeKit; Port 4407 auf LXC-IP |
| **bridge** + Publish | Nur Fallback | NAT; Discovery oft kaputt — feste Bridge-IP setzen |
| **macvlan** | Fortgeschritten | Eigene LAN-IP für den Container; Host↔Container-Kommunikation extra |

## Windows-Docker (Anhang)

Dieselbe `docker-compose.yml` nutzen. Caveats: Host-Netz unter Docker Desktop oft eingeschränkt → ggf. `-f docker-compose.bridge.yml`; Bridge muss vom Windows-Host erreichbar sein; mDNS/Bonjour unzuverlässig. **Nicht** der Einstieg — siehe Spike-Anleitung Anhang.

## Scope dieses Spikes

- ✅ TadoLocal laufen + HomeKit pairen + `GET /zones`
- ❌ Keine HA-Anbindung (Spike B später)
- ❌ Keine PWA/App
