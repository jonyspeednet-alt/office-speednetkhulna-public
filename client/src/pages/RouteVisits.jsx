import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRoutes, addRoute, getVisits, addVisit, verifyVisit,
  getDailyReport, getMonthlyReport,
} from '../services/routeVisitService';
import '../styles/RouteVisits.css';

const VISIT_TYPES = [
  'prospect', 'survey', 'close', 'form',
  'bill_submit', 'bill_collect', 'corporate', 'branding', 'competitor',
];
const TYPE_OUTCOMES = {
  prospect: ['pending', 'interested', 'hot', 'lost'],
  survey: ['done', 'lost'],
  close: ['closed'],
  form: ['done'],
  bill_submit: ['done'],
  bill_collect: ['done', 'pending'],
  corporate: ['pending', 'interested', 'hot', 'closed', 'lost'],
  branding: ['done'],
  competitor: ['done'],
};
const LOCKED_OUTCOME = { close: 'closed', form: 'done', bill_submit: 'done', branding: 'done', competitor: 'done' };
const PACKAGES = ['5 Mbps', '10 Mbps', '15 Mbps', '20 Mbps', '30 Mbps', '50 Mbps', '100 Mbps', 'Corporate'];
// Per-type dynamic fields. `req` is a UI hint only — server enforces via TYPE_RULES.
const TYPE_FIELDS = {
  prospect: [
    { k: 'decision_maker', label: 'Decision maker *', type: 'select', options: ['owner', 'manager', 'caretaker'] },
    { k: 'package_discussed', label: 'Package discussed *', type: 'select', options: PACKAGES },
    { k: 'current_isp', label: 'Current ISP', type: 'select', options: ['none', 'Link3', 'AmberIT', 'BTPL', 'other'] },
    { k: 'monthly_budget', label: 'Monthly budget Tk', type: 'number' },
    { k: 'building_type', label: 'Building', type: 'select', options: ['home', 'shop', 'office', 'mess'] },
    { k: 'leaflet_qty', label: 'Leaflets given', type: 'number' },
  ],
  survey: [
    { k: 'nearest_ot_dp', label: 'Nearest OT/DP *', type: 'text' },
    { k: 'fiber_distance_m', label: 'Fiber distance (m) *', type: 'number' },
    { k: 'pole_count', label: 'Pole count *', type: 'number' },
    { k: 'feasibility', label: 'Feasibility *', type: 'select', options: ['feasible', 'not-feasible'] },
    { k: 'install_estimate', label: 'Install estimate Tk', type: 'number' },
    { k: 'cable_needed_m', label: 'Cable needed (m)', type: 'number' },
  ],
  close: [
    { k: 'package_selected', label: 'Package selected *', type: 'select', options: PACKAGES },
    { k: 'advance_paid', label: 'Advance paid Tk *', type: 'number', step: '0.01' },
    { k: 'pay_method', label: 'Pay method', type: 'select', options: ['cash', 'bKash', 'Nagad', 'bank'] },
    { k: 'installation_date', label: 'Installation date *', type: 'date' },
    { k: 'onu_router', label: 'ONU/Router', type: 'select', options: ['isp-provided', 'customer-own', 'need-buy'] },
  ],
  form: [
    { k: 'form_serial_no', label: 'Form serial no *', type: 'text' },
    { k: 'nid_number', label: 'NID number *', type: 'text' },
    { k: 'package_selected', label: 'Package *', type: 'select', options: PACKAGES },
    { k: 'docs_nid', label: 'NID copy attached', type: 'select', options: ['yes', 'no'] },
    { k: 'docs_photo', label: 'Photo attached', type: 'select', options: ['yes', 'no'] },
    { k: 'docs_bill', label: 'Utility bill attached', type: 'select', options: ['yes', 'no'] },
    { k: 'applicant_matches_nid', label: 'Applicant matches NID', type: 'select', options: ['yes', 'no'] },
  ],
  bill_submit: [
    { k: 'bill_month', label: 'Bill month (YYYY-MM) *', type: 'month' },
    { k: 'bill_amount', label: 'Submitted amount Tk *', type: 'number', step: '0.01' },
    { k: 'submitted_to', label: 'Submitted to (office/receiver) *', type: 'text' },
    { k: 'submission_ref', label: 'Challan/ref no', type: 'text' },
  ],
  bill_collect: [
    { k: 'bill_month', label: 'Bill month (YYYY-MM) *', type: 'month' },
    { k: 'amount_due', label: 'Amount due Tk *', type: 'number', step: '0.01' },
    { k: 'collection_amount', label: 'Amount received Tk *', type: 'number', step: '0.01' },
    { k: 'receipt_no', label: 'Receipt no *', type: 'text' },
    { k: 'payment_mode', label: 'Payment mode *', type: 'select', options: ['cash', 'bKash', 'Nagad', 'bank'] },
  ],
  corporate: [
    { k: 'contact_person', label: 'Contact person *', type: 'text' },
    { k: 'contact_designation', label: 'Designation', type: 'text' },
    { k: 'contact_email', label: 'Contact email', type: 'text' },
    { k: 'users_count', label: 'Users count', type: 'number' },
    { k: 'requirement', label: 'Requirement (lines/speed) *', type: 'text' },
    { k: 'deal_value', label: 'Deal value MRC Tk *', type: 'number', step: '0.01' },
    { k: 'mou_stage', label: 'Stage *', type: 'select', options: ['pitched', 'quoted', 'negotiating', 'mou', 'won'] },
    { k: 'mou_no', label: 'MOU/Quotation no', type: 'text' },
    { k: 'expected_close_date', label: 'Expected close', type: 'date' },
  ],
  branding: [
    { k: 'branding_subtype', label: 'Branding type *', type: 'select', options: ['leaflet', 'banner', 'miking', 'booth', 'wall_paint'] },
  ],
  competitor: [
    { k: 'competitor_name', label: 'Competitor *', type: 'select', options: ['Link3', 'AmberIT', 'BTPL', 'Skynet', 'other'] },
    { k: 'competitor_package', label: 'Package/speed', type: 'text' },
    { k: 'competitor_price', label: 'Price MRC Tk *', type: 'number', step: '0.01' },
    { k: 'competitor_install', label: 'Install charge Tk', type: 'number', step: '0.01' },
    { k: 'competitor_offer', label: 'Offer/promo', type: 'text' },
    { k: 'competitor_source', label: 'Source', type: 'select', options: ['poster', 'customer', 'heard'] },
  ],
};
const BRANDING_SUBFIELDS = {
  leaflet: [{ k: 'leaflet_qty', label: 'Leaflet qty *', type: 'number' }],
  banner: [
    { k: 'banner_qty', label: 'Banner qty *', type: 'number' },
    { k: 'banner_size', label: 'Banner size', type: 'text' },
    { k: 'install_location', label: 'Install location *', type: 'text' },
  ],
  miking: [
    { k: 'miking_hours', label: 'Miking hours *', type: 'number', step: '0.5' },
    { k: 'miking_area', label: 'Miking area *', type: 'text' },
  ],
  booth: [
    { k: 'booth_location', label: 'Booth location *', type: 'text' },
    { k: 'booth_hours', label: 'Duration hrs *', type: 'number', step: '0.5' },
    { k: 'leads_collected', label: 'Leads collected', type: 'number' },
  ],
  wall_paint: [
    { k: 'wall_count', label: 'Wall count *', type: 'number' },
    { k: 'wall_location', label: 'Wall location *', type: 'text' },
    { k: 'wall_sqft', label: 'Sqft', type: 'number' },
  ],
};
const PHOTO_HINT = {
  survey: 'OT/pole/house photo *', close: 'Money receipt photo (if advance)', form: 'Filled form/NID photo *',
  bill_submit: 'Bill copy photo *', bill_collect: 'Money receipt photo *', branding: 'Work location photo *',
  competitor: 'Poster/leaflet photo *',
};
const PURPOSES = ['sales', 'branding', 'collection', 'corporate', 'other'];

