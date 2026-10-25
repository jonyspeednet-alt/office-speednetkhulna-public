const net = require('node:net');
const pool = require('./db');

const DEFAULT_FIELDS = [
  'historyid', 'callid', 'duration', 'time-start', 'time-answered', 'time-end',
  'reason-terminated', 'from-no', 'to-no', 'dial-no', 'from-dn', 'to-dn',
];
const MAX_RECORD_LENGTH = 16 * 1024;

const parseCsvLine = (line) => {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error('Malformed quoted CDR record');
  values.push(value);
  return values;
};

const parseDurationSeconds = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text));
  const match = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
};

const parseDate = (value, timeZone = 'Asia/Dhaka') => {
  const text = String(value || '').trim();
  if (!text) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  let date;
  if (hasTimezone) {
    date = new Date(text);
  } else {
    const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
    if (!match) return null;
    const [, year, month, day, hour, minute, second, fraction = '0'] = match;
    const wallClock = Date.UTC(
      Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute),
      Number(second), Number(`0.${fraction}`) * 1000
    );
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
      minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date(wallClock)).map(({ type, value: part }) => [type, part]));
    const representedAsUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second)
    );
    const offset = representedAsUtc - Math.floor(wallClock / 1000) * 1000;
    date = new Date(wallClock - offset);
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const parseCdrRecord = (line, fields = DEFAULT_FIELDS, timeZone = 'Asia/Dhaka') => {
  const values = parseCsvLine(String(line || '').trim());
  if (values.length !== fields.length) {
    throw new Error(`Expected ${fields.length} CDR fields, received ${values.length}`);
  }
  const record = Object.fromEntries(fields.map((field, index) => [field, values[index].trim()]));
  const callId = record.callid;
  const historyId = record.historyid;
  const startedAt = parseDate(record['time-start'], timeZone);
  if (!callId || !historyId || !startedAt) {
    throw new Error('CDR record is missing callid, historyid, or a valid time-start');
  }
  const extensionSource = record['from-dn'] || record['from-no'] || '';
  const extensionMatch = extensionSource.match(/(?:^|\D)(\d{2,10})(?:\D|$)/);
  return {
    callId,
    historyId,
    durationSeconds: parseDurationSeconds(record.duration),
    startedAt,
    answeredAt: parseDate(record['time-answered'], timeZone),
    endedAt: parseDate(record['time-end'], timeZone),
    terminationReason: record['reason-terminated'] || null,
    callerNumber: record['from-no'] || null,
    calleeNumber: record['to-no'] || null,
    dialedNumber: record['dial-no'] || record['to-no'] || null,
    extension: extensionMatch?.[1] || null,
  };
};

const normalizeNumber = (value) => String(value || '').replace(/\D/g, '').slice(-10);

const parseAllowedIps = (raw) => String(raw || '')
  .split(',')
  .map((ip) => ip.trim().replace(/^::ffff:/i, ''))
  .filter(Boolean);

