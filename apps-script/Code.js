// ==== CONFIG (per-sheet) ====
// Configuration is persisted in Document Properties (per spreadsheet).
// For backwards compatibility, Script Properties are used as fallback for
// CF_ENDPOINT and COLLECTION only. APP_SECRET is NOT persisted for security.

/** Cached session secret for a single invocation (not persisted). */
let __SESSION_APP_SECRET = null;

/**
 * Read effective configuration with precedence:
 * 1) Document Properties (per sheet)
 * 2) Script Properties (legacy fallback for CF_ENDPOINT, COLLECTION)
 * 3) Defaults
 * Note: APP_SECRET is never read from Document Properties; optional fallback from
 * Script Properties is supported for legacy projects but not written by this code.
 */
function getConfig_() {
  const docProps = PropertiesService.getDocumentProperties();

  const CF_ENDPOINT = (docProps.getProperty('CF_ENDPOINT')
    || 'https://functionname.a.run.app').trim();
  const COLLECTION = (docProps.getProperty('COLLECTION')
    || 'imageDataTest').trim();

  const DOC_ID_FIELD_NAME = (docProps.getProperty('DOC_ID_FIELD_NAME') || 'docId').trim();

  // Stored as string 'true' | 'false'
  const INCLUDE_ID_FIELD_IN_DOC = String(docProps.getProperty('INCLUDE_ID_FIELD_IN_DOC') || 'false') === 'true';

  // APP_SECRET is not persisted; no fallback store in Add-on context
  return { CF_ENDPOINT, COLLECTION, DOC_ID_FIELD_NAME, INCLUDE_ID_FIELD_IN_DOC };
}

/** Persist non-secret config values into Document Properties. */
function saveDocumentConfig(opts) {
  const docProps = PropertiesService.getDocumentProperties();
  const updates = {};
  if (opts.CF_ENDPOINT != null) updates.CF_ENDPOINT = String(opts.CF_ENDPOINT).trim();
  if (opts.COLLECTION != null) updates.COLLECTION = String(opts.COLLECTION).trim();
  if (opts.DOC_ID_FIELD_NAME != null) updates.DOC_ID_FIELD_NAME = String(opts.DOC_ID_FIELD_NAME).trim();
  if (opts.INCLUDE_ID_FIELD_IN_DOC != null) updates.INCLUDE_ID_FIELD_IN_DOC = String(!!opts.INCLUDE_ID_FIELD_IN_DOC);
  docProps.setProperties(updates, true);
  return { ok: true, updated: Object.keys(updates) };
}

/** Load non-secret config values from Document Properties with defaults. */
function loadDocumentConfig() {
  const cfg = getConfig_();
  // Do not return APP_SECRET (not persisted). Caller should provide it interactively.
  return {
    CF_ENDPOINT: cfg.CF_ENDPOINT,
    COLLECTION: cfg.COLLECTION,
    DOC_ID_FIELD_NAME: cfg.DOC_ID_FIELD_NAME,
    INCLUDE_ID_FIELD_IN_DOC: cfg.INCLUDE_ID_FIELD_IN_DOC,
  };
}

/** Set the in-session APP_SECRET (not persisted). */
function setSessionSecret_(secret) {
  __SESSION_APP_SECRET = secret ? String(secret) : null;
}

/** Get the in-session APP_SECRET or legacy fallback. */
function getSessionSecret_() {
  if (__SESSION_APP_SECRET && typeof __SESSION_APP_SECRET === 'string') return __SESSION_APP_SECRET;
  return '';
}
// ======================================

/**
 * Set per-sheet properties (CF_ENDPOINT, COLLECTION, DOC_ID_FIELD_NAME, INCLUDE_ID_FIELD_IN_DOC).
 * Note: APP_SECRET is intentionally not persisted.
 * Intended for use via clasp run or the Apps Script API against this spreadsheet.
 */
