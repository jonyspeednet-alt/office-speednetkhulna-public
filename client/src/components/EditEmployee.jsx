import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { getEmployeeById, updateEmployee, getDepartments, getEmployees, resetEmployeePassword } from '../services/employeeService';
import { getRoles } from '../services/roleService';
import apiClient from '../config/axiosConfig';
import ImageWithFallback from './ImageWithFallback';
import Swal from 'sweetalert2';
import moment from 'moment';
import { normalizeEmployeeForm, buildEmployeeUpdate } from '../utils/employeeForm';
import { BRANCHES } from '../constants/branches';
import '../styles/EditEmployee.css';

const resolveUploadUrl = (pic) => {
    if (!pic || pic === 'default.png') return null;
    if (/^https?:\/\//i.test(pic)) return pic;
    if (String(pic).startsWith('/api/')) return pic;
    const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
    const path = String(pic).startsWith('/') ? pic : `/uploads/${pic}`;
    return `${base}${path}`;
};

const EditEmployee = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const [loading, setLoading] = useState(true);
    const [departments, setDepartments] = useState([]);
    const [allEmployees, setAllEmployees] = useState([]);
    const [formData, setFormData] = useState({});
    const [initialSnapshot, setInitialSnapshot] = useState(null);
    const [saving, setSaving] = useState(false);
    const [resettingPassword, setResettingPassword] = useState(false);
    const [preview, setPreview] = useState(null);
    // Revoke blob: preview URLs on replace/unmount (server URLs must not be revoked).
    useEffect(() => {
        return () => {
            if (preview && String(preview).startsWith('blob:')) {
                try { URL.revokeObjectURL(preview); } catch { /* ignore */ }
            }
        };
    }, [preview]);
    const [activeTab, setActiveTab] = useState('official');
    const [serverUser, setServerUser] = useState(null);
    // Dynamic role list (roles table) — custom roles from Manage Permissions
    // (e.g. "Noc Executive") must also appear here, not just Staff/HR/Admin.
    const [availableRoles, setAvailableRoles] = useState([]);

    // Server is the source of truth for permissions (/api/auth/me). Never gate on raw role strings.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { data } = await apiClient.get('/api/auth/me');
                if (!cancelled && data?.user) {
                    setServerUser(data.user);
                    // Keep the cached session user fresh (permissions originate from server)
                    try {
                        const cached = JSON.parse(localStorage.getItem('user') || '{}');
                        localStorage.setItem('user', JSON.stringify({ ...cached, ...data.user, permissions: data.user.permissions || cached.permissions }));
                    } catch { /* ignore */ }
                }
            } catch { /* non-blocking: fall back to no power */ }
        })();
        return () => { cancelled = true; };
    }, []);

    const serverPerms = serverUser?.permissions || {};
    // Identity (id) is not a permission — cached id is fine as a fallback until /me resolves.
    const currentUserId = Number(serverUser?.id || (() => {
        try { return JSON.parse(localStorage.getItem('user') || '{}')?.id || 0; }
        catch { return 0; }
    })());
    const hasServerPerm = (key) => Boolean(
        serverUser?.all_access || serverPerms.all_access || serverPerms[key] || serverUser?.[key]
    );
    const isPowerUser = hasServerPerm('users.manage') || hasServerPerm('p_manage_users')
        || hasServerPerm('employees.create_edit') || hasServerPerm('p_employee_create_edit')
        || hasServerPerm('users.edit.any') || hasServerPerm('p_edit_any_profile');
    const canManageAccount = hasServerPerm('users.manage') || hasServerPerm('p_manage_users');
    const canAssignAdmin = hasServerPerm('all_access') || hasServerPerm('system.all_access');
    const roleOptions = React.useMemo(() => {
        const isPrivileged = (n) => ['admin', 'super admin', 'superadmin'].includes(String(n || '').trim().toLowerCase());
        const names = availableRoles.length > 0
            ? availableRoles.map((r) => r.name).filter(Boolean)
            : ['Staff', 'HR', 'Admin'];
        ['Staff', 'HR', 'Manager'].forEach((legacy) => {
            if (!names.some((n) => String(n).toLowerCase() === legacy.toLowerCase())) names.push(legacy);
        });
        if (!names.some((n) => String(n).toLowerCase() === 'admin') && canAssignAdmin) names.push('Admin');
        const filtered = names.filter((n) => !isPrivileged(n) || canAssignAdmin);
        // Current value (e.g. legacy custom text) must stay selectable.
        if (formData?.role && !filtered.includes(formData.role)) {
            filtered.push(formData.role);
        }
        return filtered;
    }, [availableRoles, canAssignAdmin, formData?.role]);
    const isOwnProfile = currentUserId ? Number(id) === currentUserId : false;
    // Self (non-power) users only get the Security section
    useEffect(() => {
        if (serverUser && isOwnProfile && !isPowerUser) setActiveTab('security');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serverUser, isOwnProfile, isPowerUser]);
    // Self password via PUT is rejected by the server — always use change-password for own account.
    // Back-এ গেলে employees list আগের জায়গাতেই থাকবে (scroll + filter preserve)
    // Unsaved changes trigger a confirm first (dirty-guard).
    const isDirty = (() => {
        if (!initialSnapshot) return false;
        try {
            const a = { ...formData };
            const b = { ...initialSnapshot };
            delete a.password; delete a.confirm_password;
            delete b.password; delete b.confirm_password;
            return JSON.stringify(a) !== JSON.stringify(b)
                || Boolean(formData.password || formData.confirm_password);
        } catch { return false; }
    })();
    const handleBack = async () => {
        if (isDirty) {
            const res = await Swal.fire({
                title: 'Unsaved Changes',
                text: 'Going back will discard your changes.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Go Back',
                cancelButtonText: 'Stay',
            });
            if (!res.isConfirmed) return;
        }
        try { sessionStorage.setItem('employees-highlight', String(id)); } catch { /* ignore */ }
        const fromPath = location.state?.from;
        const fallback = fromPath || (isPowerUser ? '/employees' : `/profile/${id}`);
        if (window.history.length > 1 && location.key !== 'default') {
            navigate(-1);
            setTimeout(() => {
                try {
                    if (window.location.pathname.includes('/edit-employee/')) {
                        navigate(fallback, { state: { highlightId: String(id) } });
                    }
                } catch { /* ignore */ }
            }, 300);
        } else {
            navigate(fallback, { state: { highlightId: String(id) } });
        }
    };

    useEffect(() => {
        const fetchData = async () => {
            try {
            const [empData, deptData, rolesData] = await Promise.all([
                getEmployeeById(id),
                getDepartments(),
                getRoles().catch(() => [])
            ]);
            
            if (empData.joining_date) {
                empData.joining_date = moment(empData.joining_date).format('YYYY-MM-DD');
            }
            // Prefer the joined role name (role_id source of truth) so a
            // Manage-Permissions assign shows correctly even on diverged rows.
            const normalized = normalizeEmployeeForm(empData);
            setFormData(normalized);
            setInitialSnapshot({ ...normalized });
            setDepartments(Array.isArray(deptData) ? deptData : []);
            if (Array.isArray(rolesData)) setAvailableRoles(rolesData);
            setPreview(resolveUploadUrl(empData.profile_pic));

            try {
                const empList = await getEmployees();
                setAllEmployees(Array.isArray(empList) ? empList : (empList?.rows || []));
            } catch { /* non-blocking */ }
            } catch (error) {
                const unauthorized = Number(error?.response?.status) === 403;
                Swal.fire(
                    unauthorized ? 'Unauthorized' : 'Error',
                    unauthorized ? 'You can only edit your own profile.' : 'Failed to load employee details',
                    unauthorized ? 'warning' : 'error'
                );
                try { sessionStorage.setItem('employees-highlight', String(id)); } catch { /* ignore */ }
                navigate(unauthorized ? `/profile/${id}` : '/employees', { state: { highlightId: String(id) } });
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [id, navigate]);

    const handleInputChange = (e) => {
        setFormData(previous => ({ ...previous, [e.target.name]: e.target.value }));
    };

    const handleResetPassword = async () => {
        const result = await Swal.fire({
            title: 'Reset employee password?',
            text: `This will reset ${formData.full_name}'s password to a temporary one. They will be required to change it after logging in.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Reset Password',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#d33',
        });
        if (!result.isConfirmed) return;

        setResettingPassword(true);
        try {
            const response = await resetEmployeePassword(id);
            const successText = response?.temporaryPassword
                ? `${response.message}\n\nTemporary password: ${response.temporaryPassword}\nCopy it now — it will not be shown again.`
                : response.message;
            await Swal.fire('Password reset', successText, 'success');
        } catch (error) {
            Swal.fire('Error', error.response?.data?.message || 'Failed to reset employee password.', 'error');
        } finally {
            setResettingPassword(false);
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (e.target.name === 'profile_pic') {
            const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
            const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
            const ext = `.${String(file.name || '').split('.').pop().toLowerCase()}`;
            if ((!file.type || !allowedTypes.includes(file.type)) && !allowedExts.includes(ext)) {
                Swal.fire('Error', 'Invalid photo type. Allowed: JPG, PNG, WebP, GIF.', 'error');
                e.target.value = '';
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                Swal.fire('Error', 'Photo must be 5MB or smaller.', 'error');
                e.target.value = '';
                return;
            }
            setPreview((prev) => {
                if (prev && String(prev).startsWith('blob:')) {
                    try { URL.revokeObjectURL(prev); } catch { /* ignore */ }
                }
                return URL.createObjectURL(file);
            });
        }
        setFormData({ ...formData, [e.target.name]: file });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Same mismatch guard as Add (Employees.jsx): password vs confirm_password.
        if ((formData.password || '') !== (formData.confirm_password || '')) {
            Swal.fire('Error', 'Password and confirmation do not match.', 'error');
            return;
        }

        const data = buildEmployeeUpdate(formData, initialSnapshot, {
            canEditProfile: isPowerUser, canManageAccount, isOwnProfile,
        });
        if (data.entries().next().done) {
            Swal.fire('No changes', 'No editable information has changed.', 'info');
            return;
        }

        setSaving(true);
        try {
            await updateEmployee(id, data);
            queryClient.invalidateQueries({ queryKey: ['employees'] });
            queryClient.invalidateQueries({ queryKey: ['employees-stats'] });
            // Keep the cached session user in sync when editing own profile
            if (isOwnProfile) {
                try {
                    const { data: session } = await apiClient.get('/api/auth/me');
                    if (session?.user) localStorage.setItem('user', JSON.stringify(session.user));
                    // Re-mount sidebar so avatar/name/role refresh instantly
                    window.dispatchEvent(new Event('auth-change'));
                } catch { /* ignore */ }
            }
            await Swal.fire({
                title: 'Success!',
                text: 'Profile information updated.',
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });
            try { sessionStorage.setItem('employees-highlight', String(id)); } catch { /* ignore */ }

            // Notify profile view components to refresh
            try {
                window.dispatchEvent(new CustomEvent('profile-updated', { detail: { id } }));
            } catch { /* ignore */ }

            const fromPath = location.state?.from;
            if (fromPath && fromPath.includes('/profile/') && window.history.length > 1 && location.key !== 'default') {
                navigate(-1);
            } else {
                navigate(`/profile/${id}`, { replace: true, state: { highlightId: String(id), updated: true } });
            }
        } catch (error) {
            const resp = error.response?.data || {};
            const msg = resp.field && resp.message
                ? `${resp.field}: ${resp.message}`
                : (resp.message || 'Failed to update profile.');
            Swal.fire('Error', msg, 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return (
        <div className="d-flex justify-content-center align-items-center vh-100 bg-light">
            <div className="spinner-modern"></div>
        </div>
    );

    return (
        <div className="edit-employee-page">
            {/* Hero Header Section */}
            <div className="hero-header fade-in-up">
                <div className="d-flex align-items-center gap-4 flex-wrap flex-md-nowrap">
                    <div className="profile-pic-container">
                        <ImageWithFallback 
                            src={preview} 
                            fallbackName={formData.full_name}
                            className="profile-pic-modern" 
                            alt="Profile"
                        />
                        {isPowerUser && (
                        <label className="upload-overlay" title="Change photo">
                            <i className="fas fa-camera"></i>
                            <input type="file" name="profile_pic" className="d-none" accept=".jpg,.jpeg,.png,.webp,.gif" onChange={handleFileChange} />
                        </label>
                        )}
                    </div>
                    <div>
                        <div className="mb-2">
                            <span className={`badge rounded-pill px-3 py-2 ${formData.status?.toLowerCase() === 'active' ? 'bg-success' : 'bg-danger'}`}>
                                <i className={`fas fa-${formData.status?.toLowerCase() === 'active' ? 'check-circle' : 'times-circle'} me-1`}></i>
                                {formData.status || 'Active'}
                            </span>
                        </div>
                        <h1 className="fw-800 m-0 text-white" style={{ fontSize: '2.5rem', letterSpacing: '-1px' }}>{formData.full_name}</h1>
                        <div className="d-flex gap-3 mt-2 opacity-75">
                            <span><i className="fas fa-briefcase me-1"></i> {formData.designation || 'No designation'}</span>
                            <span><i className="fas fa-sitemap me-1"></i> {formData.department || 'No department'}</span>
                        </div>
                    </div>
                </div>
                <div className="mt-4 mt-lg-0">
                    <button type="button" onClick={handleBack} className="btn-back-premium" style={{ border: 'none', cursor: 'pointer' }}>
                        <i className="fas fa-arrow-left me-2"></i> Go Back
                    </button>
                </div>
            </div>

            <div className="row g-4">
                {/* Navigation Sidebar */}
                <div className="col-lg-3">
                    <div className="nav-pills-premium glass-card-modern fade-in-up" style={{ animationDelay: '0.1s' }}>
                        {(isPowerUser || !isOwnProfile) && (
                            <>
                                <button
                                    type="button"
                                    className={`nav-link-premium ${activeTab === 'official' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('official')}
                                >
                                    <i className="fas fa-building-columns"></i> Official Info
                                </button>
                                <button
                                    type="button"
                                    className={`nav-link-premium ${activeTab === 'personal' ? 'active' : ''}`}
                                    onClick={() => setActiveTab('personal')}
                                >
                                    <i className="fas fa-user-gear"></i> Personal Info
                                </button>
                            </>
                        )}
                        <button
                            type="button"
                            className={`nav-link-premium ${activeTab === 'security' ? 'active' : ''}`}
                            onClick={() => setActiveTab('security')}
                        >
                            <i className="fas fa-shield-halved"></i> Security
                        </button>
                    </div>
                </div>

                {/* Form Section */}
                <div className="col-lg-9">
                    <form onSubmit={handleSubmit} className="fade-in-up" style={{ animationDelay: '0.2s' }}>
                        <div className="glass-card-modern">
                            {(isPowerUser || !isOwnProfile) && activeTab === 'official' && (
                                <div className="tab-pane">
                                    <h4 className="fw-bold mb-4 d-flex align-items-center gap-2">
                                        <div style={{ width: '4px', height: '24px', background: 'var(--emp-primary)', borderRadius: '2px' }}></div>
                                        Edit Official Information
                                    </h4>
                                    <div className="row">
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Employee ID (ID Card Number)</label>
                                            <div className="input-group-premium">
                                                <input type="text" name="employee_id" className="form-control-premium" value={formData.employee_id || ''} onChange={handleInputChange} disabled={!canManageAccount || isOwnProfile} placeholder="e.g. SNKHL-AD-CEO-M-0715-0001" />
                                                <i className="fas fa-id-badge input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Full Name</label>
                                            <div className="input-group-premium">
                                                <input type="text" name="full_name" className="form-control-premium" value={formData.full_name || ''} onChange={handleInputChange} disabled={!isPowerUser} />
                                                <i className="fas fa-user input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Designation</label>
                                            <div className="input-group-premium">
                                                <input type="text" name="designation" className="form-control-premium" value={formData.designation || ''} onChange={handleInputChange} disabled={!isPowerUser} />
                                                <i className="fas fa-id-badge input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Department</label>
                                            <div className="input-group-premium">
                                                <select name="department" className="form-control-premium" value={formData.department || ''} onChange={handleInputChange} disabled={!isPowerUser}>
                                                    <option value="">Select</option>
                                                    {formData.department && !departments.some(d => d.dept_name === formData.department) && <option value={formData.department}>{formData.department}</option>}
                                                    {departments.map(d => <option key={d.id} value={d.dept_name}>{d.dept_name}</option>)}
                                                </select>
                                                <i className="fas fa-sitemap input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Role</label>
                                            <div className="input-group-premium">
                                                <select name="role" className="form-control-premium" value={formData.role || ''} onChange={handleInputChange} disabled={!canManageAccount || isOwnProfile}>
                                                    <option value="">Select role</option>
                                                    {roleOptions.map((rName) => {
                                                        const k = String(rName).trim().toLowerCase();
                                                        const label = k === 'staff' ? 'Staff' : k === 'hr' ? 'HR' : k === 'admin' ? 'Admin' : k === 'manager' ? 'Manager' : rName;
                                                        return <option key={rName} value={rName}>{label}</option>;
                                                    })}
                                                </select>
                                                <i className="fas fa-user-shield input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Status</label>
                                            <div className="input-group-premium">
                                                <select name="status" className="form-control-premium" value={formData.status || 'Active'} onChange={handleInputChange} disabled={!canManageAccount || isOwnProfile}>
                                                    <option value="Active">Active</option>
                                                    <option value="Inactive">Inactive</option>
                                                </select>
                                                <i className="fas fa-circle-check input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Joining Date</label>
                                            <div className="input-group-premium">
                                                <input type="date" name="joining_date" className="form-control-premium" value={formData.joining_date || ''} onChange={handleInputChange} disabled={!isPowerUser} />
                                                <i className="fas fa-calendar-days input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Reporting Manager</label>
                                            <div className="input-group-premium">
                                                <select name="reporting_manager" className="form-control-premium" value={formData.reporting_manager || ''} onChange={handleInputChange} disabled={!isPowerUser}>
                                                    {formData.reporting_manager && <option value={formData.reporting_manager}>{formData.reporting_manager}</option>}
                                                    <option value="">Select</option>
                                                    {allEmployees.filter(e => String(e.status || 'Active').toLowerCase() === 'active' && Number(e.id) !== Number(id)).map(emp => (
                                                        <option key={emp.id} value={emp.full_name}>{emp.full_name} ({emp.designation || '—'})</option>
                                                    ))}
                                                </select>
                                                <i className="fas fa-user-tie input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Work Location</label>
                                            <div className="input-group-premium">
                                                <select name="work_location" className="form-control-premium" value={formData.work_location || ''} onChange={handleInputChange} disabled={!canManageAccount} required>
                                                    <option value="">Select</option>
                                                    {formData.work_location && !BRANCHES.some(({ name }) => name === formData.work_location) && <option value={formData.work_location}>{formData.work_location}</option>}
                                                    {BRANCHES.map(({ name }) => <option key={name} value={name}>{name}</option>)}
                                                </select>
                                                <i className="fas fa-location-dot input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Employment Type</label>
                                            <div className="input-group-premium">
                                                <select name="employment_type" className="form-control-premium" value={formData.employment_type || ''} onChange={handleInputChange} disabled={!isPowerUser}>
                                                    {formData.employment_type && <option value={formData.employment_type}>{formData.employment_type}</option>}
                                                    <option value="">Select</option>
                                                    <option value="পূর্ণকালীন (Full-Time, Permanent)">Full-Time (Permanent)</option>
                                                    <option value="আংশিককালীন (Part-Time)">Part-Time</option>
                                                    <option value="চুক্তিভিত্তিক (Contract)">Contract</option>
                                                    <option value="ইন্টার্ন (Intern)">Intern</option>
                                                </select>
                                                <i className="fas fa-briefcase input-icon-premium"></i>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {(isPowerUser || !isOwnProfile) && activeTab === 'personal' && (
                                <div className="tab-pane">
                                    <h4 className="fw-bold mb-4 d-flex align-items-center gap-2">
                                        <div style={{ width: '4px', height: '24px', background: 'var(--emp-primary)', borderRadius: '2px' }}></div>
                                        Personal & Contact Information
                                    </h4>
                                    <div className="row">
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Email</label>
                                            <div className="input-group-premium">
                                                <input type="email" name="email" className="form-control-premium" value={formData.email || ''} onChange={handleInputChange} disabled={!isPowerUser} />
                                                <i className="fas fa-envelope input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Phone Number</label>
                                            <div className="input-group-premium">
                                                <input type="text" name="phone" className="form-control-premium" value={formData.phone || ''} onChange={handleInputChange} disabled={!isPowerUser} />
                                                <i className="fas fa-phone input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Emergency Phone</label>
                                            <div className="input-group-premium">
                                                <input type="text" name="emergency_phone" className="form-control-premium" value={formData.emergency_phone || ''} onChange={handleInputChange} disabled={!isPowerUser} />
                                                <i className="fas fa-phone-volume input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Blood Group</label>
                                            <div className="input-group-premium">
                                                <select name="blood_group" className="form-control-premium" value={formData.blood_group || ''} onChange={handleInputChange} disabled={!isPowerUser}>
                                                    {formData.blood_group && <option value={formData.blood_group}>{formData.blood_group}</option>}
                                                    <option value="">Select</option>
                                                    {['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                                                </select>
                                                <i className="fas fa-droplet input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Father/Husband Name</label>
                                            <div className="input-group-premium">
                                                <input type="text" name="father_name" className="form-control-premium" value={formData.father_name || ''} onChange={handleInputChange} disabled={!isPowerUser} />
                                                <i className="fas fa-people-roof input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">NID Number</label>
                                            <div className="input-group-premium">
                                                <input type="text" name="nid_number" className="form-control-premium" value={formData.nid_number || ''} onChange={handleInputChange} disabled={!isPowerUser} />
                                                <i className="fas fa-address-card input-icon-premium"></i>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Present Address</label>
                                            <div className="input-group-premium">
                                                <textarea name="present_address" className="form-control-premium" rows="3" style={{ paddingLeft: '16px' }} value={formData.present_address || ''} onChange={handleInputChange} disabled={!isPowerUser}></textarea>
                                            </div>
                                        </div>
                                        <div className="col-md-6">
                                            <label className="form-label-premium">Permanent Address</label>
                                            <div className="input-group-premium">
                                                <textarea name="permanent_address" className="form-control-premium" rows="3" style={{ paddingLeft: '16px' }} value={formData.permanent_address || ''} onChange={handleInputChange} disabled={!isPowerUser}></textarea>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'security' && (
                                <div className="tab-pane">
                                    <h4 className="fw-bold mb-4 d-flex align-items-center gap-2 text-danger">
                                        <div style={{ width: '4px', height: '24px', background: '#ee5d50', borderRadius: '2px' }}></div>
                                        Account Security
                                    </h4>
                                    {isOwnProfile ? (
                                        <>
                                            <div className="row g-3 mb-4">
                                                {[
                                                    { icon: 'fa-briefcase', label: 'Designation', value: formData.designation || 'No designation' },
                                                    { icon: 'fa-sitemap', label: 'Department', value: formData.department || 'No department' },
                                                    { icon: 'fa-envelope', label: 'Email', value: formData.email || '—' },
                                                    { icon: 'fa-phone', label: 'Phone', value: formData.phone || '—' },
                                                ].map((c) => (
                                                    <div className="col-md-6" key={c.label}>
                                                        <div className="bg-light border-0 rounded-4 p-3 d-flex align-items-center gap-3">
                                                            <i className={`fas ${c.icon} text-primary`}></i>
                                                            <div>
                                                                <div className="small text-muted">{c.label}</div>
                                                                <div className="fw-bold text-break">{c.value}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="alert bg-light border-0 rounded-4 p-4 mb-4 d-flex align-items-start gap-3">
                                                <i className="fas fa-shield-check text-primary mt-1" style={{ fontSize: '1.5rem' }}></i>
                                                <div>
                                                    <h6 className="fw-bold m-0 mb-1">You cannot change your own password here</h6>
                                                    <p className="m-0 text-muted small mb-3">For security, use the password section on your profile to change your own password.</p>
                                                    <Link to={`/profile/${id}#password`} className="btn btn-primary btn-sm">
                                                        <i className="fas fa-lock me-2"></i>Go to Change Password
                                                    </Link>
                                                </div>
                                            </div>
                                        </>
                                    ) : canManageAccount ? (
                                        <>
                                            <div className="alert bg-light border-0 rounded-4 p-4 mb-4 d-flex align-items-start gap-3">
                                                <i className="fas fa-shield-check text-primary mt-1" style={{ fontSize: '1.5rem' }}></i>
                                                <div>
                                                    <h6 className="fw-bold m-0 mb-1">Security Advice</h6>
                                                    <p className="m-0 text-muted small">Use a strong password with at least 8 characters.</p>
                                                </div>
                                            </div>
                                            <div className="col-md-12">
                                                <label className="form-label-premium">New Password</label>
                                                <div className="input-group-premium">
                                                    <input
                                                        type="password"
                                                        name="password"
                                                        className="form-control-premium"
                                                        placeholder="Leave empty to keep unchanged..."
                                                        minLength={8}
                                                        onChange={handleInputChange}
                                                    />
                                                    <i className="fas fa-lock-keyhole input-icon-premium"></i>
                                                </div>
                                            </div>
                                            <div className="col-md-12">
                                                <label className="form-label-premium">Confirm Password</label>
                                                <div className="input-group-premium">
                                                    <input
                                                        type="password"
                                                        name="confirm_password"
                                                        className="form-control-premium"
                                                        placeholder="Enter new password again..."
                                                        minLength={8}
                                                        onChange={handleInputChange}
                                                    />
                                                    <i className="fas fa-lock-keyhole input-icon-premium"></i>
                                                </div>
                                            </div>
                                            <div className="alert alert-warning border-0 rounded-4 p-4 mb-4">
                                                <h6 className="fw-bold mb-2">Reset password</h6>
                                                <p className="small mb-3">The employee will be required to change this temporary password after logging in.</p>
                                                <button
                                                    type="button"
                                                    className="btn btn-danger"
                                                    onClick={handleResetPassword}
                                                    disabled={resettingPassword || saving}
                                                >
                                                    {resettingPassword ? (
                                                        <><span className="spinner-border spinner-border-sm me-2" role="status"></span>Resetting...</>
                                                    ) : (
                                                        <><i className="fas fa-key me-2"></i>Reset Password</>
                                                    )}
                                                </button>
                                            </div>
                                        </>
                                    ) : <p className="text-muted">Password resets require user management permission.</p>}
                                </div>
                            )}

                            <div className="mt-5 pt-4 border-top text-end d-flex justify-content-end gap-2">
                                <button type="button" className="btn-cancel-premium" onClick={handleBack} disabled={saving}>
                                    <i className="fas fa-times me-2"></i>Cancel
                                </button>
                                {(isOwnProfile || isPowerUser) && (
                                    <button type="submit" className="btn-save-premium" disabled={saving}>
                                        {saving ? (
                                            <>
                                                <span className="spinner-border spinner-border-sm" role="status"></span>
                                                Saving...
                                            </>
                                        ) : (
                                            <>
                                                <i className="fas fa-cloud-arrow-up"></i> Save Changes
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default EditEmployee;
