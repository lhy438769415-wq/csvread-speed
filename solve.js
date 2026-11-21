// Fast csv-reader 1.0.0-compatible CSV reader.
//
// Contract (from the competition rules): run({text, header}) returns
// {columns, rows, errors} with csv-reader 1.0.0's exact broken-row policy.
// Written as a single-pass scanner that slices whole field segments with
// indexOf instead of walking character by character.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // Smallest index >= from among the next ',', '\n' or '\r'; n when none.
  function nextSpecial(from) {
    let m = n;
    let i = text.indexOf(',', from);
    if (i !== -1 && i < m) m = i;
    i = text.indexOf('\n', from);
    if (i !== -1 && i < m) m = i;
    i = text.indexOf('\r', from);
    if (i !== -1 && i < m) m = i;
    return m;
  }

  // Reads an unquoted field starting at pos, appending onto `value`.
  // Returns [value, ended, added] where added counts kept characters.
  // May push stray_cr errors; the caller's recordLine/recordRow are used.
  function readUnquoted(value, recordLine, recordRow) {
    let added = 0;
    for (;;) {
      if (pos >= n) return [value, END, added];
      const cut = nextSpecial(pos);
      if (cut > pos) {
        value += text.slice(pos, cut);
        added += cut - pos;
        pos = cut;
      }
      if (pos >= n) return [value, END, added];
      const c = text.charCodeAt(pos);
      if (c === 44) { // ','
        pos += 1;
        return [value, COMMA, added];
      }
      if (c === 10) { // '\n'
        pos += 1;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      // '\r': CRLF ends the line, a lone CR is dropped with an error.
      if (text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos += 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  // Returns [value, ended]. May push unterminated_quote / quote_junk /
  // stray_cr errors (stray_cr only via the junk tail).
  function readQuoted(recordLine, recordRow) {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // Never closes: the quote is literal, re-read after it as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        const r = readUnquoted('"', recordLine, recordRow);
        return [r[0], r[1]];
      }
      const seg = text.slice(pos, q);
      if (seg.length > 0) {
        if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) {
          value += seg;
        } else {
          // CRLF and lone CR inside quotes each become one LF.
          let breaks = 0;
          for (let i = 0; i < seg.length; i++) {
            const ch = seg.charCodeAt(i);
            if (ch === 10) breaks += 1;
            else if (ch === 13) { breaks += 1; if (seg.charCodeAt(i + 1) === 10) i += 1; }
          }
          line += breaks;
          value += seg.replace(/\r\n?/g, '\n');
        }
      }
      if (text.charCodeAt(q + 1) === 34) {
        // Doubled quote: one literal quote, keep scanning.
        value += '"';
        pos = q + 2;
        continue;
      }
      // Closing quote at q.
      pos = q + 1;
      if (pos >= n) return [value, END];
      const c = text.charCodeAt(pos);
      if (c === 44) { // ','
        pos += 1;
        return [value, COMMA];
      }
      if (c === 10) { // '\n'
        pos += 1;
        line += 1;
        return [value, LINE_BREAK];
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) { // CRLF
        pos += 2;
        line += 1;
        return [value, LINE_BREAK];
      }
      // Anything else is junk appended as it stands, up to the next
      // comma or line break; a lone CR here is stray_cr via readUnquoted.
      const r = readUnquoted(value, recordLine, recordRow);
      if (r[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return [r[0], r[1]];
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      let v;
      if (quoted) {
        const r = readQuoted(recordLine, recordRow);
        v = r[0]; ended = r[1];
      } else {
        const r = readUnquoted('', recordLine, recordRow);
        v = r[0]; ended = r[1];
      }
      fields.push(v);
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
