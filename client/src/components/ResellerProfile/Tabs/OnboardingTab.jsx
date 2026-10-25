import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPartnerOnboardings } from '../../../services/partnerOnboardingService';

const OnboardingTab = ({ resellerId }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getPartnerOnboardings({ reseller_id: resellerId, limit: 20 });
        if (!cancelled) setRows(data.rows || data || []);
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.message || e.message || 'Failed to load onboarding');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (resellerId) load();
    return () => { cancelled = true; };
  }, [resellerId]);

  if (loading) {
    return (
      <div className="p-4 text-center">
        <div className="spinner-border text-primary" role="status" />
        <div className="text-muted mt-2" style={{ fontSize: '13px' }}>Loading onboarding info...</div>
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-danger m-3">{error}</div>;
  }

  if (!rows.length) {
    return (
      <div className="p-4">
        <div className="text-center py-4">
          <i className="fas fa-file-circle-question" style={{ fontSize: '36px', color: '#94a3b8' }}></i>
          <div className="fw-bold mt-2" style={{ color: '#334155' }}>No onboarding form found</div>
          <div className="text-muted" style={{ fontSize: '13px' }}>No onboarding created for this partner yet.</div>
          <Link to={`/partner-onboarding-form?reseller_id=${resellerId}`} className="btn btn-sm btn-primary mt-3">
            <i className="fas fa-plus me-1"></i>Create Onboarding
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h6 className="fw-bold m-0"><i className="fas fa-handshake me-2 text-primary"></i>Onboarding History</h6>
        <Link to={`/partner-onboarding-form?reseller_id=${resellerId}`} className="btn btn-sm btn-outline-primary">
          <i className="fas fa-plus me-1"></i>New Form
        </Link>
      </div>
      <div className="table-responsive">
        <table className="table table-hover table-sm mb-0" style={{ fontSize: '13px' }}>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th>Onboarding Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><span className="fw-bold" style={{ color: '#1e293b' }}>{row.ref_number}</span></td>
                <td>{row.partner_name}</td>
                <td><span className="badge bg-light text-dark border">{row.partner_type}</span></td>
                <td><span className={`badge ${row.status === 'converted' ? 'bg-success' : row.status === 'approved' ? 'bg-primary' : row.status === 'rejected' ? 'bg-danger' : 'bg-secondary'}`}>{row.status}</span></td>
                <td>{row.onboarding_date ? new Date(row.onboarding_date).toLocaleDateString('en-GB') : (row.created_at ? new Date(row.created_at).toLocaleDateString('en-GB') : '-')}</td>
                <td>
                  <Link to={`/partner-onboarding-form?onboarding_id=${row.id}`} className="btn btn-sm btn-outline-primary py-0">
                    <i className="fas fa-eye me-1"></i>View / Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-muted mt-3" style={{ fontSize: '11px' }}>
        <i className="fas fa-info-circle me-1"></i>Older migrated members show here as converted — new onboardings will align here.
      </div>
    </div>
  );
};

export default OnboardingTab;
