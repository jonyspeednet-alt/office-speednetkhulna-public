import React from 'react';

const RequestsTab = ({ requests }) => {
    return (
        <div className="table-responsive" style={{ maxHeight: 420 }}>
            <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                    <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Action & Amount</th>
                        <th>Requested Date</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {requests.length === 0 ? (
                        <tr><td colSpan="5" className="text-center text-muted py-4">No requests found.</td></tr>
                    ) : requests.map((r) => (
                        <tr key={r.id}>
                            <td>{new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                            <td><span className="badge bg-light text-dark border">{r.bw_type}</span></td>
                            <td>
                                <div className={`${r.change_type === 'increase' ? 'text-success' : 'text-danger'} fw-bold small text-uppercase`}>
                                    {r.change_type === 'increase' ? 'Upgradation' : 'Downgradation'}
                                </div>
                                <span className="fw-bold text-dark small">{r.requested_bw_mbps} Mbps</span>
                            </td>
                            <td>
                                <span className="badge bg-info bg-opacity-10 text-dark border">
                                    <i className="far fa-calendar-alt me-1" />
                                    {r.requested_effective_date ? new Date(r.requested_effective_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Immediate'}
                                </span>
                            </td>
                            <td>
                                <span className={`badge ${r.admin_status === 'approved' ? 'bg-success' : 'bg-warning'} bg-opacity-10 text-dark border`}>
                                    {String(r.admin_status || 'pending')}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default RequestsTab;
