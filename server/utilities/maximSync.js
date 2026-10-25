/**
 * Maxim billing sync worker (no API from Maestro — AJAX/form scraping path).
 *
 * Flow per reseller/month:
 *   1. login() — POST validate4.jsp {uName, passw} -> session id + maximorig cookie
 *   2. Payment report — POST mainPage.jsp {linkname: icustomerpayments-2,
 *      from_date, to_date} -> parse table#example -> filter username by suffix
 *      -> upsert maxim_payment_snapshots
 *   3. Customer list — discover (reseller_id, pops, s_exp) combos from the
 *      listicustomers0 summary page, then POST
 *      customers/list_customers_2_ajax.jsp per combo with
 *      search[value]=suffix (paginate start/length) -> upsert
 *      maxim_customer_snapshots
 *   4. maxim_sync_logs row updated (running -> completed/failed + counts)
 *
 * Semantics (verified via browser): Maxim Balance negative = due.
 * Not Paid (portal) = max(0, Total Bill - Rcv Amount).
 *
 * Credentials ONLY from env: MAXIM_USER / MAXIM_PASS (+optional MAXIM_BASE_URL).
 * Never hardcode, never log values.
 */
const pool = require("./db");
const { initChannelPartnerTables } = require("./channelPartnerInit");
// Lazy-required inside runMaximSync (after snapshots) to avoid module load-order issues.
const getAutoImporter = () =>
  require("../controllers/channelPartnerController").autoImportMaximSnapshots;

const MAXIM_BASE = (
  process.env.MAXIM_BASE_URL || "https://s8.maxim-billing.com"
).replace(/\/+$/, "");
const PAGE_LEN = 500;
// No timeout on raw fetch() hung a verify run for ~2 days (PID orphaned,
// PPID 1, 0% CPU). All Maxim HTTP goes through fetchWithTimeout below.
const FETCH_TIMEOUT_MS = Number(process.env.MAXIM_FETCH_TIMEOUT_MS || 30000);

const fetchWithTimeout = (url, opts = {}, ms = FETCH_TIMEOUT_MS) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const signal = opts.signal || ctrl.signal;
  return fetch(url, { ...opts, signal }).finally(() => clearTimeout(t));
};
const running = new Set(); // `${resellerId}:${monthYm}` — double-run guard

class MaximExpiredError extends Error {
  constructor() {
    super("Maxim session expired");
    this.code = "MAXIM_EXPIRED";
  }
}

// ─── tiny HTML helpers (no new deps) ──────────────────────────────

const stripHtml = (s) => {
  if (s == null) return "";
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
};

const parseNum = (s, d = 0) => {
  if (s == null) return d;
  const n = Number(String(s).replace(/,/g, "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : d;
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const parseYmd = (s) => {
  const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const lastDayOfMonthYm = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getDate();
};

const monthRangeYm = (ym) => ({
  first: `${ym}-01`,
  last: `${ym}-${String(lastDayOfMonthYm(ym)).padStart(2, "0")}`,
});

// ─── session client ───────────────────────────────────────────────

const newClient = () => ({ sessionId: null, cookies: [] });

const storeCookies = (client, res) => {
  const list = typeof res.headers.getSetCookie === "function"
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  for (const c of list) {
    const pair = String(c).split(";")[0].trim();
    const name = pair.split("=")[0];
    client.cookies = client.cookies.filter((p) => !p.startsWith(name + "="));
    if (pair) client.cookies.push(pair);
  }
};

const cookieHeader = (c) => {
  const jar = [...c.cookies];
  if (c.sessionId && !jar.some((p) => p.startsWith("maximorig=")))
    jar.push(`maximorig=${c.sessionId}`);
  return jar.join("; ");
};

async function postForm(client, path, params, { ajax = false } = {}) {
  const url =
    path.startsWith("http") || path.startsWith("https")
      ? path
      : `${MAXIM_BASE}/${path.replace(/^\/+/, "")}`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Referer: `${MAXIM_BASE}/mainPage.jsp`,
  };
  if (client.sessionId || client.cookies.length)
    headers.Cookie = cookieHeader(client);
  if (ajax) headers["X-Requested-With"] = "XMLHttpRequest";
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: new URLSearchParams(params),
    redirect: "manual",
  });
  storeCookies(client, res);
  const loc = res.headers.get("location") || "";
  if (/index3\.jsp|login/i.test(loc)) throw new MaximExpiredError();
  const text = await res.text();
  if (
    /name="theForm"|action="validate4\.jsp"/.test(text) &&
    !/mainPage\.jsp\?id=/.test(text.slice(0, 2000))
  ) {
    // Login page served instead of content. Distinguish from the actual
    // login POST by checking whether we already hold a session.
    if (client.sessionId) throw new MaximExpiredError();
  }
  return { res, text, loc };
}

