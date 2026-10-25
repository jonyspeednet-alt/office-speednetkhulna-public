import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import moment from 'moment';
import { getLeaveSummaryReport } from '../services/reportService';
import { t } from '../i18n';
import '../styles/AdminDashboard.css';
import '../styles/LeaveReport.css';

const getCurrentYearRange = () => {
  const year = new Date().getFullYear();
  return {
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`
  };
};

const LeaveReport = () => {
  const [data, setData] = useState({
    employeesList: [],
    leaveTypes: [],
    summaryReport: [],
    grandTypeCounts: {},
    grandTotalDays: 0
  });

  const [filters, setFilters] = useState(() => ({
    employee_id: '',
    ...getCurrentYearRange()
  }));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchData = useCallback(async (overrideFilters = null) => {
    setLoading(true);
    setError('');
    try {
      const result = await getLeaveSummaryReport(overrideFilters || filters);
      setData(result);
    } catch (fetchError) {
      setError(fetchError?.response?.data?.message || t('leaveReport.loadError'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFilterChange = (event) => {
    setFilters((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const handleSearch = (event) => {
    event.preventDefault();
    const { employee_id, start_date, end_date } = filters;

    if (!start_date || !end_date) {
      setError(t('leaveReport.dateRangeRequired'));
      return;
    }

    if (end_date < start_date) {
      setError(t('leaveReport.invalidDateRange'));
      return;
    }

    if (moment.utc(end_date).diff(moment.utc(start_date), 'days') > 366) {
      setError(t('leaveReport.dateRangeTooLong'));
      return;
    }

    fetchData({ employee_id, start_date, end_date });
  };

  const handleReset = () => {
    const defaultFilters = { employee_id: '', ...getCurrentYearRange() };
    setFilters(defaultFilters);
    fetchData(defaultFilters);
  };

  const handleExport = () => {
    if (!data.summaryReport.length) return;

    const exportData = data.summaryReport.map((item, index) => {
      const row = {
        [t('leaveReport.sl')]: index + 1,
        [t('leaveReport.employeeName')]: item.name,
        [t('leaveReport.designation')]: item.designation
      };

      data.leaveTypes.forEach((leaveType) => {
        row[leaveType.name] = item.type_counts[leaveType.id] || '-';
      });

      row[t('leaveReport.total')] = item.total_days;
      return row;
    });

    const totalRow = {
      [t('leaveReport.sl')]: '',
      [t('leaveReport.employeeName')]: t('leaveReport.grandTotalLabel'),
      [t('leaveReport.designation')]: ''
    };
    data.leaveTypes.forEach((leaveType) => {
      totalRow[leaveType.name] = data.grandTypeCounts[leaveType.id] || '-';
    });
    totalRow[t('leaveReport.total')] = data.grandTotalDays;
    exportData.push(totalRow);

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, t('leaveReport.exportSheet'));
    XLSX.writeFile(workbook, `${t('leaveReport.exportFilePrefix')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const previewRange = useMemo(() => {
    if (!filters.start_date || !filters.end_date) return t('leaveReport.allDates');
    const start = moment(filters.start_date).format('DD MMM YYYY');
    const end = moment(filters.end_date).format('DD MMM YYYY');
    return `${start} - ${end}`;
  }, [filters.start_date, filters.end_date]);

  return (
    <>
      <section className="lr-hero">
        <div>
          <span className="lr-chip">
            <i className="fa-solid fa-chart-line"></i>
            {t('leaveReport.reportCenter')}
          </span>
          <h1>{t('leaveReport.title')}</h1>
          <p>{t('leaveReport.subtitle')}</p>
        </div>
        <div className="lr-metric-grid">
          <article>
            <span>{t('leaveReport.employees')}</span>
            <strong>{data.summaryReport.length}</strong>
          </article>
          <article>
            <span>{t('leaveReport.leaveTypes')}</span>
            <strong>{data.leaveTypes.length}</strong>
          </article>
          <article>
            <span>{t('leaveReport.totalDays')}</span>
            <strong>{data.grandTotalDays || 0}</strong>
          </article>
          <article>
            <span>{t('leaveReport.range')}</span>
            <strong>{previewRange}</strong>
          </article>
        </div>
      </section>

      <section className="lr-filter-card">
        <form onSubmit={handleSearch} className="lr-filters">
          <div>
            <label>{t('leaveReport.selectEmployee')}</label>
            <select name="employee_id" value={filters.employee_id} onChange={handleFilterChange}>
              <option value="">{t('leaveReport.allEmployees')}</option>
              {data.employeesList.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>{t('leaveReport.startDate')}</label>
            <input
              type="date"
              name="start_date"
              value={filters.start_date}
              onChange={handleFilterChange}
              required
            />
          </div>

          <div>
            <label>{t('leaveReport.endDate')}</label>
            <input
              type="date"
              name="end_date"
              value={filters.end_date}
              onChange={handleFilterChange}
              required
            />
          </div>

          <div className="lr-actions">
            <button type="submit" className="btn-primary-lite">
              <i className="fa-solid fa-magnifying-glass"></i>
              {t('leaveReport.view')}
            </button>
            <button type="button" className="btn-success-lite" onClick={handleExport} disabled={!data.summaryReport.length}>
              <i className="fa-solid fa-file-excel"></i>
              {t('leaveReport.export')}
            </button>
            <button type="button" className="btn-neutral-lite" onClick={() => window.print()}>
              <i className="fa-solid fa-print"></i>
              {t('leaveReport.print')}
            </button>
            <button type="button" className="btn-soft-lite" onClick={handleReset}>
              <i className="fa-solid fa-rotate"></i>
              {t('leaveReport.reset')}
            </button>
          </div>
        </form>
      </section>

      {error && (
        <section className="lr-error">
          <i className="fa-solid fa-triangle-exclamation"></i>
          <span>{error}</span>
        </section>
      )}

      <section className="lr-table-card">
        <header>
          <div>
            <h2>{t('leaveReport.summaryTitle')}</h2>
            <p className="lr-print-range">{t('leaveReport.range')}: {previewRange}</p>
            <p>{t('leaveReport.generatedOn')} {moment().format('DD MMMM YYYY, h:mm A')}</p>
          </div>
        </header>

        <div className="table-responsive">
          <table className="table mb-0 lr-table">
            <thead>
              <tr>
                <th>{t('leaveReport.sl')}</th>
                <th>{t('leaveReport.employeeName')}</th>
                <th>{t('leaveReport.designation')}</th>
                {data.leaveTypes.map((leaveType) => (
                  <th key={leaveType.id} className="text-center">
                    {leaveType.name}
                  </th>
                ))}
                <th className="text-center">{t('leaveReport.total')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan="100%" className="text-center py-5">
                    <div className="spinner-border text-primary" role="status">
                      <span className="visually-hidden">{t('leaveReport.loading')}</span>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && data.summaryReport.length === 0 && (
                <tr>
                  <td colSpan="100%" className="text-center py-5 text-muted">
                    {t('leaveReport.noData')}
                  </td>
                </tr>
              )}

              {!loading &&
                data.summaryReport.map((item, index) => (
                  <tr key={item.user_id}>
                    <td>{index + 1}</td>
                    <td className="fw-bold">{item.name}</td>
                    <td>{item.designation}</td>
                    {data.leaveTypes.map((leaveType) => (
                      <td key={leaveType.id} className="text-center">
                        {item.type_counts[leaveType.id] > 0 ? item.type_counts[leaveType.id] : '-'}
                      </td>
                    ))}
                    <td className="text-center fw-bold total-cell">{item.total_days}</td>
                  </tr>
                ))}
            </tbody>

            <tfoot>
              <tr>
                <td colSpan="3" className="text-end text-uppercase fw-bold">
                  {t('leaveReport.grandTotal')}
                </td>
                {data.leaveTypes.map((leaveType) => (
                  <td key={leaveType.id} className="text-center fw-bold">
                    {data.grandTypeCounts[leaveType.id] > 0 ? data.grandTypeCounts[leaveType.id] : '-'}
                  </td>
                ))}
                <td className="text-center fw-bold total-footer">{data.grandTotalDays}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </>
  );
};

export default LeaveReport;