function setProperties(opts) {
  saveDocumentConfig({
    CF_ENDPOINT: opts.endpoint,
    COLLECTION: opts.collection,
    DOC_ID_FIELD_NAME: opts.docIdFieldName,
    INCLUDE_ID_FIELD_IN_DOC: opts.includeIdField === true,
  });
}

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
  const cfg = getConfig_();

  const headerRow = 1;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

  // Find the docID column in headers
  const docIdColIndex1 = findDocIdColIndex_(headers);
  if (!docIdColIndex1) {
    ui.alert(`Header "${cfg.DOC_ID_FIELD_NAME}" not found in row ${headerRow}. Aborting.`);
    return;
  }

  // Prompt for secret once per push (not persisted)
  const secret = promptForSecretOnce_();
  if (secret == null) return; // user canceled

  const range = sheet.getActiveRange();
  const startRow = range.getRow();
  const numRows  = range.getNumRows();

  const summary = processRowsToFirestore_(sheet, headers, docIdColIndex1, startRow, numRows, secret);
  ui.alert(formatSummary_(summary));
}

/**
 * Push ALL rows below header to Firestore using the same rules as pushSelectedRowsToFirestore.
 */
function pushAllRowsToFirestore() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  const cfg = getConfig_();

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
    ui.alert(`Header "${cfg.DOC_ID_FIELD_NAME}" not found in row ${headerRow}. Aborting.`);
    return;
  }

  // Prompt for secret once per push (not persisted)
  const secret = promptForSecretOnce_();
  if (secret == null) return; // user canceled

  const startRow = headerRow + 1;
  const numRows  = lastRow - headerRow;

  const summary = processRowsToFirestore_(sheet, headers, docIdColIndex1, startRow, numRows, secret);
  ui.alert(formatSummary_(summary));
}

/**
 * Same as pushSelectedRowsToFirestore, but returns summary and does not alert.
 */
function pushSelectedRowsToFirestoreNoAlert_(secret) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const cfg = getConfig_();

  const headerRow = 1;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

  const docIdColIndex1 = findDocIdColIndex_(headers);
  if (!docIdColIndex1) {
    throw new Error('Header "' + cfg.DOC_ID_FIELD_NAME + '" not found in row ' + headerRow + '.');
  }

  const range = sheet.getActiveRange();
  const startRow = range.getRow();
  const numRows  = range.getNumRows();

  return processRowsToFirestore_(sheet, headers, docIdColIndex1, startRow, numRows, secret);
}

/**
 * Same as pushAllRowsToFirestore, but returns summary and does not alert.
 */
function pushAllRowsToFirestoreNoAlert_(secret) {
  const sheet = SpreadsheetApp.getActiveSheet();
  const cfg = getConfig_();

  const headerRow = 1;
  const lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) {
    throw new Error('No data below the header.');
  }

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

  const docIdColIndex1 = findDocIdColIndex_(headers);
  if (!docIdColIndex1) {
    throw new Error('Header "' + cfg.DOC_ID_FIELD_NAME + '" not found in row ' + headerRow + '.');
  }

  const startRow = headerRow + 1;
  const numRows  = lastRow - headerRow;

  return processRowsToFirestore_(sheet, headers, docIdColIndex1, startRow, numRows, secret);
}


// ---------------------- Helpers ----------------------

/**
 * Find 1-based index of the DOC_ID_FIELD_NAME column in the header array (case-sensitive).
 */
