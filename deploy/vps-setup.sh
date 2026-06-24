#!/usr/bin/env bash
# =============================================================================
#  DAX Live Scorecard — VPS Deployment Script
#  Hostinger VPS (Ubuntu 24.04 LTS)
#
#  Ausführung: Auf dem VPS als root oder sudo-user ausführen:
#    bash deploy/vps-setup.sh
#
#  Annahmen:
#    - Ubuntu 24.04 LTS (frisch)
#    - SSH-Zugang mit sudo-Rechten
#    - Domain scorecard.example.com zeigt auf VPS-IP
# =============================================================================
set -euo pipefail

# ─── Variablen (anpassen!) ───────────────────────────────────────────────────
DOMAIN="scorecard.example.com"
APP_DIR="/var/www/dax-scorecard"
APP_PORT=4173
NODE_LTS_MAJOR="22"
REPO_URL="https://github.com/OLAFMESSERSCHMIDT/dax-live-scorecard.git"
LOG_DIR="/var/log/dax-scorecard"

# ─── Farbcodes ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; }

# ─── 1. System aktualisieren ─────────────────────────────────────────────────
echo "=== 1/7 System aktualisieren ==="
apt update && apt upgrade -y
apt install -y curl git nginx ufw certbot python3-certbot-nginx

# ─── 2. Node.js via NVM installieren ─────────────────────────────────────────
echo "=== 2/7 Node.js installieren ==="
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
fi
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

if ! command -v node &> /dev/null; then
  nvm install "$NODE_LTS_MAJOR"
  nvm alias default "$NODE_LTS_MAJOR"
fi
log "Node.js $(node -v), npm $(npm -v)"

# ─── 3. PM2 installieren ─────────────────────────────────────────────────────
echo "=== 3/7 PM2 installieren ==="
npm install -g pm2
log "PM2 $(pm2 --version) installiert"

# ─── 4. Applikation deployen ─────────────────────────────────────────────────
echo "=== 4/7 Applikation deployen ==="
mkdir -p "$APP_DIR"
mkdir -p "$LOG_DIR"

if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git pull origin main
  log "Repository aktualisiert"
else
  git clone "$REPO_URL" "$APP_DIR"
  log "Repository geklont nach $APP_DIR"
fi

# ─── 5. Nginx Reverse Proxy konfigurieren ─────────────────────────────────────
echo "=== 5/7 Nginx konfigurieren ==="
NGINX_CONF="/etc/nginx/sites-available/dax-scorecard.conf"
NGINX_LINK="/etc/nginx/sites-enabled/dax-scorecard.conf"

# Temporäre HTTP-only Config für Certbot (SSL kommt nach Zertifikats-Erstellung)
cat > "$NGINX_CONF" << NGINX_HTTP
upstream dax_scorecard {
    server 127.0.0.1:${APP_PORT};
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /api/ {
        proxy_pass http://dax_scorecard;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
    }

    location / {
        proxy_pass http://dax_scorecard;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    gzip on;
    gzip_types application/json text/css text/javascript;
    gzip_min_length 256;
}
NGINX_HTTP

ln -sf "$NGINX_CONF" "$NGINX_LINK"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
log "Nginx konfiguriert für $DOMAIN (HTTP)"

# ─── 6. Firewall ──────────────────────────────────────────────────────────────
echo "=== 6/7 Firewall konfigurieren ==="
ufw --force reset
ufw allow ssh
ufw allow http
ufw allow https
ufw --force enable
log "UFW aktiviert: SSH, HTTP, HTTPS"

# ─── 7. PM2 Start + SSL ───────────────────────────────────────────────────────
echo "=== 7/7 PM2 + SSL ==="
cd "$APP_DIR"
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u "$(whoami)" --hp "$HOME" 2>/dev/null || true
log "PM2 startup konfiguriert"
log "PM2 gestartet — App läuft auf Port $APP_PORT"

# Warten bis App erreichbar ist
sleep 3
if curl -s "http://127.0.0.1:${APP_PORT}/api/health" | grep -q '"ok":true'; then
  log "Health-Check erfolgreich"
else
  warn "Health-Check fehlgeschlagen — pm2 logs prüfen"
fi

# SSL via Certbot
echo ""
warn "SSL-Zertifikat einrichten? (erfordert DNS-Auflösung von $DOMAIN)"
read -p "Jetzt Certbot ausführen? [j/N]: " RUN_CERTBOT
if [[ "$RUN_CERTBOT" =~ ^[Jj]$ ]]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
  log "SSL-Zertifikat installiert — HTTPS aktiv"
else
  warn "SSL übersprungen — später mit: certbot --nginx -d $DOMAIN"
fi

echo ""
echo "══════════════════════════════════════════════════════════"
log "Deployment abgeschlossen!"
echo "  URL:     https://${DOMAIN}"
echo "  Health:  https://${DOMAIN}/api/health"
echo "  Logs:    pm2 logs dax-scorecard"
echo "  Status:  pm2 status"
echo "  Nginx:   systemctl status nginx"
echo "══════════════════════════════════════════════════════════"
