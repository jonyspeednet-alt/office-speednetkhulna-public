import React from 'react';

const MovementsTab = ({ movements, loading }) => (
  <div className="card shadow-sm">
    <div className="card-header bg-white fw-bold d-flex justify-content-between align-items-center">
      <span>Movement History</span>
      <span className="text-muted small">{movements.length} records</span>
    </div>
    <div className="table-responsive">
      <table className="table align-middle mb-0">
        <thead>
          <tr>
            <th>Asset</th>
            <th>From</th>
            <th>To</th>
            <th>Reason</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => (
            <tr key={movement.id}>
              <td>
                <div className="fw-semibold">{movement.asset_name}</div>
                <div className="small text-muted">{movement.asset_tag}</div>
              </td>
              <td>
                <div>{movement.from_office_name || '-'}</div>
                <div className="small text-muted">{movement.from_desk_no ? `Desk ${movement.from_desk_no}` : '-'}</div>
              </td>
              <td>
                <div>{movement.to_office_name || '-'}</div>
                <div className="small text-muted">{movement.to_desk_no ? `Desk ${movement.to_desk_no}` : '-'}</div>
              </td>
              <td>{movement.reason || '-'}</td>
              <td>{movement.moved_by_name || '-'}</td>
            </tr>
          ))}
          {!movements.length && !loading && (
            <tr><td colSpan="5" className="text-muted text-center py-4">No movement history found</td></tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

export default MovementsTab;