function findDocIdColIndex_(headers) {
  const { DOC_ID_FIELD_NAME } = getConfig_();
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
  const { DOC_ID_FIELD_NAME, INCLUDE_ID_FIELD_IN_DOC } = getConfig_();
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
function processRowsToFirestore_(sheet, headers, docIdColIndex1, startRow, numRows, secret) {
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

      writeDoc_(doc, docId, secret);
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
function writeDoc_(doc, docId, secretOpt) {
  const { CF_ENDPOINT, COLLECTION } = getConfig_();
  const secret = secretOpt || getSessionSecret_();
  const res = UrlFetchApp.fetch(CF_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-app-secret': secret },
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
    .addSeparator()
    .addItem('Configuration…', 'openConfigSidebar')
    .addItem('Diagnostics…', 'openConfigSidebar')
    .addToUi();
}

/** Open the configuration sidebar (per-sheet settings). */
function openConfigSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('SheetFire Settings')
    .setWidth(420);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ====== Editor Add-on (Sheets) UI ======
// The functions below enable using this project as an Editor Add-on
// published via the Google Workspace Marketplace. They reuse the same
// core push logic while presenting a simple CardService UI.

/** Homepage entry for Editor Add-on (Sheets). */
function onHomepage(e) {
  return buildHomeCard_(e);
}

/** Rebuild UI after file-scope access is granted. */
function onFileScopeGranted(e) {
  return buildHomeCard_(e);
}

/** Build the main home card with actions and quick config info. */
function buildHomeCard_(e) {
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle('SheetFire'));

  var s = CardService.newCardSection();
  var cfg = getConfig_();

  s.addWidget(CardService.newTextParagraph()
    .setText('Endpoint: ' + cfg.CF_ENDPOINT));
  s.addWidget(CardService.newTextParagraph()
    .setText('Collection: ' + cfg.COLLECTION));

  // Inline, non-persistent secret input for actions below
  s.addWidget(CardService.newTextInput()
    .setFieldName('APP_SECRET')
    .setTitle('APP_SECRET (not stored)')
    .setHint('Required for push/diagnostics. Never persisted.'));

  var actionsRow = CardService.newButtonSet()
    .addButton(CardService.newTextButton()
      .setText('Push selected rows')
      .setOnClickAction(CardService.newAction().setFunctionName('handlePushSelected_')))
    .addButton(CardService.newTextButton()
      .setText('Push all rows')
      .setOnClickAction(CardService.newAction().setFunctionName('handlePushAll_')));
  s.addWidget(actionsRow);

  s.addWidget(CardService.newTextButton()
    .setText('Run diagnostics')
    .setOnClickAction(CardService.newAction().setFunctionName('handleDiagnostics_')));

  s.addWidget(CardService.newTextButton()
    .setText('Settings')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName('showSettingsCard_')));

  card.addSection(s);
  return card.build();
}

/** Show a card to edit CF_ENDPOINT, COLLECTION, and APP_SECRET. */
function showSettingsCard_(e) {
  var card = CardService.newCardBuilder();
  card.setHeader(CardService.newCardHeader().setTitle('Settings'));
  var s = CardService.newCardSection();

  var cfg = getConfig_();

  s.addWidget(CardService.newTextInput()
    .setFieldName('CF_ENDPOINT')
    .setTitle('CF_ENDPOINT')
    .setValue(cfg.CF_ENDPOINT));
  s.addWidget(CardService.newTextInput()
    .setFieldName('COLLECTION')
    .setTitle('COLLECTION')
    .setValue(cfg.COLLECTION));
  s.addWidget(CardService.newTextInput()
    .setFieldName('DOC_ID_FIELD_NAME')
    .setTitle('DOC_ID_FIELD_NAME')
    .setValue(cfg.DOC_ID_FIELD_NAME));
  s.addWidget(CardService.newSelectionInput()
    .setFieldName('INCLUDE_ID_FIELD_IN_DOC')
    .setTitle('INCLUDE_ID_FIELD_IN_DOC')
    .setType(CardService.SelectionInputType.CHECK_BOX)
    .addItem('Include the docId field in payload', 'true', cfg.INCLUDE_ID_FIELD_IN_DOC));

  s.addWidget(CardService.newTextParagraph()
    .setText('APP_SECRET is not stored. Provide it on the home card when pushing or running diagnostics.'));

  s.addWidget(CardService.newTextButton()
    .setText('Save')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName('saveSettings_')));

  card.addSection(s);
  return card.build();
}

