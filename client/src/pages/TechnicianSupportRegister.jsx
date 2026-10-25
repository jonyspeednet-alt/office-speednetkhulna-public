import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTechnicianSupportRegister } from '../services/supportService';
import '../styles/SupportReports.css';

const getDhakaMonth = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
};

const FILTERS = [
  { key: 'userId', label: 'PPPoE User ID', group: 'userId' },
  { key: 'connectionType', label: 'Connection type', group: 'connectionType' },
  { key: 'category', label: 'Problem category', group: 'category' },
  { key: 'vlan', label: 'VLAN', group: 'vlan' },
  { key: 'technician', label: 'Technician', group: 'technician' },
];

const SORTABLE_COLUMNS = [
  { key: 'createdDate', label: 'Created date' },
  { key: 'userId', label: 'PPPoE user ID' },
  { key: 'connectionType', label: 'Connection type' },
  { key: 'phone', label: 'Number' },
  { key: 'category', label: 'Problem category' },
  { key: 'vlan', label: 'VLAN' },
  { key: 'supportedBy', label: 'Supported by' },
];

const emptyFilters = () => ({
  userId: '',
  connectionType: '',
  category: '',
  vlan: '',
  technician: '',
});

const formatCount = (value) => Number(value || 0).toLocaleString('en-US');
const formatDate = (date) => {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${String(date).slice(0, 10)}T00:00:00Z`));
};

const monthLabel = (month) => {
  if (!month) return '';
  const [year, number] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka' })
    .format(new Date(Date.UTC(year, number - 1, 1)));
};

const TechnicianSupportRegister = () => {
  const [month, setMonth] = useState(getDhakaMonth);
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [activeFilters, setActiveFilters] = useState(emptyFilters);
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [showFilters, setShowFilters] = useState(() => window.matchMedia('(min-width: 761px)').matches);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('createdDate');
  const [sortDirection, setSortDirection] = useState('desc');
  const [reloadCount, setReloadCount] = useState(0);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);

  useEffect(() => {
    const requestId = ++requestSequence.current;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getTechnicianSupportRegister({
          month,
          ...activeFilters,
          q: activeSearch,
          page,
          limit: 50,
          sortBy,
          sortDirection,
        });
        if (requestId === requestSequence.current) setReport(data);
      } catch (fetchError) {
        if (requestId === requestSequence.current) {
          setReport(null);
          setError(fetchError?.response?.data?.message || fetchError?.message || 'Could not load the support register.');
        }
      } finally {
        if (requestId === requestSequence.current) setLoading(false);
      }
    };
    load();
    return () => {
      if (requestId === requestSequence.current) requestSequence.current += 1;
    };
  }, [month, activeFilters, activeSearch, page, sortBy, sortDirection, reloadCount]);

  const appliedCount = useMemo(
    () => Object.values(activeFilters).filter(Boolean).length + (activeSearch ? 1 : 0),
    [activeFilters, activeSearch],
  );
  const hasFiltersToClear = appliedCount > 0 || Object.values(draftFilters).some(Boolean) || Boolean(search.trim());

  const applyFilters = (event) => {
    event.preventDefault();
    setActiveFilters({ ...draftFilters });
    setActiveSearch(search.trim());
    setPage(1);
  };

  const resetFilters = () => {
    setDraftFilters(emptyFilters());
    setActiveFilters(emptyFilters());
    setSearch('');
    setActiveSearch('');
    setPage(1);
  };

  const toggleSort = (key) => {
    if (sortBy === key) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDirection(key === 'createdDate' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const filterOptions = report?.groups || {};
  const groups = report?.groups || {};
  const groupSections = [
    { key: 'userId', title: 'PPPoE user ID', icon: 'fa-fingerprint' },
    { key: 'connectionType', title: 'Connection type', icon: 'fa-network-wired' },
    { key: 'category', title: 'Problem category', icon: 'fa-screwdriver-wrench' },
    { key: 'vlan', title: 'VLAN', icon: 'fa-diagram-project' },
    { key: 'technician', title: 'Technician', icon: 'fa-user-gear' },
  ];

  return (
    <main className="sr-page sr-register">
      <nav className="sr-breadcrumb" aria-label="Breadcrumb">
        <Link to="/support-reports"><i className="fa-solid fa-arrow-left" aria-hidden="true" /> Support Reports</Link>
        <span aria-hidden="true">/</span>
        <span>Technician Support Register</span>
      </nav>

      <header className="sr-register-header">
        <div className="sr-register-title">
          <span className="sr-eyebrow">SUPPORT REPORTS <span aria-hidden="true">/</span> SERVICE ACTIVITY</span>
          <h1>Technician Support Register</h1>
          <p>শুধু সমাধান হওয়া টিকিট: তারিখ, গ্রাহক, সংযোগ, সমস্যা, VLAN ও টেকনিশিয়ান অনুযায়ী বিবরণ</p>
        </div>
        <div className="sr-month-context">
          <span className="sr-month-label"><i className="fa-regular fa-calendar" aria-hidden="true" /> REPORTING MONTH</span>
          <strong>{monthLabel(month)}</strong>
          <span>Dates shown in Asia/Dhaka</span>
        </div>
      </header>

      <section className="sr-control-panel" aria-label="Report filters">
        <form onSubmit={applyFilters}>
          <div className="sr-primary-filters">
            <label className="sr-field sr-month-field">
              <span>Month <b aria-hidden="true">*</b></span>
              <input
                type="month"
                value={month}
                onChange={(event) => { setMonth(event.target.value); setPage(1); }}
                required
                aria-label="Reporting month"
              />
            </label>
            <label className="sr-field sr-search-field">
              <span>Search register</span>
              <span className="sr-search-input">
                <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="User ID, number, category, VLAN or technician"
                  aria-label="Search all support record fields"
                />
              </span>
            </label>
            <button
              className="sr-filter-toggle"
              type="button"
              aria-expanded={showFilters}
              aria-controls="sr-secondary-filters"
              onClick={() => setShowFilters((shown) => !shown)}
            >
              <i className="fa-solid fa-sliders" aria-hidden="true" />
              Filters {appliedCount > 0 && <span className="sr-filter-count">{appliedCount}</span>}
            </button>
            <button className="sr-apply-button" type="submit">
              <i className="fa-solid fa-arrow-right-to-bracket" aria-hidden="true" /> Apply
            </button>
          </div>

          <div id="sr-secondary-filters" className={`sr-secondary-filters${showFilters ? ' is-open' : ''}`}>
            {FILTERS.map((filter) => (
              <label className="sr-field" key={filter.key}>
                <span>{filter.label}</span>
                <select
                  value={draftFilters[filter.key]}
                  onChange={(event) => setDraftFilters((current) => ({ ...current, [filter.key]: event.target.value }))}
                >
                  <option value="">All {filter.label.toLowerCase()}s</option>
                  {(filterOptions[filter.group] || []).map((option) => (
                    <option key={`${option.value}-${option.label}`} value={option.value}>
                      {option.label} ({formatCount(option.count)})
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button className="sr-reset-button" type="button" onClick={resetFilters} disabled={!hasFiltersToClear}>
              Clear filters
            </button>
          </div>
        </form>
      </section>

      {error && (
        <div className="sr-error-state" role="alert">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
          <div><strong>Report unavailable</strong><span>{error}</span></div>
          <button type="button" onClick={() => setReloadCount((count) => count + 1)}>Try again</button>
        </div>
      )}

      <section className="sr-summary" aria-label="Monthly summary" aria-busy={loading}>
        <div className="sr-summary-heading">
          <span className="sr-section-kicker">SOLVED TICKETS · MONTHLY SNAPSHOT</span>
          <span className="sr-snapshot-month">{monthLabel(month)} <span>· Dhaka time</span></span>
        </div>
        <div className="sr-summary-metrics">
          <article className="sr-summary-primary">
            <span>Support tickets</span>
            <strong>{loading && !report ? '—' : formatCount(report?.summary?.tickets)}</strong>
            <small>Matching this report scope</small>
          </article>
          <article>
            <span>Unique PPPoE users</span>
            <strong>{loading && !report ? '—' : formatCount(report?.summary?.uniqueUsers)}</strong>
            <small>Customers represented</small>
          </article>
          <article>
            <span>Technicians involved</span>
            <strong>{loading && !report ? '—' : formatCount(report?.summary?.technicians)}</strong>
            <small>Assigned and additional</small>
          </article>
          <div className="sr-summary-aside">
            <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
            <span>Historical phone and VLAN values are preferred when the ticket snapshot contains them.</span>
          </div>
        </div>
      </section>

      <section className="sr-breakdowns" aria-labelledby="sr-breakdown-title">
        <div className="sr-section-heading sr-breakdown-heading">
          <div><span className="sr-section-kicker">AT A GLANCE</span><h2 id="sr-breakdown-title">Grouped breakdowns</h2></div>
          <span>Counts follow the current month and filters</span>
        </div>
        <div className="sr-breakdown-grid">
          {groupSections.map((section) => {
            const values = (groups[section.key] || []).slice(0, 5);
            return (
              <article className="sr-breakdown" key={section.key}>
                <h3><i className={`fa-solid ${section.icon}`} aria-hidden="true" />{section.title}</h3>
                {loading && !report ? (
                  <div className="sr-breakdown-loading" aria-label="Loading breakdown"><span /><span /><span /></div>
                ) : values.length ? (
                  <ol>
                    {values.map((item) => (
                      <li key={`${item.value}-${item.label}`} title={item.label}>
                        <span>{item.label}</span><strong>{formatCount(item.count)}</strong>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="sr-breakdown-empty">No matching activity</p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="sr-register-table" aria-labelledby="sr-register-table-title">
        <header className="sr-table-heading">
          <div>
            <span className="sr-section-kicker">FULL DETAIL</span>
            <h2 id="sr-register-table-title">Technician activity ledger</h2>
            <p>{monthLabel(month)} <span aria-hidden="true">·</span> {formatCount(report?.total)} matching solved tickets</p>
          </div>
          <span className="sr-row-limit">50 rows per page</span>
        </header>

        {loading && !report ? (
          <div className="sr-table-state" role="status">
            <span className="sr-spinner" aria-hidden="true" />
            <strong>Loading support activity…</strong>
            <span>Fetching monthly tickets and grouped totals.</span>
          </div>
        ) : error && !report ? (
          <div className="sr-table-state sr-table-error" role="status">
            <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
            <strong>Unable to show the register</strong>
            <span>Check your connection or try loading the report again.</span>
          </div>
        ) : report && report.rows.length === 0 ? (
          <div className="sr-table-state">
            <span className="sr-empty-icon" aria-hidden="true"><i className="fa-regular fa-folder-open" /></span>
            <strong>No support tickets for this selection</strong>
            <span>Choose another month or clear some filters to see more activity.</span>
            {appliedCount > 0 && <button type="button" onClick={resetFilters}>Clear filters</button>}
          </div>
        ) : (
          <>
            <div className="sr-table-scroll" aria-busy={loading}>
              <table>
                <thead>
                  <tr>
                    {SORTABLE_COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        aria-sort={sortBy === column.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(column.key)}
                          aria-label={`Sort by ${column.label}${sortBy === column.key ? `, currently ${sortDirection}` : ''}`}
                        >
                          {column.label}
                          <i className={`fa-solid ${sortBy === column.key ? (sortDirection === 'asc' ? 'fa-arrow-up' : 'fa-arrow-down') : 'fa-sort'}`} aria-hidden="true" />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.ticket_id}>
                      <td className="sr-date-cell">{formatDate(row.created_date)}</td>
                      <td className="sr-user-cell">{row.user_id || '—'}</td>
                      <td>{row.connection_type || 'Unspecified'}</td>
                      <td className="sr-phone-cell">{row.phone || '—'}</td>
                      <td>{row.category_name || 'Uncategorized'}</td>
                      <td><span className="sr-vlan-tag">{row.vlan || 'Unknown'}</span></td>
                      <td className="sr-tech-cell">{row.supported_by || 'Unassigned'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="sr-pagination">
              <span>Showing <strong>{formatCount(report.total === 0 ? 0 : ((page - 1) * report.limit) + 1)}–{formatCount(Math.min(page * report.limit, report.total))}</strong> of <strong>{formatCount(report.total)}</strong></span>
              <div>
                <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading}>
                  <i className="fa-solid fa-chevron-left" aria-hidden="true" /> Previous
                </button>
                <span>Page {page} of {Math.max(1, report.totalPages)}</span>
                <button type="button" onClick={() => setPage((current) => current + 1)} disabled={page >= report.totalPages || loading}>
                  Next <i className="fa-solid fa-chevron-right" aria-hidden="true" />
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
    </main>
  );
};

export default TechnicianSupportRegister;
