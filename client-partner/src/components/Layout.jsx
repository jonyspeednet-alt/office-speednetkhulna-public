import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const distributionLinks = [
  { to: '/', icon: 'fa-th-large', label: 'ড্যাশবোর্ড', end: true },
  { to: '/request/new', icon: 'fa-plus-circle', label: 'রিকোয়েস্ট ব্যান্ডউইথ' },
  { to: '/history', icon: 'fa-history', label: 'রিকোয়েস্ট হিস্ট্রি' },
  { to: '/payments', icon: 'fa-wallet', label: 'পেমেন্ট হিস্ট্রি' },
  { to: '/settings', icon: 'fa-cog', label: 'সেটিংস' },
];

const commissionLinks = [
  { to: '/', icon: 'fa-chart-pie', label: 'কমিশন ড্যাশবোর্ড', end: true },
  { to: '/payments', icon: 'fa-wallet', label: 'কমিশন পেমেন্ট হিস্ট্রি' },
  { to: '/settings', icon: 'fa-cog', label: 'সেটিংস' },
];

const LOGO = 'https://speednetkhulna.com/assets/img/logo-b.png';

// Mirrors server/middleware/partnerAuth.js normalizePartnerType so the portal
// treats legacy 'channel'/'chanel'/'mac' variants the same as the backend.
export function normalizePartnerType(value) {
  const type = String(value || 'distribution_partner')
    .trim()
    .toLowerCase()
    .replace(/[ -]+/g, '_');
  if (['channel_partner', 'channel', 'chanel_partner', 'chanel'].includes(type)) return 'channel_partner';
  if (['mac_partner', 'mac'].includes(type)) return 'mac_partner';
  return 'distribution_partner';
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const { logout, reseller } = useAuth();
  const isCommissionPartner = ['channel_partner', 'mac_partner'].includes(normalizePartnerType(reseller?.partner_type));
  const visibleLinks = isCommissionPartner ? commissionLinks : distributionLinks;
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <div className={`sidebar${open ? ' active' : ''}`} id="sidebar" aria-label="পার্টনার সাইডবার">
        <div className="brand-logo">
          <img src={LOGO} alt="Speed Net" style={{ height: 40 }} />
        </div>
        <p className="sidebar-group-label">মেনু</p>
        <ul className="nav flex-column flex-grow-1 sidebar-nav" aria-label="পার্টনার নেভিগেশন">
          {visibleLinks.map((l) => (
            <li className="nav-item" key={l.to}>
              <NavLink
                to={l.to}
                end={l.end}
                className={({ isActive }) => `nav-link-p${isActive ? ' active' : ''}`}
                onClick={() => setOpen(false)}
              >
                <i className={`fas ${l.icon}`} /> {l.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="nav-link-p text-danger sidebar-logout" onClick={handleLogout} role="button" tabIndex={0} aria-label="লগআউট">
          <i className="fas fa-sign-out-alt" /> লগআউট
        </div>
      </div>

      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} />}

      <div className="main-content">
        <i
          className="fas fa-bars mobile-toggle mb-3"
          onClick={() => setOpen((v) => !v)}
          aria-label="মেনু খুলুন"
          aria-expanded={open}
        />
        <Outlet />
      </div>
    </>
  );
}
