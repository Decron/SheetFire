#!/usr/bin/env bash
set -euo pipefail

# Navigate to repository root
cd "$(dirname "$0")/.."

read -rp "Firebase project ID: " PROJECT_ID

if [[ -z "$PROJECT_ID" ]]; then
  echo "Project ID is required" >&2
  exit 1
fi

# Ensure required CLIs are available (mirrors install.sh style)
need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required CLI: $1" >&2
    return 1
  fi
}

need_cmd firebase || { echo "Install Firebase CLI: https://firebase.google.com/docs/cli"; exit 1; }
need_cmd gcloud   || { echo "Install gcloud SDK: https://cloud.google.com/sdk/docs/install"; exit 1; }

# Set secret in Firebase Functions
firebase functions:secrets:set APP_SECRET --project "$PROJECT_ID"

# Enable required APIs
gcloud services enable firestore.googleapis.com cloudfunctions.googleapis.com --project "$PROJECT_ID"

# Deploy the adminAddDoc function
firebase deploy --only functions:adminAddDoc --project "$PROJECT_ID"
