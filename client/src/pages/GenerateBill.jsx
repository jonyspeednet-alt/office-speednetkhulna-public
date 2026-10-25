import React, { useState } from 'react';

const GenerateBill = () => {
  const [month] = useState(new Date().toISOString().slice(0, 7));

  return (
    <div className="container py-3 reseller-page">
      <div className="card p-4">
        <h3 className="fw-bold text-center mb-3 text-primary">????? ??? ??????? ??????</h3>
        <div className="alert alert-info mb-0">
          <div className="fw-semibold mb-1">Manual generate/finalize ???? ??? ??????</div>
          <div>????? ????? ??? ??? 23:59 (Asia/Dhaka) ? ?? active reseller-?? final bill automatic generate ????</div>
          <div className="mt-2 small text-muted">Current month: {month}</div>
        </div>
      </div>
    </div>
  );
};

export default GenerateBill;
