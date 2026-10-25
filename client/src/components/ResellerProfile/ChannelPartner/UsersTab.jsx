import React from 'react';
import { money } from '../../../utils/formatters';

const UsersTab = ({ cpUsers, cpUserSearch, setCpUserSearch, onAddUser, onEditUser, onDeleteUser, onMaximSync, maximSyncing, maximStatus }) => {
    const lastLog = maximStatus?.log || null;
    const lastSyncText = lastLog
        ? `${lastLog.status === "completed" ? "Success" : lastLog.status} · ${lastLog.rows_payments || 0} payments / ${lastLog.rows_customers || 0} customers`
        : "Not synced yet";
    const filteredUsers = cpUsers.filter(u =>
        !cpUserSearch ||
        u.user_name?.toLowerCase().includes(cpUserSearch.toLowerCase()) ||
        u.user_id_code?.toLowerCase().includes(cpUserSearch.toLowerCase()) ||
        u.phone?.includes(cpUserSearch)
    );

    return (
        <div className="p-2 p-sm-3">
            <div className="rp-toolbar mb-3">
                <div className="d-flex gap-2 align-items-center flex-grow-1">
                    <input
                        type="search"
                        className="form-control form-control-sm"
                        placeholder="Search users..."
                        value={cpUserSearch}
                        onChange={(e) => setCpUserSearch(e.target.value)}
                        aria-label="Search users"
                    />
                    <span className="badge bg-primary text-nowrap">{cpUsers.length} users</span>
                    {onMaximSync && (
                        <span className="badge bg-light text-dark border text-nowrap" title="Last Maxim sync">
                            <i className="fas fa-history me-1" />{lastSyncText}
                        </span>
                    )}
                </div>
                {onMaximSync && (
                    <button
                        type="button"
                        className="btn btn-sm btn-outline-dark rounded-pill px-3"
                        onClick={() => onMaximSync()}
                        disabled={!!maximSyncing}
                        title="Fetch this month's payments + customer snapshot from Maxim"
                    >
                        <i className={`fas ${maximSyncing ? "fa-spinner fa-spin" : "fa-cloud-download-alt"} me-1`} />
                        {maximSyncing ? "Syncing…" : "Maxim Sync"}
                    </button>
                )}
                <button type="button" className="btn btn-sm btn-primary rounded-pill px-3" onClick={onAddUser}>
                    <i className="fas fa-plus me-1" />Add User
                </button>
            </div>

            {filteredUsers.length === 0 ? (
                <div className="text-center text-muted py-5"><i className="fas fa-users d-block mb-2" style={{ fontSize: '1.5rem' }} />No users</div>
            ) : (
                <>
                    <div className="rp-mobile-list d-md-none">
                        {filteredUsers.map((u) => (
                            <article key={u.id} className="rp-mobile-card">
                                <div className="rp-mobile-card-head">
                                    <div>
                                        <div className="fw-bold">{u.user_name}</div>
                                        <span className="badge bg-light text-dark border mt-1">{u.user_id_code || '-'}</span>
                                    </div>
                                    <span className={`badge ${u.status === 'active' ? 'bg-success' : 'bg-danger'} bg-opacity-10 text-dark border`}>
                                        {u.status}
                                    </span>
                                </div>
                                <div className="rp-kv mt-2">
                                    <div><span className="label">Phone</span><br />{u.phone || '-'}</div>
                                    <div><span className="label">Package</span><br />{u.package_name || '-'}</div>
                                    <div><span className="label">Rate</span><br />{money(u.monthly_rate)}</div>
                                </div>
                                <div className="d-flex gap-2 mt-2">
                                    <button type="button" className="btn btn-outline-primary btn-sm flex-fill" onClick={() => onEditUser(u)}>
                                        <i className="fas fa-edit me-1" />Edit
                                    </button>
                                    <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => onDeleteUser(u.id)} aria-label="Delete">
                                        <i className="fas fa-trash" />
                                    </button>
                                </div>
                            </article>
                        ))}
                    </div>

                    <div className="rp-table-wrap d-none d-md-block">
                        <table className="table table-hover align-middle mb-0 table-sm">
                            <thead className="table-light">
                                <tr>
                                    <th>Name</th>
                                    <th>ID</th>
                                    <th>Phone</th>
                                    <th>Package</th>
                                    <th>Rate</th>
                                    <th>Status</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.map((u) => (
                                    <tr key={u.id}>
                                        <td className="fw-bold">{u.user_name}</td>
                                        <td><span className="badge bg-light text-dark border">{u.user_id_code || '-'}</span></td>
                                        <td>{u.phone || '-'}</td>
                                        <td>{u.package_name || '-'}</td>
                                        <td>{money(u.monthly_rate)}</td>
                                        <td>
                                            <span className={`badge ${u.status === 'active' ? 'bg-success' : 'bg-danger'} bg-opacity-10 text-dark border`}>
                                                {u.status}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="btn-group btn-group-sm">
                                                <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => onEditUser(u)} title="Edit">
                                                    <i className="fas fa-edit" />
                                                </button>
                                                <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => onDeleteUser(u.id)} title="Delete">
                                                    <i className="fas fa-trash" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
};

export default UsersTab;
