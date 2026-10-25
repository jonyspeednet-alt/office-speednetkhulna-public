import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import moment from 'moment';
import ImageWithFallback from './ImageWithFallback';
import NoticeTicker from './NoticeTicker';
import { getAdminDashboardData } from '../services/adminDashboardService';
import { t } from '../i18n';
import '../styles/AdminDashboard.css';

const fallbackData = {
  stats: { pending: 0, onLeave: 0, offDay: 0, totalStaff: 0 },
  onLeaveList: [],
  recentLeaves: []
};

const AdminDashboard = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['adminDashboard'],
    queryFn: getAdminDashboardData,
    select: (result) => ({
      stats: { ...fallbackData.stats, ...(result?.stats || {}) },
      onLeaveList: Array.isArray(result?.onLeaveList) ? result.onLeaveList : [],
      recentLeaves: Array.isArray(result?.recentLeaves) ? result.recentLeaves : []
    })
  });

  const dashboard = data || fallbackData;

  const summary = useMemo(() => {
    const total = dashboard.stats.totalStaff || 0;
    const available = Math.max(total - dashboard.stats.onLeave - dashboard.stats.offDay, 0);
    const pendingRate = total > 0 ? Math.round((dashboard.stats.pending / total) * 100) : 0;
    const oldestPending = dashboard.recentLeaves
      .filter((leave) => String(leave.status || '').toLowerCase() === 'pending' && leave.applied_at)
      .map((leave) => new Date(leave.applied_at))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a - b)[0] || null;
    return { total, available, pendingRate, oldestPending };
  }, [dashboard.stats, dashboard.recentLeaves]);

  const greeting = useMemo(() => {
    const hour = moment().hour();
    if (hour < 12) return t('adminDashboard.morning');
    if (hour < 17) return t('adminDashboard.afternoon');
    return t('adminDashboard.evening');
  }, []);

  const formatDate = (value) => {
    if (!value) return '-';
    const parsed = moment(value);
    return parsed.isValid() ? parsed.format('DD MMM YYYY') : '-';
  };

  const recentQueue = dashboard.recentLeaves.slice(0, 4);
  const activePeople = dashboard.onLeaveList.slice(0, 5);
  const urgentWarnings = [];
  if (dashboard.stats.pending > 0 && summary.oldestPending) {
    const hoursOld = Math.max(0, Math.round((Date.now() - summary.oldestPending.getTime()) / 36e5));
    if (hoursOld >= 12) urgentWarnings.push(`Oldest pending request is ${hoursOld}h old.`);
  }


  const QuickLink = ({ icon, label, to, tone }) => (
    <Link className={`quick-link tone-${tone}`} to={to}>
      <div className="quick-icon"><i className={`fas ${icon}`}></i></div>
      <div className="quick-text">
        <strong>{label}</strong>
        <span>Open now</span>
      </div>
    </Link>
  );

  return (
    <div className="admin-dash-shell">
      <NoticeTicker />

      {isLoading ? (
        <div className="admin-skeleton-v2">
          <div className="sk-hero"></div>
          <div className="sk-grid"></div>
          <div className="sk-main"></div>
          <div className="sk-side"></div>
        </div>
      ) : error ? (
        <div className="dash-error">
          {error.message || t('adminDashboard.dashboardLoadError')}
        </div>
      ) : (
        <>
          <section className="admin-hero">
            <div className="hero-topline">
              <h1>
                {greeting}, <span>Admin</span>
              </h1>
              {dashboard.stats.pending > 0 && (
                <Link className="badge-chip pending" to="/manage-leaves?status=Pending">
                  {dashboard.stats.pending} pending
                </Link>
              )}
            </div>

            <div className="hero-metrics-bar">
              <div className="hm-item">
                <span>Team</span>
                <strong>{summary.total}</strong>
              </div>
              <div className="hm-item accent">
                <span>Pending</span>
                <strong>{dashboard.stats.pending}</strong>
              </div>
              <div className="hm-item">
                <span>On leave</span>
                <strong>{dashboard.stats.onLeave}</strong>
              </div>
              <div className="hm-item">
                <span>Available</span>
                <strong>{summary.available}</strong>
              </div>
              <div className="hm-item">
                <span>Work ready</span>
                <strong>{summary.total > 0 ? `${Math.round((summary.available / summary.total) * 100)}%` : '0%'}</strong>
              </div>
              <div className="hm-item">
                <span>Pending rate</span>
                <strong>{summary.pendingRate}%</strong>
              </div>
            </div>

            <div className="hero-actions">
              <Link to="/manage-leaves?status=Pending" className="hero-btn primary">
                <i className="fas fa-bolt"></i> Review queue
              </Link>
              <Link to="/leave-report" className="hero-btn secondary">
                <i className="fas fa-chart-column"></i> Reports
              </Link>
              <Link to="/monthly-summary" className="hero-btn secondary">
                <i className="fas fa-calendar-days"></i> Monthly summary
              </Link>
            </div>
          </section>

          <section className="quick-rail">
          <QuickLink icon="fa-list-check" label="Manage leaves" to="/manage-leaves" tone="blue" />
          <QuickLink icon="fa-users" label="Employees" to="/employees" tone="violet" />
          <QuickLink icon="fa-file-lines" label="Leave report" to="/leave-report" tone="green" />
          <QuickLink icon="fa-signal" label="Monthly summary" to="/monthly-summary" tone="amber" />
          <QuickLink icon="fa-boxes-stacked" label="Asset Management" to="/asset-management" tone="indigo" />
        </section>

          <section className="dashboard-layout">
            <div className="dashboard-main">
              <article className="dash-panel feed-panel">
                <div className="dash-panel-head">
                  <div>
                    <p className="dash-kicker">Recent activity</p>
                    <h3>Latest leave requests</h3>
                  </div>
                  <Link to="/manage-leaves" className="panel-link">Open all</Link>
                </div>

                <div className="activity-feed">
                  {recentQueue.length === 0 ? (
                    <div className="empty-state">No recent leave activity.</div>
                  ) : (
                    recentQueue.map((leave, index) => (
                      <div className="feed-row" key={leave.id || index}>
                        <ImageWithFallback
                          src={leave.profile_pic ? `/uploads/${leave.profile_pic}` : null}
                          fallbackName={leave.full_name}
                          className="feed-avatar"
                          alt=""
                          width="42px"
                          height="42px"
                        />
                        <div className="feed-body">
                          <div className="feed-title">
                            <strong>{leave.full_name}</strong>
                            <span className={leave.status === 'Approved' ? 'feed-badge approved' : leave.status === 'Rejected' ? 'feed-badge rejected' : 'feed-badge pending'}>
                              {leave.status}
                            </span>
                          </div>
                          <div className="feed-meta">
                            <span>{leave.type_name}</span>
                            <span>{formatDate(leave.from_date)} - {formatDate(leave.to_date)}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </article>

              <article className="dash-panel table-panel">
                <div className="dash-panel-head">
                  <div>
                    <p className="dash-kicker">Team status</p>
                    <h3>Who is out today</h3>
                  </div>
                  <span className="panel-chip">{activePeople.length} active</span>
                </div>

                <div className="table-wrap">
                  {activePeople.length === 0 ? (
                    <div className="empty-state">Everyone is present today.</div>
                  ) : (
                    activePeople.map((staff, index) => (
                      <div className="team-row-v2" key={`${staff.full_name}-${index}`}>
                        <ImageWithFallback
                          src={staff.profile_pic ? `/uploads/${staff.profile_pic}` : null}
                          fallbackName={staff.full_name}
                          className="team-avatar"
                          alt=""
                          width="36px"
                          height="36px"
                        />
                        <div className="team-copy">
                          <strong>{staff.full_name}</strong>
                          <span>{staff.leave_type || t('adminDashboard.leaveGeneric')}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </article>
            </div>

            <aside className="dashboard-side">
              <article className="dash-panel alert-panel">
                <div className="dash-panel-head">
                  <div>
                    <p className="dash-kicker">Alerts</p>
                    <h3>What needs attention</h3>
                  </div>
                </div>
                <div className="alert-list">
                  {urgentWarnings.length === 0 ? (
                    <div className="empty-state">No urgent alerts right now.</div>
                  ) : (
                    urgentWarnings.map((warning, index) => (
                      <div className="alert-row" key={`${warning}-${index}`}>
                        <i className="fas fa-triangle-exclamation"></i>
                        <span>{warning}</span>
                      </div>
                    ))
                  )}
                </div>
              </article>

              <article className="dash-panel stats-panel">
                <div className="dash-panel-head">
                  <div>
                    <p className="dash-kicker">Live stats</p>
                    <h3>Today overview</h3>
                  </div>
                </div>

                <div className="mini-stats">
                  <div className="mini-card">
                    <span>Present</span>
                    <strong>{Math.max(summary.total - dashboard.stats.onLeave - dashboard.stats.offDay, 0)}</strong>
                  </div>
                  <div className="mini-card">
                    <span>On leave</span>
                    <strong>{dashboard.stats.onLeave}</strong>
                  </div>
                  <div className="mini-card">
                    <span>Off day</span>
                    <strong>{dashboard.stats.offDay}</strong>
                  </div>
                  <div className="mini-card accent">
                    <span>Pending</span>
                    <strong>{dashboard.stats.pending}</strong>
                  </div>
                </div>
              </article>
            </aside>
          </section>
        </>
      )}
    </div>
  );
};

export default AdminDashboard;