const todayDhaka = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
const currentMonth = () => todayDhaka().slice(0, 7);

const currentUserFromStorage = () => {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};

const emptyVisit = () => ({
  area: '', shop_name: '', owner_name: '', phone: '', address: '',
  visit_type: 'prospect', outcome: 'pending',
  package_discussed: '', leaflet_qty: '', banner_qty: '', forms_filled: '', day_sale: '',
  collection_amount: '', followup_date: '', lost_reason: '', competitor_note: '',
  gps_lat: '', gps_lng: '',
  decision_maker: '', current_isp: '', monthly_budget: '', building_type: '',
  nearest_ot_dp: '', fiber_distance_m: '', pole_count: '', feasibility: '', install_estimate: '', cable_needed_m: '',
  package_selected: '', advance_paid: '', pay_method: '', installation_date: '', onu_router: '',
  form_serial_no: '', nid_number: '', docs_nid: '', docs_photo: '', docs_bill: '', applicant_matches_nid: '',
  bill_month: '', bill_amount: '', submitted_to: '', submission_ref: '',
  amount_due: '', receipt_no: '', payment_mode: '',
  contact_person: '', contact_designation: '', contact_email: '', users_count: '', requirement: '',
  deal_value: '', mou_stage: '', mou_no: '', expected_close_date: '',
  branding_subtype: '', miking_hours: '', miking_area: '', booth_location: '', booth_hours: '', leads_collected: '',
  wall_count: '', wall_location: '', wall_sqft: '', banner_size: '', install_location: '',
  competitor_name: '', competitor_package: '', competitor_price: '', competitor_install: '',
  competitor_offer: '', competitor_source: '',
});

