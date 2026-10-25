import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import moment from 'moment';
import { getMyLeaves } from '../services/myLeavesService';
import { t } from '../i18n';

const mapStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'approved') return t('myLeaves.approved');
  if (normalized === 'rejected') return t('myLeaves.rejected');
  return t('myLeaves.pending');
};

const MyLeaves = () => {
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaves();
  }, []);

  const fetchLeaves = async () => {
    try {
      const data = await getMyLeaves();
      setLeaves(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  const countDays = (leave) => {
    // Half Day (leave_type_id === 3) সবসময় 0.5 দিন
    if (parseInt(leave.leave_type_id, 10) === 3 || leave.leave_name === 'Half Day') {
      return 0.5;
    }
    const startDate = moment(leave.start_date);
    const endDate = moment(leave.end_date);
    return endDate.diff(startDate, 'days') + 1;
  };

  return (
    <div className="container-fluid p-4">
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center mb-4">
        <div>
          <h3 className="fw-bold text-dark mb-1">{t('myLeaves.title')}</h3>
          <p className="text-muted mb-0">{t('myLeaves.subtitle')}</p>
        </div>
        <Link to="/apply-leave" className="btn btn-primary rounded-pill px-4 fw-bold shadow-sm mt-3 mt-md-0">
          <i className="fas fa-plus me-2"></i> {t('myLeaves.newRequest')}
        </Link>
      </div>

      <div className="card border-0 shadow-sm rounded-4 p-4 bg-white">
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead className="bg-light">
              <tr>
                <th className="border-0 text-muted small fw-bold text-uppercase p-3">{t('myLeaves.requestDate')}</th>
                <th className="border-0 text-muted small fw-bold text-uppercase p-3">{t('myLeaves.leaveType')}</th>
                <th className="border-0 text-muted small fw-bold text-uppercase p-3">{t('myLeaves.period')}</th>
                <th className="border-0 text-muted small fw-bold text-uppercase p-3">{t('myLeaves.totalDays')}</th>
                <th className="border-0 text-muted small fw-bold text-uppercase p-3">{t('myLeaves.state')}</th>
                <th className="border-0 text-muted small fw-bold text-uppercase p-3 text-end">{t('myLeaves.action')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={`sk-${i}`}>
                    {[...Array(6)].map((__, c) => (
                      <td key={c} className="p-3"><span className="ui-skeleton ui-skeleton-line" /></td>
                    ))}
                  </tr>
                ))
              ) : leaves.length === 0 ? (
                <tr>
                  <td colSpan="6">
                    <div className="ui-empty">
                      <i className="far fa-calendar-check ui-empty-icon"></i>
                      <span className="ui-empty-title">{t('myLeaves.noData')}</span>
                    </div>
                  </td>
                </tr>
              ) : (
                leaves.map((leave) => (
                  <tr key={leave.id}>
                    <td className="p-3">
                      <div className="fw-bold">{moment(leave.applied_at).format('DD MMM, YYYY')}</div>
                      <small className="text-muted">{moment(leave.applied_at).format('h:mm A')}</small>
                    </td>
                    <td className="p-3"><span className="text-primary fw-bold">{leave.leave_name}</span></td>
                    <td className="p-3">
                      <div className="small fw-bold">
                        <i className="far fa-calendar-alt text-muted me-1"></i>
                        {moment(leave.start_date).format('DD/MM/YYYY')} - {moment(leave.end_date).format('DD/MM/YYYY')}
                      </div>
                    </td>
                    <td className="p-3">
                      <span className="badge bg-light text-dark rounded-pill border">
                        {countDays(leave)} {t('myLeaves.day')}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`badge rounded-pill px-3 py-2 ${
                        leave.status === 'Approved' ? 'bg-success-subtle text-success' :
                        leave.status === 'Rejected' ? 'bg-danger-subtle text-danger' :
                        'bg-warning-subtle text-warning'
                      }`}>
                        <i className="fas fa-circle me-1" style={{ fontSize: '8px' }}></i> {mapStatus(leave.status)}
                      </span>
                    </td>
                    <td className="p-3 text-end">
                      {leave.status === 'Approved' ? (
                        <a href={`/approval/${leave.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary rounded-pill px-3 fw-bold">
                          <i className="fas fa-file-invoice me-1"></i> {t('myLeaves.download')}
                        </a>
                      ) : (
                        <span className="badge bg-light text-muted fw-normal">{t('myLeaves.processing')}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default MyLeaves;