async function getPage(client, url) {
  const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
  if (client.sessionId || client.cookies.length) {
    headers.Cookie = cookieHeader(client);
    headers.Referer = `${MAXIM_BASE}/mainPage.jsp`;
  }
  const res = await fetchWithTimeout(url, { headers, redirect: "manual" });
  storeCookies(client, res);
  const loc = res.headers.get("location") || "";
  if (/index3\.jsp|login/i.test(loc)) throw new MaximExpiredError();
  const text = await res.text();
  if (/name="theForm"/.test(text) && !/logout/i.test(text.slice(0, 5000)))
    throw new MaximExpiredError();
  return text;
}

async function login(client) {
  const user = process.env.MAXIM_USER || "";
  const pass = process.env.MAXIM_PASS || "";
  if (!user || !pass)
    throw new Error(
      "MAXIM_USER / MAXIM_PASS env missing (add to secrets/.env.production)",
    );
  // 1. GET the login page first — server issues the JSESSIONID the POST needs.
  const gRes = await fetchWithTimeout(`${MAXIM_BASE}/index3.jsp`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    redirect: "manual",
  });
  storeCookies(client, gRes);
  await gRes.text().catch(() => {});
  const { loc, text } = await postForm(client, "validate4.jsp", {
    uName: user,
    passw: pass,
  });
  // Success is HTTP 200 with JS: location.replace("mainPage.jsp?id=SID&...")
  const m =
    loc.match(/[?&]id=([A-Fa-f0-9]{16,})/) ||
    text.match(/mainPage\.jsp\?id=([A-Fa-f0-9]{16,})/) ||
    text.match(/location\.replace\("mainPage\.jsp\?id=([A-Fa-f0-9]+)/) ||
    text.match(/id=([A-Fa-f0-9]{32})/);
  if (!m) throw new Error("Maxim login failed (no session id in response)");
  client.sessionId = m[1];
  return client.sessionId;
}

const withSession = async (client, fn) => {
  try {
    return await fn();
  } catch (err) {
    if (err && err.code === "MAXIM_EXPIRED") {
      await login(client); // single refresh-and-retry, then fail loudly
      return await fn();
    }
    throw err;
  }
};

// ─── payment report (server-rendered table#example) ───────────────

const parsePaymentTable = (html) => {
  const t0 = html.search(/<table[^>]*id=["']?example["']?/i);
  if (t0 < 0) return [];
  const t1 = html.indexOf("</table>", t0);
  const table = html.slice(t0, t1 < 0 ? undefined : t1);
  const body = table.match(/<tbody[\s\S]*<\/tbody>/i);
  const scope = body ? body[0] : table;
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRe.exec(scope)) !== null) {
    if (/<th/i.test(tr[0])) continue;
    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let td;
    while ((td = tdRe.exec(tr[1])) !== null) cells.push(stripHtml(td[1]));
    if (!cells.length) continue;
    if (/TOTAL/i.test(cells.join(" ")) && cells.filter(Boolean).length < 4)
      continue;
    rows.push(cells);
  }
  return rows;
};

async function fetchPayments(client, sessionId, { fromDate, toDate }) {
  // NOTE: the filter form must be driven via GET query params — POSTing the
  // same fields returns the empty page shell (no table). Verified 2026-09-28.
  const qs = new URLSearchParams({
    id: sessionId,
    linkname: "icustomerpayments-2",
    from_date: fromDate,
    to_date: toDate,
  });
  const text = await getPage(client, `${MAXIM_BASE}/mainPage.jsp?${qs}`);
  return parsePaymentTable(text).map((c) => ({
    username: c[0] || "",
    cust_id: (c[1] || "").split(/\s+/).pop() || "",
    pay_date: parseYmd(c[2]),
    rcv_amount: round2(parseNum(c[3])),
    total_bill: round2(parseNum(c[4])),
    pay_type: c[5] || "",
    money_receipt: c[6] || "",
    remarks: c[7] || "",
    received_by: c[8] || "",
    pop_name: c[9] || "",
    entry_by: c[10] || "",
  }));
}

// ─── customer list (DataTables AJAX per POP/status combo) ─────────

async function discoverPopCombos(client, sessionId) {
  const html = await getPage(
    client,
    `${MAXIM_BASE}/mainPage.jsp?id=${sessionId}&linkname=listicustomers0`,
  );
  const combos = [];
  const formRe = /<form[^>]*action="mainPage\.jsp"[^>]*>([\s\S]*?)<\/form>/gi;
  let fm;
  while ((fm = formRe.exec(html)) !== null) {
    const f = fm[1];
    if (!f.includes("listcust-2")) continue;
    const val = (n) => {
      const m = f.match(
        new RegExp(`name="${n}"[^>]*value="([^"]*)"`, "i"),
      );
      return m ? m[1] : "";
    };
    combos.push({
      label: stripHtml(f).slice(0, 60),
      reseller_id: val("reseller_id") || "0",
      pops: val("pops"),
      s_exp: val("s_exp") || "ND",
      bill_cycle: val("bill_cycle") || "-1",
    });
  }
  const seen = new Set();
  return combos.filter((c) => {
    const k = `${c.reseller_id}|${c.pops}|${c.s_exp}`;
    if (seen.has(k) || !c.pops) return false;
    seen.add(k);
    return true;
  });
}

const customerAjaxParams = (sessionId, combo) => ({
  id: sessionId,
  reseller_id: combo.reseller_id,
  popMultiple: `[${combo.pops}]`,
  bill_cycle: combo.bill_cycle,
  s_plan_id: "-1",
  plan_type: "-1",
  boxno: "null",
  from_date: "",
  to_date: "",
  manager_id: "-1",
  s_exp: combo.s_exp,
  group_id: "-1",
  area: "",
  olt_id: "",
  olt_port: "",
  date_filter: "null",
  show_pass: "0",
});

const customerAjaxBody = (start, length, search) => {
  const p = { draw: "1", start: String(start), length: String(length) };
  for (let i = 0; i < 29; i++) {
    p[`columns[${i}][data]`] = String(i);
    p[`columns[${i}][name]`] = "";
    p[`columns[${i}][searchable]`] = "true";
    p[`columns[${i}][orderable]`] = "true";
    p[`columns[${i}][search][value]`] = "";
    p[`columns[${i}][search][regex]`] = "false";
  }
  p["order[0][column]"] = "0";
  p["order[0][dir]"] = "asc";
  p["search[value]"] = search;
  p["search[regex]"] = "false";
  return p;
};

const cellText = (row, i) => stripHtml(row[i]);

// Maxim owner reseller id (Speed Net Khulna) — fallback when summary forms
// carry reseller_id=0 (which returns zero rows). Verified 2026-09-28.
const OWNER_RESELLER_FALLBACK = process.env.MAXIM_OWNER_RESELLER_ID || "30313";

// Mirror the browser drill-down click: POSTing the listcust-2 form primes the
// server-side dataset the AJAX endpoint below pages through.
async function drillCombo(client, sessionId, combo) {
  await postForm(
    client,
    "mainPage.jsp",
    {
      id: sessionId,
      linkname: "listcust-2",
      reseller_id: combo.reseller_id,
      pops: combo.pops,
      s_exp: combo.s_exp,
      bill_cycle: combo.bill_cycle,
    },
    {},
  );
}

// Fetch one POP (all pages), trying each candidate reseller id until one
// returns rows. Returns mapped + suffix-filtered rows of the winning combo.
async function fetchPopCustomers(client, sessionId, pops, candidates, suffix) {
  const pick = [];
  const seenRes = new Set();
  for (const c of candidates) {
    if (seenRes.has(c.reseller_id)) continue;
    seenRes.add(c.reseller_id);
    pick.push(c);
  }
  pick.push({
    reseller_id: OWNER_RESELLER_FALLBACK,
    s_exp: "ND",
    bill_cycle: "-1",
  });
  for (const combo of pick) {
    const full = { ...combo, pops };
    await withSession(client, () => drillCombo(client, sessionId, full));
    const probe = await withSession(client, () =>
      fetchCustomersPage(client, sessionId, full, 0, 10),
    );
    if (probe.total > 0) {
      const raw = [...probe.rows];
      let start = probe.rows.length;
      while (start < probe.total) {
        const page = await withSession(client, () =>
          fetchCustomersPage(client, sessionId, full, start, PAGE_LEN),
        );
        raw.push(...page.rows);
        start += page.rows.length;
        if (page.rows.length < PAGE_LEN) break;
      }
      const out = [];
      for (const r of raw) {
        const m = mapCustomerRow(r);
        if (m.username && m.username.toLowerCase().includes(suffix.toLowerCase()))
          out.push(m);
      }
      return { combo: full, rows: out };
    }
  }
  return { combo: { pops }, rows: [] };
}

async function fetchCustomersPage(client, sessionId, combo, start, length) {
  // NOTE: Maxim server-side search[value] never matches suffixes
  // (recordsFiltered 0 even when rows exist) — fetch ALL pages with empty
  // search and filter client-side. Verified 2026-09-28.
  const qs = new URLSearchParams(customerAjaxParams(sessionId, combo));
  const { text } = await postForm(
    client,
    `customers/list_customers_2_ajax.jsp?${qs}`,
    customerAjaxBody(start, length, ""),
    { ajax: true },
  );
  const j = text.indexOf("{");
  if (j < 0) throw new Error("Maxim customer AJAX returned non-JSON");
  const data = JSON.parse(text.slice(j));
  return {
    rows: Array.isArray(data.data) ? data.data : [],
    total: Number(data.recordsFiltered || data.recordsTotal || 0),
  };
}

const mapCustomerRow = (r) => {
  const custCell = cellText(r, 1);
  return {
    username: cellText(r, 2),
    cust_id: (custCell || "").split(/\s+/).pop() || "",
    name: cellText(r, 3),
    package_name: cellText(r, 4),
    balance: round2(parseNum(cellText(r, 5))),
    exp_date: parseYmd(cellText(r, 6)),
    last_logout:
      stripHtml(r[7] || "").match(
        /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?)/,
      )?.[1] || null,
    mobile: cellText(r, 8),
    status: cellText(r, 10),
    pop_name: cellText(r, 16),
    bill_cycle: cellText(r, 23),
    raw: {
      created: cellText(r, 9),
      group: cellText(r, 17),
      net_bill: cellText(r, 18),
      email: cellText(r, 21),
    },
  };
};

