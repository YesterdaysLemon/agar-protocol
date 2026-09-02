#!/usr/bin/env bash
set -Eeuo pipefail

# Idempotently register and perform the first deployment of Agar Protocol on
# the existing shared Deploy Manager host. Run as root through bootstrap-vps.ps1.

APP_ID="agar"
APP_HOST="agar.alirezaafshan.com"
APP_REPO="YesterdaysLemon/agar-protocol"
APP_REPO_URL="https://github.com/${APP_REPO}.git"
APP_BRANCH="main"
APP_ROOT="/opt/agar-protocol"
APP_REPO_DIR="${APP_ROOT}/app"
APP_PORT="3080"
CANDIDATE_PORT="3081"
CONTAINER_PORT="8080"
HEALTH_PATH="/healthz"
REPO_USER="codex"
OPERATOR_USER="ali"

APPS_FILE="/etc/deploy-manager/apps.json"
APP_ENV_FILE="/etc/deploy-manager/apps/${APP_ID}.env"
MANAGER_ENV_FILE="/etc/deploy-manager/deploy-manager.env"
CADDY_FILE="/etc/caddy/Caddyfile"
DEPLOY_RUNNER="/usr/local/sbin/deploy-app-run"
SECRET_EXPORT="/home/${OPERATOR_USER}/.agar-protocol-deploy-secret"

if [[ "${EUID}" -ne 0 ]]; then
  echo "bootstrap-vps: run as root (bootstrap-vps.ps1 invokes sudo for you)" >&2
  exit 77
fi

for command in caddy curl git openssl python3 ss systemctl; do
  command -v "${command}" >/dev/null 2>&1 || {
    echo "bootstrap-vps: missing required command: ${command}" >&2
    exit 69
  }
done

for path in "${APPS_FILE}" "${MANAGER_ENV_FILE}" "${CADDY_FILE}" "${DEPLOY_RUNNER}"; do
  [[ -e "${path}" ]] || {
    echo "bootstrap-vps: required Deploy Manager path is missing: ${path}" >&2
    exit 66
  }
done

id "${REPO_USER}" >/dev/null 2>&1 || {
  echo "bootstrap-vps: repository user does not exist: ${REPO_USER}" >&2
  exit 67
}
id "${OPERATOR_USER}" >/dev/null 2>&1 || {
  echo "bootstrap-vps: operator user does not exist: ${OPERATOR_USER}" >&2
  exit 67
}

if [[ ! -e "${APP_ENV_FILE}" ]]; then
  for port in "${APP_PORT}" "${CANDIDATE_PORT}"; do
    if ss -H -ltn | awk '{print $4}' | grep -Eq "(^|:)${port}$"; then
      echo "bootstrap-vps: refusing occupied port ${port}" >&2
      exit 73
    fi
  done
fi

stage_dir="$(mktemp -d)"
backup_dir="/root/agar-protocol-bootstrap-backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${backup_dir}"
cp -a "${APPS_FILE}" "${backup_dir}/apps.json"
cp -a "${MANAGER_ENV_FILE}" "${backup_dir}/deploy-manager.env"
cp -a "${CADDY_FILE}" "${backup_dir}/Caddyfile"
if [[ -e "${APP_ENV_FILE}" ]]; then
  cp -a "${APP_ENV_FILE}" "${backup_dir}/agar.env"
  had_app_env=1
else
  had_app_env=0
fi

committed=0
rollback() {
  local code=$?
  trap - EXIT HUP INT TERM
  rm -rf "${stage_dir}"
  if [[ "${committed}" -eq 0 ]]; then
    echo "bootstrap-vps: restoring control-plane files from ${backup_dir}" >&2
    cp -a "${backup_dir}/apps.json" "${APPS_FILE}"
    cp -a "${backup_dir}/deploy-manager.env" "${MANAGER_ENV_FILE}"
    cp -a "${backup_dir}/Caddyfile" "${CADDY_FILE}"
    if [[ "${had_app_env}" -eq 1 ]]; then
      cp -a "${backup_dir}/agar.env" "${APP_ENV_FILE}"
    else
      rm -f "${APP_ENV_FILE}"
    fi
    systemctl restart deploy-manager >/dev/null 2>&1 || true
    systemctl reload caddy >/dev/null 2>&1 || true
  fi
  exit "${code}"
}
trap rollback EXIT HUP INT TERM

install -d -o "${REPO_USER}" -g "${REPO_USER}" -m 0755 "${APP_ROOT}"
if [[ -d "${APP_REPO_DIR}/.git" ]]; then
  actual_origin="$(sudo -u "${REPO_USER}" -H git -C "${APP_REPO_DIR}" remote get-url origin)"
  [[ "${actual_origin}" == "${APP_REPO_URL}" ]] || {
    echo "bootstrap-vps: existing checkout has unexpected origin: ${actual_origin}" >&2
    exit 65
  }
elif [[ -e "${APP_REPO_DIR}" ]]; then
  echo "bootstrap-vps: refusing non-git path: ${APP_REPO_DIR}" >&2
  exit 65
else
  sudo -u "${REPO_USER}" -H git clone --branch "${APP_BRANCH}" --single-branch \
    "${APP_REPO_URL}" "${APP_REPO_DIR}"
