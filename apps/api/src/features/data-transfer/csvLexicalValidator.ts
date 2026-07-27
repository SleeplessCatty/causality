function withoutRecordDelimiter(raw: string): string {
  if (raw.endsWith('\r\n')) return raw.slice(0, -2);
  if (raw.endsWith('\n')) return raw.slice(0, -1);
  if (raw.endsWith('\r')) return raw.slice(0, -1);
  return raw;
}

export function isBlankRawCsvRecord(raw: string): boolean {
  return withoutRecordDelimiter(raw).trim().length === 0;
}

export function isStrictQuotedCsvRecord(raw: string): boolean {
  const record = withoutRecordDelimiter(raw);
  let position = 0;

  while (position < record.length) {
    if (record[position] !== '"') return false;
    position += 1;

    let closed = false;
    while (position < record.length) {
      if (record[position] !== '"') {
        position += 1;
        continue;
      }
      if (record[position + 1] === '"') {
        position += 2;
        continue;
      }
      position += 1;
      closed = true;
      break;
    }

    if (!closed) return false;
    if (position === record.length) return true;
    if (record[position] !== ',') return false;
    position += 1;
    if (position === record.length) return false;
  }

  return false;
}