// ─── persistence ──────────────────────────────────────────────────

async function upsertCustomers(snapshotMonth, resellerId, suffix, rows) {
  let n = 0;
  for (const r of rows) {
    await pool.query(
      `INSERT INTO maxim_customer_snapshots
        (snapshot_month, username, cust_id, reseller_suffix, reseller_id,
         name, package_name, balance, exp_date, last_logout, mobile,
         status, pop_name, bill_cycle, raw, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,NOW())
       ON CONFLICT (snapshot_month, username) DO UPDATE SET
         cust_id = EXCLUDED.cust_id, reseller_suffix = EXCLUDED.reseller_suffix,
         reseller_id = EXCLUDED.reseller_id, name = EXCLUDED.name,
         package_name = EXCLUDED.package_name, balance = EXCLUDED.balance,
         exp_date = EXCLUDED.exp_date, last_logout = EXCLUDED.last_logout,
         mobile = EXCLUDED.mobile, status = EXCLUDED.status,
         pop_name = EXCLUDED.pop_name, bill_cycle = EXCLUDED.bill_cycle,
         raw = EXCLUDED.raw, fetched_at = NOW()`,
      [
        snapshotMonth,
        r.username,
        r.cust_id,
        suffix,
        resellerId,
        r.name,
        r.package_name,
        r.balance,
        r.exp_date,
        r.last_logout,
        r.mobile,
        r.status,
        r.pop_name,
        r.bill_cycle,
        JSON.stringify(r.raw || {}),
      ],
    );
    n++;
  }
  return n;
}

async function upsertPayments(snapshotMonth, resellerId, suffix, rows) {
  // Cash-only: Credit rows are bill adjustments (rcv 0), not real collection.
  await pool.query(
    `DELETE FROM maxim_payment_snapshots
     WHERE snapshot_month = $1::date AND reseller_id = $2
       AND LOWER(pay_type) <> 'cash'`,
    [snapshotMonth, resellerId],
  );
  let n = 0;
  for (const r of rows) {
    if (!r.username.toLowerCase().includes(suffix.toLowerCase())) continue;
    if (String(r.pay_type || "").toLowerCase() !== "cash") continue;
    await pool.query(
      `INSERT INTO maxim_payment_snapshots
        (snapshot_month, username, cust_id, reseller_suffix, reseller_id,
         pay_date, rcv_amount, total_bill, pay_type, money_receipt,
         remarks, received_by, entry_by, pop_name, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       ON CONFLICT (snapshot_month, username, pay_date, rcv_amount, money_receipt)
       DO UPDATE SET
         cust_id = EXCLUDED.cust_id, reseller_suffix = EXCLUDED.reseller_suffix,
         reseller_id = EXCLUDED.reseller_id, total_bill = EXCLUDED.total_bill,
         pay_type = EXCLUDED.pay_type, remarks = EXCLUDED.remarks,
         received_by = EXCLUDED.received_by, entry_by = EXCLUDED.entry_by,
         pop_name = EXCLUDED.pop_name, fetched_at = NOW()`,
      [
        snapshotMonth,
        r.username,
        r.cust_id,
        suffix,
        resellerId,
        r.pay_date || snapshotMonth,
        r.rcv_amount,
        r.total_bill,
        r.pay_type,
        r.money_receipt,
        r.remarks,
        r.received_by,
        r.entry_by,
        r.pop_name,
      ],
    );
    n++;
  }
  return n;
}

