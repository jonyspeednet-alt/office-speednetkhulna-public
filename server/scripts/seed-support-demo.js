require('../config/env');
const pool = require('../utilities/db');

const customers = [
  { username: 'DEMO-PPPOE-1001', phone: '01700000001', address: 'Sonadanga, Khulna', profile: '10M', online: true },
  { username: 'DEMO-PPPOE-1002', phone: '01800000002', address: 'Nirala, Khulna', profile: '20M', online: false },
  { username: 'DEMO-PPPOE-1003', phone: '01900000003', address: 'Daulatpur, Khulna', profile: '30M', online: true },
];

const tickets = [
  { no: 'DEMO-SUP-001', username: 'DEMO-PPPOE-1001', category: 'internet_down', subject: 'ইন্টারনেট সংযোগ পাচ্ছে না', priority: 'high', status: 'new' },
  { no: 'DEMO-SUP-002', username: 'DEMO-PPPOE-1002', category: 'slow_speed', subject: 'সন্ধ্যার সময় ইন্টারনেট স্লো', priority: 'medium', status: 'in_progress' },
  { no: 'DEMO-SUP-003', username: 'DEMO-PPPOE-1003', category: 'router_onu', subject: 'ONU-তে LOS light জ্বলছে', priority: 'critical', status: 'verification_pending' },
  { no: 'DEMO-SUP-004', username: 'DEMO-PPPOE-1001', category: 'billing', subject: 'বিল পরিশোধের পরেও সংযোগ বন্ধ', priority: 'medium', status: 'closed' },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const customer of customers) {
      await client.query(
        `INSERT INTO network_customers
          (router_id, pppoe_username, package_profile, service, disabled, is_online, comment_raw, phone, address, parse_status, parse_confidence, last_synced_at)
         VALUES ('demo-seed', $1, $2, 'pppoe', FALSE, $3, $4, $5, $6, 'parsed', 'high', NOW())
         ON CONFLICT (router_id, pppoe_username) DO UPDATE SET
           package_profile=EXCLUDED.package_profile, is_online=EXCLUDED.is_online,
           comment_raw=EXCLUDED.comment_raw, phone=EXCLUDED.phone, address=EXCLUDED.address, updated_at=NOW()`,
        [customer.username, customer.profile, customer.online, `${customer.phone}, ${customer.address}`, customer.phone, customer.address],
      );
    }
    for (const ticket of tickets) {
      await client.query(
        `INSERT INTO support_tickets
          (ticket_no, customer_id, customer_snapshot, category_id, subject, description, source, status, priority, resolved_at, closed_at)
         SELECT $1, c.id,
           jsonb_build_object('pppoe_username', c.pppoe_username, 'phone', c.phone, 'address', c.address, 'package_profile', c.package_profile),
           sc.id, $2, 'Demo data - test ticket only', 'phone', $3::varchar, $4::varchar,
           CASE WHEN $3::varchar IN ('verification_pending','closed') THEN NOW() ELSE NULL END,
           CASE WHEN $3::varchar = 'closed' THEN NOW() ELSE NULL END
         FROM network_customers c
         JOIN support_categories sc ON sc.name=$5
         WHERE c.router_id='demo-seed' AND c.pppoe_username=$6
         ON CONFLICT (ticket_no) DO NOTHING`,
        [ticket.no, ticket.subject, ticket.status, ticket.priority, ticket.category, ticket.username],
      );
      await client.query(
        `INSERT INTO support_ticket_events (ticket_id, event_type, message, new_status)
         SELECT t.id, 'created', 'Demo ticket created', t.status
         FROM support_tickets t
         WHERE t.ticket_no=$1
           AND NOT EXISTS (SELECT 1 FROM support_ticket_events e WHERE e.ticket_id=t.id AND e.message='Demo ticket created')`,
        [ticket.no],
      );
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ customers: customers.length, tickets: tickets.length, marker: 'demo-seed' }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
