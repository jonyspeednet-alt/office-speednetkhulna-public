import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';

const hrDocumentsList = [
  // 1. Recruitment & Employment
  {
    id: 'appointment',
    title: 'Appointment Letter',
    titleBn: 'Appointment letter generator',
    path: '/appointment-generator',
    icon: 'fa-file-signature',
    category: 'recruitment',
    categoryLabel: 'Recruitment & Joining',
    gradient: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
    badgeColor: '#dbeafe',
    badgeTextColor: '#1e40af',
    description: 'Create official employment appointment letters with customized designations, salary, and terms.',
  },
  {
    id: 'experience',
    title: 'Experience Certificate',
    titleBn: 'Experience certificate',
    path: '/experience-certificate-generator',
    icon: 'fa-certificate',
    category: 'recruitment',
    categoryLabel: 'Recruitment & Joining',
    gradient: 'linear-gradient(135deg, #0891b2, #0e7490)',
    badgeColor: '#cff4fc',
    badgeTextColor: '#055160',
    description: 'Generate service experience certificates for former or existing team members.',
  },
  {
    id: 'no-dues',
    title: 'No Dues Certificate',
    titleBn: 'No-dues clearance certificate',
    path: '/no-dues-certificate-generator',
    icon: 'fa-file-contract',
    category: 'recruitment',
    categoryLabel: 'Recruitment & Joining',
    gradient: 'linear-gradient(135deg, #059669, #047857)',
    badgeColor: '#d1fae5',
    badgeTextColor: '#065f46',
    description: 'Official clearance certificate confirming no pending financial or asset dues.',
  },

  // 2. Career & Appraisal
  {
    id: 'promotion',
    title: 'Promotion Letter',
    titleBn: 'Promotion letter generator',
    path: '/promotion-letter-generator',
    icon: 'fa-user-tie',
    category: 'career',
    categoryLabel: 'Career & Appraisal',
    gradient: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
    badgeColor: '#ede9fe',
    badgeTextColor: '#5b21b6',
    description: 'Official promotion notification with updated title, grade, and revised responsibilities.',
  },
  {
    id: 'salary-increment',
    title: 'Salary Increment Letter',
    titleBn: 'Salary increment approval letter',
    path: '/salary-increment-letter-generator',
    icon: 'fa-money-check-dollar',
    category: 'career',
    categoryLabel: 'Career & Appraisal',
    gradient: 'linear-gradient(135deg, #10b981, #047857)',
    badgeColor: '#d1fae5',
    badgeTextColor: '#065f46',
    description: 'Salary review and increment confirmation letter for performance evaluations.',
  },
  {
    id: 'department-change',
    title: 'Department Change Letter',
    titleBn: 'Department change approval letter',
    path: '/department-change-generator',
    icon: 'fa-people-arrows',
    category: 'career',
    categoryLabel: 'Career & Appraisal',
    gradient: 'linear-gradient(135deg, #d97706, #b45309)',
    badgeColor: '#fef3c7',
    badgeTextColor: '#92400e',
    description: 'Internal transfer notice and department reassignment documentation.',
  },
  {
    id: 'pip',
    title: 'Performance Improvement Plan (PIP)',
    titleBn: 'Performance improvement plan',
    path: '/performance-improvement-plan-generator',
    icon: 'fa-chart-line',
    category: 'career',
    categoryLabel: 'Career & Appraisal',
    gradient: 'linear-gradient(135deg, #4f46e5, #4338ca)',
    badgeColor: '#e0e7ff',
    badgeTextColor: '#3730a3',
    description: 'Structured performance review tracking, targeted goals, and corrective action plan.',
  },

  // 3. Recognition & Awards
  {
    id: 'eotm',
    title: 'Employee of the Month',
    titleBn: 'Employee of the month certificate',
    path: '/employee-of-the-month-generator',
    icon: 'fa-award',
    category: 'recognition',
    categoryLabel: 'Recognition & Awards',
    gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    badgeColor: '#fef3c7',
    badgeTextColor: '#92400e',
    description: 'Monthly recognition certificate for outstanding work and dedication.',
  },
  {
    id: 'eoty',
    title: 'Employee of the Year',
    titleBn: 'Employee of the year award',
    path: '/employee-of-the-year-generator',
    icon: 'fa-crown',
    category: 'recognition',
    categoryLabel: 'Recognition & Awards',
    gradient: 'linear-gradient(135deg, #eab308, #ca8a04)',
    badgeColor: '#fef9c3',
    badgeTextColor: '#854d0e',
    description: 'Annual prestigious award certificate honoring exceptional yearly contributions.',
  },

  // 4. Exit & Disciplinary
  {
    id: 'noc',
    title: 'NOC Certificate',
    titleBn: 'No objection certificate (NOC)',
    path: '/noc-generator',
    icon: 'fa-file-circle-check',
    category: 'exit',
    categoryLabel: 'Exit & Disciplinary',
    gradient: 'linear-gradient(135deg, #0284c7, #0369a1)',
    badgeColor: '#e0f2fe',
    badgeTextColor: '#075985',
    description: 'No Objection Certificate for official, academic, or personal clearance requests.',
  },
  {
    id: 'termination',
    title: 'Termination Letter',
    titleBn: 'Termination / separation letter',
    path: '/termination-generator',
    icon: 'fa-file-circle-xmark',
    category: 'exit',
    categoryLabel: 'Exit & Disciplinary',
    gradient: 'linear-gradient(135deg, #dc2626, #b91c1c)',
    badgeColor: '#fee2e2',
    badgeTextColor: '#991b1b',
    description: 'Formal termination, resignation acceptance, or employee separation notice.',
  },
  {
    id: 'punishment',
    title: 'Disciplinary / Warning Letter',
    titleBn: 'Show-cause / warning letter',
    path: '/punishment-letter-generator',
    icon: 'fa-triangle-exclamation',
    category: 'exit',
    categoryLabel: 'Exit & Disciplinary',
    gradient: 'linear-gradient(135deg, #ea580c, #c2410c)',
    badgeColor: '#ffedd5',
    badgeTextColor: '#9a3412',
    description: 'Official warning, show cause, or disciplinary action notice.',
  },

  // 5. Operational Forms & Notices
  {
    id: 'device-handover',
    title: 'Device Handover Form',
    titleBn: 'Device handover form',
    path: '/device-handover-form',
    icon: 'fa-laptop-code',
    category: 'operations',
    categoryLabel: 'Operations & Forms',
    gradient: 'linear-gradient(135deg, #0284c7, #2563eb)',
    badgeColor: '#e0f2fe',
    badgeTextColor: '#0369a1',
    description: 'IT asset, laptop, and hardware equipment handover acknowledgment form.',
  },
  {
    id: 'issue-suggestion',
    title: 'Employee Issue & Suggestion',
    titleBn: 'Feedback & suggestion form',
    path: '/employee-issue-suggestion-form',
    icon: 'fa-clipboard-question',
    category: 'operations',
    categoryLabel: 'Operations & Forms',
    gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
    badgeColor: '#f3e8ff',
    badgeTextColor: '#6b21a8',
    description: 'Confidential employee feedback, grievance, and internal suggestion form.',
  },
  {
    id: 'monthly-meeting',
    title: 'Monthly All-Employee Meeting Notice',
    titleBn: 'Monthly meeting notice',
    path: '/monthly-all-employee-meeting-form',
    icon: 'fa-user-group',
    category: 'operations',
    categoryLabel: 'Operations & Forms',
    gradient: 'linear-gradient(135deg, #14b8a6, #0d9488)',
    badgeColor: '#ccfbf1',
    badgeTextColor: '#115e59',
    description: 'Official circular for company-wide monthly meetings, agenda, and attendance.',
  },
  {
    id: 'partner-onboarding',
    title: 'Partner Onboarding Form',
    titleBn: 'Partner onboarding form',
    path: '/partner-onboarding-form',
    icon: 'fa-handshake',
    category: 'operations',
    categoryLabel: 'Operations & Forms',
    gradient: 'linear-gradient(135deg, #6366f1, #4f46e5)',
    badgeColor: '#e0e7ff',
    badgeTextColor: '#3730a3',
    description: 'MAC, Distribution & Channel Partner onboarding with NTTN, revenue sharing, agreement & approval workflow.',
  },
  {
    id: 'leave-approval',
    title: 'Leave Approval Letter / Management',
    titleBn: 'Leave approval center',
    path: '/manage-leaves',
    icon: 'fa-calendar-check',
    category: 'operations',
    categoryLabel: 'Operations & Forms',
    gradient: 'linear-gradient(135deg, #10b981, #059669)',
    badgeColor: '#d1fae5',
    badgeTextColor: '#065f46',
    description: 'Manage employee leave applications and print official leave approval letters.',
  },
  {
    id: 'implementation-approval',
    title: 'Implementation Approval Form',
    titleBn: 'Implementation approval & responsibility assignment',
    path: '/implementation-approval-form',
    icon: 'fa-list-check',
    category: 'operations',
    categoryLabel: 'Operations & Forms',
    gradient: 'linear-gradient(135deg, #0f766e, #115e59)',
    badgeColor: '#ccfbf1',
    badgeTextColor: '#115e59',
    description: 'Record implementation details, assign responsibility, collect management consent, and track completion status.',
  },
];