// ─── main entry ───────────────────────────────────────────────────

/**
 * Run a full Maxim sync for one reseller + month.
 * @param {{resellerId:number, suffix:string, monthYm:string, source?:string, logId?:number}} opts
 */
async function runMaximSync({ resellerId, suffix, monthYm, source = "manual", logId = null }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthYm || ""))
    throw new Error("month must be YYYY-MM");
  if (!/^@[a-z0-9_.-]+$/i.test(suffix || ""))
    throw new Error("suffix must look like @speednetmasum");
  const key = `${resellerId}:${monthYm}`;
  if (running.has(key)) throw new Error("Sync already running for this reseller/month");
  running.add(key);

  await initChannelPartnerTables();
  const { first, last } = monthRangeYm(monthYm);
  const snapshotMonth = first;
  const client = newClient();
  let nCust = 0;
  let nPay = 0;
  try {
    await login(client);
    const sessionId = client.sessionId;

    const payRows = await withSession(client, () =>
      fetchPayments(client, sessionId, { fromDate: first, toDate: last }),
    );
    nPay = await upsertPayments(snapshotMonth, resellerId, suffix, payRows);

    const combos = await withSession(client, () =>
      discoverPopCombos(client, sessionId),
    );
    // Group by POP; per POP try each seen reseller id (+owner fallback).
    const popsMap = new Map();
    for (const c of combos) {
      if (!c.pops) continue;
      if (!popsMap.has(c.pops)) popsMap.set(c.pops, []);
      popsMap.get(c.pops).push(c);
    }
    let popCount = 0;
    for (const [pops, candidates] of popsMap) {
      const { rows } = await fetchPopCustomers(
        client,
        sessionId,
        pops,
        candidates,
        suffix,
      );
      popCount++;
      nCust += await upsertCustomers(snapshotMonth, resellerId, suffix, rows);
    }

    if (logId) {
      await pool.query(
        `UPDATE maxim_sync_logs SET status='completed', rows_customers=$2,
          rows_payments=$3, finished_at=NOW() WHERE id=$1`,
        [logId, nCust, nPay],
      );
    }
    // Auto-import: fill blank Receive rows from snapshots (manual edits kept).
    let autoImport = { filled: 0, created: 0, skipped: 0 };
    try {
      autoImport = await getAutoImporter()(resellerId, monthYm);
    } catch (ie) {
      console.warn("[MaximSync] auto-import failed:", ie.message);
      autoImport = { error: ie.message };
    }
    return { customers: nCust, payments: nPay, combos: popCount, autoImport };
  } catch (err) {
    if (logId) {
      await pool.query(
        `UPDATE maxim_sync_logs SET status='failed', error=$2, finished_at=NOW()
         WHERE id=$1`,
        [logId, String((err && err.message) || err).slice(0, 2000)],
      ).catch(() => {});
    }
    throw err;
  } finally {
    running.delete(key);
  }
}

