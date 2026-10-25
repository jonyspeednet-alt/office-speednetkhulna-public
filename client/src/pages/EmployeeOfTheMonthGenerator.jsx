import React, { useState, useMemo, useEffect, useRef } from 'react';
import moment from 'moment';
import html2canvas from 'html2canvas';
import BrandLogo from '../components/BrandLogo';
import { getEmployees } from '../services/employeeService';
import { deleteMonthlyAward, getMonthlyAwards, saveMonthlyAward } from '../services/employeeOfTheMonthService';

const formatAwardMonth = (value) => {
  const parsed = moment(value, 'YYYY-MM', true);
  return parsed.isValid() ? parsed.format('MMMM, YYYY').toUpperCase() : '';
};

const isSuperAdminRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  return r === 'super admin' || r === 'superadmin';
};

const EmployeeOfTheMonthGenerator = () => {
  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);

  const isSuperAdmin = isSuperAdminRole(user?.role);
  const hasPermission = (perm) => {
    if (isSuperAdmin) return true;
    return Boolean(
      user?.all_access ||
      user?.permissions?.all_access ||
      user?.permissions?.[perm] ||
      user?.[perm]
    );
  };
  const canAccess = hasPermission('appointment_letters.generate') || hasPermission('p_appointment_letter');

  // Template Mode: 'certificate' (Landscape) | 'photo_frame' (Portrait)
  const [templateMode, setTemplateMode] = useState('photo_frame');
  const [awardMonth, setAwardMonth] = useState(() => moment().format('YYYY-MM'));
  const [monthlyAwards, setMonthlyAwards] = useState([]);
  const [awardsLoading, setAwardsLoading] = useState(false);
  const [savingAward, setSavingAward] = useState(false);
  const [deletingAwardMonth, setDeletingAwardMonth] = useState('');
  const [editingAwardMonth, setEditingAwardMonth] = useState('');
  const [awardMessage, setAwardMessage] = useState('');

  // State for Landscape Certificate
  const [certData, setCertData] = useState({
    refNo: `SNKHL/HR/EOM/${moment().format('YYYYMM')}/01`,
    issueDate: moment().format('DD/MM/YYYY'),
    headerPrefix: 'FOR EMPLOYEE OF THE MONTH',
    monthYear: moment().format('MMMM, YYYY').toUpperCase(),
    awardLead: 'This certificate is awarded to',
    employeeName: 'SK Mehadi Hasan Jony',
    appreciationLine1: 'We strongly appreciate your outstanding participation & achievement',
    appreciationLine2: 'for',
    orgName: 'Speed Net',
    yearBanner: 'During The Year 2026',
    signerTitle: 'SIGNATURE',
    signerDesignation: 'Director',
    signerOrg: 'Speed Net Khulna',
    frameColor: '#476778',
  });

  // State for Portrait Photo Frame Poster
  const [photoData, setPhotoData] = useState({
    year: '2026',
    month: 'June',
    title: 'Employee of The Month',
    employeeName: 'Abu Bakkar Siddik',
    designation: 'Finance Manager',
    department: 'Finance',
    functionName: 'Accounts & Revenue',
    thankYouText: 'Thank You For Your Hard Work',
    photoUrl: '', // Base64 or URL
  });

  const [zoomLevel, setZoomLevel] = useState(1);
  const certificateRef = useRef(null);
  const posterRef = useRef(null);
  const [refNoDirty, setRefNoDirty] = useState(false);

  useEffect(() => {
    document.body.classList.add('certificate-generator-active');
    return () => document.body.classList.remove('certificate-generator-active');
  }, []);

  // ---- DB Employee Select ----
  const [employees, setEmployees] = useState([]);
  const [empLoading, setEmpLoading] = useState(false);
  const [empSearch, setEmpSearch] = useState('');
  const [showEmpDropdown, setShowEmpDropdown] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState(null);
  const empSearchWrapRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setEmpLoading(true);
    getEmployees()
      .then((data) => {
        if (alive) setEmployees(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (alive) setEmployees([]);
      })
      .finally(() => {
        if (alive) setEmpLoading(false);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setAwardsLoading(true);
    getMonthlyAwards()
      .then((records) => {
        if (alive) setMonthlyAwards(Array.isArray(records) ? records : []);
      })
      .catch(() => {
        if (alive) setAwardMessage('Could not load saved monthly winner records.');
      })
      .finally(() => {
        if (alive) setAwardsLoading(false);
      });
    return () => { alive = false; };
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const onDocClick = (e) => {
      if (empSearchWrapRef.current && !empSearchWrapRef.current.contains(e.target)) {
        setShowEmpDropdown(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const filteredEmployees = useMemo(() => {
    const q = empSearch.trim().toLowerCase();
    if (!q) return employees.slice(0, 30);
    return employees.filter((emp) => {
      const hay = `${emp.full_name || ''} ${emp.employee_id || ''} ${emp.designation || ''} ${emp.department || ''}`.toLowerCase();
      return hay.includes(q);
    }).slice(0, 30);
  }, [employees, empSearch]);

  const selectedEmployee = useMemo(() => {
    if (selectedEmpId == null) return null;
    return employees.find((e) => Number(e.id) === Number(selectedEmpId)) || null;
  }, [employees, selectedEmpId]);

  const buildProfilePicUrl = (emp) => {
    if (!emp?.profile_pic || emp.profile_pic === 'default.png') return '';
    return `/uploads/${emp.profile_pic}`;
  };

  const handleSelectEmployee = (emp) => {
    setSelectedEmpId(emp.id);
    setEmpSearch('');
    setShowEmpDropdown(false);
    const picUrl = buildProfilePicUrl(emp);
    setPhotoData((prev) => ({
      ...prev,
      employeeName: emp.full_name || prev.employeeName,
      designation: emp.designation || prev.designation,
      department: emp.department || prev.department,
      photoUrl: picUrl || prev.photoUrl,
    }));
    setCertData((prev) => ({
      ...prev,
      employeeName: emp.full_name || prev.employeeName,
    }));
  };

  const handleClearSelectedEmployee = () => {
    setSelectedEmpId(null);
    setEmpSearch('');
    setShowEmpDropdown(false);
  };

  const handleCertChange = (e) => {
    const { name, value } = e.target;
    if (name === 'employeeName') setSelectedEmpId(null);
    if (name === 'refNo') setRefNoDirty(true);
    setCertData((prev) => ({ ...prev, [name]: value }));
  };

  const handleAwardMonthChange = (e) => {
    const value = e.target.value;
    setAwardMonth(value);
    setCertData((prev) => ({
      ...prev,
      monthYear: formatAwardMonth(value),
      // Don't clobber a manually edited refNo.
      ...(refNoDirty ? {} : { refNo: `SNKHL/HR/EOM/${value.replace('-', '')}/01` }),
    }));
  };

  const updateAwardMonthPart = (part, value) => {
    const [, year = moment().format('YYYY'), month = moment().format('MM')] = awardMonth.match(/^(\d{4})-(\d{2})$/) || [];
    handleAwardMonthChange({ target: { value: part === 'year' ? `${value}-${month}` : `${year}-${value}` } });
  };

  const handleLoadAward = (record) => {
    const month = String(record.award_month || '').slice(0, 7);
    const savedCertificate = record.certificate_data && typeof record.certificate_data === 'object'
      ? record.certificate_data
      : {};
    setAwardMonth(month);
    setCertData((prev) => ({
      ...prev,
      ...savedCertificate,
      monthYear: formatAwardMonth(month),
      employeeName: record.employee_name || savedCertificate.employeeName || '',
    }));
    setRefNoDirty(false);
    setSelectedEmpId(record.employee_id ? Number(record.employee_id) : null);
    setTemplateMode('certificate');
    setEditingAwardMonth('');
    setAwardMessage(`Loaded ${formatAwardMonth(month)} — ${record.employee_name}.`);
  };

  const handleEditAward = (record) => {
    handleLoadAward(record);
    setEditingAwardMonth(String(record.award_month || '').slice(0, 7));
    setAwardMessage(`Editing ${formatAwardMonth(record.award_month)} — ${record.employee_name}.`);
  };

  const handleSaveAward = async () => {
    const employeeName = String(certData.employeeName || '').trim();
    const monthLabel = formatAwardMonth(awardMonth);
    if (!monthLabel) {
      setAwardMessage('Choose a valid month and year first.');
      return;
    }
    if (!employeeName) {
      setAwardMessage('Enter or select the employee name first.');
      return;
    }
    if (selectedEmpId == null) {
      setAwardMessage('Select the employee from the DB list so employee_id is saved.');
      return;
    }
    const existing = monthlyAwards.find((record) => record.award_month === awardMonth);
    if (existing && editingAwardMonth !== awardMonth && !window.confirm(`${monthLabel} already has a saved winner (${existing.employee_name}). Replace that record with ${employeeName}?`)) {
      return;
    }

    setSavingAward(true);
    setAwardMessage('');
    try {
      const saved = await saveMonthlyAward(awardMonth, {
        employee_id: selectedEmpId,
        employee_name: employeeName,
        certificate_data: { ...certData, employeeName, monthYear: monthLabel },
      });
      setMonthlyAwards((current) => [saved, ...current.filter((record) => record.award_month !== saved.award_month)]
        .sort((a, b) => b.award_month.localeCompare(a.award_month)));
      setEditingAwardMonth('');
      setAwardMessage(`${editingAwardMonth ? 'Updated' : 'Saved'} ${monthLabel} — ${employeeName}.`);
    } catch (error) {
      setAwardMessage(error.response?.data?.message || 'Could not save the monthly winner.');
    } finally {
      setSavingAward(false);
    }
  };

  const handleDeleteAward = async (record) => {
    const month = String(record.award_month || '').slice(0, 7);
    const monthLabel = formatAwardMonth(month);
    if (!window.confirm(`Delete ${monthLabel} winner record for ${record.employee_name}? This cannot be undone.`)) return;
    setDeletingAwardMonth(month);
    setAwardMessage('');
    try {
      await deleteMonthlyAward(month);
      setMonthlyAwards((current) => current.filter((item) => item.award_month !== month));
      if (editingAwardMonth === month) setEditingAwardMonth('');
      setAwardMessage(`Deleted ${monthLabel} winner record.`);
    } catch (error) {
      setAwardMessage(error.response?.data?.message || 'Could not delete the monthly winner.');
    } finally {
      setDeletingAwardMonth('');
    }
  };

  const awardYear = awardMonth.slice(0, 4);
  const awardMonthNumber = awardMonth.slice(5, 7);
  const awardYears = useMemo(() => {
    const currentYear = moment().year();
    const years = new Set(Array.from({ length: 11 }, (_, index) => String(currentYear - 5 + index)));
    monthlyAwards.forEach((record) => years.add(String(record.award_month || '').slice(0, 4)));
    years.add(awardYear);
    return [...years].filter((year) => /^\d{4}$/.test(year)).sort((a, b) => Number(b) - Number(a));
  }, [monthlyAwards, awardYear]);

  const handlePhotoChange = (e) => {
    const { name, value } = e.target;
    setPhotoData((prev) => ({ ...prev, [name]: value }));
  };

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        setPhotoData((prev) => ({ ...prev, photoUrl: uploadEvent.target?.result || '' }));
      };
      reader.readAsDataURL(file);
    }
  };

  const downloadCertificatePng = async () => {
    const target = templateMode === 'certificate' ? certificateRef.current : posterRef.current;
    if (!target) return;
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: null,
      logging: false,
    });
    const link = document.createElement('a');
    link.download = templateMode === 'certificate'
      ? `employee-of-the-month-${certData.employeeName || 'certificate'}.png`
      : `employee-of-the-month-poster-${photoData.employeeName || 'poster'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleReset = () => {
    if (templateMode === 'certificate') {
      setCertData({
        refNo: `SNKHL/HR/EOM/${moment().format('YYYYMM')}/01`,
        issueDate: moment().format('DD/MM/YYYY'),
        headerPrefix: 'FOR EMPLOYEE OF THE MONTH',
        monthYear: moment().format('MMMM, YYYY').toUpperCase(),
        awardLead: 'This certificate is awarded to',
        employeeName: 'SK Mehadi Hasan Jony',
        appreciationLine1: 'We strongly appreciate your outstanding participation & achievement',
        appreciationLine2: 'for',
        orgName: 'Speed Net',
        yearBanner: 'During The Year 2026',
        signerTitle: 'SIGNATURE',
        signerDesignation: 'Director',
        signerOrg: 'Speed Net Khulna',
        frameColor: '#476778',
      });
      setAwardMonth(moment().format('YYYY-MM'));
      setAwardMessage('');
      setRefNoDirty(false);
    } else {
      setPhotoData({
        year: '2026',
        month: 'June',
        title: 'Employee of The Month',
        employeeName: 'Abu Bakkar Siddik',
        designation: 'Finance Manager',
        department: 'Finance',
        functionName: 'Accounts & Revenue',
        thankYouText: 'Thank You For Your Hard Work',
        photoUrl: '',
      });
    }
    setZoomLevel(1);
    // keep selected employee after reset? clear to allow fresh pick
    // Do NOT auto-clear selectedEmpId here — user can click "Clear" manually
  };

  if (!canAccess) {
    return (
      <div className="container-fluid p-3">
        <div className="alert alert-danger mb-0">No permission to generate Employee Of The Month. (Permission: appointment_letters.generate)</div>
      </div>
    );
  }

  return (
    <div className="certificate-generator-wrapper d-flex" style={{ minHeight: 'calc(100vh - 70px)', background: '#0b1320' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Great+Vibes&family=Alex+Brush&family=Cinzel:wght@500;600;700;800&family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,400;1,600&family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=Poppins:wght@400;500;600;700;800&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&display=swap');

        .admin-sidebar-form {
          width: 360px;
          min-width: 310px;
          background: #0d1b2a;
          color: #e0e8f5;
          padding: 18px;
          overflow-y: auto;
          max-height: calc(100vh - 70px);
          border-right: 2px solid #1e3a5f;
          z-index: 10;
        }

        .admin-sidebar-form .sec {
          background: #132238;
          border: 1px solid #1e3a5f;
          border-radius: 8px;
          margin-bottom: 14px;
          overflow: hidden;
        }
        .admin-sidebar-form .sec.sec-db {
          overflow: visible;
        }
        .admin-sidebar-form .sec.sec-db .sec-body {
          overflow: visible;
        }

        .admin-sidebar-form .sec-title {
          background: #1b304f;
          padding: 9px 12px;
          font-size: 11px;
          font-weight: 700;
          color: #38bdf8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 1px solid #1e3a5f;
        }

        .admin-sidebar-form .sec-body {
          padding: 12px;
        }

        .admin-sidebar-form label {
          font-size: 11px;
          color: #94a3b8;
          text-transform: uppercase;
          font-weight: 600;
          margin-bottom: 4px;
          display: block;
        }

        .admin-sidebar-form input {
          width: 100%;
          background: #0b1523;
          border: 1px solid #233e63;
          border-radius: 5px;
          color: #fff;
          padding: 7px 10px;
          font-size: 12px;
          margin-bottom: 10px;
          transition: border-color 0.2s;
        }

        .admin-sidebar-form input:focus {
          outline: none;
          border-color: #38bdf8;
        }

        .preview-pane {
          flex: 1;
          padding: 24px;
          overflow: auto;
          background: #182234;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
        }

        body.certificate-generator-active .mobile-toggle,
        body.certificate-generator-active .sidebar-overlay {
          display: none !important;
        }

        .preview-toolbar {
          width: 800px;
          max-width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 14px;
          padding: 8px 14px;
          background: #0f1c2e;
          border: 1px solid #1e3a5f;
          border-radius: 8px;
          color: #94a3b8;
          font-size: 12px;
        }

        /* Certificate Container: A4 Landscape Ratio 1000px x 707px */
        .cert-outer-wrapper {
          transform-origin: top center;
          transition: transform 0.2s ease-in-out;
        }

        .certificate-page {
          width: 1000px;
          height: 707px;
          background: ${certData.frameColor || '#476778'};
          padding: 28px;
          box-sizing: border-box;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
          position: relative;
          user-select: none;
        }

        .certificate-inner {
          width: 100%;
          height: 100%;
          background: #ffffff;
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          box-sizing: border-box;
          padding: 26px 42px 22px;
          box-shadow: 0 0 15px rgba(0, 0, 0, 0.15) inset;
        }

        .poly-canvas {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          opacity: 0.4;
          pointer-events: none;
          z-index: 1;
        }

        .cert-content {
          position: relative;
          z-index: 2;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          text-align: center;
        }

        .diamond-emblem {
          width: 60px;
          height: 60px;
          margin-top: 2px;
          margin-bottom: -6px;
        }

        .title-certificate {
          font-family: 'Great Vibes', 'Alex Brush', cursive;
          font-size: 88px;
          color: #2b3d4f;
          line-height: 1.05;
          margin: 0;
          font-weight: 400;
          letter-spacing: 1px;
        }

        .cert-subtitle {
          font-family: 'Cinzel', 'Playfair Display', serif;
          font-size: 16.5px;
          font-weight: 700;
          color: #3b4e61;
          letter-spacing: 2px;
          margin-top: 10px;
          margin-bottom: 5px;
          text-transform: uppercase;
        }

        .certificate-meta-row {
          position: absolute;
          top: 22px;
          left: 42px;
          right: 42px;
          display: flex;
          justify-content: space-between;
          color: #64748b;
          font: 9.5px 'Montserrat', sans-serif;
          letter-spacing: 0.45px;
          text-transform: uppercase;
          z-index: 3;
          pointer-events: none;
        }

        .certificate-meta-row span {
          background: rgba(255, 255, 255, 0.78);
          border: 1px solid rgba(148, 163, 184, 0.35);
          border-radius: 3px;
          padding: 3px 7px;
          box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
        }

        .certificate-meta-row { display: none !important; }
        .certificate-meta-external {
          margin-left: 10px;
          color: #94a3b8;
          font-size: 10px;
          letter-spacing: 0.2px;
        }

        .cert-awarded-to {
          font-family: 'Montserrat', sans-serif;
          font-size: 11px;
          font-weight: 400;
          color: #64748b;
          letter-spacing: 0.2px;
          margin-bottom: 12px;
        }

        .employee-name-wrap {
          width: 370px;
          border-top: 1px solid #cbd5e1;
          border-bottom: 1px solid #cbd5e1;
          padding: 4px 0 5px;
          margin-bottom: 12px;
        }

        .employee-name-text {
          font-family: 'Cinzel', 'Playfair Display', serif;
          font-size: 21px;
          font-weight: 600;
          color: #2c3e50;
          letter-spacing: 1px;
          line-height: 1.2;
        }

        .citation-line1 {
          font-family: 'Great Vibes', 'Alex Brush', cursive;
          font-size: 21px;
          color: #2b3d4f;
          line-height: 1.25;
          margin-bottom: 1px;
        }

        .citation-line2 {
          font-family: 'Great Vibes', 'Alex Brush', cursive;
          font-size: 18px;
          color: #3b4e61;
          line-height: 1.15;
          margin-bottom: 1px;
        }

        .citation-line3 {
          font-family: 'Great Vibes', 'Alex Brush', cursive;
          font-size: 23px;
          font-weight: 600;
          color: #1e293b;
          line-height: 1.25;
          margin-bottom: 4px;
        }

        .year-pill-badge {
          display: inline-block;
          background: linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%);
          border: 1px solid #cbd5e1;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.05);
          border-radius: 30px;
          padding: 2px 28px;
        }

        .citation-line4 {
          font-family: 'Great Vibes', 'Alex Brush', cursive;
          font-size: 18px;
          color: #1e293b;
          font-weight: 600;
          line-height: 1.25;
        }

        .cert-footer-row {
          width: 100%;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          padding: 0 6px;
          margin-top: auto;
        }

        .footer-col-left {
          width: 220px;
          text-align: left;
          display: flex;
          align-items: center;
          justify-content: flex-start;
        }

        .footer-col-center {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        .footer-col-right {
          width: 220px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .signature-line-bar {
          width: 170px;
          height: 1.5px;
          background: #0284c7;
          margin-bottom: 6px;
        }

        .sig-label-top {
          font-family: 'Montserrat', sans-serif;
          font-size: 10px;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: 1.5px;
          line-height: 1.2;
        }

        .sig-label-role {
          font-family: 'Montserrat', sans-serif;
          font-size: 10px;
          color: #64748b;
          font-weight: 500;
          line-height: 1.3;
        }

        .sig-label-org {
          font-family: 'Montserrat', sans-serif;
          font-size: 10px;
          color: #64748b;
          font-weight: 500;
          line-height: 1.3;
        }

        /* ---------------------------------------------------- */
        /* PHOTO FRAME POSTER STYLES (PORTRAIT POSTER)          */
        /* ---------------------------------------------------- */
        .photo-poster-page {
          width: 620px;
          height: 877px; /* 1:1.414 portrait aspect ratio */
          background: linear-gradient(180deg, #6ee7b7 0%, #34d399 35%, #10b981 70%, #059669 100%);
          position: relative;
          overflow: hidden;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
          box-sizing: border-box;
          padding: 24px 28px 20px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          align-items: center;
          user-select: none;
        }

        .photo-poster-bg {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 1;
        }

        .photo-poster-content {
          position: relative;
          z-index: 2;
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
        }

        /* Top Header Row */
        .poster-top-row {
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .poster-date-box {
          text-align: right;
          color: #064e3b;
        }

        .poster-year {
          font-family: 'Montserrat', 'Poppins', sans-serif;
          font-size: 36px;
          font-weight: 800;
          line-height: 1;
          color: #064e3b;
          letter-spacing: -0.5px;
        }

        .poster-month {
          font-family: 'Montserrat', 'Poppins', sans-serif;
          font-size: 22px;
          font-weight: 600;
          line-height: 1.1;
          color: #064e3b;
        }

        /* Poster Title Banner */
        .poster-title-banner {
          width: 100%;
          text-align: center;
          background: rgba(255, 255, 255, 0.28);
          backdrop-filter: blur(4px);
          border-top: 1px solid rgba(255, 255, 255, 0.4);
          border-bottom: 1px solid rgba(255, 255, 255, 0.4);
          padding: 8px 12px;
          margin: 10px 0 16px;
        }

        .poster-title-text {
          font-family: 'Montserrat', 'Poppins', sans-serif;
          font-size: 34px;
          font-weight: 700;
          color: #064e3b;
          letter-spacing: -0.3px;
          margin: 0;
          line-height: 1.1;
        }

        /* Center Photo Frame - Prominent & Enlarged */
        .photo-frame-container {
          position: relative;
          width: 380px;
          height: 430px;
          background: #15803d; /* Outer forest green frame */
          padding: 22px;
          box-sizing: border-box;
          flex-shrink: 0;
          box-shadow: 0 20px 40px rgba(6, 78, 59, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 6px auto;
        }

        .photo-mat-inner {
          position: relative;
          width: 100%;
          height: 100%;
          background: #f59e0b; /* Golden Yellow Inner Mat */
          padding: 12px;
          box-sizing: border-box;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .employee-photo-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center top;
          background: #e2e8f0;
          display: block;
        }

        /* Golden Corner Mounts */
        .photo-corner {
          position: absolute;
          width: 42px;
          height: 42px;
          z-index: 5;
          pointer-events: none;
        }
        .corner-tl { top: -2px; left: -2px; }
        .corner-tr { top: -2px; right: -2px; }
        .corner-bl { bottom: -2px; left: -2px; }
        .corner-br { bottom: -2px; right: -2px; }

        /* Bottom Thank You Banner */
        .poster-thankyou-banner {
          width: 100%;
          text-align: center;
          background: rgba(255, 255, 255, 0.28);
          backdrop-filter: blur(4px);
          border-top: 1px solid rgba(255, 255, 255, 0.4);
          border-bottom: 1px solid rgba(255, 255, 255, 0.4);
          padding: 6px 12px;
          margin-top: 16px;
        }

        .poster-thankyou-text {
          font-family: 'Montserrat', 'Poppins', sans-serif;
          font-size: 24px;
          font-weight: 700;
          color: #064e3b;
          letter-spacing: -0.2px;
          margin: 0;
        }

        /* Recipient Info Section */
        .poster-recipient-name {
          font-family: 'Montserrat', 'Poppins', sans-serif;
          font-size: 32px;
          font-weight: 800;
          color: #064e3b;
          letter-spacing: -0.3px;
          margin: 8px 0 4px;
          text-align: center;
        }

        .poster-details-list {
          text-align: center;
          color: #064e3b;
          font-family: 'Montserrat', 'Poppins', sans-serif;
          font-size: 18px;
          font-weight: 600;
          line-height: 1.45;
          margin-bottom: 6px;
        }

        .emp-db-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: #0b1523;
          border: 1px solid #1e3a5f;
          border-radius: 6px;
          max-height: 380px;
          min-height: 120px;
          overflow-y: auto;
          z-index: 999;
          box-shadow: 0 12px 28px rgba(0,0,0,0.55);
          margin-top: 4px;
        }
        .emp-db-dropdown::-webkit-scrollbar { width: 6px; }
        .emp-db-dropdown::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 6px; }
        .emp-db-dropdown::-webkit-scrollbar-track { background: #0b1523; }
        .emp-db-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          cursor: pointer;
          border-bottom: 1px solid #162d50;
          transition: background 0.15s;
        }
        .emp-db-item:last-child { border-bottom: none; }
        .emp-db-item:hover { background: #132238; }
        .emp-db-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          object-fit: cover;
          background: #1e3a5f;
          flex-shrink: 0;
        }
        .emp-db-meta {
          flex: 1;
          min-width: 0;
          text-align: left;
        }
        .emp-db-name {
          font-size: 12px;
          font-weight: 700;
          color: #e0e8f5;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.2;
        }
        .emp-db-sub {
          font-size: 10px;
          color: #94a3b8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .emp-selected-chip {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #0f2a1a;
          border: 1px solid #15803d;
          border-radius: 6px;
          padding: 7px 10px;
          margin-top: 8px;
        }
        .emp-selected-chip img {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          object-fit: cover;
        }

        @media print {
          /* Print only the selected artwork, independent of the app shell. */
          html, body, #root {
            width: 100% !important;
            min-width: 0 !important;
            height: auto !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }
          body {
            background: white !important;
          }
          .admin-sidebar-form, .preview-toolbar, .no-print,
          .mobile-toggle, .sidebar-overlay, #sidebar, .app-sidebar,
          .sidebar, nav, header, button {
            display: none !important;
          }
          .certificate-generator-wrapper {
            display: block !important;
            width: 100% !important;
            min-height: 0 !important;
            background: white !important;
          }
          .admin-wrapper {
            display: block !important;
            width: 100% !important;
            min-height: 0 !important;
          }
          .main-content.admin-dashboard-page {
            display: block !important;
            width: 100% !important;
            min-width: 0 !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .preview-pane {
            width: 100% !important;
            padding: 0 !important;
            background: transparent !important;
            display: block !important;
            overflow: visible !important;
          }
          .cert-outer-wrapper {
            width: 100% !important;
            transform: none !important;
          }
          .cert-outer-wrapper.is-certificate {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 297mm !important;
            height: 210mm !important;
          }
          .certificate-page {
            box-shadow: none !important;
            border: none !important;
            width: 8in !important;
            height: 6in !important;
            max-width: 8in !important;
            padding: 28px !important;
            margin: 0 !important;
            overflow: visible !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .certificate-page .certificate-inner,
          .certificate-page .cert-content {
            height: 100% !important;
            min-height: 0 !important;
          }
          .certificate-page .footer-col-left,
          .certificate-page .footer-col-right {
            position: relative !important;
            top: -7mm !important;
          }
          .photo-poster-page {
            box-shadow: none !important;
            border: none !important;
            width: 210mm !important;
            height: 297mm !important;
            max-width: 210mm !important;
            padding: 24px 28px 20px !important;
            margin: 0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .photo-poster-page .photo-poster-content,
          .photo-poster-page .photo-poster-bg {
            height: 100% !important;
          }
          .photo-poster-page .photo-frame-container {
            width: 125mm !important;
            height: 145mm !important;
            flex-shrink: 0 !important;
          }
          @page {
            size: ${templateMode === 'certificate' ? 'A4 landscape' : 'A4 portrait'};
            margin: 0;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>

      {/* Form Sidebar */}
      <div className="admin-sidebar-form no-print">
        <div className="text-center mb-3 py-2" style={{ background: 'linear-gradient(135deg, #047857 0%, #064e3b 100%)', borderRadius: '8px', border: '1px solid #10b981' }}>
          <h5 className="text-white fw-bold m-0" style={{ fontSize: '13px', letterSpacing: '0.5px' }}>
            <i className="fas fa-award text-warning me-2"></i>Employee Of The Month Hub
          </h5>
        </div>

        {/* Template Selector Tabs */}
        <div className="btn-group w-100 mb-3" role="group">
          <button
            type="button"
            className={`btn btn-sm ${templateMode === 'photo_frame' ? 'btn-success fw-bold' : 'btn-outline-secondary text-light'}`}
            onClick={() => setTemplateMode('photo_frame')}
          >
            <i className="fas fa-image me-1"></i>Photo Frame Poster
          </button>
          <button
            type="button"
            className={`btn btn-sm ${templateMode === 'certificate' ? 'btn-info fw-bold text-dark' : 'btn-outline-secondary text-light'}`}
            onClick={() => setTemplateMode('certificate')}
          >
            <i className="fas fa-certificate me-1"></i>Certificate (Landscape)
          </button>
        </div>

        <button className="btn btn-warning w-100 fw-bold mb-2 text-dark shadow-sm" onClick={() => window.print()}>
          <i className="fas fa-print me-2"></i>Print / Save as PDF
        </button>
        <button className="btn btn-info w-100 fw-bold mb-2 text-dark shadow-sm" onClick={downloadCertificatePng}>
          <i className="fas fa-image me-2"></i>Download PNG
        </button>
        <button className="btn btn-outline-secondary w-100 fw-bold mb-3 shadow-sm text-light" onClick={handleReset} style={{ fontSize: '12px' }}>
          <i className="fas fa-undo me-2"></i>Reset to Default
        </button>

        {/* DB Employee Selector — available for both templates */}
        <div className="sec sec-db">
          <div className="sec-title"><i className="fas fa-database me-1"></i> Select Employee from DB</div>
          <div className="sec-body">
            <label>Search employee — name / ID / designation / department</label>
            <div ref={empSearchWrapRef} style={{ position: 'relative' }}>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={empSearch}
                  onChange={(e) => { setEmpSearch(e.target.value); setShowEmpDropdown(true); }}
                  onFocus={() => setShowEmpDropdown(true)}
                  placeholder={empLoading ? 'Loading...' : 'Type e.g. Jony, SNKHL...'}
                  style={{ paddingRight: '30px' }}
                />
                <i className="fas fa-search" style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: '11px' }}></i>
              </div>
              {showEmpDropdown && (
                <div className="emp-db-dropdown">
                  {empLoading ? (
                    <div style={{ padding: '14px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}><i className="fas fa-spinner fa-spin me-2"></i>Loading...</div>
                  ) : filteredEmployees.length === 0 ? (
                    <div style={{ padding: '14px', textAlign: 'center', color: '#94a3b8', fontSize: '12px' }}>No employees found</div>
                  ) : (
                    filteredEmployees.map((emp) => (
                      <div key={emp.id} className="emp-db-item" onClick={() => handleSelectEmployee(emp)}>
                        <img
                          src={emp.profile_pic && emp.profile_pic !== 'default.png' ? `/uploads/${emp.profile_pic}` : `https://ui-avatars.com/api/?name=${encodeURIComponent(emp.full_name || 'U')}&background=1e3a5f&color=fff&size=64`}
                          alt={emp.full_name}
                          className="emp-db-avatar"
                          onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(emp.full_name || 'U')}&background=1e3a5f&color=fff&size=64`; }}
                        />
                        <div className="emp-db-meta">
                          <div className="emp-db-name">{emp.full_name}</div>
                          <div className="emp-db-sub">{emp.designation || '—'} • {emp.department || '—'}{emp.employee_id ? ` • ${emp.employee_id}` : ''}</div>
                        </div>
                        <i className="fas fa-plus" style={{ color: '#38bdf8', fontSize: '10px' }}></i>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
              {empLoading ? '...' : `${employees.length} employees • showing ${filteredEmployees.length}`}
            </div>
            {selectedEmployee && (
              <div className="emp-selected-chip">
                <img
                  src={selectedEmployee.profile_pic && selectedEmployee.profile_pic !== 'default.png' ? `/uploads/${selectedEmployee.profile_pic}` : `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedEmployee.full_name || 'U')}&background=15803d&color=fff&size=64`}
                  alt={selectedEmployee.full_name}
                  onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedEmployee.full_name || 'U')}&background=15803d&color=fff&size=64`; }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#86efac', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedEmployee.full_name}</div>
                  <div style={{ fontSize: '10px', color: '#a7f3d0' }}>{selectedEmployee.designation || '—'} • {selectedEmployee.department || '—'}</div>
                </div>
                <button
                  type="button"
                  title="Clear selection"
                  onClick={handleClearSelectedEmployee}
                  style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: '4px', padding: '3px 7px', fontSize: '10px', cursor: 'pointer' }}
                >
                  <i className="fas fa-times"></i>
                </button>
              </div>
            )}
            {selectedEmployee && (
              <div style={{ fontSize: '10px', color: '#6ee7b7', marginTop: '6px', lineHeight: 1.4 }}>
                <i className="fas fa-check-circle me-1"></i>Name, designation, department and photo auto-filled — edit below if needed.
              </div>
            )}
          </div>
        </div>

        {/* CONTROLS FOR PHOTO FRAME TEMPLATE */}
        {templateMode === 'photo_frame' && (
          <>
            <div className="sec">
              <div className="sec-title">Poster Info</div>
              <div className="sec-body">
                <label>Header Title</label>
                <input name="title" value={photoData.title} onChange={handlePhotoChange} placeholder="Employee of The Month" />

                <label>Year</label>
                <input name="year" value={photoData.year} onChange={handlePhotoChange} placeholder="2026" />

                <label>Month Name</label>
                <input name="month" value={photoData.month} onChange={handlePhotoChange} placeholder="June" />
              </div>
            </div>

            <div className="sec">
              <div className="sec-title">Employee Photo</div>
              <div className="sec-body">
                <label>Upload Photo</label>
                <input type="file" accept="image/*" onChange={handlePhotoUpload} style={{ padding: '4px' }} />

                <label>Or Photo Image URL</label>
                <input name="photoUrl" value={photoData.photoUrl} onChange={handlePhotoChange} placeholder="https://... or data:image" />
              </div>
            </div>

            <div className="sec">
              <div className="sec-title">Employee Details</div>
              <div className="sec-body">
                <label>Employee Name</label>
                <input name="employeeName" value={photoData.employeeName} onChange={handlePhotoChange} placeholder="Abu Bakkar Siddik" />

                <label>Designation</label>
                <input name="designation" value={photoData.designation} onChange={handlePhotoChange} placeholder="Finance Manager" />

                <label>Department</label>
                <input name="department" value={photoData.department} onChange={handlePhotoChange} placeholder="Finance" />

                <label>Function</label>
                <input name="functionName" value={photoData.functionName} onChange={handlePhotoChange} placeholder="Accounts & Revenue" />

                <label>Appreciation Line</label>
                <input name="thankYouText" value={photoData.thankYouText} onChange={handlePhotoChange} placeholder="Thank You For Your Hard Work" />
              </div>
            </div>
          </>
        )}

        {/* CONTROLS FOR CERTIFICATE TEMPLATE */}
        {templateMode === 'certificate' && (
          <>
            <div className="sec">
              <div className="sec-title">Certificate Info</div>
              <div className="sec-body">
                <label>Reference No.</label>
                <input name="refNo" value={certData.refNo} onChange={handleCertChange} />
                <label>Issue Date</label>
                <input name="issueDate" value={certData.issueDate} onChange={handleCertChange} />
                <label>Header Prefix</label>
                <input name="headerPrefix" value={certData.headerPrefix} onChange={handleCertChange} />

                <label>Award Month &amp; Year</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <select
                    aria-label="Award month"
                    value={awardMonthNumber}
                    disabled={Boolean(editingAwardMonth)}
                    onChange={(event) => updateAwardMonthPart('month', event.target.value)}
                    style={{ width: '100%', background: '#0b1523', border: '1px solid #233e63', borderRadius: 5, color: '#fff', padding: '7px 8px', fontSize: 12 }}
                  >
                    {moment.months().map((month, index) => <option key={month} value={String(index + 1).padStart(2, '0')}>{month}</option>)}
                  </select>
                  <select
                    aria-label="Award year"
                    value={awardYear}
                    disabled={Boolean(editingAwardMonth)}
                    onChange={(event) => updateAwardMonthPart('year', event.target.value)}
                    style={{ width: '100%', background: '#0b1523', border: '1px solid #233e63', borderRadius: 5, color: '#fff', padding: '7px 8px', fontSize: 12 }}
                  >
                    {awardYears.map((year) => <option key={year} value={year}>{year}</option>)}
                  </select>
                </div>
                {editingAwardMonth && <small style={{ color: '#94a3b8', display: 'block', margin: '-5px 0 9px' }}>Cancel edit to choose a different month.</small>}

                <label>Employee Name</label>
                <input name="employeeName" value={certData.employeeName} onChange={handleCertChange} placeholder="SK Mehadi Hasan Jony" />

                <label>Award Intro</label>
                <input name="awardLead" value={certData.awardLead} onChange={handleCertChange} />
              </div>
            </div>

            <div className="sec">
              <div className="sec-title">Citation / Body</div>
              <div className="sec-body">
                <label>Appreciation Line 1</label>
                <input name="appreciationLine1" value={certData.appreciationLine1} onChange={handleCertChange} />

                <label>Connecting Word (Line 2)</label>
                <input name="appreciationLine2" value={certData.appreciationLine2} onChange={handleCertChange} />

                <label>Company Name</label>
                <input name="orgName" value={certData.orgName} onChange={handleCertChange} />

                <label>Year Banner</label>
                <input name="yearBanner" value={certData.yearBanner} onChange={handleCertChange} />
              </div>
            </div>

            <div className="sec">
              <div className="sec-title">Signer Details</div>
              <div className="sec-body">
                <label>Signature Label</label>
                <input name="signerTitle" value={certData.signerTitle} onChange={handleCertChange} />

                <label>Designation</label>
                <input name="signerDesignation" value={certData.signerDesignation} onChange={handleCertChange} placeholder="Director" />

                <label>Organization</label>
                <input name="signerOrg" value={certData.signerOrg} onChange={handleCertChange} placeholder="Speed Net Khulna" />
              </div>
            </div>
          </>
        )}

        <div className="sec">
          <div className="sec-title"><i className="fas fa-calendar-check me-1"></i>Monthly Winner Records</div>
          <div className="sec-body">
            {templateMode === 'certificate' ? (
              <>
                <p style={{ color: '#cbd5e1', fontSize: '11px', lineHeight: 1.45, margin: '0 0 9px' }}>
                  Save the selected month, winner, and certificate details. Existing months require confirmation before replacement.
                </p>
                <button
                  type="button"
                  className="btn btn-success w-100 fw-bold mb-2"
                  onClick={handleSaveAward}
                  disabled={savingAward || awardsLoading || !certData.employeeName.trim()}
                >
                  <i className={`fas ${savingAward ? 'fa-spinner fa-spin' : 'fa-floppy-disk'} me-2`}></i>
                  {savingAward ? 'Saving...' : `${editingAwardMonth ? 'Update' : 'Save'} ${formatAwardMonth(awardMonth) || 'Monthly'} Winner`}
                </button>
                {editingAwardMonth && (
                  <button
                    type="button"
                    className="btn btn-outline-light w-100 mb-2"
                    onClick={() => { setEditingAwardMonth(''); setAwardMessage('Edit cancelled.'); }}
                    disabled={savingAward}
                  >Cancel Edit</button>
                )}
              </>
            ) : (
              <p style={{ color: '#cbd5e1', fontSize: '11px', lineHeight: 1.45, margin: '0 0 9px' }}>
                Choose Certificate (Landscape) to save a winner. You can load previous months from this list in either view.
              </p>
            )}
            {awardMessage && <div role="status" style={{ color: ['Saved', 'Updated', 'Deleted', 'Loaded', 'Editing', 'Edit cancelled'].some((prefix) => awardMessage.startsWith(prefix)) ? '#86efac' : '#fca5a5', fontSize: '11px', marginBottom: 8 }}>{awardMessage}</div>}
            {awardsLoading ? (
              <div style={{ color: '#94a3b8', fontSize: '11px' }}><i className="fas fa-spinner fa-spin me-1"></i>Loading records...</div>
            ) : monthlyAwards.length ? (
              <div style={{ maxHeight: 260, overflowY: 'auto', display: 'grid', gap: 6 }}>
                {monthlyAwards.map((record) => (
                  <div key={record.award_month} style={{ padding: 8, border: '1px solid #2a4a7a', borderRadius: 5, background: '#0b1523', color: '#e2e8f0' }}>
                    <div style={{ minWidth: 0, marginBottom: 7 }}>
                      <strong style={{ display: 'block', fontSize: 11 }}>{formatAwardMonth(record.award_month)}</strong>
                      <span style={{ display: 'block', color: '#94a3b8', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.employee_name}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button type="button" className="btn btn-sm btn-outline-info" onClick={() => handleLoadAward(record)} title="View certificate">
                        <i className="fas fa-eye me-1"></i>View
                      </button>
                      <button type="button" className="btn btn-sm btn-outline-warning" onClick={() => handleEditAward(record)} disabled={Boolean(deletingAwardMonth)} title="Edit winner">
                        <i className="fas fa-pen me-1"></i>Edit
                      </button>
                      <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => handleDeleteAward(record)} disabled={Boolean(deletingAwardMonth)} title="Delete winner">
                        <i className={`fas ${deletingAwardMonth === String(record.award_month).slice(0, 7) ? 'fa-spinner fa-spin' : 'fa-trash'} me-1`}></i>Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: '#94a3b8', fontSize: 11 }}>No monthly winners saved yet.</div>
            )}
          </div>
        </div>
      </div>

      {/* Preview Pane */}
      <div className="preview-pane">
        <div className="preview-toolbar no-print">
          <div className="d-flex align-items-center gap-2">
            <span className={`badge ${templateMode === 'photo_frame' ? 'bg-success' : 'bg-primary'}`}>
              {templateMode === 'photo_frame' ? 'A4 Portrait (Photo Frame)' : 'A4 Landscape · 8 × 6 in Certificate'}
            </span>
            <span>100% Matching Template Preview</span>
            {templateMode === 'certificate' && (
              <span className="certificate-meta-external">
                Ref: {certData.refNo} · Date: {certData.issueDate}
              </span>
            )}
          </div>
          <div className="d-flex align-items-center gap-2">
            <span>Zoom:</span>
            <button className={`btn btn-sm ${zoomLevel === 0.85 ? 'btn-info' : 'btn-outline-secondary'}`} onClick={() => setZoomLevel(0.85)}>85%</button>
            <button className={`btn btn-sm ${zoomLevel === 1 ? 'btn-info' : 'btn-outline-secondary'}`} onClick={() => setZoomLevel(1)}>100%</button>
            <button className={`btn btn-sm ${zoomLevel === 1.15 ? 'btn-info' : 'btn-outline-secondary'}`} onClick={() => setZoomLevel(1.15)}>115%</button>
          </div>
        </div>

        <div className={`cert-outer-wrapper ${templateMode === 'certificate' ? 'is-certificate' : 'is-photo-frame'}`} style={{ transform: `scale(${zoomLevel})` }}>
          {/* ========================================================================= */}
          {/* TEMPLATE 1: PHOTO FRAME POSTER (PORTRAIT)                                 */}
          {/* ========================================================================= */}
          {templateMode === 'photo_frame' && (
            <div ref={posterRef} className="photo-poster-page">
              {/* Background Geometric Vector Patterns */}
              <svg className="photo-poster-bg" viewBox="0 0 620 877" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
                {/* Top Right Dotted Matrix Grid */}
                <g fill="#ffffff" opacity="0.32">
                  <circle cx="510" cy="35" r="3" />
                  <circle cx="530" cy="35" r="3" />
                  <circle cx="550" cy="35" r="3" />
                  <circle cx="570" cy="35" r="3" />
                  <circle cx="590" cy="35" r="3" />
                  <circle cx="510" cy="50" r="3" />
                  <circle cx="530" cy="50" r="3" />
                  <circle cx="550" cy="50" r="3" />
                  <circle cx="570" cy="50" r="3" />
                  <circle cx="590" cy="50" r="3" />
                </g>

                {/* Left Diagonal Stripes Hatching */}
                <g stroke="#ffffff" strokeWidth="2.5" strokeOpacity="0.22">
                  <line x1="-20" y1="280" x2="160" y2="100" />
                  <line x1="-20" y1="310" x2="190" y2="100" />
                  <line x1="-20" y1="340" x2="220" y2="100" />
                  <line x1="-20" y1="370" x2="250" y2="100" />
                  <line x1="-20" y1="400" x2="280" y2="100" />
                  <line x1="-20" y1="430" x2="310" y2="100" />
                  <line x1="-20" y1="460" x2="340" y2="100" />
                  <line x1="-20" y1="490" x2="370" y2="100" />
                  <line x1="-20" y1="520" x2="400" y2="100" />
                  <line x1="-20" y1="550" x2="430" y2="100" />
                </g>

                {/* Squiggly / Wavy Lines */}
                <path
                  d="M100,340 Q108,348 116,340 T132,340 T148,340 T164,340"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeOpacity="0.45"
                />
                <path
                  d="M120,630 Q128,638 136,630 T152,630 T168,630 T184,630"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeOpacity="0.45"
                />
                <path
                  d="M480,670 Q488,678 496,670 T512,670 T528,670 T544,670"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeOpacity="0.45"
                />

                {/* Right Side Matrix Dots */}
                <g fill="#ffffff" opacity="0.35">
                  <circle cx="510" cy="580" r="3.2" />
                  <circle cx="530" cy="580" r="3.2" />
                  <circle cx="550" cy="580" r="3.2" />
                  <circle cx="510" cy="600" r="3.2" />
                  <circle cx="530" cy="600" r="3.2" />
                  <circle cx="550" cy="600" r="3.2" />
                  <circle cx="510" cy="620" r="3.2" />
                  <circle cx="530" cy="620" r="3.2" />
                  <circle cx="550" cy="620" r="3.2" />
                </g>

                {/* Decorative Circles & Pluses */}
                <circle cx="255" cy="38" r="7" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeOpacity="0.4" />
                <circle cx="510" cy="225" r="5" fill="none" stroke="#ffffff" strokeWidth="2" strokeOpacity="0.35" />
                <text x="60" y="680" fill="#ffffff" opacity="0.4" fontSize="20" fontWeight="bold" fontFamily="sans-serif">+</text>
                <text x="60" y="710" fill="#ffffff" opacity="0.4" fontSize="20" fontWeight="bold" fontFamily="sans-serif">+</text>

                {/* Bottom Diagonal Stripe Accents */}
                <g stroke="#ffffff" strokeWidth="2" strokeOpacity="0.2">
                  <line x1="0" y1="780" x2="620" y2="780" />
                  <line x1="0" y1="830" x2="620" y2="830" />
                </g>
              </svg>

              <div className="photo-poster-content">
                {/* 1. Top Header Row: Speed Net Logo & Year/Month */}
                <div className="poster-top-row">
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>

                    <BrandLogo alt="Speed Net" style={{ height: '120px', width: 'auto', objectFit: 'contain' }} />

                  </div>

                  <div className="poster-date-box">
                    <div className="poster-year">{photoData.year}</div>
                    <div className="poster-month">{photoData.month}</div>
                  </div>
                </div>

                {/* 2. Employee of The Month Title Banner */}
                <div className="poster-title-banner">
                  <h1 className="poster-title-text">{photoData.title}</h1>
                </div>

                {/* 3. Center Photo Frame with Corner Accents */}
                <div className="photo-frame-container">
                  <div className="photo-mat-inner">
                    {/* Golden Photo Corner Mounts */}
                    <svg className="photo-corner corner-tl" viewBox="0 0 40 40">
                      <polygon points="0,0 40,0 0,40" fill="#fbbf24" />
                      <polygon points="0,0 28,0 0,28" fill="#f59e0b" />
                    </svg>
                    <svg className="photo-corner corner-tr" viewBox="0 0 40 40">
                      <polygon points="40,0 0,0 40,40" fill="#fbbf24" />
                      <polygon points="40,0 12,0 40,28" fill="#f59e0b" />
                    </svg>
                    <svg className="photo-corner corner-bl" viewBox="0 0 40 40">
                      <polygon points="0,40 40,40 0,0" fill="#fbbf24" />
                      <polygon points="0,40 28,40 0,12" fill="#f59e0b" />
                    </svg>
                    <svg className="photo-corner corner-br" viewBox="0 0 40 40">
                      <polygon points="40,40 0,40 40,0" fill="#fbbf24" />
                      <polygon points="40,40 12,40 40,12" fill="#f59e0b" />
                    </svg>

                    {/* Photo */}
                    {photoData.photoUrl ? (
                      <img src={photoData.photoUrl} alt={photoData.employeeName} className="employee-photo-img" />
                    ) : (
                      <div className="d-flex flex-column align-items-center justify-content-center h-100 w-100 bg-white text-muted">
                        <i className="fas fa-user-tie fa-4x mb-2 text-secondary"></i>
                        <span style={{ fontSize: '11px', fontWeight: 600 }}>Employee Photo</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. Thank You Banner */}
                <div className="poster-thankyou-banner">
                  <div className="poster-thankyou-text">{photoData.thankYouText}</div>
                </div>

                {/* 5. Employee Details */}
                <div style={{ width: '100%', textAlign: 'center' }}>
                  <div className="poster-recipient-name">{photoData.employeeName || 'Abu Bakkar Siddik'}</div>

                  <div className="poster-details-list">
                    {photoData.designation && <div>Designation: {photoData.designation}</div>}
                    {photoData.department && <div>Department: {photoData.department}</div>}
                    {photoData.functionName && <div>Function: {photoData.functionName}</div>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TEMPLATE 2: AWARD CERTIFICATE (LANDSCAPE)                                  */}
          {/* ========================================================================= */}
          {templateMode === 'certificate' && (
            <div ref={certificateRef} className="certificate-page">
              <div className="certificate-inner">
                {/* SVG Polygonal Crystal Artwork matching PDF */}
                <svg className="poly-canvas" viewBox="0 0 1000 700" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="facetDeep1" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#1e5f8a" stopOpacity="0.95" />
                      <stop offset="100%" stopColor="#0c3e60" stopOpacity="0.98" />
                    </linearGradient>
                    <linearGradient id="facetDeep2" x1="100%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#0e7490" stopOpacity="0.92" />
                      <stop offset="100%" stopColor="#08495d" stopOpacity="0.96" />
                    </linearGradient>
                    <linearGradient id="facetCyan1" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.88" />
                      <stop offset="100%" stopColor="#0284c7" stopOpacity="0.92" />
                    </linearGradient>
                    <linearGradient id="facetCyan2" x1="100%" y1="100%" x2="0%" y2="0%">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.85" />
                      <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.9" />
                    </linearGradient>
                    <linearGradient id="facetLight1" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.65" />
                    </linearGradient>
                    <linearGradient id="facetLight2" x1="0%" y1="100%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#a5f3fc" stopOpacity="0.75" />
                      <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0.55" />
                    </linearGradient>
                    <linearGradient id="facetIce1" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#cffafe" stopOpacity="0.7" />
                      <stop offset="100%" stopColor="#e0f2fe" stopOpacity="0.35" />
                    </linearGradient>
                    <linearGradient id="facetIce2" x1="100%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#bae6fd" stopOpacity="0.6" />
                      <stop offset="100%" stopColor="#f0f9ff" stopOpacity="0.2" />
                    </linearGradient>
                    <linearGradient id="facetCenterGlow" x1="50%" y1="0%" x2="50%" y2="100%">
                      <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.6" />
                      <stop offset="60%" stopColor="#a5f3fc" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                    </linearGradient>
                    <radialGradient id="ambientSoftGlow" cx="50%" cy="12%" r="55%">
                      <stop offset="0%" stopColor="#e0f7fa" stopOpacity="0.75" />
                      <stop offset="50%" stopColor="#e0f2fe" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                    </radialGradient>
                  </defs>

                  <ellipse cx="500" cy="110" rx="460" ry="240" fill="url(#ambientSoftGlow)" />

                  <polygon points="500,0 360,0 430,90" fill="url(#facetLight2)" />
                  <polygon points="500,0 640,0 570,90" fill="url(#facetLight1)" />
                  <polygon points="500,0 430,90 500,120" fill="url(#facetIce1)" />
                  <polygon points="500,0 570,90 500,120" fill="url(#facetLight2)" />
                  <polygon points="430,90 570,90 500,185" fill="url(#facetCenterGlow)" />
                  <polygon points="360,0 430,90 310,120" fill="url(#facetLight2)" />
                  <polygon points="640,0 570,90 690,120" fill="url(#facetCyan2)" />
                  <polygon points="430,90 500,185 380,210" fill="url(#facetIce2)" />
                  <polygon points="570,90 500,185 620,210" fill="url(#facetLight1)" />
                  <polygon points="380,210 500,185 500,280" fill="url(#facetIce1)" />
                  <polygon points="620,210 500,185 500,280" fill="url(#facetIce2)" />

                  <polygon points="0,0 130,0 65,75" fill="url(#facetLight1)" />
                  <polygon points="130,0 250,0 190,85" fill="url(#facetCyan2)" />
                  <polygon points="250,0 360,0 310,80" fill="url(#facetLight2)" />
                  <polygon points="0,0 65,75 0,140" fill="url(#facetCyan1)" />
                  <polygon points="65,75 190,85 125,165" fill="url(#facetLight1)" />
                  <polygon points="190,85 310,80 255,160" fill="url(#facetIce1)" />
                  <polygon points="310,80 360,0 310,120" fill="url(#facetLight2)" />
                  <polygon points="310,80 310,120 255,160" fill="url(#facetIce2)" />
                  <polygon points="0,140 125,165 0,230" fill="url(#facetLight2)" />
                  <polygon points="125,165 255,160 185,245" fill="url(#facetIce1)" />
                  <polygon points="255,160 310,120 380,210" fill="url(#facetIce2)" />
                  <polygon points="255,160 380,210 300,265" fill="url(#facetIce1)" />
                  <polygon points="0,230 185,245 0,310" fill="url(#facetIce2)" />
                  <polygon points="185,245 300,265 220,325" fill="url(#facetIce2)" />
                  <polygon points="300,265 380,210 340,320" fill="#e0f2fe" opacity="0.3" />

                  <polygon points="1000,0 870,0 945,85" fill="url(#facetDeep1)" />
                  <polygon points="870,0 750,0 825,95" fill="url(#facetDeep2)" />
                  <polygon points="750,0 640,0 705,80" fill="url(#facetCyan1)" />
                  <polygon points="640,0 690,120 705,80" fill="url(#facetCyan2)" />

                  <polygon points="1000,0 945,85 1000,165" fill="url(#facetDeep2)" />
                  <polygon points="945,85 825,95 915,185" fill="url(#facetCyan1)" />
                  <polygon points="825,95 705,80 775,185" fill="url(#facetCyan2)" />
                  <polygon points="705,80 690,120 775,185" fill="url(#facetLight1)" />
                  <polygon points="690,120 570,90 620,210" fill="url(#facetLight2)" />
                  <polygon points="690,120 620,210 720,225" fill="url(#facetCyan2)" />
                  <polygon points="690,120 720,225 775,185" fill="url(#facetLight1)" />

                  <polygon points="1000,165 915,185 1000,270" fill="url(#facetDeep1)" />
                  <polygon points="915,185 775,185 870,285" fill="url(#facetCyan1)" />
                  <polygon points="775,185 720,225 805,305" fill="url(#facetCyan2)" />
                  <polygon points="720,225 620,210 670,305" fill="url(#facetLight1)" />
                  <polygon points="620,210 500,280 580,345" fill="url(#facetIce1)" />
                  <polygon points="620,210 580,345 670,305" fill="url(#facetLight2)" />

                  <polygon points="1000,270 870,285 1000,370" fill="url(#facetCyan1)" />
                  <polygon points="870,285 805,305 910,390" fill="url(#facetCyan2)" />
                  <polygon points="805,305 670,305 765,395" fill="url(#facetLight1)" />
                  <polygon points="670,305 580,345 640,415" fill="url(#facetIce1)" />

                  <polygon points="1000,370 910,390 1000,460" fill="url(#facetCyan2)" />
                  <polygon points="910,390 765,395 865,475" fill="url(#facetLight1)" />
                  <polygon points="765,395 640,415 730,485" fill="url(#facetLight2)" />
                  <polygon points="1000,460 865,475 970,530" fill="url(#facetLight1)" />
                  <polygon points="865,475 730,485 810,545" fill="url(#facetIce1)" />
                  <polygon points="1000,460 970,530 1000,545" fill="url(#facetLight2)" />

                  <polygon points="500,280 580,345 510,410" fill="#e0f2fe" opacity="0.4" />
                  <polygon points="580,345 640,415 570,470" fill="#bae6fd" opacity="0.3" />
                  <polygon points="640,415 730,485 660,535" fill="#e0f2fe" opacity="0.25" />
                  <polygon points="730,485 810,545 745,585" fill="#bae6fd" opacity="0.2" />
                </svg>

                {/* Certificate Content */}
                <div className="cert-content">
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
                    <svg className="diamond-emblem" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <defs>
                        <linearGradient id="diaTop" x1="50%" y1="0%" x2="50%" y2="100%">
                          <stop offset="0%" stopColor="#7dd3fc" />
                          <stop offset="100%" stopColor="#38bdf8" />
                        </linearGradient>
                        <linearGradient id="diaBottom" x1="50%" y1="0%" x2="50%" y2="100%">
                          <stop offset="0%" stopColor="#0284c7" />
                          <stop offset="100%" stopColor="#0369a1" />
                        </linearGradient>
                        <linearGradient id="diaLeft" x1="0%" y1="50%" x2="100%" y2="50%">
                          <stop offset="0%" stopColor="#0284c7" />
                          <stop offset="100%" stopColor="#38bdf8" />
                        </linearGradient>
                        <linearGradient id="diaRight" x1="100%" y1="50%" x2="0%" y2="50%">
                          <stop offset="0%" stopColor="#0369a1" />
                          <stop offset="100%" stopColor="#0ea5e9" />
                        </linearGradient>
                      </defs>
                      <polygon points="50,4 66,38 50,50 34,38" fill="url(#diaTop)" />
                      <polygon points="96,50 62,66 50,50 62,34" fill="url(#diaRight)" />
                      <polygon points="50,96 34,62 50,50 66,62" fill="url(#diaBottom)" />
                      <polygon points="4,50 38,34 50,50 38,66" fill="url(#diaLeft)" />
                      <line x1="50" y1="4" x2="50" y2="96" stroke="#ffffff" strokeWidth="0.8" opacity="0.7" />
                      <line x1="4" y1="50" x2="96" y2="50" stroke="#ffffff" strokeWidth="0.8" opacity="0.7" />
                    </svg>

                    <div className="certificate-meta-row">
                      <span>Ref: {certData.refNo}</span>
                      <span>Date: {certData.issueDate}</span>
                    </div>
                    <h1 className="title-certificate">Certificate</h1>

                    <div className="cert-subtitle">
                      {certData.headerPrefix} {certData.monthYear}
                    </div>

                    <div className="cert-awarded-to">
                      {certData.awardLead}
                    </div>

                    <div className="employee-name-wrap">
                      <div className="employee-name-text">
                        {certData.employeeName || 'SK Mehadi Hasan Jony'}
                      </div>
                    </div>

                    <div className="citation-line1">
                      {certData.appreciationLine1}
                    </div>
                    <div className="citation-line2">
                      {certData.appreciationLine2}
                    </div>
                    <div className="citation-line3">
                      {certData.orgName}
                    </div>

                    <div className="year-pill-badge">
                      <div className="citation-line4">
                        {certData.yearBanner}
                      </div>
                    </div>
                  </div>

                  <div className="cert-footer-row">
                    <div className="footer-col-left" style={{ position: 'relative' }}>
                      <svg width="125" height="65" viewBox="0 0 140 75" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                          <linearGradient id="thankGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#0284c7" />
                            <stop offset="100%" stopColor="#0ea5e9" />
                          </linearGradient>
                        </defs>
                        <path d="M12,22 L14,16 L20,14 L14,12 L12,6 L10,12 L4,14 L10,16 Z" fill="#38bdf8" />
                        <circle cx="26" cy="46" r="2.2" fill="#38bdf8" />
                        <circle cx="118" cy="18" r="2.5" fill="#38bdf8" />
                        <path d="M126,24 L127.5,20 L131.5,18.5 L127.5,17 L126,13 L124.5,17 L120.5,18.5 L124.5,20 Z" fill="#38bdf8" />
                        <circle cx="12" cy="54" r="1.8" fill="#7dd3fc" />
                        <circle cx="110" cy="52" r="2" fill="#7dd3fc" />
                        <circle cx="124" cy="48" r="1.5" fill="#38bdf8" />

                      </svg>
                      <div style={{ position: 'absolute', left: '8px', top: '1px', width: '102px', textAlign: 'center', fontFamily: "'Great Vibes', 'Alex Brush', cursive", fontSize: '32px', fontWeight: 600, lineHeight: 0.95, letterSpacing: '0.4px', color: '#0284c7', transform: 'rotate(-7deg)', textShadow: '1px 2px 2px rgba(2, 132, 199, 0.2)', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
                        <div style={{ whiteSpace: 'nowrap' }}>thank</div>
                        <div style={{ whiteSpace: 'nowrap', marginLeft: '7px' }}>you</div>
                      </div>
                    </div>

                    <div className="footer-col-center">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <BrandLogo alt="Speed Net Logo" style={{ height: '120px', width: 'auto', objectFit: 'contain' }} />
                      </div>
                    </div>

                    <div className="footer-col-right">
                      <div className="signature-line-bar"></div>
                      <div className="sig-label-top">{certData.signerTitle}</div>
                      <div className="sig-label-role">{certData.signerDesignation}</div>
                      <div className="sig-label-org">{certData.signerOrg}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmployeeOfTheMonthGenerator;
