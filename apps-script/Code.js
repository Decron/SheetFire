// ==== CONFIG ====
const CF_ENDPOINT = 'https://functionname.a.run.app';
const COLLECTION  = 'imageDataTest';
const APP_SECRET  = 'randomString';
const DOC_ID_FIELD_NAME = 'docId';
const INCLUDE_ID_FIELD_IN_DOC = false;
// ========================

/**
 * Push the current selection (treated as rows) to Firestore.
 * REQUIREMENTS:
 *  - Header row contains DOC_ID_FIELD_NAME (e.g., 'docID').
 *  - Only columns strictly to the RIGHT of that header become the document fields.
 *  - The value in DOC_ID_FIELD_NAME is used as the Firestore document ID; blank docIDs are skipped.
 */
function pushSelectedRowsToFirestore() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  const headerRow = 1;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

  // Find the docID column in headers
  const docIdColIndex1 = findDocIdColIndex_(headers);
  if (!docIdColIndex1) {
    ui.alert(`Header "${DOC_ID_FIELD_NAME}" not found in row ${headerRow}. Aborting.`);
    return;
  }

  const range = sheet.getActiveRange();
  const startRow = range.getRow();
  const numRows  = range.getNumRows();

  const summary = processRowsToFirestore_(sheet, headers, docIdColIndex1, startRow, numRows);
  ui.alert(formatSummary_(summary));
}

/**
 * Push ALL rows below header to Firestore using the same rules as pushSelectedRowsToFirestore.
 */
function pushAllRowsToFirestore() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  const headerRow = 1;
  const lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) {
    ui.alert('No data below the header.');
    return;
  }

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

  const docIdColIndex1 = findDocIdColIndex_(headers);
  if (!docIdColIndex1) {
    ui.alert(`Header "${DOC_ID_FIELD_NAME}" not found in row ${headerRow}. Aborting.`);
    return;
  }

  const startRow = headerRow + 1;
  const numRows  = lastRow - headerRow;

  const summary = processRowsToFirestore_(sheet, headers, docIdColIndex1, startRow, numRows);
  ui.alert(formatSummary_(summary));
}


// ---------------------- Helpers ----------------------

/**
 * Find 1-based index of the DOC_ID_FIELD_NAME column in the header array (case-sensitive).
 */
function findDocIdColIndex_(headers) {
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === DOC_ID_FIELD_NAME) {
      return i + 1; // 1-based
    }
  }
  return 0;
}

/**
 * Build {doc, docId} strictly from the docId column and columns to its right.
 * - docId is taken from the DOC_ID_FIELD_NAME column.
 * - Document fields = headers (docIdCol+1 .. last) mapped to row values (coerced).
 * - Optionally include docId as a field too (INCLUDE_ID_FIELD_IN_DOC).
 */
function buildDocFromRow_(headers, rowValues, docIdColIndex1) {
  const idx0 = docIdColIndex1 - 1;
  const rawId = rowValues[idx0];
  const docId = (rawId === '' || rawId === null) ? '' : String(rawId).trim();

  const doc = {};
  for (let c = docIdColIndex1; c < headers.length + 1; c++) {
    const header = headers[c - 1];
    if (!header) continue;
    doc[header] = coerce_(rowValues[c - 1]);
  }

  // Remove the docId header from the payload (we only want fields to the RIGHT)
  delete doc[DOC_ID_FIELD_NAME];

  if (INCLUDE_ID_FIELD_IN_DOC && docId) {
    doc[DOC_ID_FIELD_NAME] = docId;
  }

  return { doc, docId };
}

/**
 * Process a contiguous block of rows and push to Firestore.
 * Treats the active range as a row-selection only; columns come from the sheet:
 *  - docId from DOC_ID_FIELD_NAME column,
 *  - fields from columns to the right of that column (entire row, not just selected columns).
 */
function processRowsToFirestore_(sheet, headers, docIdColIndex1, startRow, numRows) {
  const lastCol = sheet.getLastColumn();

  // Read the FULL width of the sheet for the chosen rows, so we can always access docId + fields to the right
  const values = sheet.getRange(startRow, 1, numRows, lastCol).getValues();

  const summary = {
    attemptedRows: numRows,
    sent: 0,
    skippedNoId: 0,
    skippedErrors: 0,
    errors: []
  };

  for (let r = 0; r < values.length; r++) {
    try {
      const rowValues = values[r];
      const { doc, docId } = buildDocFromRow_(headers, rowValues, docIdColIndex1);

      if (!docId) {
        summary.skippedNoId++;
        continue; // skip rows with blank docID
      }

      writeDoc_(doc, docId);
      summary.sent++;
    } catch (e) {
      summary.skippedErrors++;
      summary.errors.push(`Row ${startRow + r}: ${e && e.message ? e.message : e}`);
    }
  }

  return summary;
}

/**
 * Writes a document to your HTTPS endpoint (Cloud Function / Cloud Run).
 */
function writeDoc_(doc, docId) {
  const res = UrlFetchApp.fetch(CF_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-app-secret': APP_SECRET },
    payload: JSON.stringify({ collection: COLLECTION, doc, docId }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code >= 300) throw new Error(`Cloud Function error ${code}: ${res.getContentText()}`);
}

/**
 * Basic type coercion so numbers/booleans aren’t sent as strings.
 */
function coerce_(v) {
  if (v === '' || v === null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s === 'true')  return true;
  if (s === 'false') return false;
  const n = Number(s);
  return isNaN(n) ? s : n;
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Firestore')
    .addItem('Push selected rows', 'pushSelectedRowsToFirestore')
    .addItem('Push all rows (below header)', 'pushAllRowsToFirestore')
    .addToUi();
}

/**
 * Nicely formats the push summary for the UI alert.
 */
function formatSummary_(s) {
  const lines = [
    `Attempted rows: ${s.attemptedRows}`,
    `Sent: ${s.sent}`,
    `Skipped (blank ${DOC_ID_FIELD_NAME}): ${s.skippedNoId}`,
    `Skipped due to errors: ${s.skippedErrors}`,
  ];

  if (s.errors && s.errors.length) {
    const maxShow = 10;
    const shown = s.errors.slice(0, maxShow);
    lines.push('', 'Errors:');
    shown.forEach(msg => lines.push(`• ${msg}`));
    const extra = s.errors.length - shown.length;
    if (extra > 0) lines.push(`(+${extra} more)`);
  }

  return `Firestore push summary\n\n` + lines.join('\n');
}


// AUTO: stamp yyyymmdd docID for the new response, then push ONLY that row to Firestore
function onFormSubmit(e) {
  const sheet = e.range.getSheet();
  const row   = e.range.getRow();

  // --- 1) Ensure docID column exists and write yyyymmdd for this new row ---
  const lastCol = sheet.getLastColumn();
  let headers   = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  let docCol = headers.indexOf(DOC_ID_FIELD_NAME) + 1; // 1-based
  if (docCol === 0) {
    // Add header at the end if missing
    docCol = lastCol + 1;
    sheet.getRange(1, docCol).setValue(DOC_ID_FIELD_NAME);
  }

  // Resolve Timestamp from event or sheet
  const tz = Session.getScriptTimeZone();
  let ts;
  if (e?.namedValues?.Timestamp?.[0]) {
    ts = new Date(e.namedValues.Timestamp[0]);
  } else {
    // Fallback: try to locate a timestamp column by common names, else now()
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const tsHeaderCandidates = ['Timestamp', 'Submitted at', 'Submission Time'];
    let tsCol = -1;
    for (const h of tsHeaderCandidates) {
      const idx = headers.indexOf(h);
      if (idx !== -1) { tsCol = idx + 1; break; }
    }
    ts = tsCol === -1 ? new Date() : new Date(sheet.getRange(row, tsCol).getValue());
  }

  const yyyymmdd = Utilities.formatDate(ts, tz, 'yyyyMMdd');
  sheet.getRange(row, docCol).setValue(Number(yyyymmdd));

  // Make sure the write is committed before we read the row back
  SpreadsheetApp.flush();

  // --- 2) Push ONLY this row to Firestore using your existing helpers ---
  const headerRow = 1;
  const lastColNow = sheet.getLastColumn();
  const hdrs = sheet.getRange(headerRow, 1, 1, lastColNow).getValues()[0];

  const docIdColIndex1 = findDocIdColIndex_(hdrs);
  if (!docIdColIndex1) {
    // Shouldn't happen since we just ensured the header, but guard anyway
    console.warn(`Header "${DOC_ID_FIELD_NAME}" not found; skipping push.`);
    return;
  }

  try {
    // Reuse your pipeline but for exactly one row
    const summary = processRowsToFirestore_(sheet, hdrs, docIdColIndex1, row, 1);
    // Optional: small toast for debugging (remove if not wanted)
    sheet.toast(`Firestore push: sent ${summary.sent}, skippedNoId ${summary.skippedNoId}, errors ${summary.skippedErrors}`, 'onFormSubmit');
  } catch (err) {
    console.error('Push latest row failed:', err);
  }
}
