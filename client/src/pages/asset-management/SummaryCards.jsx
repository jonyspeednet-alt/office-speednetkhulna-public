import React from 'react';

export const Card = ({ label, value, hint, tone }) => (
  <div className={`card border-0 shadow-sm h-100 asset-metric-card asset-tone-${tone}`}>
    <div className="card-body">
      <div className="text-uppercase small fw-semibold text-muted">{label}</div>
      <div className="display-6 fw-bold mb-1">{value}</div>
      <div className="text-muted small">{hint}</div>
    </div>
  </div>
);

export const QuickActionCard = ({ title, value, hint, buttonLabel, onClick, tone = 'primary' }) => (
  <div className="card border-0 shadow-sm h-100 asset-quick-card">
    <div className="card-body d-flex flex-column">
      <div className="d-flex justify-content-between align-items-start mb-3">
        <div>
          <div className="text-uppercase small fw-semibold text-muted">{title}</div>
          <div className="display-6 fw-bold mb-1">{value}</div>
        </div>
        <span className={`badge text-bg-${tone}`}>{buttonLabel}</span>
      </div>
      <div className="text-muted small mb-3">{hint}</div>
      <button type="button" className="btn btn-sm btn-outline-dark mt-auto align-self-start" onClick={onClick}>
        Open
      </button>
    </div>
  </div>
);