fi

sudo -u "${REPO_USER}" -H git -C "${APP_REPO_DIR}" fetch origin "${APP_BRANCH}"
sudo -u "${REPO_USER}" -H git -C "${APP_REPO_DIR}" checkout "${APP_BRANCH}"
sudo -u "${REPO_USER}" -H git -C "${APP_REPO_DIR}" reset --hard "origin/${APP_BRANCH}"
deploy_sha="$(sudo -u "${REPO_USER}" -H git -C "${APP_REPO_DIR}" rev-parse HEAD)"

cp "${APPS_FILE}" "${stage_dir}/apps.json"
APPS_FILE="${stage_dir}/apps.json" python3 - <<'PY'
import json
import os
from pathlib import Path

path = Path(os.environ["APPS_FILE"])
document = json.loads(path.read_text(encoding="utf-8"))
apps = document.setdefault("apps", {})
expected = {
    "repo": "YesterdaysLemon/agar-protocol",
    "branch": "main",
    "event": "push",
    "secretEnv": "AGAR_DEPLOY_WEBHOOK_SECRET",
}
existing = apps.get("agar")
if existing is not None and existing != expected:
    raise SystemExit(f"bootstrap-vps: existing agar allowlist entry differs: {existing!r}")
apps["agar"] = expected
path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
PY
python3 -m json.tool "${stage_dir}/apps.json" >/dev/null

cat >"${stage_dir}/agar.env" <<EOF
APP_ID=${APP_ID}
REPO_DIR=${APP_REPO_DIR}
REPO_USER=${REPO_USER}
BRANCH=${APP_BRANCH}

IMAGE_NAME=agar-protocol
CONTAINER_NAME=agar-protocol
CANDIDATE_CONTAINER_NAME=agar-protocol-candidate

APP_PORT=${APP_PORT}
CANDIDATE_APP_PORT=${CANDIDATE_PORT}
CONTAINER_PORT=${CONTAINER_PORT}
HEALTH_PATH=${HEALTH_PATH}
HEALTH_ATTEMPTS=60
HEALTH_SLEEP_SECONDS=1

LOG_FILE=/var/log/deploy-manager/agar.log
EOF

cp "${MANAGER_ENV_FILE}" "${stage_dir}/deploy-manager.env"
deploy_secret="$(awk -F= '$1 == "AGAR_DEPLOY_WEBHOOK_SECRET" { print substr($0, index($0, "=") + 1) }' "${stage_dir}/deploy-manager.env" | tail -n 1)"
if [[ -z "${deploy_secret}" ]]; then
  deploy_secret="$(openssl rand -hex 32)"
  printf '\nAGAR_DEPLOY_WEBHOOK_SECRET=%s\n' "${deploy_secret}" >>"${stage_dir}/deploy-manager.env"
fi
if [[ "${#deploy_secret}" -lt 32 ]]; then
  echo "bootstrap-vps: existing Agar webhook secret is unexpectedly short" >&2
  exit 65
fi

cp "${CADDY_FILE}" "${stage_dir}/Caddyfile"
if grep -Fq "${APP_HOST} {" "${stage_dir}/Caddyfile"; then
  grep -Fq "reverse_proxy 127.0.0.1:${APP_PORT}" "${stage_dir}/Caddyfile" || {
    echo "bootstrap-vps: existing ${APP_HOST} route does not target ${APP_PORT}" >&2
    exit 65
  }
else
  cat >>"${stage_dir}/Caddyfile" <<EOF

# BEGIN AGAR PROTOCOL
${APP_HOST} {
	reverse_proxy 127.0.0.1:${APP_PORT}
}
# END AGAR PROTOCOL
EOF
fi
caddy validate --config "${stage_dir}/Caddyfile" --adapter caddyfile >/dev/null

install -o root -g root -m 0644 "${stage_dir}/apps.json" "${APPS_FILE}"
install -o root -g root -m 0644 "${stage_dir}/agar.env" "${APP_ENV_FILE}"
install -o root -g root -m "$(stat -c '%a' "${MANAGER_ENV_FILE}")" \
  "${stage_dir}/deploy-manager.env" "${MANAGER_ENV_FILE}"
install -o root -g root -m "$(stat -c '%a' "${CADDY_FILE}")" \
  "${stage_dir}/Caddyfile" "${CADDY_FILE}"

systemctl restart deploy-manager
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:9019/healthz >/dev/null
systemctl reload caddy

"${DEPLOY_RUNNER}" "${APP_ID}" "${deploy_sha}"
curl --fail --silent --show-error --max-time 5 \
  "http://127.0.0.1:${APP_PORT}${HEALTH_PATH}" >/dev/null

printf '%s\n' "${deploy_secret}" >"${stage_dir}/deploy-secret"
install -o "${OPERATOR_USER}" -g "${OPERATOR_USER}" -m 0600 \
  "${stage_dir}/deploy-secret" "${SECRET_EXPORT}"

committed=1
rm -rf "${stage_dir}"
trap - EXIT HUP INT TERM

echo "BOOTSTRAP_OK app=${APP_ID} sha=${deploy_sha} port=${APP_PORT} backup=${backup_dir}"
