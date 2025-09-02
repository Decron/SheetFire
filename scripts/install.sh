#!/usr/bin/env bash
set -euo pipefail

# SheetFire installer
# - Checks required CLIs (firebase, gcloud, node+npx)
# - Enables required Google APIs
# - Sets/updates APP_SECRET in Secret Manager
# - Builds and deploys Cloud Function: adminAddDoc
# - Pushes Apps Script via clasp
# - Sets Apps Script properties (CF_ENDPOINT, COLLECTION, APP_SECRET)

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
cd "$repo_root"

# Defaults (override via env or flags)
PROJECT_ID="${FIREBASE_PROJECT:-}"
REGION="${REGION:-us-central1}"
COLLECTION="${COLLECTION:-imageDataTest}"
APP_SECRET="${APP_SECRET:-}"

usage() {
  cat <<EOF
Usage: scripts/install.sh [options]

Options:
  -p, --project <id>      Firebase/GCP project ID (or set FIREBASE_PROJECT)
  -r, --region <region>   Cloud Functions region (default: ${REGION})
  -c, --collection <name> Firestore collection (default: ${COLLECTION})
  -s, --secret <value>    Shared app secret (or set APP_SECRET)
  --skip-push             Skip clasp push (Apps Script)
  -h, --help              Show this help

Notes:
  - Re-running is safe: APIs remain enabled, secret gets a new version, function redeploys,
    Apps Script re-pushes, and properties are overwritten.
EOF
}

SKIP_PUSH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--project) PROJECT_ID="$2"; shift 2;;
    -r|--region) REGION="$2"; shift 2;;
    -c|--collection) COLLECTION="$2"; shift 2;;
    -s|--secret) APP_SECRET="$2"; shift 2;;
    --skip-push) SKIP_PUSH=true; shift 1;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1;;
  esac
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required CLI: $1" >&2
    return 1
  fi
}

echo "Checking required CLIs..."
need_cmd firebase || { echo "Install Firebase CLI: https://firebase.google.com/docs/cli"; exit 1; }
need_cmd gcloud   || { echo "Install gcloud SDK: https://cloud.google.com/sdk/docs/install"; exit 1; }
need_cmd node     || { echo "Install Node.js 18+"; exit 1; }
need_cmd npm      || { echo "Install npm"; exit 1; }
need_cmd npx      || { echo "Install npm (for npx)"; exit 1; }

if [[ -z "$PROJECT_ID" ]]; then
  read -rp "Firebase project ID: " PROJECT_ID
fi
if [[ -z "$PROJECT_ID" ]]; then
  echo "Project ID is required" >&2
  exit 1
fi

if [[ -z "$APP_SECRET" ]]; then
  echo "Enter a shared secret used by Apps Script and the backend."
  echo "Re-use the same value on subsequent runs to keep them in sync."
  read -r -s -p "APP_SECRET: " APP_SECRET
  echo ""
fi
if [[ -z "$APP_SECRET" ]]; then
  echo "APP_SECRET is required" >&2
  exit 1
fi

echo "\n1) Enabling required Google APIs..."
gcloud services enable \
  firestore.googleapis.com \
  cloudfunctions.googleapis.com \
  secretmanager.googleapis.com \
  --project "$PROJECT_ID" >/dev/null

echo "\n2) Creating/updating APP_SECRET in Secret Manager..."
if ! gcloud secrets describe APP_SECRET --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create APP_SECRET \
    --replication-policy=automatic \
    --project "$PROJECT_ID" >/dev/null
fi
# Add a new secret version with the provided value
printf %s "$APP_SECRET" | gcloud secrets versions add APP_SECRET \
  --project "$PROJECT_ID" \
  --data-file=- >/dev/null

echo "\n3) Building and deploying Cloud Function (adminAddDoc)..."
(
  cd "$repo_root/functions"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
  npm run build
)

firebase deploy --only functions:adminAddDoc --project "$PROJECT_ID"

echo "\n4) Resolving Cloud Function endpoint..."
CF_ENDPOINT=$(gcloud functions describe adminAddDoc \
  --region "$REGION" \
  --gen2 \
  --project "$PROJECT_ID" \
  --format='value(serviceConfig.uri)')

if [[ -z "$CF_ENDPOINT" ]]; then
  echo "Failed to resolve function endpoint. Check deployment and region ($REGION)." >&2
  exit 1
fi
echo "Endpoint: $CF_ENDPOINT"

if [[ "$SKIP_PUSH" == false ]]; then
  echo "\n5) Pushing Apps Script (clasp push)..."
  (
    cd "$repo_root/apps-script"
    # Force push to avoid interactive prompt
    npx --yes clasp push -f
  )
else
  echo "\n5) Skipping Apps Script push (per flag)."
fi

echo "\n6) Setting Apps Script properties via clasp run..."
node "$repo_root/scripts/set-script-props.js" "$CF_ENDPOINT" "$COLLECTION" "$APP_SECRET"

cat <<EOF

Done.

- Project:     $PROJECT_ID
- Region:      $REGION
- Endpoint:    $CF_ENDPOINT
- Collection:  $COLLECTION

EOF