module.exports = { runMaximSync, MaximExpiredError };

// ─── CLI (one-off verify runs) ────────────────────────────────────
// Usage:
//   node server/utilities/maximSync.js --resellerId 29 --suffix @speednetmasum --monthYm 2026-09 [--source verify]
// Always closes the DB pool and exits (0 = ok, 1 = failed, 2 = bad args),
// so a finished run can never orphan on the pg keepalive timer.
// Do NOT use bare `node -e "...runMaximSync..."` anymore.
if (require.main === module) {
  (async () => {
    const get = (name) => {
      const i = process.argv.indexOf(`--${name}`);
      return i >= 0 ? process.argv[i + 1] : undefined;
    };
    const resellerId = Number(get("resellerId"));
    const suffix = get("suffix");
    const monthYm = get("monthYm");
    const source = get("source") || "cli";
    if (!Number.isFinite(resellerId) || !suffix || !monthYm) {
      console.error(
        "Usage: node server/utilities/maximSync.js --resellerId <id> --suffix <@suffix> --monthYm <YYYY-MM> [--source verify]",
      );
      process.exit(2);
    }
    let code = 0;
    try {
      require("./envLoader").loadEnv();
      const r = await runMaximSync({ resellerId, suffix, monthYm, source });
      console.log("RESULT:", JSON.stringify(r));
    } catch (e) {
      console.error("FAILED:", (e && e.message) || e);
      code = 1;
    } finally {
      try {
        await pool.end();
      } catch (_) {
        // pool already closed / never connected — exit anyway
      }
      process.exit(code);
    }
  })();
}
