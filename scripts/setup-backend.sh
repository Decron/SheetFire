#!/usr/bin/env bash
set -euo pipefail

# Navigate to repository root
cd "$(dirname "$0")/.."

read -rp "Firebase project ID: " PROJECT_ID

if [[ -z "$PROJECT_ID" ]]; then
  echo "Project ID is required" >&2
  exit 1
fi

# Set secret in Firebase Functions
firebase functions:secrets:set APP_SECRET --project "$PROJECT_ID"

# Enable required APIs
gcloud services enable firestore.googleapis.com cloudfunctions.googleapis.com --project "$PROJECT_ID"

# Deploy the adminAddDoc function
firebase deploy --config functions/firebase.json --only functions:adminAddDoc --project "$PROJECT_ID"
