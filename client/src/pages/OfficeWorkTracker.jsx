import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bar } from 'react-chartjs-2';
import { confirmAction } from '../utils/confirm';
import { formatClockTime, formatDateTime as formatTimestamp } from '../utils/formatters';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { t } from '../i18n';
import { getWorkEntries, addWorkEntry, updateWorkEntry, toggleWorkEntry, deleteWorkEntry, addWorkSession, getWorkPerformanceSummary, getWorkKpiTargets, upsertWorkKpiTarget } from '../services/officeWorkService';
import { getDepartments } from '../services/employeeService';
import '../styles/OfficeWorkTracker.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const makeDefaultTimeState = () => {
  const now = new Date();
  const start = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const endDate = new Date(now.getTime() + 60 * 60 * 1000);
  const end = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
  return {
    work_date: now.toISOString().slice(0, 10),
    start_time: start,
    end_time: end
  };
};

const OfficeWorkTracker = () => {
  const queryClient = useQueryClient();
  const defaults = makeDefaultTimeState();
  const performanceDefaultEnd = new Date().toISOString().slice(0, 10);
  const performanceDefaultStartDate = new Date(Date.now() - (14 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  const loggedInUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);
  const canViewPerformance = useMemo(() => {
    const role = String(loggedInUser?.role || '').trim().toLowerCase();
    const perms = loggedInUser?.permissions || {};
    return Boolean(
      role === 'admin' ||
      role === 'super admin' ||
      role === 'superadmin' ||
      role === 'hr' ||
      loggedInUser?.all_access ||
      loggedInUser?.p_manage_users ||
      loggedInUser?.p_office_work ||
      loggedInUser?.['users.manage'] ||
      loggedInUser?.['office_work.manage'] ||
      perms.all_access ||
      perms.p_manage_users ||
      perms.p_office_work ||
      perms['users.manage'] ||
      perms['office_work.manage']
    );
  }, [loggedInUser]);

  const [newEntry, setNewEntry] = useState({
    task: '',
    category: 'general',
    priority: 'normal',
    assignment_type: 'single',
    department_tags: [],
    ...defaults
  });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    task: '',
    category: 'general',
    priority: 'normal',
    assignment_type: 'single',
    department_tags: [],
    work_date: '',
    start_time: '',
    end_time: ''
  });
  const [filter, setFilter] = useState('all');
  const [sessionDraftByEntry, setSessionDraftByEntry] = useState({});
  const [performanceFilters, setPerformanceFilters] = useState({
    start_date: performanceDefaultStartDate,
    end_date: performanceDefaultEnd,
    department: ''
  });
  const [kpiMonth, setKpiMonth] = useState(new Date().toISOString().slice(0, 7));
  const [kpiDraftByDept, setKpiDraftByDept] = useState({});

  const categories = [
    { id: 'general', icon: 'fa-clipboard-list', label: 'general' },
    { id: 'meeting', icon: 'fa-handshake', label: 'meeting' },
    { id: 'development', icon: 'fa-laptop-code', label: 'development' },
    { id: 'maintenance', icon: 'fa-screwdriver-wrench', label: 'maintenance' },
    { id: 'support', icon: 'fa-headset', label: 'support' },
    { id: 'documentation', icon: 'fa-file-lines', label: 'documentation' },
    { id: 'training', icon: 'fa-book-open', label: 'training' },
    { id: 'admin', icon: 'fa-gear', label: 'admin' }
  ];

  const priorities = [
    { id: 'high', label: 'high', color: '#ef4444' },
    { id: 'normal', label: 'normal', color: '#3b82f6' },
    { id: 'low', label: 'low', color: '#22c55e' }
  ];

  const { data: workEntries = [], isLoading, error } = useQuery({
    queryKey: ['officeWorkEntries'],
    queryFn: getWorkEntries,
    staleTime: 30000
  });
  const { data: departments = [] } = useQuery({
    queryKey: ['officeWorkTrackerDepartments'],
    queryFn: getDepartments,
    staleTime: 10 * 60 * 1000
  });
  const departmentOptions = useMemo(
    () => [...new Set(departments.map((d) => String(d.dept_name || '').trim()).filter(Boolean))],
    [departments]
  );
  const { data: performanceData, isLoading: performanceLoading, error: performanceError } = useQuery({
    queryKey: ['officeWorkPerformanceSummary', performanceFilters.start_date, performanceFilters.end_date, performanceFilters.department],
    queryFn: () => getWorkPerformanceSummary(performanceFilters),
    enabled: canViewPerformance,
    staleTime: 30000
  });
  const { data: kpiData, isLoading: kpiLoading, error: kpiError } = useQuery({
    queryKey: ['officeWorkKpiTargets', kpiMonth],
    queryFn: () => getWorkKpiTargets({ month: kpiMonth }),
    enabled: canViewPerformance,
    staleTime: 30000
  });

  const addEntryMutation = useMutation({
    mutationFn: addWorkEntry,
    onSuccess: () => {
      queryClient.invalidateQueries(['officeWorkEntries']);
      queryClient.invalidateQueries(['officeWorkPerformanceSummary']);
      setNewEntry({
        task: '',
        category: 'general',
        priority: 'normal',
        assignment_type: 'single',
        department_tags: [],
        ...makeDefaultTimeState()
      });
    }
  });

  const updateEntryMutation = useMutation({
    mutationFn: updateWorkEntry,
    onSuccess: () => {
      queryClient.invalidateQueries(['officeWorkEntries']);
      queryClient.invalidateQueries(['officeWorkPerformanceSummary']);
      setEditingId(null);
    }
  });

  const toggleEntryMutation = useMutation({
    mutationFn: toggleWorkEntry,
    onSuccess: () => {
      queryClient.invalidateQueries(['officeWorkEntries']);
      queryClient.invalidateQueries(['officeWorkPerformanceSummary']);
    }
  });

  const deleteEntryMutation = useMutation({
    mutationFn: deleteWorkEntry,
    onSuccess: () => {
      queryClient.invalidateQueries(['officeWorkEntries']);
      queryClient.invalidateQueries(['officeWorkPerformanceSummary']);
    }
  });
  const addSessionMutation = useMutation({
    mutationFn: addWorkSession,
    onSuccess: () => {
      queryClient.invalidateQueries(['officeWorkEntries']);
      queryClient.invalidateQueries(['officeWorkPerformanceSummary']);
    }
  });
  const saveKpiMutation = useMutation({
    mutationFn: upsertWorkKpiTarget,
    onSuccess: () => {
      queryClient.invalidateQueries(['officeWorkKpiTargets']);
    }
  });

  const handleAddEntry = (e) => {
    e.preventDefault();
    if (!newEntry.task.trim()) return;
    if (!newEntry.work_date || !newEntry.start_time || !newEntry.end_time) return;
    addEntryMutation.mutate({
      ...newEntry,
      assignment_type: newEntry.assignment_type === 'hybrid' || (newEntry.department_tags || []).length > 1 ? 'hybrid' : 'single'
    });
  };

  const handleDelete = async (id) => {
    if (await confirmAction({ title: t('officeWorkTracker.confirmDelete'), danger: true })) {
      deleteEntryMutation.mutate(id);
    }
  };

  const handleStartEdit = (entry) => {
    setEditingId(entry.id);
    setEditForm({
      task: entry.task || '',
      category: entry.category || 'general',
      priority: entry.priority || 'normal',
      assignment_type: entry.assignment_type || ((entry.department_tags || []).length > 1 ? 'hybrid' : 'single'),
      department_tags: Array.isArray(entry.department_tags) ? entry.department_tags : [],
      work_date: String(entry.work_date || '').slice(0, 10),
      start_time: String(entry.start_time || '').slice(0, 5),
      end_time: String(entry.end_time || '').slice(0, 5)
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleSaveEdit = (id) => {
    if (!editForm.task.trim()) return;
    if (!editForm.work_date || !editForm.start_time || !editForm.end_time) return;
    updateEntryMutation.mutate({
      id,
      data: {
        task: editForm.task.trim(),
        category: editForm.category,
        priority: editForm.priority,
        assignment_type: editForm.assignment_type === 'hybrid' || (editForm.department_tags || []).length > 1 ? 'hybrid' : 'single',
        department_tags: editForm.department_tags || [],
        work_date: editForm.work_date,
        start_time: editForm.start_time,
        end_time: editForm.end_time
      }
    });
  };
  const toggleDepartmentTag = (field, value) => {
    if (!value) return;
    const updateFn = field === 'new' ? setNewEntry : setEditForm;
    updateFn((prev) => {
      const current = Array.isArray(prev.department_tags) ? prev.department_tags : [];
      const hasTag = current.includes(value);
      const nextTags = hasTag ? current.filter((tag) => tag !== value) : [...current, value];
      return {
        ...prev,
        department_tags: nextTags,
        assignment_type: nextTags.length > 1 ? 'hybrid' : prev.assignment_type
      };
    });
  };
  const getSessionDraft = (entry) => {
    if (sessionDraftByEntry[entry.id]) return sessionDraftByEntry[entry.id];
    return {
      work_date: String(entry.work_date || '').slice(0, 10),
      start_time: String(entry.start_time || '').slice(0, 5),
      end_time: String(entry.end_time || '').slice(0, 5),
      notes: ''
    };
  };
  const setSessionDraft = (entryId, patch) => {
    setSessionDraftByEntry((prev) => ({
      ...prev,
      [entryId]: {
        ...(prev[entryId] || {}),
        ...patch
      }
    }));
  };
  const handleAddSession = (entry) => {
    const draft = getSessionDraft(entry);
    if (!draft.work_date || !draft.start_time || !draft.end_time) return;
    addSessionMutation.mutate({
      id: entry.id,
      data: draft
    });
    setSessionDraftByEntry((prev) => ({
      ...prev,
      [entry.id]: {
        ...draft,
        notes: ''
      }
    }));
  };

  const getCategoryInfo = (categoryId) => categories.find((c) => c.id === categoryId) || categories[0];
  const getPriorityInfo = (priorityId) => priorities.find((p) => p.id === priorityId) || priorities[1];

  const formatRelativeTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hour ago`;
    return formatTimestamp(date);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('bn-BD', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const formatClock = (timeStr) => {
    if (!timeStr) return '--:--';
    const hhmm = String(timeStr).slice(0, 5);
    return formatClockTime(hhmm) || '--:--';
  };

  const formatDateTime = (timestamp) => {
    if (!timestamp) return '-';
    return formatTimestamp(timestamp) || '-';
  };
  const formatMinutes = (minutes) => {
    const total = Number(minutes || 0);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h <= 0) return `${m}m`;
    return `${h}h ${m}m`;
  };
  const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`;
  const applyQuickRange = (days) => {
    const end = new Date();
    const start = new Date(Date.now() - ((Math.max(1, Number(days || 1)) - 1) * 24 * 60 * 60 * 1000));
    setPerformanceFilters((prev) => ({
      ...prev,
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10)
    }));
  };
  const exportPerformanceCsv = () => {
    const rows = performanceData?.employees || [];
    if (rows.length === 0) return;
    const headers = [
      'Employee',
      'Employee ID',
      'Department',
      'Total Tasks',
      'Completed',
      'Pending',
      'Completion Rate',
      'Total Minutes',
      'Hybrid Tasks'
    ];
    const csvRows = rows.map((row) => [
      `"${String(row.full_name || '').replace(/"/g, '""')}"`,
      `"${String(row.employee_id || '')}"`,
      `"${String(row.home_department || '').replace(/"/g, '""')}"`,
      Number(row.total_tasks || 0),
      Number(row.completed_tasks || 0),
      Number(row.pending_tasks || 0),
      Number(row.completion_rate || 0),
      Number(row.total_minutes || 0),
      Number(row.hybrid_tasks || 0)
    ].join(','));
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `office-work-performance-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  const getKpiDraft = (row) => {
    const key = String(row?.department || '');
    if (kpiDraftByDept[key]) return kpiDraftByDept[key];
    return {
      task_target: Number(row?.target?.tasks || 0),
      completion_target: Number(row?.target?.completion_rate || 80),
      minutes_target: Number(row?.target?.minutes || 0)
    };
  };
  const setKpiDraft = (department, patch) => {
    const key = String(department || '');
    setKpiDraftByDept((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        ...patch
      }
    }));
  };
  const handleSaveKpi = (department) => {
    const draft = getKpiDraft({ department });
    saveKpiMutation.mutate({
      month: kpiMonth,
      department,
      task_target: Number(draft.task_target || 0),
      completion_target: Number(draft.completion_target || 0),
      minutes_target: Number(draft.minutes_target || 0)
    });
  };
  const kpiChartData = useMemo(() => {
    const rows = (kpiData?.rows || []).slice(0, 8);
    return {
      labels: rows.map((r) => r.department),
      datasets: [
        {
          label: 'Target Tasks',
          backgroundColor: '#93c5fd',
          borderColor: '#3b82f6',
          borderWidth: 1,
          data: rows.map((r) => Number(r?.target?.tasks || 0))
        },
        {
          label: 'Actual Tasks',
          backgroundColor: '#22c55e',
          borderColor: '#16a34a',
          borderWidth: 1,
          data: rows.map((r) => Number(r?.actual?.tasks || 0))
        }
      ]
    };
  }, [kpiData]);

  const filteredEntries = filter === 'all'
    ? workEntries
    : filter === 'completed'
      ? workEntries.filter((e) => e.completed)
      : workEntries.filter((e) => !e.completed);

  const stats = {
    total: workEntries.length,
    completed: workEntries.filter((e) => e.completed).length,
    pending: workEntries.filter((e) => !e.completed).length
  };

  if (error) {
    return (
      <div className="office-work-tracker">
        <div className="error-state">
          <div className="error-icon">!</div>
          <p className="error-text">{t('officeWorkTracker.loadError')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="office-work-tracker">
      <div className="tracker-header">
        <div className="header-content">
          <h1 className="tracker-title">
            <span className="title-icon"><i className="fa-solid fa-clipboard-list" /></span>
            {t('officeWorkTracker.title')}
          </h1>
          <p className="tracker-subtitle">{t('officeWorkTracker.subtitle')}</p>
        </div>
        <div className="header-stats">
          <div className="stat-card total"><span className="stat-number">{stats.total}</span><span className="stat-label">{t('officeWorkTracker.total')}</span></div>
          <div className="stat-card completed"><span className="stat-number">{stats.completed}</span><span className="stat-label">{t('officeWorkTracker.completed')}</span></div>
          <div className="stat-card pending"><span className="stat-number">{stats.pending}</span><span className="stat-label">{t('officeWorkTracker.pending')}</span></div>
        </div>
      </div>

      {canViewPerformance && (
        <div className="performance-panel">
          <div className="performance-panel-header">
            <h2><i className="fa-solid fa-chart-line me-2" />Team Performance Monitor</h2>
            <div className="performance-filters">
              <div className="performance-quick-ranges">
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => applyQuickRange(7)}>Last 7d</button>
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => applyQuickRange(14)}>Last 14d</button>
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => applyQuickRange(30)}>Last 30d</button>
              </div>
              <input
                type="date"
                className="form-control"
                value={performanceFilters.start_date}
                onChange={(e) => setPerformanceFilters((prev) => ({ ...prev, start_date: e.target.value }))}
              />
              <input
                type="date"
                className="form-control"
                value={performanceFilters.end_date}
                onChange={(e) => setPerformanceFilters((prev) => ({ ...prev, end_date: e.target.value }))}
              />
              <select
                className="form-select"
                value={performanceFilters.department}
                onChange={(e) => setPerformanceFilters((prev) => ({ ...prev, department: e.target.value }))}
              >
                <option value="">All Departments</option>
                {departmentOptions.map((dept) => (
                  <option key={`perf-${dept}`} value={dept}>{dept}</option>
                ))}
              </select>
              <button type="button" className="btn btn-sm btn-success" onClick={exportPerformanceCsv}>
                <i className="fa-solid fa-file-csv me-1" />
                Export CSV
              </button>
            </div>
          </div>

          <div className="kpi-target-panel">
            <div className="kpi-target-header">
              <h4><i className="fa-solid fa-bullseye me-2" />Department KPI Target vs Actual</h4>
              <input
                type="month"
                className="form-control"
                style={{ maxWidth: 180 }}
                value={kpiMonth}
                onChange={(e) => setKpiMonth(e.target.value)}
              />
            </div>

            {kpiLoading ? (
              <div className="performance-loading">Loading KPI targets...</div>
            ) : kpiError ? (
              <div className="performance-error">KPI target data unavailable.</div>
            ) : (
              <>
                <div className="kpi-chart-wrap">
                  <Bar
                    data={kpiChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: 'bottom' }
                      }
                    }}
                  />
                </div>
                <div className="table-responsive mt-2">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Department</th>
                        <th>Target Tasks</th>
                        <th>Target %</th>
                        <th>Target Min</th>
                        <th>Actual Tasks</th>
                        <th>Actual %</th>
                        <th>Status</th>
                        <th>Save</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(kpiData?.rows || []).map((row) => {
                        const draft = getKpiDraft(row);
                        return (
                          <tr key={`kpi-row-${row.department}`}>
                            <td>{row.department}</td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                className="form-control form-control-sm"
                                style={{ minWidth: 90 }}
                                value={draft.task_target}
                                onChange={(e) => setKpiDraft(row.department, { task_target: e.target.value })}
                                disabled={!kpiData?.kpi_storage_enabled}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                className="form-control form-control-sm"
                                style={{ minWidth: 90 }}
                                value={draft.completion_target}
                                onChange={(e) => setKpiDraft(row.department, { completion_target: e.target.value })}
                                disabled={!kpiData?.kpi_storage_enabled}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                className="form-control form-control-sm"
                                style={{ minWidth: 110 }}
                                value={draft.minutes_target}
                                onChange={(e) => setKpiDraft(row.department, { minutes_target: e.target.value })}
                                disabled={!kpiData?.kpi_storage_enabled}
                              />
                            </td>
                            <td>{row?.actual?.tasks || 0}</td>
                            <td>{formatPercent(row?.actual?.completion_rate || 0)}</td>
                            <td>
                              <span className={`kpi-status-badge ${row?.achievement?.status || 'off_track'}`}>
                                {String(row?.achievement?.status || 'off_track').replace('_', ' ')}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={() => handleSaveKpi(row.department)}
                                disabled={!kpiData?.kpi_storage_enabled || saveKpiMutation.isPending}
                              >
                                Save
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!kpiData?.kpi_storage_enabled && (
                  <div className="text-danger small mt-2">No KPI storage (DB permission issue); view-only mode is on.</div>
                )}
              </>
            )}
          </div>

          {performanceLoading ? (
            <div className="performance-loading">Loading team performance...</div>
          ) : performanceError ? (
            <div className="performance-error">Performance data unavailable right now.</div>
          ) : (
            <>
              <div className="performance-summary-grid">
                <div className="performance-summary-card">
                  <span>Employees</span>
                  <strong>{performanceData?.summary?.total_employees || 0}</strong>
                </div>
                <div className="performance-summary-card">
                  <span>Total Tasks</span>
                  <strong>{performanceData?.summary?.total_tasks || 0}</strong>
                </div>
                <div className="performance-summary-card">
                  <span>Completion</span>
                  <strong>{formatPercent(performanceData?.summary?.completion_rate)}</strong>
                </div>
                <div className="performance-summary-card">
                  <span>Total Hours</span>
                  <strong>{formatMinutes(performanceData?.summary?.total_minutes || 0)}</strong>
                </div>
                <div className="performance-summary-card">
                  <span>Hybrid Tasks</span>
                  <strong>{performanceData?.summary?.hybrid_tasks || 0}</strong>
                </div>
                <div className="performance-summary-card">
                  <span>Daily Avg Time</span>
                  <strong>{formatMinutes(performanceData?.summary?.avg_daily_minutes || 0)}</strong>
                </div>
              </div>

              {(performanceData?.alerts || []).length > 0 && (
                <div className="performance-alerts">
                  <h4><i className="fa-solid fa-triangle-exclamation me-2" />Needs Attention</h4>
                  <div className="performance-alert-list">
                    {performanceData.alerts.map((row) => (
                      <div key={`alert-${row.user_id}`} className="performance-alert-item">
                        <strong>{row.full_name}</strong>
                        <span>{row.home_department}</span>
                        <span>Completion: {formatPercent(row.completion_rate)}</span>
                        <span>Pending: {row.pending_tasks}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="performance-tables">
                <div className="performance-table-card">
                  <h4>Employee Performance</h4>
                  <div className="table-responsive">
                    <table className="table table-sm align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Employee</th>
                          <th>Department</th>
                          <th>Tasks</th>
                          <th>Done</th>
                          <th>Rate</th>
                          <th>Time</th>
                          <th>Hybrid</th>
                          <th>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(performanceData?.employees || []).slice(0, 10).map((row) => (
                          <tr key={`perf-emp-${row.user_id}`}>
                            <td>{row.full_name}</td>
                            <td>{row.home_department}</td>
                            <td>{row.total_tasks}</td>
                            <td>{row.completed_tasks}</td>
                            <td>{formatPercent(row.completion_rate)}</td>
                            <td>{formatMinutes(row.total_minutes)}</td>
                            <td>{row.hybrid_tasks}</td>
                            <td>
                              <span className={`score-pill ${row.score_level || 'average'}`}>
                                {Number(row.performance_score || 0).toFixed(1)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="performance-table-card">
                  <h4>Department Breakdown</h4>
                  <div className="table-responsive">
                    <table className="table table-sm align-middle mb-0">
                      <thead>
                        <tr>
                          <th>Department</th>
                          <th>Employees</th>
                          <th>Tasks</th>
                          <th>Rate</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(performanceData?.departments || []).map((row) => (
                          <tr key={`perf-dept-${row.department}`}>
                            <td>{row.department}</td>
                            <td>{row.employee_count}</td>
                            <td>{row.total_tasks}</td>
                            <td>{formatPercent(row.completion_rate)}</td>
                            <td>{formatMinutes(row.total_minutes)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="performance-tables">
                <div className="performance-table-card">
                  <h4>Top Performers</h4>
                  <div className="performance-ranking-list">
                    {(performanceData?.top_performers || []).map((row, idx) => (
                      <div key={`top-${row.user_id}`} className="performance-ranking-item">
                        <span className="rank">{idx + 1}</span>
                        <span className="name">{row.full_name}</span>
                        <span className="meta">{formatPercent(row.completion_rate)} | {row.total_tasks} tasks</span>
                        <span className={`score-pill ${row.score_level || 'average'}`}>{Number(row.performance_score || 0).toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="performance-table-card">
                  <h4>Bottom Performers</h4>
                  <div className="performance-ranking-list">
                    {(performanceData?.bottom_performers || []).map((row, idx) => (
                      <div key={`bottom-${row.user_id}`} className="performance-ranking-item">
                        <span className="rank">{idx + 1}</span>
                        <span className="name">{row.full_name}</span>
                        <span className="meta">{formatPercent(row.completion_rate)} | Pending {row.pending_tasks}</span>
                        <span className={`score-pill ${row.score_level || 'average'}`}>{Number(row.performance_score || 0).toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="performance-table-card">
                <h4>Insights & Recommendations</h4>
                <div className="insight-grid">
                  <div className="insight-item">
                    <span>Risk Level</span>
                    <strong className={`risk-tag ${(performanceData?.insights?.risk_level || 'low')}`}>
                      {String(performanceData?.insights?.risk_level || 'low').toUpperCase()}
                    </strong>
                  </div>
                  <div className="insight-item">
                    <span>Strongest Department</span>
                    <strong>{performanceData?.insights?.strongest_department?.department || '-'}</strong>
                  </div>
                  <div className="insight-item">
                    <span>Busiest Day</span>
                    <strong>{formatDate(performanceData?.insights?.busiest_day?.work_date)}</strong>
                  </div>
                </div>
                <div className="insight-reco-list">
                  {(performanceData?.insights?.recommendations || []).length === 0 ? (
                    <div className="text-muted small">No critical recommendations for selected period.</div>
                  ) : (
                    (performanceData?.insights?.recommendations || []).map((rec, idx) => (
                      <div key={`reco-${idx}`} className="insight-reco-item">
                        <i className="fa-solid fa-circle-check" />
                        <span>{rec}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="performance-table-card">
                <h4>Daily Trend (Last {performanceData?.daily_trend?.length || 0} days)</h4>
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Tasks</th>
                        <th>Completed</th>
                        <th>Rate</th>
                        <th>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(performanceData?.daily_trend || []).map((day) => {
                        const rate = Number(day.total_tasks || 0) > 0
                          ? (Number(day.completed_tasks || 0) / Number(day.total_tasks || 0)) * 100
                          : 0;
                        return (
                          <tr key={`trend-${day.work_date}`}>
                            <td>{formatDate(day.work_date)}</td>
                            <td>{day.total_tasks}</td>
                            <td>{day.completed_tasks}</td>
                            <td>{formatPercent(rate)}</td>
                            <td>{formatMinutes(day.total_minutes)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <div className="tracker-body">
        <div className="entry-form-section">
          <form onSubmit={handleAddEntry} className="entry-form">
            <div className="form-main">
              <div className="input-wrapper">
                <span className="input-icon"><i className="fa-solid fa-pen" /></span>
                <input
                  type="text"
                  className="task-input"
                  placeholder={t('officeWorkTracker.placeholder')}
                  value={newEntry.task}
                  onChange={(e) => setNewEntry({ ...newEntry, task: e.target.value })}
                />
              </div>
            </div>

            <div className="form-options">
              <div className="priority-selector">
                <label className="option-label">Task Time</label>
                <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
                  <input type="date" className="form-control" style={{ maxWidth: 180 }} value={newEntry.work_date} onChange={(e) => setNewEntry({ ...newEntry, work_date: e.target.value })} />
                  <input type="time" className="form-control" style={{ maxWidth: 140 }} value={newEntry.start_time} onChange={(e) => setNewEntry({ ...newEntry, start_time: e.target.value })} />
                  <span className="text-muted">to</span>
                  <input type="time" className="form-control" style={{ maxWidth: 140 }} value={newEntry.end_time} onChange={(e) => setNewEntry({ ...newEntry, end_time: e.target.value })} />
                </div>
              </div>

              <div className="category-selector">
                <label className="option-label">{t('officeWorkTracker.category')}</label>
                <div className="category-chips">
                  {categories.map((cat) => (
                    <button key={cat.id} type="button" className={`category-chip ${newEntry.category === cat.id ? 'active' : ''}`} onClick={() => setNewEntry({ ...newEntry, category: cat.id })}>
                      <span className="chip-icon"><i className={`fa-solid ${cat.icon}`} /></span>
                      <span className="chip-label">{t(`officeWorkTracker.categories.${cat.label}`)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="category-selector">
                <label className="option-label">Departments (multi-select)</label>
                <div className="category-chips">
                  {departmentOptions.length === 0 ? (
                    <span className="text-muted small">No departments configured</span>
                  ) : (
                    departmentOptions.map((dept) => (
                      <button
                        key={`new-dept-${dept}`}
                        type="button"
                        className={`category-chip ${(newEntry.department_tags || []).includes(dept) ? 'active' : ''}`}
                        onClick={() => toggleDepartmentTag('new', dept)}
                      >
                        <span className="chip-icon"><i className="fa-solid fa-building-user" /></span>
                        <span className="chip-label">{dept}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="priority-selector">
                <label className="option-label">Assignment Type</label>
                <div className="priority-buttons">
                  <button
                    type="button"
                    className={`priority-btn ${newEntry.assignment_type === 'single' ? 'active' : ''}`}
                    onClick={() => setNewEntry({ ...newEntry, assignment_type: 'single' })}
                  >
                    Single Department
                  </button>
                  <button
                    type="button"
                    className={`priority-btn ${newEntry.assignment_type === 'hybrid' ? 'active' : ''}`}
                    onClick={() => setNewEntry({ ...newEntry, assignment_type: 'hybrid' })}
                  >
                    Hybrid / Cross Team
                  </button>
                </div>
              </div>

              <div className="priority-selector">
                <label className="option-label">{t('officeWorkTracker.priority')}</label>
                <div className="priority-buttons">
                  {priorities.map((pri) => (
                    <button
                      key={pri.id}
                      type="button"
                      className={`priority-btn ${newEntry.priority === pri.id ? 'active' : ''}`}
                      style={{ '--priority-color': pri.color, borderColor: newEntry.priority === pri.id ? pri.color : 'transparent' }}
                      onClick={() => setNewEntry({ ...newEntry, priority: pri.id })}
                    >
                      {t(`officeWorkTracker.priorities.${pri.label}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button type="submit" className="submit-btn" disabled={!newEntry.task.trim() || !newEntry.work_date || !newEntry.start_time || !newEntry.end_time || addEntryMutation.isPending}>
              <span className="btn-icon"><i className="fa-solid fa-plus" /></span>
              {addEntryMutation.isPending ? t('officeWorkTracker.adding') : t('officeWorkTracker.addTask')}
            </button>
          </form>
        </div>

        <div className="entries-section">
          <div className="filter-bar">
            <h2 className="section-title"><span className="section-icon"><i className="fa-solid fa-list-check" /></span>{t('officeWorkTracker.myTasks')}</h2>
            <div className="filter-tabs">
              <button className={`filter-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>{t('officeWorkTracker.all')}</button>
              <button className={`filter-tab ${filter === 'pending' ? 'active' : ''}`} onClick={() => setFilter('pending')}>{t('officeWorkTracker.pendingTab')}</button>
              <button className={`filter-tab ${filter === 'completed' ? 'active' : ''}`} onClick={() => setFilter('completed')}>{t('officeWorkTracker.completedTab')}</button>
            </div>
          </div>

          <div className="entries-list">
            {isLoading ? (
              <div className="loading-state"><div className="spinner-border text-primary" role="status"><span className="visually-hidden">{t('app.loading')}</span></div></div>
            ) : filteredEntries.length === 0 ? (
              <div className="empty-state"><div className="empty-icon"><i className="fa-regular fa-clipboard" /></div><p className="empty-text">{t('officeWorkTracker.noTasks')}</p></div>
            ) : (
              filteredEntries.map((entry) => {
                const category = getCategoryInfo(entry.category);
                const priority = getPriorityInfo(entry.priority);
                const isEditing = editingId === entry.id;
                const sessionDraft = getSessionDraft(entry);
                const sessions = Array.isArray(entry.sessions) ? entry.sessions : [];

                return (
                  <div key={entry.id} className={`entry-card ${entry.completed ? 'completed' : ''}`} style={{ '--priority-color': priority.color }}>
                    <div className="entry-content">
                      <div className="entry-header">
                        {isEditing ? (
                          <div className="d-flex flex-wrap gap-2 w-100">
                            <select className="form-select" style={{ maxWidth: 200 }} value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                              {categories.map((cat) => (
                                <option key={cat.id} value={cat.id}>{t(`officeWorkTracker.categories.${cat.label}`)}</option>
                              ))}
                            </select>
                            <select className="form-select" style={{ maxWidth: 160 }} value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}>
                              {priorities.map((pri) => (
                                <option key={pri.id} value={pri.id}>{t(`officeWorkTracker.priorities.${pri.label}`)}</option>
                              ))}
                            </select>
                            <select className="form-select" style={{ maxWidth: 190 }} value={editForm.assignment_type} onChange={(e) => setEditForm({ ...editForm, assignment_type: e.target.value })}>
                              <option value="single">Single Department</option>
                              <option value="hybrid">Hybrid / Cross Team</option>
                            </select>
                          </div>
                        ) : (
                          <>
                            <span className="entry-category"><span className="category-badge"><i className={`fa-solid ${category.icon}`} /></span>{t(`officeWorkTracker.categories.${category.label}`)}</span>
                            <div className="entry-status-wrap">
                              <span className={`entry-status ${entry.completed ? 'completed' : 'pending'}`}>
                                {entry.completed ? 'Completed' : 'Pending'}
                              </span>
                              <span className={`entry-status ${String(entry.assignment_type || '').toLowerCase() === 'hybrid' || (entry.department_tags || []).length > 1 ? 'pending' : 'completed'}`}>
                                {String(entry.assignment_type || '').toLowerCase() === 'hybrid' || (entry.department_tags || []).length > 1 ? 'Hybrid' : 'Single'}
                              </span>
                              <span className="entry-priority" style={{ color: priority.color }}>{t(`officeWorkTracker.priorities.${priority.label}`)}</span>
                            </div>
                          </>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="d-flex flex-column gap-2 mb-2">
                          <input type="text" className="form-control" value={editForm.task} onChange={(e) => setEditForm({ ...editForm, task: e.target.value })} />
                          <div className="d-flex flex-wrap gap-2 align-items-center">
                            <input type="date" className="form-control" style={{ maxWidth: 180 }} value={editForm.work_date} onChange={(e) => setEditForm({ ...editForm, work_date: e.target.value })} />
                            <input type="time" className="form-control" style={{ maxWidth: 140 }} value={editForm.start_time} onChange={(e) => setEditForm({ ...editForm, start_time: e.target.value })} />
                            <input type="time" className="form-control" style={{ maxWidth: 140 }} value={editForm.end_time} onChange={(e) => setEditForm({ ...editForm, end_time: e.target.value })} />
                          </div>
                          <div className="d-flex flex-wrap gap-2">
                            {departmentOptions.map((dept) => (
                              <button
                                key={`edit-dept-${entry.id}-${dept}`}
                                type="button"
                                className={`category-chip ${(editForm.department_tags || []).includes(dept) ? 'active' : ''}`}
                                onClick={() => toggleDepartmentTag('edit', dept)}
                              >
                                <span className="chip-icon"><i className="fa-solid fa-building-user" /></span>
                                <span className="chip-label">{dept}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className={`entry-task ${entry.completed ? 'done' : ''}`}>{entry.task}</p>
                          {(entry.department_tags || []).length > 0 && (
                            <div className="entry-departments">
                              {(entry.department_tags || []).map((dept) => (
                                <span key={`entry-${entry.id}-dept-${dept}`} className="entry-dept-badge">{dept}</span>
                              ))}
                            </div>
                          )}
                        </>
                      )}

                      <div className="entry-footer">
                        <span className="entry-time"><i className="fa-regular fa-clock me-1" />{formatRelativeTime(entry.created_at)}</span>
                        <span className="entry-time"><i className="fa-regular fa-calendar me-1" />{formatDate(entry.work_date)} | {formatClock(entry.start_time)} - {formatClock(entry.end_time)}</span>
                        <span className="entry-time"><i className="fa-solid fa-stopwatch me-1" />Total: {formatMinutes(entry.total_minutes)}</span>
                        <div className="entry-actions">
                          <button
                            className={`action-btn toggle-status-btn ${entry.completed ? 'mark-pending' : 'mark-completed'}`}
                            onClick={() => toggleEntryMutation.mutate(entry.id)}
                            title={entry.completed ? 'Mark Pending' : 'Mark Completed'}
                          >
                            <i className={`fa-solid ${entry.completed ? 'fa-rotate-left' : 'fa-check'}`} />
                          </button>
                          {isEditing ? (
                            <>
                              <button className="action-btn save-btn" onClick={() => handleSaveEdit(entry.id)} disabled={updateEntryMutation.isPending} title="Save">
                                <i className="fa-solid fa-check" />
                              </button>
                              <button className="action-btn cancel-btn" onClick={handleCancelEdit} title="Cancel">
                                <i className="fa-solid fa-xmark" />
                              </button>
                            </>
                          ) : (
                            <button className="action-btn edit-btn" onClick={() => handleStartEdit(entry)} title="Edit">
                              <i className="fa-regular fa-pen-to-square" />
                            </button>
                          )}
                          <button className="action-btn delete-btn" onClick={() => handleDelete(entry.id)} title={t('officeWorkTracker.delete')}>
                            <i className="fa-regular fa-trash-can" />
                          </button>
                        </div>
                      </div>

                      {!isEditing && (
                        <div className="session-panel">
                          <div className="session-form">
                            <input type="date" className="form-control" style={{ maxWidth: 170 }} value={sessionDraft.work_date} onChange={(e) => setSessionDraft(entry.id, { work_date: e.target.value })} />
                            <input type="time" className="form-control" style={{ maxWidth: 130 }} value={sessionDraft.start_time} onChange={(e) => setSessionDraft(entry.id, { start_time: e.target.value })} />
                            <input type="time" className="form-control" style={{ maxWidth: 130 }} value={sessionDraft.end_time} onChange={(e) => setSessionDraft(entry.id, { end_time: e.target.value })} />
                            <input type="text" className="form-control" placeholder="Session note (optional)" value={sessionDraft.notes || ''} onChange={(e) => setSessionDraft(entry.id, { notes: e.target.value })} />
                            <button type="button" className="action-btn save-btn" onClick={() => handleAddSession(entry)} title="Add Session">
                              <i className="fa-solid fa-plus" />
                            </button>
                          </div>
                          {sessions.length > 0 && (
                            <div className="session-list">
                              {sessions.map((s) => (
                                <div key={s.id} className="session-item">
                                  <span>{formatDate(s.work_date)} | {formatClock(s.start_time)} - {formatClock(s.end_time)}</span>
                                  <span>{formatMinutes(s.duration_minutes)}</span>
                                  <span>{s.notes || '-'}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="activity-section">
            <h3 className="activity-title">
              <i className="fa-solid fa-timeline me-2" />
              Work Activity Timeline
            </h3>
            <div className="activity-list">
              {workEntries.length === 0 ? (
                <div className="activity-empty">No activity yet.</div>
              ) : (
                [...workEntries]
                  .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
                  .map((entry) => (
                    <div key={`activity-${entry.id}`} className="activity-item">
                      <div className="activity-task">{entry.task}</div>
                      <div className="activity-meta">
                        <span><i className="fa-regular fa-calendar-plus me-1" />Created: {formatDateTime(entry.created_at)}</span>
                        <span><i className="fa-regular fa-pen-to-square me-1" />Updated: {formatDateTime(entry.updated_at)}</span>
                        <span>
                          <i className={`fa-regular me-1 ${entry.completed ? 'fa-circle-check' : 'fa-circle'}`} />
                          {entry.completed ? `Completed: ${formatDateTime(entry.completed_at || entry.updated_at)}` : 'Status: Pending'}
                        </span>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OfficeWorkTracker;
