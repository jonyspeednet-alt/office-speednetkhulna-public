import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/SupportReports.css';

const REPORTS = [
  {
    title: 'Technician Support Register',
    subtitle: 'টিকিটের তারিখ, গ্রাহক, সংযোগ, সমস্যা, VLAN ও টেকনিশিয়ান অনুযায়ী বিবরণ',
    description: 'Review solved tickets for the month and trace every record to its customer and supporting technician.',
    scope: ['Solved tickets only', 'PPPoE user ID', 'Connection type', 'Problem category', 'VLAN', 'Technician'],
    path: '/support-reports/technician-register',
    icon: 'fa-clipboard-list',
    tag: 'Available now',
  },
];

const SupportReports = () => (
  <main className="sr-page">
    <header className="sr-hub-header">
      <div className="sr-hub-mark" aria-hidden="true"><i className="fa-solid fa-chart-column" /></div>
      <div>
        <div className="sr-eyebrow">OPERATIONS · REPORTS</div>
        <h1>Support Reports</h1>
        <p>A focused home for support activity, accountability and service trends.</p>
      </div>
    </header>

    <section className="sr-hub-section" aria-labelledby="sr-available-title">
      <div className="sr-section-heading">
        <div>
          <span className="sr-section-kicker">REPORT LIBRARY</span>
          <h2 id="sr-available-title">Available reports</h2>
        </div>
        <span className="sr-library-count">01 report</span>
      </div>

      <div className="sr-report-list">
        {REPORTS.map((report, index) => (
          <Link className="sr-report-entry" to={report.path} key={report.path}>
            <span className="sr-report-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="sr-report-icon" aria-hidden="true"><i className={`fa-solid ${report.icon}`} /></span>
            <span className="sr-report-copy">
              <span className="sr-report-title">{report.title}</span>
              <span className="sr-report-subtitle">{report.subtitle}</span>
              <span className="sr-report-description">{report.description}</span>
              <span className="sr-report-scope" aria-label="Report scope">
                {report.scope.map((dimension, scopeIndex) => (
                  <React.Fragment key={dimension}>
                    {scopeIndex > 0 && <span className="sr-scope-separator" aria-hidden="true">·</span>}
                    <span>{dimension}</span>
                  </React.Fragment>
                ))}
              </span>
            </span>
            <span className="sr-report-status">{report.tag}</span>
            <span className="sr-report-arrow" aria-hidden="true"><i className="fa-solid fa-arrow-right" /></span>
          </Link>
        ))}
      </div>

      <div className="sr-library-note">
        <span className="sr-note-rule" />
        <p>New support reports will appear here as they are added to the library.</p>
      </div>
    </section>
  </main>
);

export default SupportReports;
