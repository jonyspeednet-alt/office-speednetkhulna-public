import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';

const StatementTab = ({ statementItems }) => {
    const statementRows = useMemo(() => statementItems.map((x) => ({
        ...x,
        typeText: x.type === 'invoice' ? 'Debit' : (x.type === 'discount' ? 'Discount' : 'Credit'),
        typeClass:
            x.type === 'invoice'
                ? 'bg-danger bg-opacity-10 text-danger border border-danger border-opacity-25'
                : x.type === 'discount'
                    ? 'bg-info bg-opacity-10 text-info border border-info border-opacity-25'
                    : 'bg-success bg-opacity-10 text-success border border-success border-opacity-25',
        amountClass: x.type === 'invoice' ? 'text-danger' : (x.type === 'discount' ? 'text-info' : 'text-success')
    })), [statementItems]);

    return (
        <div className="p-2 p-sm-3">
            <div className="table-responsive" style={{ maxHeight: 420 }}>
            <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                    <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Type</th>
                        <th>Amount</th>
                        <th className="text-end">Action</th>
                    </tr>
                </thead>
                <tbody>
                    {statementRows.length === 0 ? (
                        <tr><td colSpan="5" className="text-center text-muted py-4">No transactions found.</td></tr>
                    ) : statementRows.map((item) => (
                        <tr key={`${item.type}-${item.id}`}>
                            <td>{new Date(item.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                            <td>
                                {item.type === 'invoice' ? (
                                    <div className="d-flex align-items-center">
                                        <i className="fas fa-file-invoice-dollar text-danger me-2" />
                                        <div>
                                            <span className="text-dark fw-bold">Bill</span>{' '}
                                            <small className="text-muted">{item.description}</small>
                                        </div>
                                    </div>
                                ) : item.type === 'discount' ? (
                                    <div className="d-flex align-items-center">
                                        <i className="fas fa-percent text-info me-2" />
                                        <span className="text-dark small">{item.description}</span>
                                    </div>
                                ) : (
                                    <div className="d-flex align-items-center">
                                        <i className="fas fa-hand-holding-usd text-success me-2" />
                                        <span className="text-dark small">{item.description}</span>
                                    </div>
                                )}
                            </td>
                            <td><span className={`badge ${item.typeClass}`}>{item.typeText}</span></td>
                            <td className={`fw-bold ${item.amountClass}`}>{Number(item.amount || 0).toFixed(2)}</td>
                            <td className="text-end">
                                {item.type === 'invoice' ? (
                                    <Link to={item.action_url} target="_blank" className="btn btn-sm btn-light text-primary py-0 px-2">
                                        <i className="fas fa-eye" />
                                    </Link>
                                ) : ''}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            </div>
        </div>
    );
};

export default StatementTab;
