# End‑to‑End Example: SheetFire from Zero to Data

This guide walks you from an empty directory to a fully configured SheetFire setup with example data in Firestore. It uses the provided scripts to deploy the backend, create a Google Sheet (and optional Form), and wire everything together.

What you’ll end up with:
- A deployed HTTPS endpoint (`adminAddDoc`) that writes to Firestore
- An `APP_SECRET` stored in Secret Manager used by both sides
- A new Google Sheet with the SheetFire Apps Script bound and configured
- Optional Google Form linked to the Sheet, with an on‑submit trigger to auto‑push to Firestore
- Example documents written to a Firestore collection

## Prerequisites
- Node.js 18+, npm
- Google Cloud SDK (`gcloud`) and Firebase CLI (`firebase`)
- Logged in to the CLIs you’ll use:
  - `gcloud auth login`
  - `gcloud auth application-default login` (optional but handy)
  - `firebase login`
  - `npx clasp login` (first time only; opens a browser)

## 1) Start from an empty folder and get the code

```bash
mkdir sheetfire-example && cd sheetfire-example
git clone https://github.com/openai-labs/SheetFire.git .
```

Alternatively, copy the repository contents into this folder by other means.

## 2) Deploy the backend (Cloud Functions v2)

You need a Firebase/GCP project with Firestore in Native mode. The SheetFire installer enables required APIs, stores `APP_SECRET` in Secret Manager, builds, and deploys the function.

```bash
# Pick a project ID you own and a secret you’ll reuse when bootstrapping the Sheet
export FIREBASE_PROJECT="<YOUR_PROJECT_ID>"
export REGION="us-central1"  # or another supported region
export APP_SECRET="<A_RANDOM_STRING>"

# Deploy the backend only; skip pushing Apps Script here
scripts/install.sh --project "$FIREBASE_PROJECT" --region "$REGION" --secret "$APP_SECRET" --skip-push
```

Verify the endpoint exists:

```bash
gcloud functions describe adminAddDoc \
  --region "$REGION" --gen2 --project "$FIREBASE_PROJECT" \
  --format='value(serviceConfig.uri)'
```

## 3) Bootstrap a new Sheet (and optional Form)

Use the bootstrap to create a brand‑new Sheet with the Apps Script from this repo bound to it. It sets the required script properties and can also create/link a Form and move everything into a Drive folder.

```bash
scripts/bootstrap-drive.sh \
  --project "$FIREBASE_PROJECT" \
  --region "$REGION" \
  --title "SheetFire Example" \
  --collection "exampleItems" \
  --secret "$APP_SECRET" \
  --with-form --form-title "SheetFire Example Form" \
  --folder "SheetFire Demo"
```

Notes:
- The script creates an instance workspace at `instances/sheetfire-example/` you can reuse for future `clasp` operations.
- First run may prompt for authorization in Google; accept the scopes for Drive, Sheets, Forms, and Apps Script.

Open the new assets quickly:

```bash
cd instances/sheetfire-example
npx clasp open  # opens the Sheet; you can also open the bound script
```

## 4) Push example data from the Sheet (manual mode)

In the Sheet, create a header row and a few example rows. Important: the column named `docId` defines the Firestore document ID; only columns to its RIGHT are included as fields.

Example data (paste into A1):

```
docId	name	qty	active
p-001	Pencils	12	true
p-002	Notebooks	5	true
p-003	Markers	0	false
```

Then run from the Sheet menu:
- Firestore → Push all rows (below header)

Result: three documents appear in the `exampleItems` collection with the IDs `p-001`, `p-002`, `p-003`.

## 5) Try the automatic Form → Sheet → Firestore flow (optional)

If you created a Form in step 3, open it and submit a response. The bound Apps Script installs an on‑submit trigger that reads the new row and posts a document with an auto‑generated ID to Firestore. By default, the “Timestamp” column is excluded from the payload.

Tip: Edit the Form to add fields you want; they will appear as columns in the linked response sheet automatically.

## 6) Verify in Firestore

Use the Firebase Console (Firestore Data) or the CLI to view the documents:

```bash
# Fetch the endpoint for ad‑hoc tests
ENDPOINT=$(gcloud functions describe adminAddDoc --region "$REGION" --gen2 --project "$FIREBASE_PROJECT" --format='value(serviceConfig.uri)')

# Quick POST example (sends one extra doc)
curl -sS -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "x-app-secret: $APP_SECRET" \
  -d '{"collection":"exampleItems","doc":{"name":"Erasers","qty":3,"active":true}}'
```

## Options and customization

- scripts/install.sh
  - `--project`, `--region`, `--collection`, `--secret`, `--skip-push`
  - Enables APIs, stores `APP_SECRET`, builds, deploys `adminAddDoc`, resolves the endpoint, optionally pushes the sample Apps Script project

- scripts/bootstrap-drive.sh
  - `--title` (required), `--project`, `--region`, `--collection`, `--secret`
  - Optional: `--with-form`, `--form-title`, `--folder`
  - Creates a new Sheet + bound script, sets script properties, optionally creates/links a Form, adds an on‑submit trigger, and moves files into a Drive folder

- apps-script/Code.js constants
  - `DOC_ID_FIELD_NAME` (default: `docId`)
  - `INCLUDE_ID_FIELD_IN_DOC` (default: `false`)

## Troubleshooting

- `clasp` prompts or fails: run `npx clasp login` and ensure the Apps Script API is enabled for your Google account.
- Function “Unauthorized”: ensure `x-app-secret` matches the secret configured in Secret Manager (`APP_SECRET`) and in the script properties.
- 403 “Permission denied”: confirm Cloud Run Invoker permissions exist for the function and you’re hitting the correct region.
- No documents show up: check the browser authorization prompts in the Sheet (Extensions → Apps Script) and the menu actions; open `View → Logs` for script errors.

## Clean‑up

- Delete or rename the Drive folder you created; remove the Sheet and Form from Drive.
- Remove the function with `firebase functions:delete adminAddDoc --region "$REGION" --project "$FIREBASE_PROJECT"`.
- Optionally delete the `APP_SECRET` secret in Secret Manager.

You now have a working end‑to‑end setup and example data in Firestore. Happy automating!

