#!/usr/bin/env bash
set -euo pipefail

# Bootstrap: create a Google Sheet (and optional Form) wired to your Firebase instance.
# - Creates a new container-bound Apps Script project attached to a new Sheet
# - Pushes the repo's Apps Script code
# - Sets script properties (CF_ENDPOINT, COLLECTION, APP_SECRET)
# - Optionally creates a Form, links it to the Sheet, and installs a form-submit trigger
# - Optionally moves the Sheet/Form into a Drive folder
#
# Requirements:
# - Logged into Firebase CLI and gcloud
# - Logged into clasp (npx clasp login)
# - APIs: Cloud Functions v2 deployed (function: adminAddDoc), Apps Script API enabled for your account

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
cd "$repo_root"

PROJECT_ID="${FIREBASE_PROJECT:-}"
REGION="${REGION:-us-central1}"
COLLECTION="${COLLECTION:-imageDataTest}"
APP_SECRET="${APP_SECRET:-}"
TITLE=""
FOLDER_NAME=""
WITH_FORM=false
FORM_TITLE=""

usage() {
  cat <<EOF
Usage: scripts/bootstrap-drive.sh [options]

Creates a new Google Sheet bound to Apps Script (from apps-script/) and configures it
to push to your Firebase function. Optionally creates a Form and links it to the Sheet.

Options:
  -p, --project <id>        Firebase/GCP project ID
  -r, --region <region>     Cloud Functions region (default: ${REGION})
  -c, --collection <name>   Firestore collection (default: ${COLLECTION})
  -s, --secret <value>      Shared app secret (or set APP_SECRET)
  -t, --title <name>        Title for the new Google Sheet (required)
  -f, --folder <name>       Drive folder to move the Sheet/Form into (optional)
  --with-form               Also create and link a new Google Form
  --form-title <name>       Title for the new Form (optional; defaults to "<title> Form")
  -h, --help                Show this help

Examples:
  scripts/bootstrap-drive.sh -p my-proj -t "Inventory Sheet" --with-form -f "Ops/Inventory"
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--project) PROJECT_ID="$2"; shift 2;;
    -r|--region) REGION="$2"; shift 2;;
    -c|--collection) COLLECTION="$2"; shift 2;;
    -s|--secret) APP_SECRET="$2"; shift 2;;
    -t|--title) TITLE="$2"; shift 2;;
    -f|--folder) FOLDER_NAME="$2"; shift 2;;
    --with-form) WITH_FORM=true; shift 1;;
    --form-title) FORM_TITLE="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1;;
  esac
done

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing required CLI: $1" >&2; exit 1; }; }

echo "Checking required CLIs..."
need_cmd gcloud
need_cmd node
need_cmd npm
need_cmd npx

if [[ -z "$PROJECT_ID" ]]; then
  read -rp "Firebase project ID: " PROJECT_ID
fi
if [[ -z "$PROJECT_ID" ]]; then echo "Project ID is required" >&2; exit 1; fi

if [[ -z "$APP_SECRET" ]]; then
  echo "Enter the shared APP_SECRET (must match your backend)."
  read -r -s -p "APP_SECRET: " APP_SECRET; echo
fi
if [[ -z "$APP_SECRET" ]]; then echo "APP_SECRET is required" >&2; exit 1; fi

if [[ -z "$TITLE" ]]; then echo "--title is required" >&2; exit 1; fi
if [[ -z "$FORM_TITLE" && "$WITH_FORM" == true ]]; then FORM_TITLE="$TITLE Form"; fi

echo "Resolving Cloud Function endpoint..."
CF_ENDPOINT=$(gcloud functions describe adminAddDoc \
  --region "$REGION" --gen2 --project "$PROJECT_ID" \
  --format='value(serviceConfig.uri)')

if [[ -z "$CF_ENDPOINT" ]]; then
  echo "Could not resolve adminAddDoc endpoint; ensure it is deployed (try scripts/install.sh)." >&2
  exit 1
fi

# Prepare a persistent instance directory so future clasp ops are easy
slug=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
instance_dir="$repo_root/instances/$slug"
mkdir -p "$instance_dir"

echo "Creating new Sheet + bound Apps Script via clasp..."
(
  cd "$instance_dir"
  # Seed with our Apps Script sources
  cp -f "$repo_root/apps-script/Code.js" "$repo_root/apps-script/appsscript.json" .
  # Include HtmlService templates (e.g., Sidebar)
  if [[ -f "$repo_root/apps-script/Sidebar.html" ]]; then
    cp -f "$repo_root/apps-script/Sidebar.html" .
  fi
  # Create a container-bound project attached to a new Sheet
  npx --yes clasp create --type sheets --title "$TITLE" >/tmp/clasp_create_$$.log 2>&1 || {
    echo "clasp create failed. Check authentication with: npx clasp login" >&2
    cat /tmp/clasp_create_$$.log >&2 || true
    exit 1
  }
  # Push our code
  npx --yes clasp push -f
  # Configure script properties for backend integration
  npx --yes clasp run setProperties --params "[{\"endpoint\":\"$CF_ENDPOINT\",\"collection\":\"$COLLECTION\",\"secret\":\"$APP_SECRET\"}]"

  # Optionally set up folder + form + trigger in one shot
  if [[ -n "$FOLDER_NAME" || "$WITH_FORM" == true ]]; then
    params='{'
    first=true
    if [[ -n "$FOLDER_NAME" ]]; then
      params+="\"folderName\":\"${FOLDER_NAME//"/\"}\""
      first=false
    fi
    if [[ "$WITH_FORM" == true ]]; then
      [[ "$first" == false ]] && params+="," || true
      params+="\"formTitle\":\"${FORM_TITLE//"/\"}\""
    fi
    params+="}"
    echo "Running bootstrapDrive with params: $params"
    npx --yes clasp run bootstrapDrive --params "[$params]"
  fi

  echo
  echo "All set! To open the new Sheet and script, run:"
  echo "  cd $instance_dir && npx clasp open"
  echo
  echo "You can re-push updates for this instance from: $instance_dir"
)

cat <<EOF

Summary
- Project:     $PROJECT_ID
- Region:      $REGION
- Endpoint:    $CF_ENDPOINT
- Collection:  $COLLECTION
- Sheet title: $TITLE
- Folder:      ${FOLDER_NAME:-(none)}
- With form:   $WITH_FORM

EOF
