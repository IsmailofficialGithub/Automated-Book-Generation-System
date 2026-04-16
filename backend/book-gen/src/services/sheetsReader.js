import { google } from 'googleapis';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * A1 range for spreadsheets.values.get — simple names: `Book_generetor!A1:G200`;
 * names with spaces/special chars: `'My Tab'!A1:G200`
 */
function sheetTabRange(tabName, rangeWithoutTab) {
  const t = String(tabName).trim();
  if (!t) throw new Error('GOOGLE_SHEET_TAB is empty');
  if (/^[A-Za-z0-9_]+$/.test(t)) {
    return `${t}!${rangeWithoutTab}`;
  }
  const escaped = t.replace(/'/g, "''");
  return `'${escaped}'!${rangeWithoutTab}`;
}

function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  return google.sheets({ version: 'v4', auth });
}

export async function readBooksFromSheet() {
  const sheets = getSheetsClient();
  const range = sheetTabRange(env.GOOGLE_SHEET_TAB, env.GOOGLE_SHEET_RANGE);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
    range,
  });

  const rows = response.data.values ?? [];
  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const books = rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i]?.trim() ?? null;
    });
    return obj;
  });

  const valid = books.filter((b) => b.title);
  logger.info({ count: valid.length }, 'Books read from Google Sheets');
  return valid;
}

export async function syncSheetToDatabase(supabase) {
  const sheetBooks = await readBooksFromSheet();
  let inserted = 0;
  let updated = 0;

  for (const sheetBook of sheetBooks) {
    const { data: existing, error: findErr } = await supabase
      .from('books')
      .select('id, status_outline_notes, final_review_notes_status')
      .eq('title', sheetBook.title)
      .maybeSingle();
    if (findErr) throw new Error(`sync find book "${sheetBook.title}": ${findErr.message}`);

    if (!existing) {
      const { error: insertErr } = await supabase.from('books').insert({
        title: sheetBook.title,
        notes_on_outline_before: sheetBook.notes_on_outline_before,
        status_outline_notes: sheetBook.status_outline_notes ?? 'no',
        notes_on_outline_after: sheetBook.notes_on_outline_after,
        final_review_notes_status: sheetBook.final_review_notes_status ?? 'no',
        final_review_notes: sheetBook.final_review_notes,
      });
      if (insertErr) throw new Error(`sync insert book "${sheetBook.title}": ${insertErr.message}`);
      inserted++;
    } else {
      const { error: updateErr } = await supabase
        .from('books')
        .update({
          notes_on_outline_before: sheetBook.notes_on_outline_before,
          notes_on_outline_after: sheetBook.notes_on_outline_after,
          status_outline_notes: sheetBook.status_outline_notes ?? existing.status_outline_notes,
          final_review_notes_status: sheetBook.final_review_notes_status ?? existing.final_review_notes_status,
          final_review_notes: sheetBook.final_review_notes,
        })
        .eq('id', existing.id);
      if (updateErr) throw new Error(`sync update book "${sheetBook.title}": ${updateErr.message}`);
      updated++;
    }
  }

  logger.info({ inserted, updated }, 'Sheet sync complete');
  return { inserted, updated };
}