/** Persist settings and refresh the home card. */
function saveSettings_(e) {
  try {
    var inputs = (e && e.commonEventObject && e.commonEventObject.formInputs) || {};
    var current = getConfig_();
    var endpoint = getInputString_(inputs, 'CF_ENDPOINT', current.CF_ENDPOINT);
    var collection = getInputString_(inputs, 'COLLECTION', current.COLLECTION);
    var docField = getInputString_(inputs, 'DOC_ID_FIELD_NAME', current.DOC_ID_FIELD_NAME);
    var includeId = getInputBool_(inputs, 'INCLUDE_ID_FIELD_IN_DOC', current.INCLUDE_ID_FIELD_IN_DOC);

    saveDocumentConfig({
      CF_ENDPOINT: endpoint,
      COLLECTION: collection,
      DOC_ID_FIELD_NAME: docField,
      INCLUDE_ID_FIELD_IN_DOC: includeId,
    });

    var nav = CardService.newNavigation().updateCard(buildHomeCard_(e));
    return CardService.newActionResponseBuilder()
      .setNavigation(nav)
      .setNotification(CardService.newNotification().setText('Saved settings.'))
      .build();
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Error saving: ' + err))
      .build();
  }
}

/** Utility: read a single string value from formInputs. */
function getInputString_(inputs, key, fallback) {
  var obj = inputs[key];
  if (!obj || !obj.stringInputs) return fallback;
  var vals = obj.stringInputs.value || [];
  return vals.length ? String(vals[0]) : fallback;
}

/** Utility: read a boolean value from selectionInputs (checkbox). */
function getInputBool_(inputs, key, fallback) {
  var obj = inputs[key];
  if (!obj) return !!fallback;
  if (obj.stringInputs && Array.isArray(obj.stringInputs.value)) {
    // Any selected value considered true
    return obj.stringInputs.value.length > 0;
  }
  if (obj.boolInputs && Array.isArray(obj.boolInputs.value)) {
    return obj.boolInputs.value.some(Boolean);
  }
  return !!fallback;
}

/** Action handler: push selected rows via existing logic. */
function handlePushSelected_(e) {
  try {
    var inputs = (e && e.commonEventObject && e.commonEventObject.formInputs) || {};
    var secret = getInputString_(inputs, 'APP_SECRET', '');
    if (!secret) return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('APP_SECRET required'))
      .build();
    setSessionSecret_(secret);
    var summary = pushSelectedRowsToFirestoreNoAlert_(secret);
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Pushed selected rows: ' + summary.sent + ' sent.'))
      .build();
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Error: ' + err))
      .build();
  }
}

/** Action handler: push all rows via existing logic. */
function handlePushAll_(e) {
  try {
    var inputs = (e && e.commonEventObject && e.commonEventObject.formInputs) || {};
    var secret = getInputString_(inputs, 'APP_SECRET', '');
    if (!secret) return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('APP_SECRET required'))
      .build();
    setSessionSecret_(secret);
    var summary = pushAllRowsToFirestoreNoAlert_(secret);
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Pushed all rows: ' + summary.sent + ' sent.'))
      .build();
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Error: ' + err))
      .build();
  }
}

/** Add-on action: run diagnostics using provided APP_SECRET. */
function handleDiagnostics_(e) {
  try {
    var inputs = (e && e.commonEventObject && e.commonEventObject.formInputs) || {};
    var secret = getInputString_(inputs, 'APP_SECRET', '');
    var result = runDiagnostics({ APP_SECRET: secret });
    var text = result.ok ? 'Diagnostics passed: ' + result.message : 'Diagnostics failed: ' + result.message;
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(text))
      .build();
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Error: ' + err))
      .build();
  }
}

// ================= Additional automation helpers =================

/**
 * Return the active spreadsheet ID and URL.
 */
