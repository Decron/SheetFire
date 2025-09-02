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
