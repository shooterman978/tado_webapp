# Spike: TadoLocal auf Proxmox (LXC) — ausführliche Anleitung

**Für:** Jonas Rehkopf  
**Proxmox:** typisch **VE 8.x** (Bezeichnungen unten; bei 7/9 können Labels leicht abweichen)  
**Ziel:** TadoLocal läuft im Homelab, pairt die **freie** HomeKit-V3-Bridge, `GET /zones` liefert Daten.  
**Nicht in diesem Spike:** Home Assistant anbinden, PWA/App, Secrets ins Git.

| Was | Wo |
|---|---|
| Compose + Script | Repo [`deploy/tadolocal/`](../deploy/tadolocal/) |
| Upstream | [AmpScm/TadoLocal](https://github.com/AmpScm/TadoLocal) Tag **1.1.2** |
| Draft-PR (Stand) | Branch `cursor/proxmox-tadolocal-spike-1a51` |

---

## Inhaltsverzeichnis

1. [Vor dem Start](#1-vor-dem-start-checkliste--wo-finde-ich-ip-und-pin)
2. [Wegwahl & Warnungen](#2-wegwahl--warnungen)
3. [CT in der Proxmox-Web-UI anlegen](#3-ct-in-der-proxmox-web-ui-anlegen)
4. [Features nesting/keyctl nachträglich setzen](#4-features-nestingkeyctl-nachträglich-setzen)
5. [CT starten und Konsole öffnen](#5-ct-starten-und-konsole-öffnen)
6. [Spike-Dateien ins CT kopieren](#6-spike-dateien-ins-ct-kopieren)
7. [Docker installieren](#7-docker-installieren)
8. [`.env` ausfüllen und Compose starten](#8-env-ausfüllen-und-compose-starten)
9. [Firewall & Browser zu Port 4407](#9-firewall--browser-zu-port-4407)
10. [HomeKit pairen](#10-homekit-pairen)
11. [Cloud-Auth](#11-cloud-auth)
12. [Smoke-Test `GET /zones`](#12-smoke-test-get-zones)
13. [PIN aus `.env` entfernen](#13-pin-aus-env-entfernen)
14. [Troubleshooting](#14-troubleshooting)
15. [Anhang: CLI-Alternative & Windows-Docker](#15-anhang-cli-alternative--windows-docker)

---

## 1. Vor dem Start (Checkliste + wo finde ich IP und PIN)

### Checkliste

- [ ] Proxmox-Web-UI erreichbar (`https://<proxmox-host>:8006`)
- [ ] Rechte zum Anlegen eines **Containers (CT / LXC)**
- [ ] Storage mit Platz (z. B. `local-lvm` oder dein üblicher Disk-Storage)
- [ ] Linux-Container-Template vorhanden: **Debian 12** oder **Ubuntu 24.04** (amd64)
- [ ] Tado V3 **Internet Bridge** und Proxmox im **selben LAN/VLAN** (gleiche Broadcast-Domain)
- [ ] Bridge aus **Apple Home** entfernt → HomeKit-Slot frei
- [ ] **Kein** Home-Assistant-HomeKit-Pairing zur Tado-Bridge
- [ ] Bridge-**IP** und HomeKit-**PIN** greifbar (siehe unten)

### Wo finde ich die Bridge-IP?

1. Router / FritzBox o. Ä.: Geräteliste → Eintrag oft **„tado“** / **„Tado Bridge“** / Hersteller Tado.
2. Alternativ in der offiziellen Tado-App: Geräteinfos / Netzwerk (je nach App-Version).
3. Vom Laptop im gleichen LAN: Geräte-Scan oder Router-DHCP-Historie.
4. Merke die IP, z. B. `192.168.178.55` — kommt in `.env` als `TADO_BRIDGE_IP`.

### Wo finde ich den HomeKit-PIN?

- Auf dem **Aufkleber der Tado Internet Bridge** (Gerät selbst, oft Unterseite/Rückseite).
- Format: **`XXX-XX-XXX`** (acht Ziffern mit Bindestrichen), z. B. `123-45-678`.
- Das ist **nicht** dein Tado-Cloud-Passwort und **nicht** der Apple-Home-Code von einem anderen Gerät.

**Wichtig:** PIN und `.env` **niemals** committen oder in Screenshots/Chat posten.

---

## 2. Wegwahl & Warnungen

### Was wir bauen

```
Proxmox-Host
  └── LXC „tadolocal“ (privileged, nesting, keyctl)
        └── Docker + Compose
              └── Container tado-local (network_mode: host)
                    └── Port 4407 → REST/UI
                    └── HomeKit → Tado V3 Bridge (gleiche LAN-IP-Welt)
```

**Docker Compose im LXC** (nicht nativ pip): Upstream-Dockerfile, Dual-Deploy mit Windows später, Pairing-DB als Volume, Version auf Tag `1.1.2` gepinnt.

### Unprivileged vs. privileged (ehrlich)

| | Privileged (Spike-Empfehlung) | Unprivileged |
|---|---|---|
| Docker-in-LXC | Einfacher mit `nesting` + `keyctl` | Oft mehr Fehler (cgroup, Geräte) |
| HomeKit / host-Netz | Praktisch robuster | Kann gehen, mehr Frickelei |
| Sicherheit | Größere Angriffsfläche, falls Docker ausbricht | Besser isoliert |
| **Für diesen Spike** | **Ja** | Später härten |

Compose nutzt **`network_mode: host`**: der Docker-Container teilt sich den Netzwerk-Stack des LXC → gleiche LAN-Sicht wie der CT (wichtig für HomeKit).

### Netzwerk-Warnung: `vmbr0`

- In den meisten Homelabs heißt die LAN-Bridge **`vmbr0`**.
- Der CT muss an **dieselbe Bridge / dasselbe VLAN** wie die Tado-Bridge (und oft wie dein Laptop).
- Wenn deine VMs (z. B. Home Assistant) an `vmbr0` hängen und die Heizung erreichen, nimm für den Spike **dieselbe** Bridge — nicht ein isoliertes Test-Netz ohne Zugriff auf die Tado-Bridge.

---

## 3. CT in der Proxmox-Web-UI anlegen

Öffne die Proxmox-Web-UI: `https://<dein-proxmox>:8006` und melde dich an.

### 3.0 Template vorbereiten (falls noch keins da)

1. Linke Seite: **Datacenter** → deinen **Node** (Hostname des Servers) anklicken.
2. Node-Menü: **local** (oder Storage, der Templates hält) → **CT Templates** / **Inhalt** (Content).
3. Oben **Templates** / **Vorlagen** → gewünschtes Image laden, z. B.:
   - `debian-12-standard_….tar.zst`
   - oder `ubuntu-24.04-standard_….tar.zst`
4. Download abwarten, bis der Status fertig ist.

Ohne Template bricht der Assistent bei „Template“ ab.

### 3.1 Assistent starten

**Pfad (Proxmox 8):**

> Linke Baumansicht: **Datacenter** → **\<Node\>** → oben Button **Create CT**  
> (deutsch oft: **CT erstellen**)

Es öffnet sich der Wizard mit mehreren Tabs (General → Template → Disks → CPU → Memory → Network → DNS → Confirm).

### 3.2 Tab „General“ / Allgemein

| Feld | Empfehlung Spike | Hinweis |
|---|---|---|
| **Node** | dein Proxmox-Node | meist vorausgefüllt |
| **CT ID** | freie ID, z. B. `120` | darf nicht schon belegt sein |
| **Hostname** | `tadolocal` | ohne Leerzeichen |
| **Resource Pool** | leer / Default | optional |
| **Password** / Confirm | starkes root-Passwort | für Console/SSH |
| **SSH public key** | optional dein Laptop-Key | praktisch für scp/git |
| **Unprivileged container** | **deaktiviert / aus** | Spike = **privileged** |
| **Nesting** | wenn hier schon sichtbar: **an** | sonst später unter Options → Features |

**Warnung:** Steht „Unprivileged container“ auf **an**, Docker-in-LXC und HomeKit werden deutlich schwieriger. Für den Spike bewusst **aus**.

Weiter mit **Next**.

### 3.3 Tab „Template“

| Feld | Empfehlung |
|---|---|
| **Storage** | Storage, in dem das Template liegt (oft `local`) |
| **Template** | Debian 12 standard **oder** Ubuntu 24.04 standard (amd64) |

**Next**.

### 3.4 Tab „Disks“ / Festplatten

| Feld | Empfehlung Spike |
|---|---|
| **Storage** | z. B. `local-lvm` (dein Normal-Storage) |
| **Disk size** | **8 GB** Minimum; **16 GB** komfortabel (Images + Docker-Layer) |

Optional: keine Extra-Mounts nötig.

**Next**.

### 3.5 Tab „CPU“

| Feld | Empfehlung |
|---|---|
| **Cores** | **2** |
| **CPU units** / Type | Default reicht |

**Next**.

### 3.6 Tab „Memory“ / Speicher

| Feld | Empfehlung |
|---|---|
| **Memory** | **2048 MB** (2 GB) |
| **Swap** | **512 MB** |

**Next**.

### 3.7 Tab „Network“ / Netzwerk

| Feld | Empfehlung Spike | Hinweis |
|---|---|---|
| **Name** | `eth0` (Default) | |
| **Bridge** | **`vmbr0`** (oder deine LAN-Bridge) | **gleiche** Bridge wie Tado-LAN |
| **IPv4** | **DHCP** zum Start | oder Static (siehe unten) |
| **IPv6** | oft „SLAAC“ / aus — Homelab-üblich | |
| **Firewall** | nach Geschmack | bei Problemen mit :4407 prüfen (§9) |
| **VLAN Tag** | nur wenn dein LAN VLAN nutzt | sonst leer lassen |

**DHCP (einfach):**

- IPv4 = **DHCP**
- Nach dem Start IP in der Proxmox-UI am CT ablesen (Summary) oder im CT `ip -4 addr`.

**Static (optional, oft besser für Bookmarks):**

- IPv4 = **Static**
- Adresse z. B. `192.168.178.120/24` (freie IP in deinem Netz!)
- Gateway z. B. `192.168.178.1` (dein Router)
- DNS kommt oft im nächsten Tab

**Next**.

### 3.8 Tab „DNS“

| Feld | Empfehlung |
|---|---|
| **DNS domain** | optional, z. B. `lan` / leer |
| **DNS servers** | Router-IP oder `1.1.1.1` / `9.9.9.9` |

DNS muss funktionieren — Compose baut von GitHub (`github.com`).

**Next**.

### 3.9 Tab „Confirm“ / Bestätigen

1. Zusammenfassung prüfen: **privileged**, Hostname `tadolocal`, Bridge `vmbr0`, RAM/Disk ok.
2. Haken **Start after created** / **Nach Erstellung starten** setzen (praktisch).
3. **Finish** / **Fertigstellen**.
4. Task-Log unten beobachten → Status **OK**.

Der neue CT erscheint links unter dem Node (Icon Container, ID z. B. `120`).

---

## 4. Features nesting/keyctl nachträglich setzen

Docker braucht im LXC typischerweise **Nesting** und **keyctl**.

### In der GUI (Proxmox 8)

1. Links den CT **`tadolocal`** (z. B. ID 120) anklicken.
2. Menü: **Options** (deutsch: **Optionen**).
3. Zeile **Features** doppelklicken (oder Select → **Edit**).
4. Aktivieren:
   - **Nesting**
   - **keyctl** (manchmal als „Keyctl“ / unter erweiterten Features)
5. **OK** speichern.
6. CT **neu starten**, falls Features nicht hot greifen:
   - CT → **Shutdown** / **Stop**, dann **Start**  
   - oder oben **Restart**.

### Kontrolle

Unter **Options** sollte bei Features etwas wie `nesting=1;keyctl=1` stehen (Formulierung je nach UI-Sprache).

**Hinweis:** „Privileged“ wird beim Anlegen gesetzt. Um nachträglich von unprivileged → privileged zu wechseln, ist oft ein Stop + Config-Eingriff nötig — einfacher: CT löschen und Wizard nochmal mit Unprivileged **aus**.

---

## 5. CT starten und Konsole öffnen

1. CT ausgewählt → Button **Start** (falls nicht schon laufend).
2. **Summary** / **Übersicht**: Status „running“, ggf. IPv4 notieren → das ist deine **`<LXC-IP>`**.
3. Konsole:
   - **Console** (noVNC) im CT-Menü, oder
   - auf dem Proxmox-Host per Shell: `pct enter 120` (ID anpassen).

Login: `root` + Passwort aus dem Wizard (oder SSH-Key).

Kurztest Internetzugang im CT:

```bash
ping -c 2 1.1.1.1
ping -c 2 github.com
```

---

## 6. Spike-Dateien ins CT kopieren

Zielpfad im CT: **`/opt/tadolocal`** (darunter liegt dann `deploy/tadolocal/…`).

Wähle **einen** Weg.

### Weg A — git clone vom Spike-Branch (empfohlen)

Im CT:

```bash
apt-get update
apt-get install -y git ca-certificates
mkdir -p /opt
cd /opt
git clone --branch cursor/proxmox-tadolocal-spike-1a51 --single-branch \
  https://github.com/shooterman978/tado_webapp.git tadolocal
ls /opt/tadolocal/deploy/tadolocal
```

Falls das Repo privat ist: HTTPS mit Token, oder SSH-Key im CT hinterlegen, oder Weg B/C.

### Weg B — scp vom Laptop

Auf dem **Laptop** (Pfad zum ausgecheckten Repo anpassen):

```bash
scp -r deploy/tadolocal root@<LXC-IP>:/opt/tadolocal-deploy
```

Im CT aufräumen:

```bash
mkdir -p /opt/tadolocal/deploy
mv /opt/tadolocal-deploy /opt/tadolocal/deploy/tadolocal
ls /opt/tadolocal/deploy/tadolocal
```

### Weg C — nur den Ordner per Proxmox Push / USB / WinSCP

Kopiere den Inhalt von `deploy/tadolocal/` nach `/opt/tadolocal/deploy/tadolocal/` so, dass mindestens existieren:

- `docker-compose.yml`
- `docker-compose.bridge.yml`
- `.env.example`
- `scripts/prepare-proxmox-lxc.sh`
- `README.md`

---

## 7. Docker installieren

Im CT als root:

```bash
cd /opt/tadolocal/deploy/tadolocal
chmod +x scripts/prepare-proxmox-lxc.sh
bash scripts/prepare-proxmox-lxc.sh
```

Das Script installiert Docker CE + Compose-Plugin und startet den Docker-Dienst. Es erinnert an nesting/keyctl (sollten schon gesetzt sein).

Prüfen:

```bash
docker --version
docker compose version
systemctl is-active docker
```

Erwartung: Versionsnummern + `active`.

**Falls Docker fehlschlägt:** §14 (nesting/keyctl/privileged, `journalctl -u docker -e`).

---

## 8. `.env` ausfüllen und Compose starten

```bash
cd /opt/tadolocal/deploy/tadolocal
cp .env.example .env
nano .env
```

Mindestens setzen (Beispielwerte ersetzen):

```env
TADO_BRIDGE_IP=192.168.178.55
TADO_BRIDGE_PIN=123-45-678
TADO_PORT=4407
```

- Keine Anführungszeichen nötig.
- PIN exakt im Format `XXX-XX-XXX`.
- `TADO_API_KEYS` für den Spike leer lassen.

Speichern in nano: `Ctrl+O`, Enter, `Ctrl+X`.

Stack bauen und starten (braucht Internet — lädt Upstream Tag `1.1.2`):

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f --tail=100
```

Mit `Ctrl+C` Logs verlassen (Container läuft weiter).

Erwartung: Container `tado-local` Status **Up**. Image-Name typisch `tadolocal:1.1.2`.

LXC-IP nochmal notieren:

```bash
hostname -I
# oder
ip -4 addr show eth0
```

---

## 9. Firewall & Browser zu Port 4407

### Erreichbarkeit

Vom **Laptop im LAN** Browser öffnen:

```text
http://<LXC-IP>:4407
```

API-Docs:

```text
http://<LXC-IP>:4407/docs
```

### Wenn die Seite nicht lädt

1. Im CT: lauscht etwas auf 4407?

   ```bash
   ss -tlnp | grep 4407
   docker compose ps
   docker compose logs --tail=50
   ```

2. **Proxmox-Firewall**
   - **Datacenter → Firewall** und/oder **Node → Firewall** und/oder **CT → Firewall**
   - Bei aktivierter Firewall: Regel **Allow** TCP **4407** aus dem LAN (Source z. B. `192.168.178.0/24`) Richtung CT, oder Firewall am CT temporär zum Test aus.
3. Router-/Client-Firewall auf dem Laptop (selten).
4. Falsche Bridge/VLAN → Laptop und CT nicht im selben Netz.

Mit `network_mode: host` ist Port 4407 am **LXC selbst** gebunden (nicht „nur in Docker-NAT“).

---

## 10. HomeKit pairen

Voraussetzungen (nochmal):

- Slot frei (Apple Home entfernt, kein HA-HomeKit).
- `.env` mit korrekter Bridge-IP + PIN.
- CT kann die Bridge pingen:

  ```bash
  ping -c 3 "$TADO_BRIDGE_IP"
  # oder explizit:
  ping -c 3 192.168.178.55
  ```

Ablauf:

1. Container mit aktuellen Env-Vars (neu) starten:

   ```bash
   cd /opt/tadolocal/deploy/tadolocal
   docker compose up -d --force-recreate
   docker compose logs -f --tail=200
   ```

2. UI `http://<LXC-IP>:4407` — Bridge-/Pairing-Status beobachten.
3. Bei Pairing-Fehlern → §14 (Slot belegt, falsche PIN/IP, Firewall).
4. Erfolg: UI zeigt Verbindung; nach Cloud-Auth (§11) erscheinen Zonen.

Nur **ein** HomeKit-Controller gleichzeitig. TadoLocal ist für dieses Projekt der Slot-Inhaber.

---

## 11. Cloud-Auth

Lokal steuern braucht trotzdem **einmalig** Tado-Cloud-Login (Metadaten):

1. Browser: `http://<LXC-IP>:4407`
2. Statusbereich **Cloud** prüfen.
3. Link **Authenticate** / Anmelden öffnen.
4. Mit dem **Tado-Konto** einloggen und freigeben.
5. Zurück zur TadoLocal-UI — Cloud sollte connected wirken.
6. Hängt/leert die UI danach: im CT `docker compose restart`, Browser hard-refresh (`Ctrl+Shift+R`).

---

## 12. Smoke-Test `GET /zones`

Im CT:

```bash
curl -sS "http://127.0.0.1:4407/zones" | python3 -m json.tool | head -80
```

Oder vom Laptop:

```bash
curl -sS "http://<LXC-IP>:4407/zones"
```

**Erfolg:** JSON mit Zonen (Namen, Temperaturen o. Ä.).  
**Leeres Array / Fehler:** Pairing oder Cloud-Auth nachziehen; Logs prüfen.

Optional Live-Events:

```bash
curl -N "http://127.0.0.1:4407/events"
```

Optional Status:

```bash
curl -sS "http://127.0.0.1:4407/status"
```

---

## 13. PIN aus `.env` entfernen

Nach erfolgreichem Pairing liegt der Zustand im Docker-Volume **`tadolocal-data`**. Die PIN wird für Neustarts nicht mehr gebraucht.

```bash
cd /opt/tadolocal/deploy/tadolocal
nano .env
# Zeile TADO_BRIDGE_PIN=... löschen oder auskommentieren
# TADO_BRIDGE_IP behalten

docker compose up -d --force-recreate
docker compose ps
curl -sS "http://127.0.0.1:4407/zones" | head
```

**Niemals** `docker compose down -v` ohne Backup — `-v` löscht Volumes inkl. Pairing.

Volume prüfen:

```bash
docker volume ls | grep tado
```

---

## 14. Troubleshooting

| Symptom | Was tun |
|---|---|
| **Wizard: kein Template** | Node → Storage `local` → CT Templates → Template downloaden (§3.0). |
| **Docker startet nicht** | Options → Features: nesting + keyctl; CT privileged? `journalctl -u docker -e`. CT neu starten. |
| **Compose-Build / GitHub fail** | DNS im CT, `ping github.com`, Uhrzeit/NTP; Internetzugang. |
| **UI nicht erreichbar** | `ss -tlnp \| grep 4407`, `docker compose ps`, Firewall Datacenter/Node/CT (§9). |
| **Bridge nicht gefunden / kein Ping** | Gleiche Bridge `vmbr0`/VLAN? IP stimmt? Router-Isolation? Host-Netz in Compose aktiv? |
| **Slot belegt / Pairing fails** | Apple Home? HA HomeKit? Anderen Controller entfernen. Notfalls Bridge-Reset: kleine Reset-Taste hinten **≥ 10 Sekunden**, LED blinkt — danach alles neu pairen. |
| **Falsche PIN** | Aufkleber nochmal lesen; Format `XXX-XX-XXX`; nach Korrektur `--force-recreate`. |
| **Cloud-Auth hängt** | Auth im Browser wiederholen; `docker compose restart`; Hard-Refresh. |
| **`/zones` leer** | Pairing + Cloud fertig? Logs; `/status` und UI prüfen. |
| **Pairing nach Recreate weg** | Volume gelöscht (`down -v`)? Nicht löschen; Backup von `tadolocal-data` erwägen. |
| **CT falsch unprivileged angelegt** | Neu anlegen mit Unprivileged **aus** ist oft schneller als Umbau. |

### Nützliche Befehle (im CT)

```bash
cd /opt/tadolocal/deploy/tadolocal
docker compose ps
docker compose logs --tail=200
docker compose restart
journalctl -u docker -e --no-pager | tail -50
ping -c 3 <TADO_BRIDGE_IP>
ss -tlnp | grep 4407
```

### Nützliche GUI-Pfade (Proxmox 8)

| Ziel | Pfad |
|---|---|
| CT erstellen | **Datacenter → \<Node\> → Create CT** |
| Template laden | **\<Node\> → local (Storage) → CT Templates / Content → Templates** |
| Features | **\<CT\> → Options → Features** |
| Start/Stop | **\<CT\> → Start / Shutdown / Stop** |
| Konsole | **\<CT\> → Console** |
| IP sehen | **\<CT\> → Summary** |
| Firewall | **Datacenter / Node / CT → Firewall** |

---

## 15. Anhang: CLI-Alternative & Windows-Docker

### A) CT per CLI auf dem Proxmox-Host (optional)

Wenn du die GUI nicht nutzen willst — IDs/Storage/Template anpassen:

```bash
CTID=120
STORAGE=local-lvm
BRIDGE=vmbr0
TEMPLATE=local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst   # pveam available / ls

pct create $CTID $TEMPLATE \
  --hostname tadolocal \
  --cores 2 \
  --memory 2048 \
  --swap 512 \
  --rootfs ${STORAGE}:16 \
  --net0 name=eth0,bridge=${BRIDGE},ip=dhcp \
  --unprivileged 0 \
  --features nesting=1,keyctl=1 \
  --onboot 1 \
  --start 1

pct enter $CTID
```

### B) Windows-Docker (gleicher Compose, **nicht** Einstieg)

1. Docker Desktop, Ordner `deploy/tadolocal`.
2. `.env` wie oben (Bridge muss vom Windows-Host erreichbar sein).
3. Oft kein echtes Host-Netz →  
   `docker compose -f docker-compose.yml -f docker-compose.bridge.yml up -d --build`
4. UI: `http://localhost:4407`
5. **Caveat:** mDNS/Bonjour über NAT oft problematisch. Pairing bevorzugt auf **Proxmox**.

---

## Kurz: Was du am Ende erledigt haben solltest

1. Privileged CT mit nesting/keyctl an `vmbr0` (oder deinem LAN).  
2. Spike-Dateien unter `/opt/tadolocal/deploy/tadolocal`.  
3. Docker + `docker compose up -d --build`.  
4. UI `:4407` → HomeKit pairen → Cloud-Auth.  
5. `curl …/zones` liefert Daten; PIN aus `.env` entfernt; Volume intakt.  
6. Kurz Go/No-Go notieren — **HA-Sync = Spike B**, nicht dieser Durchgang.
