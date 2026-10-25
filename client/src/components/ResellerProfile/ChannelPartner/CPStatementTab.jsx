import React from 'react';
import { money } from '../../../utils/formatters';

const getStatementMeta = (type) => {
    switch (type) {
        case 'commission':
            return { label: 'Credit', badgeClass: 'bg-success', credit: true };
        case 'payment':
            return { label: 'Payment', badgeClass: 'bg-primary', credit: false };
        case 'deduction':
            return { label: 'Deduction', badgeClass: 'bg-danger', credit: false };
        case 'product_charge':
            return { label: 'Product', badgeClass: 'bg-warning', credit: false };
        case 'advance':
            return { label: 'Advance', badgeClass: 'bg-secondary', credit: false };
        case 'adjustment':
            return { label: 'Adjustment', badgeClass: 'bg-info', credit: true };
        default:
            return { label: type || '—', badgeClass: 'bg-light', credit: true };
    }
};

const formatStatementAmount = (type) => {
    const meta = getStatementMeta(type);
    return {
        prefix: meta.credit ? '+' : '-',
        amountClass: meta.credit ? 'text-success' : 'text-danger',
    };
};

const CPStatementTab = ({ cpStatement }) => {
    return (
        <section className="p-2 p-sm-3">
            <h6 className="fw-bold mb-3">Statement</h6>
            {cpStatement.length === 0 ? (
                <section className="text-center text-muted py-4">No statement entries</section>
            ) : (
                <section className="rp-mobile-list d-md-none mb-3">
                    {cpStatement.map((s, i) => {
                        const meta = getStatementMeta(s.type);
                        const { prefix, amountClass } = formatStatementAmount(s.type);
                        return (
                            <article key={`${s.type}-${s.id}-${i}`} className="rp-mobile-card">
                                <section className="rp-mobile-card-head">
                                    <section>
                                        <section className="fw-bold small">{s.description}</section>
                                        <small className="text-muted">
                                            {s.date ? new Date(s.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                                        </small>
                                    </section>
                                    <span className={`badge ${meta.badgeClass} bg-opacity-10 text-dark border`}>
                                        {meta.label}
                                    </span>
                                </section>
                                <section className={`fw-bold mt-2 ${amountClass}`}>
                                    {prefix}{money(s.amount)}
                                </section>
                            </article>
                        );
                    })}
                </section>
            )}
            <section className="rp-table-wrap d-none d-md-block">
                <table className="table table-hover align-middle mb-0 table-sm">
                    <thead className="table-light">
                        <tr>
                            <th>Date</th>
                            <th>Description</th>
                            <th>Type</th>
                            <th>Amount</th>
                        </tr>
                    </thead>
                    <tbody>
                        {cpStatement.length === 0 ? (
                            <tr><td colSpan="4" className="text-center text-muted py-4">No statement entries</td></tr>
                        ) : cpStatement.map((s, i) => {
                            const meta = getStatementMeta(s.type);
                            const { prefix, amountClass } = formatStatementAmount(s.type);
                            return (
                                <tr key={`${s.type}-${s.id}-${i}`}>
                                    <td>{s.date ? new Date(s.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '-'}</td>
                                    <td>{s.description}</td>
                                    <td>
                                        <span className={`badge ${meta.badgeClass} bg-opacity-10 text-dark border`}>
                                            {meta.label}
                                        </span>
                                    </td>
                                    <td className={`fw-bold ${amountClass}`}>
                                        {prefix}{money(s.amount)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </section>
        </section>
    );
};

export default CPStatementTab;
