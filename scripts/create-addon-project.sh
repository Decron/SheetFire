#!/usr/bin/env bash
set -euo pipefail

# Create a new standalone Apps Script project for the Sheets Add-on
# using the current repo's apps-script sources and the add-on manifest.
#
# Usage:
#   scripts/create-addon-project.sh --title "SheetFire Add-on" [--name "SheetFire"] [--logo "https://.../logo.png"]

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
cd "$repo_root"

TITLE=""
ADDON_NAME="SheetFire"
ADDON_LOGO_URL="https://example.com/logo.png"

usage() {
  cat <<EOF
Usage: scripts/create-addon-project.sh --title <title> [--name <name>] [--logo <url>]

Creates a new standalone Apps Script project configured as a Sheets add-on and
pushes the code in apps-script/ with the add-on manifest.

Options:
  --title   Add-on project title (required)
  --name    Visible add-on name (default: SheetFire)
  --logo    Logo URL for marketplace config (default: placeholder)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) TITLE="$2"; shift 2;;
    --name) ADDON_NAME="$2"; shift 2;;
    --logo) ADDON_LOGO_URL="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1;;
  esac
done

if [[ -z "$TITLE" ]]; then echo "--title is required" >&2; exit 1; fi

command -v npx >/dev/null 2>&1 || { echo "Missing npx (npm)" >&2; exit 1; }

slug=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
inst_dir="$repo_root/instances/addon-$slug"
mkdir -p "$inst_dir"

echo "Preparing add-on manifest..."
ADDON_NAME="$ADDON_NAME" ADDON_LOGO_URL="$ADDON_LOGO_URL" node "$repo_root/scripts/switch-manifest.js" addon >/dev/null

echo "Creating standalone Apps Script project: $TITLE"
(
  cd "$inst_dir"
  cp -f "$repo_root/apps-script/Code.js" .
  cp -f "$repo_root/apps-script/appsscript.json" .
  # Include HTML files used by HtmlService (e.g., Sidebar.html)
  if [[ -f "$repo_root/apps-script/Sidebar.html" ]]; then
    cp -f "$repo_root/apps-script/Sidebar.html" .
  fi
  npx --yes clasp create --type standalone --title "$TITLE"
  npx --yes clasp push -f
)

echo
echo "Done. Project created in: $inst_dir"
echo "Open it with: cd $inst_dir && npx clasp open"