const renderField = (form, setForm, f) => {
  const val = form[f.k] ?? '';
  const set = (v) => setForm({ ...form, [f.k]: v });
  if (f.type === 'select') {
    return (
      <select key={f.k} value={val} onChange={(e) => set(e.target.value)} title={f.label}>
        <option value="">{f.label}</option>
        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  const inputType = f.type === 'number' ? 'number' : (f.type === 'date' || f.type === 'month' ? f.type : 'text');
  return (
    <input key={f.k} type={inputType} min={f.type === 'number' ? '0' : undefined} step={f.step}
      placeholder={f.label} title={f.label} value={val} onChange={(e) => set(e.target.value)} />
  );
};

export default function RouteVisits() {
  const qc = useQueryClient();
  const me = currentUserFromStorage();
  const perms = me?.permissions || me || {};
  const canVerify = !!(perms['route_visit.verify'] || perms['route_visit.manage'] || perms['p_route_visit_verify'] || perms['all_access']);

  const [tab, setTab] = useState('visits');
  const [filter, setFilter] = useState({ from: todayDhaka(), to: todayDhaka(), status: '' });
  const [reportDate, setReportDate] = useState(todayDhaka());
  const [reportMonth, setReportMonth] = useState(currentMonth());
  const [form, setForm] = useState(emptyVisit());
  const [photo, setPhoto] = useState(null);
  const [plan, setPlan] = useState({ route_date: todayDhaka(), area: '', purpose: 'sales', target_visits: 10, plan_text: '' });
  const [msg, setMsg] = useState('');

  const visitsQ = useQuery({ queryKey: ['rvVisits', filter], queryFn: () => getVisits(filter), staleTime: 15000 });
  const routesQ = useQuery({ queryKey: ['rvRoutes', filter.from], queryFn: () => getRoutes({ from: filter.from, to: filter.to }), staleTime: 30000 });
  const dailyQ = useQuery({ queryKey: ['rvDaily', reportDate], queryFn: () => getDailyReport({ date: reportDate }), enabled: tab === 'report' });
  const monthlyQ = useQuery({ queryKey: ['rvMonthly', reportMonth], queryFn: () => getMonthlyReport({ month: reportMonth }), enabled: tab === 'report' });

  const addMut = useMutation({
    mutationFn: addVisit,
    onSuccess: (d) => {
      qc.invalidateQueries(['rvVisits']);
      setForm(emptyVisit()); setPhoto(null); setMsg(d?.warning?.duplicate_phone ? 'Saved with warning: duplicate phone' : 'Visit saved');
    },
    onError: (e) => setMsg(e?.response?.data?.message || 'Save failed'),
  });
  const planMut = useMutation({
    mutationFn: addRoute,
    onSuccess: () => { qc.invalidateQueries(['rvRoutes']); setMsg('Route plan saved'); },
    onError: (e) => setMsg(e?.response?.data?.message || 'Plan save failed'),
  });
  const verifyMut = useMutation({
    mutationFn: verifyVisit,
    onSuccess: () => qc.invalidateQueries(['rvVisits']),
  });

  const tryGps = (high, timeout) => new Promise((res, rej) => {
    navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: high, timeout, maximumAge: 60000 });
  });
  const captureGps = async () => {
    if (!navigator.geolocation) { setMsg('GPS not supported on this browser'); return; }
    if (!window.isSecureContext) { setMsg('GPS needs HTTPS — open https://office.speednetkhulna.com (not IP/HTTP), then retry'); return; }
    setMsg('Capturing GPS...');
    const done = (pos) => {
      setForm((f) => ({ ...f, gps_lat: pos.coords.latitude.toFixed(6), gps_lng: pos.coords.longitude.toFixed(6) }));
      setMsg(`GPS captured (+/-${Math.round(pos.coords.accuracy || 0)}m)`);
    };
    const failMsg = (e) => {
      const code = ` (code ${e.code}: ${e.message || 'no detail'})`;
      if (e.code === 1) setMsg(`Location permission blocked — phone Settings > Location ON, browser site permission Allow, then retry${code}`);
      else if (e.code === 2) setMsg(`No location fix — go outside/open sky, turn Location+WiFi ON, then retry. Save works without GPS${code}`);
      else setMsg(`GPS timed out indoors — retry outside, or type lat/lng manually below${code}`);
    };
    try {
      done(await tryGps(false, 12000)); // fast network fix first
    } catch (e1) {
      try {
        done(await tryGps(true, 30000)); // precise GPS fix fallback
      } catch (e2) { failMsg(e2); }
    }
  };

  const changeType = (next) => {
    // Keep identity/location, reset type-specific fields to avoid stale values.
    const keep = {
      area: form.area, shop_name: form.shop_name, owner_name: form.owner_name,
      phone: form.phone, address: form.address, gps_lat: form.gps_lat, gps_lng: form.gps_lng,
    };
    setForm({ ...emptyVisit(), ...keep, visit_type: next, outcome: LOCKED_OUTCOME[next] || 'pending' });
    setPhoto(null);
  };

  const submitVisit = (e) => {
    e.preventDefault();
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ''));
    fd.append('visit_date', filter.from || todayDhaka());
    if (photo) fd.append('photo', photo);
    addMut.mutate(fd);
  };

  const visits = visitsQ.data || [];
  const routes = routesQ.data || [];

  return (
    <div className="rv-wrap">
      <div className="rv-header">
        <h3><i className="fas fa-route me-2"></i>Sales & Marketing</h3>
        <div className="rv-tabs">
          {['visits', 'plans', 'report'].map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t.toUpperCase()}</button>
          ))}
        </div>
      </div>
      {msg && <div className="rv-msg">{msg}</div>}

      {tab === 'visits' && (
        <>
          <form className="rv-form" onSubmit={submitVisit}>
            <input placeholder="Area *" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} required />
            <select value={form.visit_type} onChange={(e) => changeType(e.target.value)} title="Visit type">
              {VISIT_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            {(TYPE_OUTCOMES[form.visit_type] || []).length > 1 ? (
              <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} title="Outcome">
                {TYPE_OUTCOMES[form.visit_type].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : (
              <input value={`Outcome: ${LOCKED_OUTCOME[form.visit_type] || form.outcome}`} disabled title="Outcome (locked for this type)" />
            )}
            <input placeholder="Shop / Party name" value={form.shop_name} onChange={(e) => setForm({ ...form, shop_name: e.target.value })} />
            <input placeholder="Owner" value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} />
            <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            {(TYPE_FIELDS[form.visit_type] || []).map((f) => renderField(form, setForm, f))}
            {form.visit_type === 'branding' && (BRANDING_SUBFIELDS[form.branding_subtype] || []).map((f) => renderField(form, setForm, f))}
            <input type="date" value={form.followup_date} onChange={(e) => setForm({ ...form, followup_date: e.target.value })} title="Follow-up date" />
            <input placeholder="Lost reason" value={form.lost_reason} onChange={(e) => setForm({ ...form, lost_reason: e.target.value })} />
            <div className="rv-row">
              <button type="button" onClick={captureGps}>Capture GPS</button>
              <input placeholder="Lat (optional)" title="Latitude" value={form.gps_lat} onChange={(e) => setForm({ ...form, gps_lat: e.target.value })} />
              <input placeholder="Lng (optional)" title="Longitude" value={form.gps_lng} onChange={(e) => setForm({ ...form, gps_lng: e.target.value })} />
              {form.gps_lat && form.gps_lng && (
                <a target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${form.gps_lat},${form.gps_lng}`}>Open in Maps</a>
              )}
            </div>
            {form.gps_lat && form.gps_lng && (
              <div className="rv-map">
                <iframe title="visit-location" width="100%" height="220" loading="lazy"
                  src={`https://maps.google.com/maps?q=${form.gps_lat},${form.gps_lng}&z=16&output=embed`} />
              </div>
            )}
            <div className="rv-row">
              <input type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
              {PHOTO_HINT[form.visit_type] && <small>{PHOTO_HINT[form.visit_type]}</small>}
            </div>
            <button type="submit" disabled={addMut.isPending}>{addMut.isPending ? 'Saving...' : 'Save Visit'}</button>
          </form>

          <div className="rv-filters">
            <input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} />
            <input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} />
            <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All status</option>
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <div className="table-responsive">
            <table className="rv-table">
              <thead><tr><th>Date</th><th>Area</th><th>Type</th><th>Party</th><th>Outcome</th><th>Status</th><th>Sale/Coll</th><th>Action</th></tr></thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id}>
                    <td>{v.visit_date?.slice(0, 10)}</td>
                    <td>{v.area}</td>
                    <td>{v.visit_type}</td>
                    <td>{v.shop_name || v.owner_name}<br /><small>{v.phone}</small></td>
                    <td>{v.outcome}</td>
                    <td>{v.status}</td>
                    <td>{v.day_sale}/{v.collection_amount}{Number(v.bill_amount) > 0 ? ` (sub ${v.bill_amount})` : ''}</td>
                    <td>
                      {canVerify && v.status === 'pending' && (
                        <>
                          <button onClick={() => verifyMut.mutate({ id: v.id, action: 'verify' })}>Verify</button>
                          <button onClick={() => verifyMut.mutate({ id: v.id, action: 'reject' })}>Reject</button>
                        </>
                      )}
                      {v.gps_lat && <a target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${v.gps_lat},${v.gps_lng}`}>Map</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'plans' && (
        <>
          <form className="rv-form" onSubmit={(e) => { e.preventDefault(); planMut.mutate(plan); }}>
            <input type="date" value={plan.route_date} onChange={(e) => setPlan({ ...plan, route_date: e.target.value })} required />
            <input placeholder="Area *" value={plan.area} onChange={(e) => setPlan({ ...plan, area: e.target.value })} required />
            <select value={plan.purpose} onChange={(e) => setPlan({ ...plan, purpose: e.target.value })}>
              {PURPOSES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input type="number" min="0" value={plan.target_visits} onChange={(e) => setPlan({ ...plan, target_visits: e.target.value })} title="Target visits" />
            <input placeholder="Plan note" value={plan.plan_text} onChange={(e) => setPlan({ ...plan, plan_text: e.target.value })} />
            <button type="submit">Save Plan</button>
          </form>
          <div className="table-responsive">
            <table className="rv-table">
              <thead><tr><th>Date</th><th>Area</th><th>Purpose</th><th>Target</th><th>Staff</th></tr></thead>
              <tbody>{routes.map((r) => (
                <tr key={r.id}><td>{r.route_date?.slice(0, 10)}</td><td>{r.area}</td><td>{r.purpose}</td><td>{r.target_visits}</td><td>{r.staff_name}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'report' && (
        <>
          <div className="rv-filters">
            <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            <input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} />
          </div>
          <h5>Daily — {dailyQ.data?.date}</h5>
          <div className="table-responsive">
            <table className="rv-table">
              <thead><tr><th>Staff</th><th>Visits</th><th>Verified</th><th>Leads/Hot</th><th>Closes</th><th>Forms</th><th>Coll (n/Tk)</th><th>Submitted Tk</th><th>Due FU</th></tr></thead>
              <tbody>{(dailyQ.data?.rows || []).map((r) => (
                <tr key={r.staff_id}><td>{r.staff_name}</td><td>{r.visits}</td><td>{r.verified}</td><td>{r.leads}/{r.hot}</td><td>{r.closes} ({r.day_sale})</td><td>{r.forms}</td><td>{r.coll_n}/{r.coll_amt}</td><td>{r.submitted_amt}</td><td>{r.due_followups}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <h5>Monthly — {monthlyQ.data?.month} (funnel)</h5>
          {monthlyQ.data && (
            <div className="rv-cards">
              <span>Visits {monthlyQ.data.funnel.visits}</span>
              <span>Leads {monthlyQ.data.funnel.leads} ({monthlyQ.data.funnel.lead_rate}%)</span>
              <span>Surveys {monthlyQ.data.funnel.surveys}</span>
              <span>Closes {monthlyQ.data.funnel.closes} ({monthlyQ.data.funnel.close_rate}%)</span>
              <span>Collection {monthlyQ.data.funnel.collection}</span>
            </div>
          )}
          <h6>Area coverage</h6>
          <div className="table-responsive">
            <table className="rv-table">
              <thead><tr><th>Area</th><th>Visits</th><th>Closes</th></tr></thead>
              <tbody>{(monthlyQ.data?.byArea || []).map((a) => (
                <tr key={a.area}><td>{a.area}</td><td>{a.visits}</td><td>{a.closes}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
