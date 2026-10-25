import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { getUserProfile, getProfileHistory } from "../services/profileService";
import { changePassword } from "../services/authService";
import ImageWithFallback from "../components/ImageWithFallback";
import EmployeeQRModal from "../components/EmployeeQRModal";
import moment from "moment";
import { normalizeOfficeName } from "../constants/branches";
import { t } from "../i18n";
import "../styles/AdminDashboard.css";

const resolveUploadUrl = (pic) => {
  if (!pic || pic === "default.png") return null;
  if (/^https?:\/\//i.test(pic)) return pic;
  if (String(pic).startsWith("/api/")) return pic;
  const base = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  const path = String(pic).startsWith("/") ? pic : `/uploads/${pic}`;
  return `${base}${path}`;
};

const Profile = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}");
    } catch {
      return {};
    }
  })();
  const currentUserId = Number(currentUser?.id || 0);
  const [loading, setLoading] = useState(true);
  const [profileData, setProfileData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [filters, setFilters] = useState({
    month: "",
    year: new Date().getFullYear(),
  });
  const [pwForm, setPwForm] = useState({
    current: "",
    newPass: "",
    confirm: "",
  });
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");
  const [showQRModal, setShowQRModal] = useState(false);
  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [nidRevealed, setNidRevealed] = useState(false);
  const [copiedField, setCopiedField] = useState("");
  const [pwShow, setPwShow] = useState({ current: false, newPass: false, confirm: false });
  const fetchSeqRef = useRef(0);

  const goBackToEmployees = () => {
    const pid = id || profileData?.user?.id;
    try { if (pid) sessionStorage.setItem('employees-highlight', String(pid)); } catch { /* ignore */ }
    const cameFromEmployees = location.state?.from === '/employees' ||
      (document.referrer && document.referrer.includes('/employees'));
    if (cameFromEmployees && window.history.length > 1 && location.key !== 'default') {
      navigate(-1);
    } else {
      navigate('/employees', { state: pid ? { highlightId: String(pid) } : undefined });
    }
  };

  const fetchProfile = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getUserProfile(id, filters.month, filters.year);
      if (seq !== fetchSeqRef.current) return;
      setProfileData(data);
    } catch (error) {
      if (seq !== fetchSeqRef.current) return;
      console.error(t("profile.loadFailed"), error);
      const status = Number(error?.response?.status || 0);
      if (!error?.response) setLoadError({ kind: 'network', message: error?.message || '' });
      else if (status === 404) setLoadError({ kind: 'notfound' });
      else if (status === 403) setLoadError({ kind: 'forbidden', message: error?.response?.data?.message || '' });
      else setLoadError({ kind: 'server', message: error?.response?.data?.message || '' });
      setProfileData(null);
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [filters.month, filters.year, id]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    const handleProfileUpdated = (e) => {
      if (!e?.detail?.id || String(e.detail.id) === String(id)) {
        fetchProfile();
      }
    };
    window.addEventListener('profile-updated', handleProfileUpdated);
    return () => window.removeEventListener('profile-updated', handleProfileUpdated);
  }, [fetchProfile, id]);

  useEffect(() => {
    if (location.state?.updated) {
      fetchProfile();
    }
  }, [fetchProfile, location.state?.updated]);

  useEffect(() => {
    if (activeTab !== "history" || historyData) return;
    const pid = id || profileData?.user?.id;
    if (!pid) return;
    setHistoryLoading(true);
    getProfileHistory(pid)
      .then((d) => setHistoryData(d))
      .catch(() => setHistoryData({ history: [], audit: [] }))
      .finally(() => setHistoryLoading(false));
  }, [activeTab, historyData, id, profileData]);

  // Deep-link: /profile/:id#password opens the Security tab directly (owner only).
  useEffect(() => {
    if (location.hash !== "#password") return;
    if (!profileData) {
      setActiveTab("security");
      return;
    }
    const owner = Number(profileData.user?.id) === currentUserId;
    setActiveTab(owner ? "security" : "overview");
  }, [currentUserId, id, location.hash, profileData]);

  if (loading)
    return (
      <div className="d-flex flex-column justify-content-center align-items-center vh-100 py-5">
        <div className="loader-container text-center">
          <div
            className="spinner-border text-primary"
            role="status"
            style={{ width: "3.5rem", height: "3.5rem", borderWidth: "0.25em" }}
          ></div>
          <p className="mt-3 fw-bold text-primary fs-5">{t("profile.loading")}</p>
        </div>
      </div>
    );

  if (!profileData) {
    const kind = loadError?.kind || 'notfound';
    const card = kind === 'forbidden'
      ? { code: '403', title: 'Access Forbidden', text: loadError?.message || 'You do not have permission to view this profile.' }
      : kind === 'network'
        ? { code: '!', title: 'Network Error', text: 'Could not connect to the server. Check your internet and try again.' }
        : kind === 'server'
          ? { code: '500', title: 'Server Error', text: loadError?.message || 'Could not load profile. Please try again later.' }
          : { code: '404', title: t("profile.notFound"), text: t("profile.notFoundText") };
    return (
      <div className="d-flex flex-column justify-content-center align-items-center h-100 py-5 text-center px-3">
        <div className="error-card glass-card p-4 p-md-5 rounded-4 shadow-sm" style={{ maxWidth: "500px", width: "100%" }}>
          <div className="display-1 fw-bold text-danger opacity-25">{card.code}</div>
          <h2 className="fw-bold text-dark">{card.title}</h2>
          <p className="text-muted mb-4">{card.text}</p>
          <div className="d-flex flex-wrap gap-2 justify-content-center">
            <button onClick={fetchProfile} className="btn btn-outline-primary rounded-pill px-4 shadow-sm">
              <i className="fas fa-rotate me-2"></i>{t("employees.retry")}
            </button>
            <button
              onClick={goBackToEmployees}
              className="btn btn-primary rounded-pill px-4 shadow"
            >
              {t("profile.backToEmployees")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { user, filteredTotalDays } = profileData;
  const leaves = profileData.leaves || [];
  const canEditOwnProfile = Number(user?.id) === currentUserId;
  const isProfilePowerUser = ['admin', 'super admin'].includes((currentUser.role || '').toLowerCase());

  const hasPermission = (perm) => {
    if (isProfilePowerUser) return true;
    return Boolean(
      currentUser?.all_access ||
      currentUser?.permissions?.all_access ||
      currentUser?.permissions?.[perm] ||
      currentUser?.[perm]
    );
  };

  const canGenerateAppointment = hasPermission('appointment_letters.generate') || hasPermission('p_appointment_letter');
  const canCreateEditEmployee = hasPermission('employees.create_edit') || hasPermission('p_employee_create_edit') || hasPermission('users.manage') || hasPermission('p_manage_users');
  const canViewHistory = canEditOwnProfile || canCreateEditEmployee || hasPermission('users.edit.any') || hasPermission('p_edit_any_profile') || hasPermission('p_employees');

  const canViewEmployeeId =
    canEditOwnProfile ||
    Boolean(
      currentUser?.all_access ||
      currentUser?.p_edit_any_profile ||
      currentUser?.p_employees ||
      currentUser?.permissions?.all_access ||
      currentUser?.permissions?.p_edit_any_profile ||
      currentUser?.permissions?.p_employees,
    );

  const displayId = user?.employee_id || user?.emp_id;

  const isActiveUser = user?.status
    ? String(user.status).toLowerCase() === "active"
    : Boolean(user?.can_take_action);
  const statusText = isActiveUser ? t("profile.active") : t("employees.inactive");

  const tenureText = (() => {
    if (!user?.joining_date) return null;
    const j = moment(user.joining_date);
    if (!j.isValid()) return null;
    const now = moment();
    if (j.isAfter(now)) return null;
    const years = now.diff(j, "years");
    const months = now.diff(j.clone().add(years, "years"), "months");
    return `${years}y ${months}m`;
  })();
  const joiningText = user?.joining_date
    ? moment(user.joining_date).format("DD MMM, YYYY")
    : "N/A";

  const canViewRestricted = isProfilePowerUser || canEditOwnProfile;

  const nidDigits = String(user?.nid_number || "").replace(/\D/g, "");
  const nidLast4 = nidDigits.slice(-4);
  const nidMasked = user?.nid_number ? `****-****-${nidLast4 || "----"}` : "";

  const copyText = async (key, txt) => {
    if (!txt) return;
    try {
      await navigator.clipboard.writeText(txt);
      setCopiedField(key);
      setTimeout(() => setCopiedField(""), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  const pwChecks = {
    len8: (pwForm.newPass || "").length >= 8,
    number: /\d/.test(pwForm.newPass || ""),
    mixed: /[a-z]/.test(pwForm.newPass || "") && /[A-Z]/.test(pwForm.newPass || ""),
    len12: (pwForm.newPass || "").length >= 12,
  };
  const pwScore = [pwChecks.len8, pwChecks.number, pwChecks.mixed, pwChecks.len12].filter(Boolean).length;
  const pwBarColors = ["#ef4444", "#f59e0b", "#3b82f6", "#10b981"];

  // Row-level leave days: mirrors server getCleanDays (excludes weekly_off weekday).
  const getLeaveRowDays = (leave) => {
    if (parseInt(leave.leave_type_id, 10) === 3) return "0.5";
    const s = moment(leave.start_date);
    const e = moment(leave.end_date);
    if (!s.isValid() || !e.isValid() || e.isBefore(s, "day")) return "—";
    const weeklyOff = user?.weekly_off || "Friday";
    let days = 0;
    const cur = s.clone().startOf("day");
    const end = e.clone().startOf("day");
    while (!cur.isAfter(end, "day")) {
      if (cur.format("dddd") !== weeklyOff) days += 1;
      cur.add(1, "day");
    }
    return String(days);
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPwError("");
    setPwSuccess("");

    if (pwForm.newPass !== pwForm.confirm) {
      setPwError(t("employees.passwordMismatch"));
      return;
    }
    if (pwForm.newPass.length < 8) {
      setPwError("New password must be at least 8 characters");
      return;
    }

    setPwLoading(true);
    try {
      await changePassword(pwForm.current, pwForm.newPass);
      setPwSuccess("Password changed successfully ✓");
      setPwForm({ current: "", newPass: "", confirm: "" });
    } catch (err) {
      setPwError(err.message || "Failed to change password");
    } finally {
      setPwLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "Approved":
        return (
          <span className="badge bg-success-soft text-success px-3 py-1 rounded-pill">
            <i className="fas fa-check-circle me-1"></i>
            {t("profile.approved")}
          </span>
        );
      case "Rejected":
        return (
          <span className="badge bg-danger-soft text-danger px-3 py-1 rounded-pill">
            <i className="fas fa-times-circle me-1"></i>
            {t("profile.rejected")}
          </span>
        );
      default:
        return (
          <span className="badge bg-warning-soft text-amber px-3 py-1 rounded-pill">
            <i className="fas fa-hourglass-half me-1"></i>
            {t("profile.pending")}
          </span>
        );
    }
  };

  return (
    <div className="profile-page-wrapper pb-5">
      {/* Top Breadcrumb Navigation */}
      <div className="mb-3 d-flex align-items-center justify-content-between">
        <button onClick={goBackToEmployees} className="profile-breadcrumb-link">
          <i className="fas fa-arrow-left me-2"></i>
          {t("profile.backToEmployees")}
        </button>
      </div>

      {/* Main Profile Header Card */}
      <div className="profile-header-card shadow-sm mb-4">
        <div className="profile-banner-bg">
          <div className="profile-banner-grid"></div>
        </div>

        <div className="profile-info-content p-3 p-sm-4 p-lg-5">
          <div className="row align-items-center align-items-md-start g-3 g-md-4">
            {/* Avatar Column */}
            <div className="col-12 col-md-auto text-center text-md-start">
              <div className="profile-avatar-wrapper d-inline-block">
                <ImageWithFallback
                  src={resolveUploadUrl(user.profile_pic)}
                  fallbackName={user.full_name}
                  alt={user.full_name}
                  className="profile-avatar shadow"
                />
                <div
                  className={`status-indicator ${isActiveUser ? "active" : "inactive"}`}
                  title={statusText}
                >
                  <span className="pulse-ring"></span>
                </div>
              </div>
            </div>

            {/* Info Column */}
            <div className="col-12 col-md profile-header-info">
              <div className="d-flex flex-column flex-xl-row justify-content-between align-items-center align-items-md-start align-items-xl-center gap-3">
                <div className="profile-titles text-center text-md-start">
                  <div className="d-flex align-items-center justify-content-center justify-content-md-start flex-wrap gap-2 mb-2">
                    <h1 className="user-name mb-0">{user.full_name}</h1>
                    {canViewEmployeeId && displayId && (
                      <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-2 rounded-pill fw-bold">
                        <i className="fas fa-id-badge me-2"></i>
                        {displayId}
                      </span>
                    )}
                    <span className={`badge rounded-pill px-3 py-2 fw-bold ${isActiveUser ? "bg-success-subtle text-success border border-success-subtle" : "bg-danger-subtle text-danger border border-danger-subtle"}`}>
                      <span className={`status-dot ${isActiveUser ? "active" : ""}`}></span>
                      {statusText}
                    </span>
                  </div>

                  <div className="user-meta d-flex justify-content-center justify-content-md-start flex-wrap gap-2 gap-md-3">
                    <span className="meta-pill">
                      <i className="fas fa-briefcase text-primary me-2"></i>
                      {user.designation || t("profile.staff")}
                    </span>
                    <span className="meta-pill">
                      <i className="fas fa-building text-info me-2"></i>
                      {user.department || "General"}
                    </span>
                    <span className="meta-pill">
                      <i className="fas fa-location-dot text-success me-2"></i>
                      {normalizeOfficeName(user.work_location) || `${t("employees.workLocation")}: ${t("employees.na")}`}
                    </span>
                    {tenureText && (
                      <span className="meta-pill" title={`${t("profile.joiningDate")}: ${joiningText}`}>
                        <i className="fas fa-history text-warning me-2"></i>
                        {tenureText} • Joined {joiningText}
                      </span>
                    )}
                  </div>
                </div>

                {/* Profile Actions */}
                <div className="profile-actions-wrapper d-flex flex-wrap justify-content-center justify-content-md-start gap-2">
                  {(canEditOwnProfile || canCreateEditEmployee) ? (
                    <button
                      onClick={() => navigate(`/edit-employee/${user.id}`, { state: { from: location.pathname } })}
                      className="btn btn-modern-primary flex-grow-1 flex-md-grow-0"
                    >
                      <i className="fas fa-user-edit me-2"></i>
                      {t("profile.editProfile")}
                    </button>
                  ) : (
                    <button
                      className="btn btn-modern-primary flex-grow-1 flex-md-grow-0"
                      disabled
                      title="You do not have permission to edit this profile"
                      style={{ opacity: 0.5, cursor: "not-allowed" }}
                    >
                      <i className="fas fa-lock me-2"></i>
                      {t("profile.editProfile")}
                    </button>
                  )}

                  {canGenerateAppointment ? (
                    <button
                      onClick={() =>
                        navigate("/appointment-generator", {
                          state: {
                            from: location.pathname,
                            full_name: user.full_name,
                            employee_id: user.employee_id,
                            father_name: user.father_name,
                            designation: user.designation,
                            department: user.department,
                            joining_date: user.joining_date,
                            nid_number: user.nid_number,
                            present_address: user.present_address,
                            permanent_address: user.permanent_address,
                            reporting_manager: user.reporting_manager,
                            work_location: user.work_location,
                            employment_type: user.employment_type,
                          },
                        })
                      }
                      className="btn btn-modern-outline flex-grow-1 flex-md-grow-0"
                    >
                      <i className="fas fa-file-signature me-2 text-primary"></i>
                      Appointment Letter
                    </button>
                  ) : (
                    <button
                      className="btn btn-modern-outline flex-grow-1 flex-md-grow-0"
                      disabled
                      title="You do not have permission to create appointment letters"
                      style={{ opacity: 0.5, cursor: "not-allowed" }}
                    >
                      <i className="fas fa-lock me-2"></i>
                      Appointment
                    </button>
                  )}

                  {canViewEmployeeId && (
                    <button
                      onClick={() => setShowQRModal(true)}
                      className="btn btn-modern-outline flex-grow-1 flex-md-grow-0"
                      title="View Digital ID Card & QR Code"
                    >
                      <i className="fas fa-qrcode me-2 text-indigo"></i>
                      QR Card
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modern Navigation Tabs */}
      <div className="profile-tabs-scroll-container mb-4">
        <div className="nav nav-pills profile-nav-pills p-2 rounded-4 shadow-sm border bg-white d-inline-flex flex-nowrap" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === "overview"}
            className={`nav-link profile-tab-link ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
          >
            <i className="fas fa-chart-pie me-2"></i>
            {t("profile.tabOverview")}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "details"}
            className={`nav-link profile-tab-link ${activeTab === "details" ? "active" : ""}`}
            onClick={() => setActiveTab("details")}
          >
            <i className="fas fa-user-shield me-2"></i>
            {t("profile.tabDetails")}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "leaves"}
            className={`nav-link profile-tab-link ${activeTab === "leaves" ? "active" : ""}`}
            onClick={() => setActiveTab("leaves")}
          >
            <i className="fas fa-calendar-check me-2"></i>
            {t("profile.tabLeaves")}
          </button>
          {canViewHistory && (
            <button
              role="tab"
              aria-selected={activeTab === "history"}
              className={`nav-link profile-tab-link ${activeTab === "history" ? "active" : ""}`}
              onClick={() => setActiveTab("history")}
            >
              <i className="fas fa-history me-2"></i>
              Change History
            </button>
          )}
          {canEditOwnProfile && (
            <button
              role="tab"
              aria-selected={activeTab === "security"}
              className={`nav-link profile-tab-link ${activeTab === "security" ? "active" : ""}`}
              onClick={() => setActiveTab("security")}
            >
              <i className="fas fa-key me-2"></i>
              Security
            </button>
          )}
        </div>
      </div>

      {/* Tab Content Panels */}
      <div className="tab-content">
        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <div className="fade-in">
            <div className="row g-3 g-lg-4">
              {/* Left Main Overview Box */}
              <div className="col-12 col-lg-8">
                <div className="modern-card p-3 p-sm-4 h-100">
                  <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2 border-bottom pb-3">
                    <div>
                      <h5 className="section-title mb-1">
                        <i className="fas fa-chart-bar text-primary me-2"></i>
                        {t("profile.leaveStatsYear")}
                      </h5>
                      <span className="text-muted small">Summary of leave requests and allocations</span>
                    </div>
                    <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-3 py-2 rounded-pill fw-bold fs-6">
                      Year {filters.year}
                    </span>
                  </div>

                  {/* Stat Cards Grid */}
                  <div className="row g-3 mb-4">
                    <div className="col-12 col-sm-4">
                      <div className="stat-card p-3 rounded-4 bg-primary-soft border border-primary-subtle text-center">
                        <div className="stat-icon-wrapper bg-white shadow-sm mx-auto mb-2 text-primary">
                          <i className="fas fa-calendar-day"></i>
                        </div>
                        <div className="stat-label">{t("profile.totalLeaveDays")}</div>
                        <div className="stat-value text-primary">{filteredTotalDays}</div>
                      </div>
                    </div>
                    <div className="col-12 col-sm-4">
                      <div className="stat-card p-3 rounded-4 bg-success-soft border border-success-subtle text-center">
                        <div className="stat-icon-wrapper bg-white shadow-sm mx-auto mb-2 text-success">
                          <i className="fas fa-check-circle"></i>
                        </div>
                        <div className="stat-label">{t("profile.approvedRequests")}</div>
                        <div className="stat-value text-success">
                          {leaves.filter((l) => l.status === "Approved").length}
                        </div>
                      </div>
                    </div>
                    <div className="col-12 col-sm-4">
                      <div className="stat-card p-3 rounded-4 bg-warning-soft border border-warning-subtle text-center">
                        <div className="stat-icon-wrapper bg-white shadow-sm mx-auto mb-2 text-amber">
                          <i className="fas fa-hourglass-half"></i>
                        </div>
                        <div className="stat-label">{t("profile.pending")}</div>
                        <div className="stat-value text-amber">
                          {leaves.filter((l) => l.status === "Pending" || !l.status).length}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Workplace Info Grid */}
                  <div className="mt-4 pt-3 border-top">
                    <h6 className="fw-bold text-dark mb-3">
                      <i className="fas fa-building-user text-primary me-2"></i>
                      {t("profile.workplaceInfo")}
                    </h6>
                    <div className="row g-3">
                      <div className="col-6 col-md-4 col-xl-3">
                        <div className="info-tile p-3 rounded-3 bg-light">
                          <div className="small text-muted">{t("profile.weeklyOff")}</div>
                          <div className="fw-bold text-dark">
                            {user.weekly_off || t("profile.defaultWeeklyOff")}
                          </div>
                        </div>
                      </div>
                      <div className="col-6 col-md-4 col-xl-3">
                        <div className="info-tile p-3 rounded-3 bg-light">
                          <div className="small text-muted">{t("profile.joiningDate")}</div>
                          <div className="fw-bold text-dark">
                            {user.joining_date
                              ? moment(user.joining_date).format("DD MMM, YYYY")
                              : "N/A"}
                          </div>
                        </div>
                      </div>
                      <div className="col-6 col-md-4 col-xl-3">
                        <div className="info-tile p-3 rounded-3 bg-light">
                          <div className="small text-muted">{t("employees.designation")}</div>
                          <div className="fw-bold text-dark text-truncate">
                            {user.designation || "—"}
                          </div>
                        </div>
                      </div>
                      <div className="col-6 col-md-4 col-xl-3">
                        <div className="info-tile p-3 rounded-3 bg-light">
                          <div className="small text-muted">{t("employees.role")}</div>
                          <div className="fw-bold text-dark">
                            {user.role_name || user.role || "—"}
                          </div>
                        </div>
                      </div>
                      <div className="col-6 col-md-4 col-xl-3">
                        <div className="info-tile p-3 rounded-3 bg-light">
                          <div className="small text-muted">{t("profile.status")}</div>
                          <div className={`fw-bold ${isActiveUser ? "text-success" : "text-danger"}`}>
                            {statusText}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Contact Card */}
              <div className="col-12 col-lg-4">
                <div className="modern-card p-3 p-sm-4 h-100">
                  <h5 className="section-title mb-4 border-bottom pb-3">
                    <i className="fas fa-address-book text-primary me-2"></i>
                    {t("profile.contacts")}
                  </h5>

                  <div className="contact-card-item p-3 rounded-4 bg-light mb-3">
                    <div className="d-flex align-items-center">
                      <div className="icon-box bg-primary-subtle text-primary me-3 flex-shrink-0">
                        <i className="fas fa-envelope fs-5"></i>
                      </div>
                      <div className="overflow-hidden flex-grow-1">
                        <div className="small text-muted">{t("profile.email")}</div>
                        <div className="fw-bold text-dark text-break fs-6">
                          {user.email || "N/A"}
                        </div>
                      </div>
                      {user.email && (
                        <button
                          className="btn btn-sm btn-light border ms-2 rounded-circle flex-shrink-0"
                          onClick={() => copyText("email", user.email)}
                          title="Copy Email"
                          aria-label="Copy email"
                        >
                          <i aria-hidden="true" className={`fas fa-${copiedField === "email" ? "check text-success" : "copy"}`}></i>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="contact-card-item p-3 rounded-4 bg-light mb-3">
                    <div className="d-flex align-items-center">
                      <div className="icon-box bg-success-subtle text-success me-3 flex-shrink-0">
                        <i className="fas fa-phone-alt fs-5"></i>
                      </div>
                      <div className="overflow-hidden flex-grow-1">
                        <div className="small text-muted">{t("profile.phone")}</div>
                        <div className="fw-bold text-dark fs-6">
                          {user.phone ? (
                            <a href={`tel:${user.phone}`} className="text-dark text-decoration-none hover-primary">
                              {user.phone}
                            </a>
                          ) : "N/A"}
                        </div>
                      </div>
                      {user.phone && (
                        <button
                          className="btn btn-sm btn-light border ms-2 rounded-circle flex-shrink-0"
                          onClick={() => copyText("phone", user.phone)}
                          title="Copy Phone Number"
                          aria-label="Copy phone number"
                        >
                          <i aria-hidden="true" className={`fas fa-${copiedField === "phone" ? "check text-success" : "copy"}`}></i>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="contact-card-item p-3 rounded-4 bg-light">
                    <div className="d-flex align-items-center">
                      <div className="icon-box bg-danger-subtle text-danger me-3 flex-shrink-0">
                        <i className="fas fa-droplet fs-5"></i>
                      </div>
                      <div className="overflow-hidden flex-grow-1">
                        <div className="small text-muted">{t("profile.bloodGroup")}</div>
                        <div className="fw-bold text-danger fs-6">
                          {user.blood_group || t("profile.unknown")}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DETAILS TAB */}
        {activeTab === "details" && (
          <div className="fade-in">
            {canViewRestricted ? (
              <div className="restricted-card-wrapper mb-4">
                <div className="restricted-banner-bar d-flex align-items-center justify-content-between p-3 px-4 rounded-top-4 bg-amber-soft border border-warning-subtle">
                  <div className="d-flex align-items-center text-amber fw-bold">
                    <i className="fas fa-user-lock me-2 fs-5"></i>
                    Restricted & Confidential Employee Information
                  </div>
                  <span className="badge bg-warning text-dark px-3 py-1 rounded-pill fw-semibold">
                    Authorized Access
                  </span>
                </div>

                <div className="row g-3 g-lg-4 mt-0">
                  {/* Identity Box */}
                  <div className="col-12 col-lg-6">
                    <div className="modern-card p-3 p-sm-4 h-100">
                      <h5 className="section-title mb-4 border-bottom pb-3">
                        <i className="fas fa-id-card text-primary me-2"></i>
                        Identity & NID Details
                      </h5>

                      <div className="p-3 rounded-4 bg-light mb-3">
                        <div className="text-primary fw-bold mb-1 small">
                          <i className="fas fa-user-tie me-2"></i>
                          {t("profile.fatherName")}
                        </div>
                        <div className="fw-bold text-dark fs-6">
                          {user.father_name || t("profile.noInfo")}
                        </div>
                      </div>

                      {user.nid_number && (
                        <div className="p-3 rounded-4 bg-light mb-3">
                          <div className="text-primary fw-bold mb-1 small">
                            <i className="fas fa-fingerprint me-2"></i>
                            {t("profile.nidNumber")}
                          </div>
                          <div className="d-flex align-items-center gap-2 flex-wrap">
                            <span className="font-monospace fw-bold fs-6 text-dark">
                              {nidRevealed ? user.nid_number : nidMasked}
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary rounded-pill px-3"
                              onClick={() => setNidRevealed((v) => !v)}
                            >
                              <i className={`fas fa-eye${nidRevealed ? "-slash" : ""} me-1`}></i>
                              {nidRevealed ? "Hide" : "Show"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary rounded-pill px-3"
                              onClick={() => copyText("nid", nidRevealed ? user.nid_number : nidMasked)}
                            >
                              <i className={`fas fa-${copiedField === "nid" ? "check text-success" : "copy"} me-1`}></i>
                              {copiedField === "nid" ? t("employees.copiedLabel") : t("employees.copyLabel")}
                            </button>
                          </div>
                        </div>
                      )}

                      {user.nid_pic ? (
                        <div className="nid-image-card rounded-4 overflow-hidden border shadow-sm position-relative mt-3">
                          <ImageWithFallback
                            src={resolveUploadUrl(user.nid_pic)}
                            className="img-fluid w-100"
                            alt="NID document photo"
                            type="nid"
                          />
                          <div className="overlay-btn-hover d-flex align-items-center justify-content-center">
                            <button
                              className="btn btn-light btn-sm shadow rounded-pill px-3 fw-bold"
                              data-bs-toggle="modal"
                              data-bs-target="#nidModal"
                            >
                              <i className="fas fa-expand-arrows-alt me-2 text-primary"></i>
                              {t("profile.viewLarge")}
                            </button>
                          </div>
                        </div>
                      ) : isProfilePowerUser ? (
                        <div className="text-center py-4 px-3 bg-light rounded-4 border border-dashed mt-3">
                          <i className="fas fa-id-card-alt fa-3x mb-2 text-muted opacity-50"></i>
                          <p className="text-muted small mb-2">{t("profile.nidNotUploaded")}</p>
                          <button
                            className="btn btn-sm btn-primary rounded-pill px-3"
                            onClick={() => navigate(`/edit-employee/${user.id}`, { state: { from: location.pathname } })}
                          >
                            <i className="fas fa-upload me-2"></i>
                            Upload NID
                          </button>
                        </div>
                      ) : (
                        <div className="text-center py-4 px-3 bg-light rounded-4 border border-dashed mt-3">
                          <i className="fas fa-id-card-alt fa-2x mb-2 text-muted opacity-50"></i>
                          <p className="text-muted small mb-0">{t("profile.nidNotUploaded")}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Address Box */}
                  <div className="col-12 col-lg-6">
                    <div className="modern-card p-3 p-sm-4 h-100">
                      <h5 className="section-title mb-4 border-bottom pb-3">
                        <i className="fas fa-map-marked-alt text-primary me-2"></i>
                        {t("profile.addresses")}
                      </h5>

                      <div className="p-3 rounded-4 bg-light mb-3">
                        <div className="d-flex justify-content-between align-items-center mb-1">
                          <span className="text-primary fw-bold small">
                            <i className="fas fa-home me-2"></i>
                            {t("profile.presentAddress")}
                          </span>
                          {user.present_address && (
                            <button
                              type="button"
                              className="btn btn-sm btn-light border rounded-pill px-2"
                              onClick={() => copyText("present", user.present_address)}
                            >
                              <i className={`fas fa-${copiedField === "present" ? "check text-success" : "copy"} me-1`}></i>
                              <small>{copiedField === "present" ? "Copied" : "Copy"}</small>
                            </button>
                          )}
                        </div>
                        <p className="mb-0 text-dark fw-medium fs-6">
                          {user.present_address || t("profile.noInfo")}
                        </p>
                      </div>

                      <div className="p-3 rounded-4 bg-light">
                        <div className="d-flex justify-content-between align-items-center mb-1">
                          <span className="text-primary fw-bold small">
                            <i className="fas fa-building-user me-2"></i>
                            {t("profile.permanentAddress")}
                          </span>
                          {user.permanent_address && (
                            <button
                              type="button"
                              className="btn btn-sm btn-light border rounded-pill px-2"
                              onClick={() => copyText("permanent", user.permanent_address)}
                            >
                              <i className={`fas fa-${copiedField === "permanent" ? "check text-success" : "copy"} me-1`}></i>
                              <small>{copiedField === "permanent" ? "Copied" : "Copy"}</small>
                            </button>
                          )}
                        </div>
                        <p className="mb-0 text-dark fw-medium fs-6">
                          {user.permanent_address || t("profile.noInfo")}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="modern-card text-center py-5 px-3">
                <i className="fas fa-user-lock fa-3x mb-3 text-secondary opacity-50"></i>
                <h5 className="fw-bold text-dark">Confidential Profile Section</h5>
                <p className="text-muted mb-0">You do not have permission to view restricted information for this profile.</p>
              </div>
            )}
          </div>
        )}

        {/* LEAVES TAB */}
        {activeTab === "leaves" && (
          <div className="fade-in">
            <div className="modern-card p-3 p-sm-4">
              <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-3 border-bottom pb-3">
                <div>
                  <h5 className="section-title mb-1">
                    <i className="fas fa-history text-primary me-2"></i>
                    {t("profile.leaveHistory")}
                  </h5>
                  <span className="text-muted small">View all past leave applications and approval statuses</span>
                </div>

                <div className="d-flex flex-wrap gap-2">
                  <select
                    className="form-select form-select-sm border rounded-pill ps-3 pe-4 shadow-sm"
                    style={{ minWidth: "140px" }}
                    value={filters.month}
                    onChange={(e) => setFilters({ ...filters, month: e.target.value })}
                  >
                    <option value="">{t("profile.allMonths")}</option>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {moment(i + 1, "M").format("MMMM")}
                      </option>
                    ))}
                  </select>

                  <select
                    className="form-select form-select-sm border rounded-pill ps-3 pe-4 shadow-sm"
                    style={{ minWidth: "100px" }}
                    value={filters.year}
                    onChange={(e) => setFilters({ ...filters, year: e.target.value })}
                  >
                    {Array.from({ length: 3 }, (_, i) => {
                      const y = new Date().getFullYear() - i;
                      return (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Responsive Leave Table */}
              <div className="table-responsive">
                <table className="table align-middle modern-table mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="ps-3">{t("profile.date")}</th>
                      <th>{t("profile.leaveType")}</th>
                      <th>{t("profile.days")}</th>
                      <th>{t("profile.reason")}</th>
                      <th className="pe-3">{t("profile.leaveStatus")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaves.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="text-center py-5 text-muted">
                          <i className="fas fa-calendar-times fa-2x mb-2 d-block text-secondary opacity-50"></i>
                          {t("profile.noLeaveRecords")}
                        </td>
                      </tr>
                    ) : (
                      leaves.map((leave) => {
                        const s = moment(leave.start_date);
                        const e = moment(leave.end_date);
                        return (
                        <tr key={leave.id}>
                          <td className="ps-3">
                            <div className="fw-bold text-dark">
                              {s.isValid() ? s.format("DD MMM, YYYY") : "—"}
                            </div>
                            <small className="text-muted">
                              to {e.isValid() ? e.format("DD MMM, YYYY") : "—"}
                            </small>
                          </td>
                          <td>
                            <span className="badge bg-light text-dark border px-3 py-2 rounded-pill">
                              <i className="fas fa-tag text-primary me-2"></i>
                              {leave.type_name}
                            </span>
                          </td>
                          <td>
                            <span className="fw-bold text-dark">
                              {getLeaveRowDays(leave)}{" "}
                              {t("profile.day")}
                            </span>
                          </td>
                          <td className="small text-muted" style={{ maxWidth: "220px" }}>
                            {leave.reason || "—"}
                          </td>
                          <td className="pe-3">{getStatusBadge(leave.status)}</td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* HISTORY TAB — who changed what, old -> new */}
        {activeTab === "history" && canViewHistory && (
          <div className="fade-in">
            <div className="modern-card p-3 p-sm-4">
              <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-3 border-bottom pb-3">
                <div>
                  <h5 className="section-title mb-1">
                    <i className="fas fa-history text-primary me-2"></i>
                    Change History
                  </h5>
                  <span className="text-muted small">Who changed this profile, when, and old → new values</span>
                </div>
              </div>
              {historyLoading ? (
                <div className="text-center py-5 text-muted">
                  <div className="spinner-border text-primary" role="status"></div>
                  <p className="mt-2 mb-0">Loading history…</p>
                </div>
              ) : (historyData?.history || []).length === 0 ? (
                <div className="text-center py-5 text-muted">
                  <i className="fas fa-clipboard-list fa-2x mb-2 d-block text-secondary opacity-50"></i>
                  No tracked changes yet. Edits from now on will appear here with old → new values.
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table align-middle modern-table mb-0">
                    <thead className="table-light">
                      <tr>
                        <th className="ps-3">When</th>
                        <th>Changed By</th>
                        <th>Source</th>
                        <th className="pe-3">Changes (old → new)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyData.history.map((h) => (
                        <tr key={h.id}>
                          <td className="ps-3">
                            <div className="fw-bold text-dark small">
                              {moment(h.created_at).format("DD MMM, YYYY hh:mm A")}
                            </div>
                          </td>
                          <td className="small">{h.changed_by_name || `#${h.changed_by || "?"}`}</td>
                          <td>
                            <span className="badge bg-light text-dark border px-2 py-1 rounded-pill small">
                              {h.change_source}
                            </span>
                          </td>
                          <td className="pe-3 small" style={{ maxWidth: "420px" }}>
                            {(h.changes || []).map((c, i) => (
                              <div key={i} className="mb-1">
                                <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1 rounded-pill me-1">
                                  {c.field}
                                </span>
                                <span className="text-danger text-decoration-line-through me-1">
                                  {c.old == null || c.old === "" ? "—" : String(c.old).slice(0, 80)}
                                </span>
                                <i className="fas fa-arrow-right text-muted mx-1"></i>
                                <span className="text-success fw-bold">
                                  {c.new == null || c.new === "" ? "—" : String(c.new).slice(0, 80)}
                                </span>
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SECURITY TAB */}
        {activeTab === "security" && canEditOwnProfile && (
          <div className="fade-in">
            <div className="row justify-content-center">
              <div className="col-12 col-md-8 col-lg-6 col-xl-5">
                <div id="password" className="modern-card p-4">
                  <div className="text-center mb-4">
                    <div className="icon-box bg-primary-subtle text-primary mx-auto mb-2 rounded-circle" style={{ width: 56, height: 56, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <i className="fas fa-lock fs-4"></i>
                    </div>
                    <h5 className="fw-bold text-dark mb-1">Change Account Password</h5>
                    <p className="text-muted small mb-0">Ensure your account uses a strong, safe password</p>
                  </div>

                  {pwError && (
                    <div className="alert alert-danger py-2 px-3 small rounded-3 mb-3 d-flex align-items-center">
                      <i className="fas fa-exclamation-circle me-2 fs-6"></i>
                      <div>{pwError}</div>
                    </div>
                  )}
                  {pwSuccess && (
                    <div className="alert alert-success py-2 px-3 small rounded-3 mb-3 d-flex align-items-center">
                      <i className="fas fa-check-circle me-2 fs-6"></i>
                      <div>{pwSuccess}</div>
                    </div>
                  )}

                  <form onSubmit={handlePasswordChange}>
                    <div className="mb-3">
                      <label className="form-label small fw-bold text-dark">
                        Current Password
                      </label>
                      <div className="position-relative">
                        <input
                          type={pwShow.current ? "text" : "password"}
                          className="form-control pe-5 rounded-3"
                          placeholder="Enter current password"
                          value={pwForm.current}
                          onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
                          required
                        />
                        <button
                          type="button"
                          className="btn btn-sm position-absolute top-50 end-0 translate-middle-y me-2 text-muted border-0 bg-transparent"
                          onClick={() => setPwShow((s) => ({ ...s, current: !s.current }))}
                          title={pwShow.current ? "Hide" : "Show"}
                        >
                          <i className={`fas fa-eye${pwShow.current ? "-slash" : ""}`}></i>
                        </button>
                      </div>
                    </div>

                    <div className="mb-3">
                      <label className="form-label small fw-bold text-dark">
                        New Password
                      </label>
                      <div className="position-relative">
                        <input
                          type={pwShow.newPass ? "text" : "password"}
                          className="form-control pe-5 rounded-3"
                          placeholder="Enter new password (min. 8 characters)"
                          value={pwForm.newPass}
                          onChange={(e) => setPwForm({ ...pwForm, newPass: e.target.value })}
                          required
                          minLength={8}
                        />
                        <button
                          type="button"
                          className="btn btn-sm position-absolute top-50 end-0 translate-middle-y me-2 text-muted border-0 bg-transparent"
                          onClick={() => setPwShow((s) => ({ ...s, newPass: !s.newPass }))}
                          title={pwShow.newPass ? "Hide" : "Show"}
                        >
                          <i className={`fas fa-eye${pwShow.newPass ? "-slash" : ""}`}></i>
                        </button>
                      </div>

                      {pwForm.newPass && (
                        <div className="mt-2">
                          <div className="d-flex gap-1 mb-2" aria-hidden="true">
                            {[0, 1, 2, 3].map((i) => (
                              <div
                                key={i}
                                style={{
                                  height: 4,
                                  flex: 1,
                                  borderRadius: 2,
                                  background: i < pwScore ? pwBarColors[pwScore - 1] : "#e2e8f0",
                                  transition: "background 0.2s",
                                }}
                              />
                            ))}
                          </div>
                          <ul className="list-unstyled small mb-0 text-muted">
                            <li className={pwChecks.len8 ? "text-success fw-medium" : ""}>
                              <i className={`fas fa-${pwChecks.len8 ? "check" : "circle"} me-2`} style={{ fontSize: "0.75rem" }}></i>
                              At least 8 characters
                            </li>
                            <li className={pwChecks.number ? "text-success fw-medium" : ""}>
                              <i className={`fas fa-${pwChecks.number ? "check" : "circle"} me-2`} style={{ fontSize: "0.75rem" }}></i>
                              At least one number (0-9)
                            </li>
                            <li className={pwChecks.mixed ? "text-success fw-medium" : ""}>
                              <i className={`fas fa-${pwChecks.mixed ? "check" : "circle"} me-2`} style={{ fontSize: "0.75rem" }}></i>
                              Upper & lowercase letters (Aa)
                            </li>
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="mb-4">
                      <label className="form-label small fw-bold text-dark">
                        Confirm New Password
                      </label>
                      <div className="position-relative">
                        <input
                          type={pwShow.confirm ? "text" : "password"}
                          className="form-control pe-5 rounded-3"
                          placeholder="Re-enter new password"
                          value={pwForm.confirm}
                          onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
                          required
                        />
                        <button
                          type="button"
                          className="btn btn-sm position-absolute top-50 end-0 translate-middle-y me-2 text-muted border-0 bg-transparent"
                          onClick={() => setPwShow((s) => ({ ...s, confirm: !s.confirm }))}
                          title={pwShow.confirm ? "Hide" : "Show"}
                        >
                          <i className={`fas fa-eye${pwShow.confirm ? "-slash" : ""}`}></i>
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="btn btn-primary w-100 rounded-3 py-3 fw-bold shadow-sm"
                      disabled={pwLoading}
                    >
                      {pwLoading ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                          Updating Password...
                        </>
                      ) : (
                        <>
                          <i className="fas fa-key me-2"></i>Update Password
                        </>
                      )}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* QR Code / ID Modal */}
      <EmployeeQRModal
        show={showQRModal}
        onHide={() => setShowQRModal(false)}
        employee={user}
      />

      {/* Full Size NID Modal */}
      <div className="modal fade" id="nidModal" tabIndex="-1">
        <div className="modal-dialog modal-lg modal-dialog-centered">
          <div className="modal-content border-0 rounded-4 overflow-hidden shadow-lg">
            <div className="modal-header border-0 pb-0 bg-light">
              <h6 className="modal-title fw-bold text-dark">
                <i className="fas fa-id-card text-primary me-2"></i>
                NID Document Preview
              </h6>
              <button type="button" className="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div className="modal-body text-center p-3 p-md-4">
              {user.nid_pic && (
                <img
                  src={resolveUploadUrl(user.nid_pic)}
                  className="img-fluid rounded-3 shadow-sm"
                  style={{ maxHeight: "75vh" }}
                  alt="Full preview of NID document"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Embedded High-Performance Responsive Design CSS */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .profile-page-wrapper {
          max-width: 1320px;
          margin: 0 auto;
        }

        .profile-page-wrapper .profile-breadcrumb-link {
          background: none;
          border: none;
          padding: 6px 12px;
          color: #64748b;
          font-weight: 600;
          font-size: 0.9rem;
          border-radius: 20px;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
        }
        .profile-page-wrapper .profile-breadcrumb-link:hover {
          color: #3b82f6;
          background: #f1f5f9;
        }

        /* Profile Header Card */
        .profile-page-wrapper .profile-header-card {
          position: relative;
          background: #ffffff;
          border-radius: 24px;
          overflow: hidden;
          border: 1px solid #e2e8f0;
        }

        .profile-page-wrapper .profile-banner-bg {
          height: 160px;
          background: linear-gradient(135deg, #1e1b4b 0%, #312e81 35%, #4338ca 70%, #6366f1 100%);
          position: relative;
        }
        .profile-page-wrapper .profile-banner-grid {
          position: absolute;
          inset: 0;
          background-image: radial-gradient(rgba(255, 255, 255, 0.15) 1px, transparent 1px);
          background-size: 18px 18px;
          opacity: 0.6;
        }

        .profile-page-wrapper .profile-info-content {
          margin-top: -62px;
          position: relative;
          z-index: 2;
          padding: 0 18px 18px;
        }

        .profile-page-wrapper .profile-titles {
          flex: 1 1 auto;
          min-width: 0;
        }

        .profile-page-wrapper .profile-actions-wrapper {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          align-items: center;
          gap: 0.75rem;
          margin-left: auto;
        }

        .profile-page-wrapper .profile-actions-wrapper .btn {
          min-width: 155px;
          white-space: nowrap;
          height: 46px;
        }

        .profile-page-wrapper .profile-avatar-wrapper {
          position: relative;
        }
        .profile-page-wrapper .profile-avatar {
          width: 128px;
          height: 128px;
          border-radius: 24px;
          border: 5px solid #ffffff;
          object-fit: cover;
          background: #ffffff;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15) !important;
        }

        .profile-page-wrapper .status-indicator {
          position: absolute;
          bottom: 8px;
          right: 8px;
          width: 18px;
          height: 18px;
          background: #9ca3af;
          border: 3px solid #ffffff;
          border-radius: 50%;
        }
        .profile-page-wrapper .status-indicator.active {
          background: #10b981;
        }
        .profile-page-wrapper .status-indicator.active .pulse-ring {
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          border: 2px solid #10b981;
          animation: pulseRing 2s infinite;
        }
        @keyframes pulseRing {
          0% { transform: scale(0.95); opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }

        .profile-page-wrapper .user-name {
          font-size: clamp(1.75rem, 2.15vw, 2.35rem);
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -0.03em;
          line-height: 1.15;
        }

        .profile-page-wrapper .user-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 0.65rem 0.9rem;
          margin-top: 0.15rem;
        }

        .profile-page-wrapper .meta-pill {
          display: inline-flex;
          align-items: center;
          color: #475569;
          font-weight: 600;
          font-size: 0.88rem;
          background: rgba(248, 250, 252, 0.96);
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.18);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
        }

        .profile-page-wrapper .btn-modern-primary {
          background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
          color: #ffffff;
          border: none;
          padding: 10px 20px;
          border-radius: 12px;
          font-weight: 700;
          font-size: 0.9rem;
          transition: all 0.2s ease;
          box-shadow: 0 10px 20px rgba(79, 70, 229, 0.22);
        }
        .profile-page-wrapper .btn-modern-primary:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(79, 70, 229, 0.35);
          color: #ffffff;
        }

        .profile-page-wrapper .btn-modern-outline {
          background: rgba(255, 255, 255, 0.96);
          color: #1e293b;
          border: 1px solid #dbe2ea;
          padding: 10px 20px;
          border-radius: 12px;
          font-weight: 700;
          font-size: 0.9rem;
          transition: all 0.2s ease;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
        }
        .profile-page-wrapper .btn-modern-outline:hover:not(:disabled) {
          background: #f8fafc;
          border-color: #94a3b8;
          transform: translateY(-2px);
        }

        .profile-page-wrapper .status-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ef4444;
          margin-right: 6px;
        }
        .profile-page-wrapper .status-dot.active {
          background: #10b981;
        }

        /* Nav Tabs Scrollable on Mobile */
        .profile-page-wrapper .profile-tabs-scroll-container {
          overflow-x: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .profile-page-wrapper .profile-tabs-scroll-container::-webkit-scrollbar {
          display: none;
        }

        .profile-page-wrapper .profile-nav-pills {
          min-width: max-content;
        }

        .profile-page-wrapper .profile-tab-link {
          color: #64748b !important;
          font-weight: 600 !important;
          padding: 10px 22px !important;
          border-radius: 12px !important;
          font-size: 0.95rem !important;
          transition: all 0.2s ease !important;
          white-space: nowrap;
        }
        .profile-page-wrapper .profile-tab-link.active {
          background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%) !important;
          color: #ffffff !important;
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25) !important;
        }
        .profile-page-wrapper .profile-tab-link:not(.active):hover {
          background: #f1f5f9 !important;
          color: #3b82f6 !important;
        }

        /* Cards & Tiles */
        .profile-page-wrapper .modern-card {
          background: #ffffff;
          border-radius: 20px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04);
        }

        .profile-page-wrapper .section-title {
          font-weight: 800;
          color: #0f172a;
          font-size: 1.1rem;
        }

        .profile-page-wrapper .stat-card {
          transition: transform 0.2s ease;
        }
        .profile-page-wrapper .stat-card:hover {
          transform: translateY(-3px);
        }

        .profile-page-wrapper .stat-icon-wrapper {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.1rem;
        }

        .profile-page-wrapper .stat-label {
          color: #64748b;
          font-weight: 600;
          font-size: 0.85rem;
          margin-bottom: 2px;
        }
        .profile-page-wrapper .stat-value {
          font-size: 2rem;
          font-weight: 800;
          line-height: 1.1;
        }

        .profile-page-wrapper .icon-box {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .profile-page-wrapper .hover-primary:hover {
          color: #4f46e5 !important;
        }

        /* Color Soft Tokens */
        .profile-page-wrapper .bg-primary-soft { background-color: rgba(79, 70, 229, 0.06); }
        .profile-page-wrapper .bg-success-soft { background-color: rgba(16, 185, 129, 0.08); }
        .profile-page-wrapper .bg-warning-soft { background-color: rgba(245, 158, 11, 0.08); }
        .profile-page-wrapper .bg-danger-soft  { background-color: rgba(239, 68, 68, 0.08); }
        .profile-page-wrapper .bg-amber-soft   { background-color: rgba(245, 158, 11, 0.06); }

        .profile-page-wrapper .text-indigo { color: #4338ca; }
        .profile-page-wrapper .text-amber  { color: #b45309; }

        /* NID Image Hover Button */
        .profile-page-wrapper .nid-image-card .overlay-btn-hover {
          position: absolute;
          inset: 0;
          background: rgba(15, 23, 42, 0.4);
          opacity: 0;
          transition: opacity 0.25s ease;
        }
        .profile-page-wrapper .nid-image-card:hover .overlay-btn-hover,
        .profile-page-wrapper .nid-image-card:focus-within .overlay-btn-hover {
          opacity: 1;
        }

        /* Table Design */
        .profile-page-wrapper .modern-table thead th {
          background-color: #f8fafc;
          color: #64748b;
          font-weight: 700;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid #e2e8f0;
          padding: 12px 16px;
        }
        .profile-page-wrapper .modern-table tbody td {
          padding: 14px 16px;
          border-bottom: 1px solid #f1f5f9;
        }

        /* Header info sits in the white zone, below the banner overlap (desktop) */
        @media (min-width: 768px) {
          .profile-page-wrapper .profile-header-info { padding-top: 56px; }
        }
        @media (min-width: 992px) {
          .profile-page-wrapper .profile-header-info { padding-top: 72px; }
        }

        /* Responsive Breakpoints */
        @media (max-width: 991.98px) {
          .profile-page-wrapper .profile-banner-bg { height: 130px; }
          .profile-page-wrapper .profile-info-content { margin-top: -50px; }
          .profile-page-wrapper .profile-avatar { width: 110px; height: 110px; }
          .profile-page-wrapper .user-name { font-size: 1.5rem; }
        }

        @media (max-width: 767.98px) {
          .profile-page-wrapper .profile-banner-bg { height: 110px; }
          .profile-page-wrapper .profile-info-content { margin-top: -55px; }
          .profile-page-wrapper .profile-avatar { width: 100px; height: 100px; border-width: 4px; }
          .profile-page-wrapper .user-name { font-size: 1.35rem; }
          .profile-page-wrapper .btn-modern-primary, .profile-page-wrapper .btn-modern-outline {
            padding: 8px 14px;
            font-size: 0.85rem;
          }
        }

        @media (max-width: 575.98px) {
          .profile-page-wrapper .profile-header-card { border-radius: 16px; }
          .profile-page-wrapper .modern-card { border-radius: 16px; }
          .profile-page-wrapper .user-name { font-size: 1.25rem; }
          .profile-page-wrapper .stat-value { font-size: 1.6rem; }
          .profile-page-wrapper .profile-tab-link {
            padding: 8px 14px !important;
            font-size: 0.85rem !important;
          }
        }

        /* Animations */
        .profile-page-wrapper .fade-in {
          animation: fadeInUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media print {
          .profile-page-wrapper .profile-banner-bg { display: none; }
          .profile-page-wrapper .profile-actions-wrapper { display: none; }
          .profile-page-wrapper .profile-tabs-scroll-container { display: none; }
        }
      `,
        }}
      />
    </div>
  );
};

export default Profile;