function getSpreadsheetInfo() {
  const ss = SpreadsheetApp.getActive();
  return { id: ss.getId(), url: ss.getUrl(), name: ss.getName() };
}

/**
 * Ensure a Drive folder exists by name in My Drive; return its ID.
 * If multiple folders with the same name exist, returns the first match.
 */
function ensureFolder_(name) {
  const iter = DriveApp.getFoldersByName(name);
  if (iter.hasNext()) return iter.next();
  return DriveApp.createFolder(name);
}

/**
 * Move this spreadsheet into a folder (creating the folder if needed).
 * Returns the folder ID.
 */
function moveSelfToFolder(opts) {
  const folderName = (opts && opts.folderName) || 'SheetFire';
  const folder = ensureFolder_(folderName);
  const ss = SpreadsheetApp.getActive();
  const file = DriveApp.getFileById(ss.getId());
  // Add to target folder and remove from root to emulate a move.
  folder.addFile(file);
  try {
    DriveApp.getRootFolder().removeFile(file);
  } catch (e) {
    // Ignore if API disallows remove (some enterprise settings); file will still be in target folder
  }
  return { folderId: folder.getId(), folderUrl: folder.getUrl() };
}

/**
 * Create a Google Form and link its destination to this spreadsheet.
 * Optionally move it to the provided folderName. Returns { formId, formUrl }.
 */
function setupForm(opts) {
  const title = (opts && opts.title) || 'SheetFire Form';
  const folderName = opts && opts.folderName;

  const form = FormApp.create(title);

  // Minimal example item so the form is usable
  form.addTextItem().setTitle('Name').setRequired(true);
  form.addParagraphTextItem().setTitle('Notes');

  // Link to this spreadsheet for responses
  const ss = SpreadsheetApp.getActive();
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  // Optionally move the Form into a folder
  if (folderName) {
    const folder = ensureFolder_(folderName);
    const file = DriveApp.getFileById(form.getId());
    folder.addFile(file);
    try {
      DriveApp.getRootFolder().removeFile(file);
    } catch (e) {}
  }

  return { formId: form.getId(), formUrl: form.getEditUrl() };
}

/**
 * Create an installable trigger on the spreadsheet to capture form submissions
 * and forward them to Firestore via the configured endpoint.
 */
function createOnSubmitTrigger() {
  const ssId = SpreadsheetApp.getActive().getId();
  // Avoid duplicate triggers by checking existing ones
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(t => t.getHandlerFunction() === 'onSheetFormSubmit');
  if (!exists) {
    ScriptApp.newTrigger('onSheetFormSubmit')
      .forSpreadsheet(ssId)
      .onFormSubmit()
      .create();
  }
  return { created: !exists };
}

/**
 * Installable trigger handler for Sheet form submissions. Builds a document from the
 * submitted row and writes it to Firestore (auto-ID).
 *
 * Notes:
 * - Excludes the DOC_ID_FIELD_NAME and empty headers from the payload if present.
 * - Also excludes the default 'Timestamp' column added by Google Forms if present.
 */
function onSheetFormSubmit(e) {
  const sheet = e && e.range ? e.range.getSheet() : SpreadsheetApp.getActiveSheet();
  const { DOC_ID_FIELD_NAME } = getConfig_();
  const headerRow = 1;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

  const row = e && e.range ? e.range.getRow() : headerRow + 1;
  const values = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

  const doc = {};
  for (let i = 0; i < headers.length; i++) {
    const key = String(headers[i] || '').trim();
    if (!key) continue;
    if (key === DOC_ID_FIELD_NAME) continue;
    if (key === 'Timestamp') continue; // default Forms header
    doc[key] = coerce_(values[i]);
  }

  // Auto-ID by passing blank docId
  writeDoc_(doc, '');
}

/**
 * Convenience wrapper to do end-to-end setup from clasp run:
 * - Optionally move Sheet to a folder
 * - Optionally create a Form and link it
 * - Ensure an onSubmit trigger exists
 * Returns key URLs for convenience.
 */
