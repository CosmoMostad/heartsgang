/** First-boot setup for the game server: Node, Caddy for HTTPS, the service, and a deploy script. */
export function bootScript(opts: { bucket: string; domain: string; region: string }): string[] {
  const { bucket, domain, region } = opts;
  return [
    'set -euxo pipefail',
    'dnf install -y tar gzip xz libcap',
    // Node.js 22 LTS, ARM build.
    'NODE=v22.12.0',
    'curl -fsSL "https://nodejs.org/dist/$NODE/node-$NODE-linux-arm64.tar.xz" | tar -xJ -C /usr/local --strip-components=1',
    'node --version',
    // Caddy fetches and renews the Let\'s Encrypt certificate by itself.
    'curl -fsSL -o /tmp/caddy.tgz https://github.com/caddyserver/caddy/releases/download/v2.8.4/caddy_2.8.4_linux_arm64.tar.gz',
    'tar -xzf /tmp/caddy.tgz -C /usr/local/bin caddy',
    'setcap cap_net_bind_service=+ep /usr/local/bin/caddy',
    'id heartsgang || useradd --system --home-dir /opt/heartsgang --shell /sbin/nologin heartsgang',
    'id caddy || useradd --system --home-dir /var/lib/caddy --shell /sbin/nologin caddy',
    'mkdir -p /opt/heartsgang/releases /var/lib/heartsgang /etc/caddy /var/lib/caddy',
    'chown -R heartsgang:heartsgang /var/lib/heartsgang',
    'chown -R caddy:caddy /var/lib/caddy',
    `cat > /etc/caddy/Caddyfile <<'CADDY'
${domain} {
	encode zstd gzip
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy 127.0.0.1:3000
}
www.${domain} {
	redir https://${domain}{uri} permanent
}
CADDY`,
    `cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy (HTTPS for Hearts Gang)
After=network-online.target
Wants=network-online.target

[Service]
User=caddy
Group=caddy
Environment=XDG_DATA_HOME=/var/lib/caddy XDG_CONFIG_HOME=/var/lib/caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
Restart=always
AmbientCapabilities=CAP_NET_BIND_SERVICE
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT`,
    `cat > /etc/systemd/system/heartsgang.service <<'UNIT'
[Unit]
Description=Hearts Gang game server
After=network-online.target

[Service]
User=heartsgang
Group=heartsgang
Environment=PORT=3000 HOST=127.0.0.1 STATIC_DIR=/opt/heartsgang/current/web DATA_DIR=/var/lib/heartsgang NODE_ENV=production
EnvironmentFile=-/opt/heartsgang/current/env
ExecStart=/usr/local/bin/node /opt/heartsgang/current/server/index.js
Restart=always
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
UNIT`,
    `cat > /usr/local/bin/heartsgang-deploy <<'DEPLOY'
#!/bin/bash
# Usage: heartsgang-deploy [s3 key]   Installs a release and restarts the game server.
set -euo pipefail
KEY="\${1:-releases/latest.tgz}"
DIR="/opt/heartsgang/releases/$(date +%Y%m%d%H%M%S)"
mkdir -p "$DIR"
aws s3 cp --region ${region} "s3://${bucket}/$KEY" /tmp/heartsgang-release.tgz
tar -xzf /tmp/heartsgang-release.tgz -C "$DIR"
echo "HG_VERSION=$(cat "$DIR/VERSION" 2>/dev/null || echo unknown)" > "$DIR/env"
chown -R heartsgang:heartsgang "$DIR"
ln -sfn "$DIR" /opt/heartsgang/current
systemctl enable heartsgang >/dev/null 2>&1 || true
systemctl restart heartsgang
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health; then echo; echo "Deployed $KEY"; break; fi
  if [ "$i" = 30 ]; then echo "Health check failed"; journalctl -u heartsgang -n 50 --no-pager; exit 1; fi
  sleep 1
done
# Keep the five newest releases.
ls -1dt /opt/heartsgang/releases/* | tail -n +6 | xargs -r rm -rf
DEPLOY`,
    'chmod +x /usr/local/bin/heartsgang-deploy',
    'systemctl daemon-reload',
    'systemctl enable --now caddy',
    // If a release is already uploaded (a replaced instance), bring the game up straight away.
    `if aws s3 ls --region ${region} "s3://${bucket}/releases/latest.tgz"; then /usr/local/bin/heartsgang-deploy releases/latest.tgz || true; fi`,
  ];
}
