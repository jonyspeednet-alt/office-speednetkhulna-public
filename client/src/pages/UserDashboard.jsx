import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getUserDashboardData } from '../services/userDashboardService';
import { getSupportDashboard, getMyTicketSummary } from '../services/supportService';
import { getLatestMonthlyAward } from '../services/employeeOfTheMonthService';
import NoticeTicker from '../components/NoticeTicker';
import ImageWithFallback from '../components/ImageWithFallback';
import moment from 'moment';

const hasPerm = (user, ...keys) => {
  if (!user) return false;
  if (user.is_super_admin || user.all_access) return true;
  const p = user.permissions || {};
  if (p.all_access || p['system.all_access']) return true;
  return keys.some((k) => p[k] || user[k]);
};

const UserDashboard = () => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const canSupport = hasPerm(user, 'support.ticket.view', 'p_support_view');
  const canNocView = hasPerm(user, 'reseller.status_noc.view', 'p_noc_view');
  const canCreateTicket = hasPerm(user, 'support.ticket.create', 'p_support_create');
  const canManageAwards = hasPerm(user, 'appointment_letters.generate', 'termination_letters.generate', 'employees.create_edit', 'users.manage');

  const { data, isLoading: loading } = useQuery({
    queryKey: ['userDashboard'],
    queryFn: getUserDashboardData,
  });

  const { data: latestAward } = useQuery({
    queryKey: ['latestEmployeeOfTheMonth'],
    queryFn: getLatestMonthlyAward,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  // Support at-a-glance (only fetched when the user may view tickets).
  // Note: counts are self-scoped server-side for field technicians.
  const { data: supportData } = useQuery({
    queryKey: ['userDashboardSupport'],
    queryFn: () => getSupportDashboard(),
    enabled: canSupport,
    staleTime: 1000 * 60,
    retry: false,
  });
  // My assigned work (scoped to self server-side for every role).
  const { data: myWork } = useQuery({
    queryKey: ['userDashboardMyTickets'],
    queryFn: () => getMyTicketSummary(),
    enabled: canSupport,
    staleTime: 1000 * 60,
    retry: false,
  });
  const myRecent = Array.isArray(myWork?.recent) ? myWork.recent : [];
  const myStats = [
    { label: 'Open', value: Number(myWork?.open || 0), icon: 'fa-inbox', bg: '#e0f2fe', fg: '#0369a1' },
    { label: 'In Progress', value: Number(myWork?.inProgress || 0), icon: 'fa-gear', bg: '#fef3c7', fg: '#d97706' },
    { label: 'Waiting', value: Number(myWork?.waiting || 0), icon: 'fa-hourglass-half', bg: '#ede9fe', fg: '#7c3aed' },
    { label: 'Overdue', value: Number(myWork?.overdue || 0), icon: 'fa-triangle-exclamation', bg: '#fee2e2', fg: '#dc2626' },
  ];
  const supportCounts = supportData?.counts || {};
  // Same buckets as SupportTickets page (lines 598-600).
  const num = (k) => Number(supportCounts[k] || 0);
  const pendingTickets = num('new') + num('waiting_customer') + num('reopened');
  const processingTickets = num('in_progress') + num('assigned') + num('verification_pending') + num('waiting_vendor');
  const solvedTickets = num('closed') + num('resolved');
  const totalTickets = Number(supportData?.totalTickets || 0);
  const formatResponseTime = (seconds) => {
    const total = Number(seconds || 0);
    if (!total) return '-';
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  };
  const supportStats = [
    { label: 'Total Tickets', sub: 'All tickets', value: totalTickets, icon: 'fa-file-lines', bg: '#e0f2fe', fg: '#0369a1' },
    { label: 'Pending', sub: 'Awaiting response', value: pendingTickets, icon: 'fa-hourglass-start', bg: '#fee2e2', fg: '#dc2626' },
    { label: 'Processing', sub: 'In progress', value: processingTickets, icon: 'fa-gear', bg: '#fef3c7', fg: '#d97706' },
    { label: 'Solved', sub: 'Closed + resolved', value: solvedTickets, icon: 'fa-circle-check', bg: '#d1fae5', fg: '#059669' },
    { label: 'Avg. Response', sub: 'First response', value: formatResponseTime(supportData?.avgResponseSeconds), icon: 'fa-clock-rotate-left', bg: '#ede9fe', fg: '#7c3aed' },
  ];

  // Configuration for quota cards (Colors & Labels)
  const quotaConfig = [
    { key: 'Holiday', label: 'Holiday', color: '#2563eb', defaultLimit: 12 },
    { key: 'Festival', label: 'Festival', color: '#00b5ad', defaultLimit: 8 },
    { key: 'Half Day', label: 'Half Day', color: '#ff9800', defaultLimit: 0 },
    { key: 'Unpaid', label: 'Unpaid', color: '#f44336', defaultLimit: 0 }
  ];

  const renderQuotaCard = (config) => {
    if (!data) return null;
    
    const used = data.quotaUsage[config.key] || 0;
    const entitlement = data.entitlements[config.key];
    
    let limitText = "";
    
    if (entitlement !== undefined && entitlement > 0) {
      const remaining = Math.max(0, entitlement - used);
      limitText = ` / ${entitlement} days (left: ${remaining} days)`;
    } else if (entitlement === 0) {
      limitText = " (no quota)";
    } else {
      // Fallback if no entitlement record found but config has default (mostly for display)
      if (config.defaultLimit > 0) {
         limitText = ` / ${config.defaultLimit} days`;
      } else {
         limitText = " days";
      }
    }

    return (
      <div className="col-md-6 col-xl-3" key={config.key}>
        <div className="ui-stat-card h-100" style={{ borderLeft: `5px solid ${config.color}`, padding: 0 }}>
          <div className="card-body d-flex align-items-center justify-content-between">
            <div>
              <h6 className="text-muted fw-bold mb-1">{config.label}</h6>
              <h5 className="fw-bold mb-0 text-dark">
                {used}{limitText}
              </h5>
            </div>
            <div className="rounded-circle p-3 d-flex align-items-center justify-content-center" 
                 style={{ width: '50px', height: '50px', backgroundColor: `${config.color}20`, color: config.color }}>
              <i className="fas fa-chart-pie fa-lg"></i>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="container-fluid p-4">
      <NoticeTicker />
      
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h4 className="fw-bold text-dark mb-1">Welcome, {user.full_name}</h4>
          <p className="text-muted small mb-0">{moment().format('dddd, D MMMM YYYY')}</p>
        </div>
        <div className="d-none d-md-block">
          <span className="badge bg-white text-primary shadow-sm px-3 py-2 rounded-pill border">
            <i className="fas fa-id-badge me-2"></i>{user.emp_id || user.employee_id}
          </span>
        </div>
      </div>

      {latestAward && (
        <section className="ui-card mb-4 overflow-hidden border-0" role="status" aria-label="Recent Employee of the Month" style={{ boxShadow: '0 12px 34px rgba(15, 35, 70, 0.12)', borderRadius: 16 }}>
          <div style={{ height: 7, background: 'linear-gradient(90deg, #0f766e 0%, #f59e0b 52%, #0ea5e9 100%)' }} />
          <div className="card-body p-3 p-md-4">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
              <div className="text-uppercase fw-bold" style={{ color: '#64748b', letterSpacing: '.11em', fontSize: 11 }}>
                <i className="fas fa-star me-2" style={{ color: '#d97706' }} aria-hidden="true"></i>Celebrating our people
              </div>
              <div className="d-flex align-items-center gap-2">
                <span className="badge rounded-pill px-3 py-2" style={{ color: '#92400e', background: '#fef3c7', fontSize: 11 }}>
                  <i className="fas fa-award me-1" aria-hidden="true"></i>Employee of the Month
                </span>
                {canManageAwards && (
                  <Link to="/employee-of-the-month-generator" className="btn btn-sm btn-outline-primary rounded-pill px-3">
                    <i className="fas fa-pen-to-square me-1" aria-hidden="true"></i>Update award
                  </Link>
                )}
              </div>
            </div>

            <div className="d-flex align-items-center flex-wrap gap-3 gap-md-4">
              <div className="flex-shrink-0" style={{ padding: 4, borderRadius: '50%', background: 'linear-gradient(135deg, #fbbf24, #0ea5e9)' }}>
                <ImageWithFallback
                  src={latestAward.profile_pic && latestAward.profile_pic !== 'default.png' ? `/uploads/${latestAward.profile_pic}` : null}
                  alt={latestAward.employee_name}
                  fallbackName={latestAward.employee_name}
                  width={88}
                  height={88}
                  style={{ borderRadius: '50%', border: '3px solid #fff', display: 'block' }}
                />
              </div>

              <div className="flex-grow-1" style={{ minWidth: 180 }}>
                <div className="text-muted small mb-1">Recent award recipient</div>
                <h5 className="fw-bold text-dark mb-1">{latestAward.employee_name}</h5>
                {(latestAward.designation || latestAward.department) && (
                  <div className="text-muted small">
                    {[latestAward.designation, latestAward.department].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>

              <div className="d-flex align-items-center gap-3 rounded-3 px-3 py-2 ms-md-auto" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div className="rounded-circle d-flex align-items-center justify-content-center" style={{ width: 42, height: 42, background: '#e0f2fe', color: '#0369a1' }}>
                  <i className="fas fa-calendar-check" aria-hidden="true"></i>
                </div>
                <div>
                  <div className="text-muted" style={{ fontSize: 11 }}>Award month</div>
                  <div className="fw-bold text-dark">{moment(latestAward.award_month, 'YYYY-MM').format('MMMM, YYYY')}</div>
                </div>
              </div>
            </div>

            {latestAward.updated_at && (
              <div className="text-muted text-end mt-3" style={{ fontSize: 10 }}>
                <i className="fas fa-rotate me-1" aria-hidden="true"></i>Updated {moment(latestAward.updated_at).format('D MMM YYYY')}
              </div>
            )}
          </div>
        </section>
      )}

      {loading ? (
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status"></div>
        </div>
      ) : (
        <div className="row g-4 mb-4">
          {quotaConfig.map(conf => renderQuotaCard(conf))}
        </div>
      )}

      {/* Support & Ticket Management — only for roles with ticket / NOC view */}
      {(canSupport || canNocView) && (
        <div className="ui-card mb-4">
          <div className="card-body p-4">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-3 mb-3">
              <h6 className="fw-bold text-dark mb-0">
                <i className="fas fa-headset text-primary me-2"></i>
                Support &amp; Ticket Management
              </h6>
              <span className="text-muted small">Manage, assign and resolve customer support tickets</span>
            </div>
            {canSupport && (
              <div className="row g-3 mb-3">
                {supportStats.map((s) => (
                  <div className="col-6 col-md-4 col-xl" key={s.label}>
                    <div className="d-flex align-items-center gap-3 p-3 rounded-3 h-100"
                         style={{ backgroundColor: 'var(--surface-muted)' }}>
                      <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                           style={{ width: '44px', height: '44px', backgroundColor: s.bg, color: s.fg, fontSize: '18px' }}>
                        <i className={`fas ${s.icon}`}></i>
                      </div>
                      <div className="min-width-0">
                        <div className="text-muted small">{s.label}</div>
                        <div className="fw-bold text-dark fs-5 lh-1">{s.value}</div>
                        <div className="text-muted" style={{ fontSize: '11px' }}>{s.sub}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="d-flex gap-2 flex-wrap">
              {canSupport && (
                <Link to="/support" className="btn btn-primary btn-sm rounded-pill px-4">
                  <i className="fas fa-arrow-right me-2"></i>Open Support
                </Link>
              )}
              {canCreateTicket && (
                <Link to="/support" className="btn btn-success btn-sm rounded-pill px-4">
                  <i className="fas fa-plus me-2"></i>New Ticket
                </Link>
              )}
              {canNocView && (
                <Link to="/reseller-status-noc" className="btn btn-outline-primary btn-sm rounded-pill px-4">
                  <i className="fas fa-network-wired me-2"></i>NOC Status
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* My Assigned Tickets — personal work queue (technicians land here) */}
      {canSupport && (
        <div className="ui-card mb-4">
          <div className="card-body p-4">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-3 mb-3">
              <h6 className="fw-bold text-dark mb-0">
                <i className="fas fa-user-gear text-primary me-2"></i>
                My Assigned Tickets
              </h6>
              <div className="d-flex gap-2 align-items-center flex-wrap">
                {Number(myWork?.pendingReports || 0) > 0 && (
                  <span className="badge rounded-pill bg-warning text-dark">
                    {myWork.pendingReports} report{Number(myWork.pendingReports) === 1 ? '' : 's'} pending review
                  </span>
                )}
                <Link to="/support?tab=my" className="btn btn-primary btn-sm rounded-pill px-4">
                  <i className="fas fa-arrow-right me-2"></i>My Tickets
                </Link>
              </div>
            </div>
            <div className="row g-3 mb-3">
              {myStats.map((s) => (
                <div className="col-6 col-md-3" key={s.label}>
                  <div className="d-flex align-items-center gap-3 p-3 rounded-3 h-100"
                       style={{ backgroundColor: 'var(--surface-muted)' }}>
                    <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                         style={{ width: '44px', height: '44px', backgroundColor: s.bg, color: s.fg, fontSize: '18px' }}>
                      <i className={`fas ${s.icon}`}></i>
                    </div>
                    <div className="min-width-0">
                      <div className="text-muted small">{s.label}</div>
                      <div className="fw-bold text-dark fs-5 lh-1">{s.value}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {myRecent.length > 0 ? (
              <div className="list-group list-group-flush">
                {myRecent.map((tk) => (
                  <Link
                    key={tk.id}
                    to={`/support?ticket=${tk.id}`}
                    className="list-group-item list-group-item-action d-flex justify-content-between align-items-center gap-2 px-1"
                  >
                    <span className="text-truncate">
                      <strong className="text-primary me-2">#{tk.ticket_no || tk.id}</strong>
                      <span className="text-dark">{tk.subject || tk.customer || ''}</span>
                    </span>
                    <span className="badge rounded-pill bg-light text-dark text-capitalize flex-shrink-0">
                      {String(tk.status || '').replace(/_/g, ' ')}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-muted small mb-0">No open tickets assigned to you right now.</p>
            )}
          </div>
        </div>
      )}

      {/* On Leave Today */}
      <div className="ui-card mb-4">
        <div className="card-body p-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h6 className="fw-bold text-dark mb-0">
              <i className="fas fa-calendar-day text-primary me-2"></i>
              Today on Leave
            </h6>
            <span className="badge bg-primary bg-opacity-10 text-primary px-3 py-2 rounded-pill">
              {data?.onLeaveList?.length || 0}
            </span>
          </div>
          {!data?.onLeaveList || data.onLeaveList.length === 0 ? (
            <div className="text-center py-3 text-muted">
              <i className="fas fa-check-circle text-success me-2"></i>
              No one is on leave today
            </div>
          ) : (
            <div className="row g-2">
              {data.onLeaveList.map((person, idx) => (
                <div className="col-md-6 col-lg-4" key={idx}>
                  <div className="d-flex align-items-center gap-3 p-2 rounded-3"
                       style={{ backgroundColor: 'var(--surface-muted)' }}>
                    <ImageWithFallback
                      src={person.profile_pic ? `/uploads/${person.profile_pic}` : null}
                      fallbackName={person.full_name}
                      className="rounded-circle flex-shrink-0"
                      alt=""
                      width="40px"
                      height="40px"
                    />
                    <div className="min-width-0">
                      <div className="fw-semibold text-dark small">{person.full_name}</div>
                      <span className="badge bg-warning bg-opacity-10 text-warning rounded-pill" style={{ fontSize: '11px' }}>
                        {person.leave_type}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="row g-4">
        <div className="col-md-4">
          <a href="/apply-leave" className="card border-0 shadow-sm h-100 text-decoration-none card-hover">
            <div className="card-body text-center p-4">
              <div className="icon-box bg-primary bg-opacity-10 text-primary mx-auto mb-3 rounded-circle d-flex align-items-center justify-content-center" style={{width: '60px', height: '60px', fontSize: '24px'}}>
                <i className="fas fa-plus"></i>
              </div>
              <h6 className="fw-bold text-dark">New Leave Application</h6>
              <p className="text-muted small mb-0">Click here to apply for leave</p>
            </div>
          </a>
        </div>
        <div className="col-md-4">
          <a href="/my-leaves" className="card border-0 shadow-sm h-100 text-decoration-none card-hover">
            <div className="card-body text-center p-4">
              <div className="icon-box bg-success bg-opacity-10 text-success mx-auto mb-3 rounded-circle d-flex align-items-center justify-content-center" style={{width: '60px', height: '60px', fontSize: '24px'}}>
                <i className="fas fa-list-ul"></i>
              </div>
              <h6 className="fw-bold text-dark">My Applications</h6>
              <p className="text-muted small mb-0">View status of previous applications</p>
            </div>
          </a>
        </div>
        <div className="col-md-4">
          <a href="/profile" className="card border-0 shadow-sm h-100 text-decoration-none card-hover">
            <div className="card-body text-center p-4">
              <div className="icon-box bg-info bg-opacity-10 text-info mx-auto mb-3 rounded-circle d-flex align-items-center justify-content-center" style={{width: '60px', height: '60px', fontSize: '24px'}}>
                <i className="fas fa-user"></i>
              </div>
              <h6 className="fw-bold text-dark">Profile</h6>
              <p className="text-muted small mb-0">View your personal information</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
};

export default UserDashboard;