function bootstrapDrive(opts) {
  opts = opts || {};
  const folderName = opts.folderName || null;
  const formTitle = opts.formTitle || null;

  let folderInfo = null;
  if (folderName) folderInfo = moveSelfToFolder({ folderName });

  let formInfo = null;
  if (formTitle) formInfo = setupForm({ title: formTitle, folderName });

  const trig = createOnSubmitTrigger();

  const ss = SpreadsheetApp.getActive();
  return {
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    folderId: folderInfo ? folderInfo.folderId : null,
    folderUrl: folderInfo ? folderInfo.folderUrl : null,
    formId: formInfo ? formInfo.formId : null,
    formUrl: formInfo ? formInfo.formUrl : null,
    triggerCreated: trig.created,
  };
}

/**
 * Nicely formats the push summary for the UI alert.
 */
function formatSummary_(s) {
  const lines = [
    `Attempted rows: ${s.attemptedRows}`,
    `Sent: ${s.sent}`,
    `Skipped (blank ${getConfig_().DOC_ID_FIELD_NAME}): ${s.skippedNoId}`,
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
  const { DOC_ID_FIELD_NAME } = getConfig_();
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
    // This trigger cannot prompt for a secret; require legacy script property fallback.
    const summary = processRowsToFirestore_(sheet, hdrs, docIdColIndex1, row, 1, getSessionSecret_());
    // Optional: small toast for debugging (remove if not wanted)
    sheet.toast(`Firestore push: sent ${summary.sent}, skippedNoId ${summary.skippedNoId}, errors ${summary.skippedErrors}`, 'onFormSubmit');
  } catch (err) {
    console.error('Push latest row failed:', err);
  }
}

// ================= Configuration Sidebar (HTMLService) =================

/** Prompt user for APP_SECRET once (spreadsheet UI), not persisted. */
function promptForSecretOnce_() {
  const ui = SpreadsheetApp.getUi();
  // If we have a session secret already (e.g., from sidebar), reuse it
  var existing = getSessionSecret_();
  if (existing) return existing;
  const resp = ui.prompt('APP_SECRET required', 'Enter APP_SECRET for this session (not stored).', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return null;
  const secret = (resp.getResponseText() || '').trim();
  if (!secret) {
    ui.alert('APP_SECRET is required to push.');
    return null;
  }
  setSessionSecret_(secret);
  return secret;
}

/** Non-destructive endpoint check using dryRun. */
function runDiagnostics(opts) {
  const cfg = getConfig_();
  const endpoint = cfg.CF_ENDPOINT;
  const collection = cfg.COLLECTION;
  const doc = { _diagnostic: true, _ts: new Date().toISOString() };
  const appSecret = (opts && opts.APP_SECRET) ? String(opts.APP_SECRET) : getSessionSecret_();

  if (!endpoint) return { ok: false, message: 'CF_ENDPOINT is empty' };
  if (!collection) return { ok: false, message: 'COLLECTION is empty' };
  if (!appSecret) return { ok: false, message: 'APP_SECRET not provided' };

  try {
    const res = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-app-secret': appSecret },
      payload: JSON.stringify({ collection, doc, docId: '', dryRun: true }),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const body = res.getContentText() || '';
    if (code >= 200 && code < 300) {
      // Try to parse for additional context
      try {
        const j = JSON.parse(body);
        if (j && j.ok) return { ok: true, message: 'Healthy (dryRun ok: ' + (j.path || j.wouldWriteTo || 'ok') + ')' };
      } catch (_) {}
      return { ok: true, message: 'Healthy (HTTP ' + code + ')' };
    }
    return { ok: false, message: 'HTTP ' + code + ': ' + body.slice(0, 200) };
  } catch (err) {
    return { ok: false, message: String(err && err.message || err) };
  }
}
