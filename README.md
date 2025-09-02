# Sheetfire

Turn Google Forms/Sheets rows into Firestore documents — manually (selected/all rows) or automatically on form submit. Built with Google Apps Script and a tiny HTTPS backend (Cloud Functions/Cloud Run) that writes to Firestore.

## ✨ Features
- **Two push modes:** selected rows, or all rows below header
- **Auto push on submit:** stamps a unique `docId` and ships the new row
- **Header-driven mapping:** the column named by `DOC_ID_FIELD_NAME` supplies the Firestore doc ID; **only columns to its right** become document fields
- **Type coercion:** booleans and numbers are sent as native types (customizable)
- **Human-friendly summary:** per-run stats (sent/skipped/errors)

## How it works (high level)
1. A bound Apps Script reads rows from the active sheet
2. It builds a `{ doc, docId }` from the header row + row values
3. It POSTs to your backend endpoint which authenticates and writes to Firestore

```

Sheets/Forms → Apps Script → HTTPS endpoint → Firestore

```

---

## Quick start

### 1) Backend (Cloud Functions/Run)
Implement an HTTPS endpoint that validates a shared secret or IAM and writes to Firestore. A minimal Node sample is in [`server/index.js`](#serverindexjs). Deploy it and record its URL.

### 2) Apps Script (the bridge)
- Create/open your Google Sheet
- Open **Extensions → Apps Script** and paste the code from `src/Code.gs`
- Open **Project Settings → Script properties** and add:
  - `CF_ENDPOINT` — your deployed HTTPS URL
  - `COLLECTION`  — target Firestore collection (e.g. `imageDataTest`)
  - `APP_SECRET`  — random string; also set it as backend env var
- In **Editor**, add `appsscript.json` (from this repo) to lock scopes
- Reload the sheet: you’ll see a **Firestore** menu

### 3) (Optional) Google Forms auto-push
If the sheet is linked to a Form, Install the **On form submit** trigger (Edit → Current project’s triggers) pointing to `onFormSubmit`.

---

## Configuration
These script properties are required:

- `CF_ENDPOINT` (string)
- `COLLECTION` (string)
- `APP_SECRET` (string)

And these constants in `Code.gs`:
- `DOC_ID_FIELD_NAME` — header name for the doc id column (default: `docId`)
- `INCLUDE_ID_FIELD_IN_DOC` — also include the id as a field

---

## Security
You have two solid options — pick one:

1. **HMAC signature (simple & works with Cloud Run or Functions):**
   - The Apps Script signs the JSON payload with `APP_SECRET` (`x-signature` header)
   - Backend recomputes and compares (constant-time)

2. **Google IAM (Cloud Functions):**
   - Protect the function with **Require authentication**
   - Grant your Apps Script project’s service account the **Cloud Functions Invoker** role
   - Send `Authorization: Bearer ${ScriptApp.getOAuthToken()}`

> Avoid committing secrets. Use **Script properties** and backend **env vars**. Rotate any keys that have ever been shared publicly.

---

## Limitations & notes
- Firestore doc IDs must not contain `/`; avoid exotic characters
- Strings like `00123` will coerce to number `123` by default; customize coercion if you need leading zeros (see `coerce_`)
- Empty cells become `null`. If you’d rather **omit** empty fields, tweak `buildDocFromRow_`
- Header names with `.` are interpreted as nested fields by Firestore — sanitize or opt into nesting consciously

---

## Roadmap
- Read & Delete helpers (Sheets → Firestore and vice versa)
- Column-level type hints (e.g., `age:number`, `tags:json`, `createdAt:timestamp`)
- Batching with retries/backoff and `UrlFetchApp.fetchAll`
- Dry-run preview (sidebar) and field mapping UI

---

## Contributing
See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License
[MIT](LICENSE)

## Changelog

* 0.1.0 — Initial public release
