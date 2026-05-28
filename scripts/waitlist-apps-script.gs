/**
 * Cavaliq Waitlist — Google Apps Script web app.
 *
 * Paste this into the Apps Script editor attached to the
 * "Cavaliq Waitlist" Google Sheet (Extensions → Apps Script), then:
 *
 *   1. File → Project Settings → set time zone to Asia/Dubai
 *   2. Deploy → New deployment → type "Web app"
 *      - Execute as: "Me"
 *      - Who has access: "Anyone"
 *   3. Copy the web-app URL
 *   4. From `apps/web/`:
 *        wrangler secret put WAITLIST_WEBHOOK_URL
 *      paste the URL.
 *
 * The Worker at `/api/v1/marketing-waitlist` POSTs JSON here. Re-running
 * `Deploy → New deployment` mints a fresh URL — bump the Cloudflare
 * secret each time you do that, or use "Manage deployments → Edit" to
 * keep the same URL while updating the script.
 *
 * Sheet expectations:
 *   - First row is the header row written by `ensureHeader_()` on first
 *     submission. Rename columns in the sheet if you want, but don't
 *     reorder or delete them — append-style writes use the script's
 *     internal order, not the header row.
 */

var SHEET_NAME = 'Waitlist';

var HEADER = [
  'Received at',
  'Email',
  'Name',
  'Club',
  'Country',
  'Role',
  'Source',
  'Status',
  'Notes',
];

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ success: false, error: 'No body' }, 400);
    }

    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse_({ success: false, error: 'Invalid JSON' }, 400);
    }

    var sheet = getSheet_();
    ensureHeader_(sheet);

    sheet.appendRow([
      payload.receivedAt || new Date().toISOString(),
      payload.email || '',
      payload.name || '',
      payload.clubName || '',
      payload.country || '',
      payload.role || '',
      payload.source || '',
      'New',
      '',
    ]);

    return jsonResponse_({ success: true }, 200);
  } catch (err) {
    // Surface as 500 so the Worker logs it; never throw uncaught —
    // Apps Script's default error page would leak script internals
    // back to the public Worker.
    return jsonResponse_(
      { success: false, error: String(err && err.message ? err.message : err) },
      500,
    );
  }
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  return sheet;
}

function ensureHeader_(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(HEADER);
  sheet
    .getRange(1, 1, 1, HEADER.length)
    .setFontWeight('bold')
    .setBackground('#0d1f34')
    .setFontColor('#ffffff');
  sheet.setFrozenRows(1);
}

function jsonResponse_(obj, statusCode) {
  // Apps Script's ContentService can't set arbitrary status codes —
  // every response is 200. Encode success/error in the body so the
  // Worker can branch on `response.ok` (which Apps Script ContentService
  // also returns 200 for) AND on `body.success`.
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