const categoryTabs = [
  { key: 'all', label: 'All Documents', icon: 'fa-folder-open' },
  { key: 'recruitment', label: 'Recruitment & Joining', icon: 'fa-user-plus' },
  { key: 'career', label: 'Career & Appraisal', icon: 'fa-chart-line' },
  { key: 'recognition', label: 'Recognition & Awards', icon: 'fa-trophy' },
  { key: 'exit', label: 'Exit & Disciplinary', icon: 'fa-file-shield' },
  { key: 'operations', label: 'Operations & Forms', icon: 'fa-sliders' },
];

const HrDocumentsLandingPage = () => {
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredDocuments = useMemo(() => {
    return hrDocumentsList.filter((doc) => {
      const matchesTab = activeTab === 'all' || doc.category === activeTab;
      const matchesSearch =
        searchQuery.trim() === '' ||
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.titleBn.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.description.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesTab && matchesSearch;
    });
  }, [activeTab, searchQuery]);

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        {/* ─── Hero Header Banner ────────────────────────────────── */}
        <div
          style={{
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            borderRadius: '20px',
            padding: '32px 28px',
            color: '#ffffff',
            boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.15)',
            marginBottom: '28px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              right: '-40px',
              bottom: '-40px',
              opacity: 0.06,
              fontSize: '220px',
              color: '#fff',
              pointerEvents: 'none',
            }}
          >
            <i className="fa-solid fa-folder-tree"></i>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '14px',
                  background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '22px',
                  boxShadow: '0 8px 16px rgba(59, 130, 246, 0.3)',
                }}
              >
                <i className="fa-solid fa-file-invoice"></i>
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: '26px', fontWeight: 800, tracking: '-0.02em', color: '#ffffff' }}>
                  HR & Operational Document Hub
                </h1>
                <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '14px' }}>
                  Create all official Speed Net Khulna HR documents, appointment letters, notices, and certificates from one place.
                </p>
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <span
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    padding: '8px 16px',
                    borderRadius: '30px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#60a5fa',
                  }}
                >
                  <i className="fa-solid fa-layer-group me-2"></i>
                  {hrDocumentsList.length} Total Templates
                </span>
              </div>
            </div>

            {/* Live Search Input */}
            <div style={{ marginTop: '8px', maxWidth: '640px' }}>
              <div style={{ position: 'relative' }}>
                <i
                  className="fa-solid fa-magnifying-glass"
                  style={{
                    position: 'absolute',
                    left: '16px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#64748b',
                    fontSize: '15px',
                  }}
                ></i>
                <input
                  type="text"
                  placeholder="Search (e.g. Appointment, NOC, Termination, Increment...)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px 12px 46px',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: '#ffffff',
                    fontSize: '14px',
                    outline: 'none',
                    backdropFilter: 'blur(10px)',
                    transition: 'all 0.2s ease',
                  }}
                  onFocus={(e) => {
                    e.target.style.background = 'rgba(255, 255, 255, 0.15)';
                    e.target.style.borderColor = '#3b82f6';
                  }}
                  onBlur={(e) => {
                    e.target.style.background = 'rgba(255, 255, 255, 0.08)';
                    e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      border: 'none',
                      background: 'transparent',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    <i className="fa-solid fa-circle-xmark"></i>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ─── Category Navigation Tabs ────────────────────────── */}
        <div
          style={{
            display: 'flex',
            gap: '10px',
            overflowX: 'auto',
            paddingBottom: '8px',
            marginBottom: '24px',
            scrollbarWidth: 'thin',
          }}
        >
          {categoryTabs.map((tab) => {
            const count =
              tab.key === 'all'
                ? hrDocumentsList.length
                : hrDocumentsList.filter((d) => d.category === tab.key).length;
            const isActive = activeTab === tab.key;

            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 18px',
                  borderRadius: '12px',
                  border: isActive ? '1px solid #2563eb' : '1px solid #e2e8f0',
                  background: isActive ? '#2563eb' : '#ffffff',
                  color: isActive ? '#ffffff' : '#475569',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: isActive ? '0 4px 12px rgba(37, 99, 235, 0.25)' : '0 1px 3px rgba(0,0,0,0.05)',
                  transition: 'all 0.2s ease',
                }}
              >
                <i className={`fa-solid ${tab.icon}`} style={{ opacity: isActive ? 1 : 0.7 }}></i>
                <span>{tab.label}</span>
                <span
                  style={{
                    background: isActive ? 'rgba(255, 255, 255, 0.25)' : '#f1f5f9',
                    color: isActive ? '#ffffff' : '#64748b',
                    padding: '2px 8px',
                    borderRadius: '20px',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* ─── Grid of Document Cards ──────────────────────────── */}
        {filteredDocuments.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '60px 20px',
              background: '#ffffff',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ fontSize: '48px', color: '#cbd5e1', marginBottom: '12px' }}>
              <i className="fa-solid fa-folder-open"></i>
            </div>
            <h3 style={{ margin: '0 0 6px', color: '#1e293b', fontSize: '18px', fontWeight: 700 }}>
              No documents found
            </h3>
            <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
              &quot;{searchQuery}&quot; — no documents match. Try a different search.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '20px',
            }}
          >
            {filteredDocuments.map((doc) => (
              <Link
                key={doc.id}
                to={doc.path}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '16px',
                  padding: '22px 20px',
                  textDecoration: 'none',
                  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.03)',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = '0 12px 28px rgba(15, 23, 42, 0.09)';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(15, 23, 42, 0.03)';
                  e.currentTarget.style.borderColor = '#e2e8f0';
                }}
              >
                {/* Header row: Icon + Category Badge */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <div
                    style={{
                      width: '46px',
                      height: '46px',
                      borderRadius: '12px',
                      background: doc.gradient,
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '20px',
                      boxShadow: '0 6px 14px rgba(0,0,0,0.12)',
                    }}
                  >
                    <i className={`fa-solid ${doc.icon}`}></i>
                  </div>
                  <span
                    style={{
                      background: doc.badgeColor,
                      color: doc.badgeTextColor,
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '4px 10px',
                      borderRadius: '20px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {doc.categoryLabel}
                  </span>
                </div>

                {/* Title & Bangla Subtitle */}
                <h3 style={{ margin: '0 0 2px', fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                  {doc.title}
                </h3>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#3b82f6', marginBottom: '10px' }}>
                  {doc.titleBn}
                </span>

                {/* Description */}
                <p
                  style={{
                    margin: '0 0 18px',
                    color: '#64748b',
                    fontSize: '13px',
                    lineHeight: 1.55,
                    flex: 1,
                  }}
                >
                  {doc.description}
                </p>

                {/* Action Footer */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: '12px',
                    borderTop: '1px solid #f1f5f9',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#2563eb',
                  }}
                >
                  <span>Create</span>
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: '#eff6ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <i className="fa-solid fa-arrow-right" style={{ fontSize: '11px' }}></i>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* ─── Footer Information Card ─────────────────────────── */}
        <div
          style={{
            marginTop: '36px',
            padding: '20px 24px',
            background: '#ffffff',
            borderRadius: '14px',
            border: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#475569',
                fontSize: '18px',
              }}
            >
              <i className="fa-solid fa-circle-info"></i>
            </div>
            <div>
              <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#1e293b' }}>
                HR Document Management Policy
              </h4>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>
                All documents can be printed on Speed Net Khulna official letterhead with authorized seal, or saved as PDF.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HrDocumentsLandingPage;