const isPrivateIpv4 = (ip) => {
  if (net.isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

const getConfig = (env = process.env) => {
  if (String(env.THREECX_CDR_ENABLED || '').toLowerCase() !== 'true') return null;
  const host = String(env.THREECX_CDR_HOST || '').trim();
  const port = Number(env.THREECX_CDR_PORT);
  const allowedIps = parseAllowedIps(env.THREECX_CDR_ALLOWED_IPS);
  const fields = String(env.THREECX_CDR_FIELDS || DEFAULT_FIELDS.join(','))
    .split(',')
    .map((field) => field.trim().toLowerCase())
    .filter(Boolean);
  if (!isPrivateIpv4(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('3CX CDR requires a private IPv4 bind address and valid port');
  }
  if (!allowedIps.length || allowedIps.some((ip) => net.isIP(ip) !== 4)) {
    throw new Error('3CX CDR requires an IPv4 allowlist in THREECX_CDR_ALLOWED_IPS');
  }
  if (new Set(fields).size !== fields.length || !['callid', 'historyid', 'time-start'].every((key) => fields.includes(key))) {
    throw new Error('3CX CDR fields must be unique and include callid, historyid, and time-start');
  }
  const timeZone = String(env.THREECX_CDR_TIMEZONE || 'Asia/Dhaka').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error('THREECX_CDR_TIMEZONE must be a supported IANA timezone');
  }
  return { host, port, allowedIps: new Set(allowedIps), fields, timeZone };
};

const ingestRecord = async (record) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO support_3cx_calls (
         call_id, history_id, duration_seconds, started_at, answered_at, ended_at,
         termination_reason, caller_number, callee_number, dialed_number, extension
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (call_id, history_id) DO UPDATE SET
         duration_seconds = EXCLUDED.duration_seconds,
         answered_at = EXCLUDED.answered_at,
         ended_at = EXCLUDED.ended_at,
         termination_reason = EXCLUDED.termination_reason,
         caller_number = EXCLUDED.caller_number,
         callee_number = EXCLUDED.callee_number,
         dialed_number = EXCLUDED.dialed_number,
         extension = EXCLUDED.extension
       RETURNING id`,
      [
        record.callId, record.historyId, record.durationSeconds, record.startedAt,
        record.answeredAt, record.endedAt, record.terminationReason, record.callerNumber,
        record.calleeNumber, record.dialedNumber, record.extension,
      ]
    );

    const customerNumber = normalizeNumber(record.dialedNumber);
    if (customerNumber.length >= 6) {
      const matching = await client.query(
        `SELECT id, ticket_id FROM support_ticket_events
         WHERE event_type = 'call_handoff'
           AND (metadata->>'cdr_call_id' IS NULL OR metadata->>'cdr_call_id' = $3)
           AND (NULLIF(metadata->>'extension', '') IS NULL OR metadata->>'extension' = $4)
           AND RIGHT(REGEXP_REPLACE(COALESCE(metadata->>'phone', ''), '[^0-9]', '', 'g'), 10) = $1
           AND created_at BETWEEN $2::timestamptz - INTERVAL '2 minutes'
                              AND $2::timestamptz + INTERVAL '2 minutes'
         ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - $2::timestamptz))), id DESC
         LIMIT 1`,
        [customerNumber, record.startedAt, record.callId, record.extension]
      );
      if (matching.rowCount) {
        const outcome = record.answeredAt ? 'answered' : 'not_answered';
        await client.query(
          `UPDATE support_ticket_events
           SET message = $2,
               metadata = metadata || $3::jsonb
           WHERE id = $1`,
          [
            matching.rows[0].id,
            record.answeredAt ? '3CX call answered' : '3CX call not answered',
            JSON.stringify({
              cdr_call_id: record.callId,
              cdr_history_id: record.historyId,
              extension: record.extension,
              call_status: outcome,
              duration_seconds: record.durationSeconds,
              started_at: record.startedAt,
              answered_at: record.answeredAt,
              ended_at: record.endedAt,
              termination_reason: record.terminationReason,
            }),
          ]
        );
        await client.query(
          `UPDATE support_3cx_calls
           SET ticket_event_id = $2, ticket_id = $3, portal_user_id = (
             SELECT created_by FROM support_ticket_events WHERE id = $2
           )
           WHERE id = $1`,
          [inserted.rows[0].id, matching.rows[0].id, matching.rows[0].ticket_id]
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) {
      console.error('[3CX CDR] rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
};

const start3cxCdrReceiver = async () => {
  const config = getConfig();
  if (!config) return null;
  await pool.query('SELECT id FROM support_3cx_calls LIMIT 0');

  const server = net.createServer((socket) => {
    const remoteAddress = String(socket.remoteAddress || '').replace(/^::ffff:/i, '');
    if (!config.allowedIps.has(remoteAddress)) {
      console.warn(`[3CX CDR] rejected connection from non-allowlisted address ${remoteAddress || 'unknown'}`);
      socket.destroy();
      return;
    }
    socket.setTimeout(15000, () => socket.destroy());
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > MAX_RECORD_LENGTH) {
        console.error('[3CX CDR] rejected oversized record');
        socket.destroy();
        return;
      }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const record = parseCdrRecord(line, config.fields, config.timeZone);
          ingestRecord(record).catch((error) => console.error('[3CX CDR] record ingest failed:', error.message));
        } catch (error) {
          console.error('[3CX CDR] rejected malformed record:', error.message);
        }
      }
    });
    socket.on('error', (error) => console.error('[3CX CDR] socket error:', error.message));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  console.log(`[3CX CDR] receiver listening on configured private interface ${config.host}`);
  return server;
};

module.exports = {
  DEFAULT_FIELDS,
  getConfig,
  ingestRecord,
  normalizeNumber,
  parseCdrRecord,
  parseCsvLine,
  parseDurationSeconds,
  start3cxCdrReceiver,
};
