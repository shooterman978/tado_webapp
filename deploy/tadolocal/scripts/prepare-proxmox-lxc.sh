#!/usr/bin/env bash
# Prepare a Debian/Ubuntu LXC guest for TadoLocal via Docker Compose.
# Guest may be Debian 12 or 13 (or Ubuntu); only needs to run Docker — app is in the image.
#
# Run INSIDE the container as root (after CT create + feature flags on the host).
# Does not create the CT itself — see README / Spike-Anleitung for `pct create`.
#
# Usage:
#   sudo bash prepare-proxmox-lxc.sh
#   sudo bash prepare-proxmox-lxc.sh --check-only

set -euo pipefail

CHECK_ONLY=0
if [[ "${1:-}" == "--check-only" ]]; then
  CHECK_ONLY=1
fi

log() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

need_root() {
  [[ "$(id -u)" -eq 0 ]] || die "Bitte als root ausführen (sudo)."
}

detect_os() {
  [[ -f /etc/os-release ]] || die "/etc/os-release fehlt — nur Debian/Ubuntu LXC unterstützt."
  # shellcheck source=/dev/null
  . /etc/os-release
  case "${ID:-}" in
    debian|ubuntu) log "OS erkannt: ${PRETTY_NAME:-$ID}" ;;
    *) die "Unerwartetes OS '${ID:-unknown}'. Bitte Debian oder Ubuntu LXC nutzen." ;;
  esac
}

check_nesting_hints() {
  log "--- Feature-Hinweise (Proxmox-Host) ---"
  if [[ -d /sys/fs/cgroup ]]; then
    log "cgroup vorhanden."
  fi
  if ! grep -qw containers /proc/1/cgroup 2>/dev/null && [[ -f /.dockerenv ]]; then
    log "WARN: Scheint bereits in Docker zu laufen — Script ist für LXC-Gast gedacht."
  fi
  if [[ ! -e /dev/net/tun ]] && [[ ! -d /sys/module/tun ]]; then
    log "Hinweis: /dev/net/tun optional; für Docker-Bridge oft nicht kritisch."
  fi
  log "Auf dem Proxmox-Host vor dem Start sicherstellen (Weg A = Default):"
  log "  # Unprivileged CT + Nesting in der GUI (keyctl optional — auf PVE 9 oft fehlend = ok)"
  log "  pct set <CTID> --features nesting=1"
  log "  # optional falls Host keyctl noch kennt: nesting=1,keyctl=1"
  log "  # Weg B (privileged): Nesting in der UI oft ausgegraut — Features per pct set."
  log "  # Compose braucht user 0:0 oder chown Volume (siehe fix-db-permissions.sh)."
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    log "Docker bereits installiert: $(docker --version)"
  else
    log "Installiere Docker CE (offizielles Convenience-Script)…"
    apt-get update -y
    apt-get install -y --no-install-recommends ca-certificates curl gnupg
    curl -fsSL https://get.docker.com | sh
  fi

  if ! docker compose version >/dev/null 2>&1; then
    log "Installiere Docker Compose Plugin…"
    apt-get update -y
    apt-get install -y docker-compose-plugin || true
  fi

  systemctl enable --now docker
  docker --version
  docker compose version || die "docker compose Plugin fehlt — manuell nachinstallieren."
}

install_helpers() {
  apt-get update -y
  apt-get install -y --no-install-recommends curl ca-certificates git
}

main() {
  need_root
  detect_os
  check_nesting_hints

  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    log "Check-only — keine Installation."
    command -v docker >/dev/null && docker --version || log "Docker: nicht installiert"
    exit 0
  fi

  install_helpers
  install_docker
  log ""
  log "Fertig. Nächste Schritte:"
  log "  1) Repo/Spike-Ordner nach /opt/tadolocal (o.Ä.) kopieren"
  log "  2) cp .env.example .env  &&  Bridge-IP + PIN eintragen"
  log "  3) docker compose up -d --build"
  log "  4) UI öffnen: http://<LXC-IP>:4407"
}

main "$@"
