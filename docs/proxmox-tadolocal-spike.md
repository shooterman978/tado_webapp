# Spike: TadoLocal auf Proxmox (LXC)

**Für:** Jonas Rehkopf  
**Ziel:** TadoLocal läuft im Homelab, pairt die freie HomeKit-V3-Bridge, `GET /zones` liefert Daten.  
**Nicht in diesem Spike:** Home Assistant anbinden, PWA/App, Secrets ins Git.

Repo-Dateien: [`deploy/tadolocal/`](../deploy/tadolocal/) · Upstream: [AmpScm/TadoLocal](https://github.com/AmpScm/TadoLocal) Tag **1.1.2**

---

## Vor dem Start (Checkliste)

- [ ] Tado V3 Internet Bridge und Proxmox im **selben LAN/VLAN**
- [ ] Bridge-**IP** notiert (Router / DHCP / „tado“)
- [ ] HomeKit-**PIN** vom Bridge-Aufkleber (`XXX-XX-XXX`)
- [ ] Bridge aus **Apple Home entfernt** (Slot frei — bestätigt)
- [ ] **Kein** HA-HomeKit-Pairing zur Bridge
- [ ] In der Proxmox-UI: neuer CT möglich (Template Debian 12 oder Ubuntu 24.04)

---

## Wegwahl (kurz)

**Docker Compose im Debian/Ubuntu-LXC** — nicht nativ pip.

Grund: Upstream liefert Dockerfile + Entrypoint; derselbe Stack funktioniert später unter Windows-Docker; Pairing-DB als Volume; Version über Tag `1.1.2` pinbar.

**Privileged LXC** + Features `nesting=1`, `keyctl=1` für den Spike. Unprivileged geht später mit mehr Tuning; für HomeKit/mDNS ist privileged ehrlicher und robuster. Compose nutzt **`network_mode: host`**.

---

## 1. LXC anlegen (Proxmox-Host)

Beispiel (IDs/Storage/Netz anpassen):

```bash
# Auf dem Proxmox-Host
CTID=120
STORAGE=local-lvm
BRIDGE=vmbr0
TEMPLATE=local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst   # Pfad prüfen: pveam available

pct create $CTID $TEMPLATE \
  --hostname tadolocal \
  --cores 2 \
  --memory 2048 \
  --swap 512 \
  --rootfs ${STORAGE}:8 \
  --net0 name=eth0,bridge=${BRIDGE},ip=dhcp \
  --unprivileged 0 \
  --features nesting=1,keyctl=1 \
  --onboot 1 \
  --start 1
```

Falls der CT schon unprivileged angelegt wurde:

```bash
pct set $CTID --features nesting=1,keyctl=1
# Privileged-Umschalten: CT stoppen, Config prüfen (unprivileged: 0), neu starten
pct stop $CTID
# In /etc/pve/lxc/${CTID}.conf: unprivileged: 0  (oder pct set … je nach PVE-Version)
pct start $CTID
```

Shell:

```bash
pct enter $CTID
```

---

## 2. Docker im LXC installieren

Paket aus dem Repo nach `/opt/tadolocal` legen (git clone dieses Repos, scp, oder Dateien manuell kopieren). Dann:

```bash
cd /opt/tadolocal/deploy/tadolocal
bash scripts/prepare-proxmox-lxc.sh
```

Oder manuell: [get.docker.com](https://get.docker.com) + Compose-Plugin, danach `systemctl enable --now docker`.

Prüfen:

```bash
docker --version
docker compose version
```

---

## 3. Stack starten

```bash
cd /opt/tadolocal/deploy/tadolocal
cp .env.example .env
nano .env   # TADO_BRIDGE_IP und TADO_BRIDGE_PIN setzen

docker compose up -d --build
docker compose logs -f --tail=100
```

Erster Build lädt Upstream-Tag `1.1.2` und baut das Image `tadolocal:1.1.2` (braucht Internetzugang im CT).

LXC-IP notieren (`ip -4 addr` oder Proxmox-UI).

---

## 4. TadoLocal UI öffnen

Im Browser (LAN):

`http://<LXC-IP>:4407`

Erwartung: Setup-/Status-UI. Bridge-Verbindung sollte nach erfolgreichem Pairing „ok“ wirken (Zonen erscheinen ggf. nach Cloud-Auth).

API-Docs: `http://<LXC-IP>:4407/docs`

---

## 5. HomeKit pairen

1. `.env` enthält korrekte Bridge-IP + PIN.
2. Container neu starten, falls PIN nachträglich geändert wurde:  
   `docker compose up -d --force-recreate`
3. Logs prüfen: Pairing-Fehler → Troubleshooting unten.
4. Nach Erfolg: **PIN aus `.env` entfernen** (IP behalten), recreate. State bleibt im Volume `tadolocal-data`.

Nur **ein** HomeKit-Controller erlaubt. Slot muss frei sein (Apple Home / HA HomeKit weg).

---

## 6. Cloud-Auth

Lokal steuern braucht trotzdem einmalig Tado-Cloud-Login für Metadaten:

1. In der UI Status **Cloud** prüfen.
2. Auf **Authenticate** / Login-Link klicken, mit Tado-Konto anmelden.
3. Zurück zur UI — Systeme „connected“.
4. Falls UI nach Auth leer/hängig: `docker compose restart` (bekanntes Verhalten in Community-Docker-Guides).

---

## 7. Smoke-Test `GET /zones`

```bash
curl -sS "http://127.0.0.1:4407/zones" | python3 -m json.tool | head -80
# oder vom Laptop:
curl -sS "http://<LXC-IP>:4407/zones"
```

Erwartung: JSON mit Zonen (Namen, Ist-/Soll-Temperaturen o.Ä.). Leer/`[]` ohne Fehler → oft noch Cloud-Auth oder Pairing unvollständig.

Optional Live-Events:

```bash
curl -N "http://127.0.0.1:4407/events"
```

---

## Troubleshooting

| Symptom | Was prüfen |
|---|---|
| **Slot belegt / Pairing fails** | Bridge noch in Apple Home? HA HomeKit Controller? Anderen Controller entfernen. Notfalls Bridge-Reset (Reset-Taste hinten **≥10 s**, LED blinkt) — pairt alles neu. |
| **Bridge nicht gefunden** | Gleiches VLAN? IP stimmt? Vom LXC: `ping <BRIDGE-IP>`. Firewall zwischen CT und Bridge. Host-Netz aktiv (`network_mode: host`)? |
| **UI nicht erreichbar** | `docker compose ps`, Logs, Port 4407 auf LXC: `ss -tlnp \| grep 4407`. Proxmox/Host-Firewall / `pve-firewall`. |
| **Firewall** | LAN-Zugriff auf CT:TCP/4407 erlauben; CT → Bridge (HomeKit, typ. lokal) nicht blockieren. |
| **Docker startet nicht im LXC** | `nesting=1`, `keyctl=1`, privileged? `journalctl -u docker -e`. |
| **Build von GitHub schlägt fehl** | DNS/HTTPS aus dem CT; Tag `1.1.2` erreichbar. Alternativ Upstream lokal clonen und in Compose `build.context: ./TadoLocal` setzen. |
| **Nach Update Pairing weg** | Volume `tadolocal-data` nicht gelöscht? `docker volume ls` / Backup vor `down -v`. |

---

## Anhang: Windows-Docker (gleicher Compose, nicht Hauptpfad)

1. Docker Desktop starten, Ordner `deploy/tadolocal` öffnen.
2. `.env` wie oben.
3. Unter Linux-Backend ggf. Host-Netz; unter Docker Desktop oft **kein** echtes Host-Netz →  
   `docker compose -f docker-compose.yml -f docker-compose.bridge.yml up -d --build`
4. UI: `http://localhost:4407`
5. **Caveats:** mDNS/Bonjour und Bridge-Discovery über NAT oft problematisch; Bridge muss vom Windows-Host per IP erreichbar sein. Für Pairing **Proxmox bevorzugen**.

---

## Was Jonas als Nächstes manuell tun muss

1. LXC anlegen (privileged, nesting/keyctl) und dieses Repo bzw. `deploy/tadolocal` hineinlegen.  
2. `prepare-proxmox-lxc.sh` ausführen, `.env` mit Bridge-IP + PIN füllen.  
3. `docker compose up -d --build` → UI `:4407` öffnen.  
4. HomeKit pairen, Cloud authentifizieren.  
5. `curl …/zones` prüfen; PIN aus `.env` nehmen.  
6. Ergebnis kurz notieren (Go/No-Go) — HA-Sync ist **Spike B**, nicht dieser Schritt.
