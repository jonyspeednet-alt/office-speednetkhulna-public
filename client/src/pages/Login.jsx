import React, { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { loginUser } from "../services/authService";
import BrandLogo from "../components/BrandLogo";
import { t } from "../i18n";
import "../styles/Login.css";

const UserIcon = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
    </svg>
);

const LockIcon = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
    </svg>
);

const Login = () => {
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [rememberMe, setRememberMe] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    // 429 lockout countdown — prevents hammering (which would extend the window)
    const [lockSeconds, setLockSeconds] = useState(0);
    const [, setLockScope] = useState(""); // 'account' | 'ip' | ''
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const ROLES = { ADMIN: "admin", SUPER_ADMIN: "super admin" };
    const PATHS = { ADMIN_DASHBOARD: "/admin-dashboard", DASHBOARD: "/dashboard" };

    useEffect(() => {
        const savedPhone = localStorage.getItem("rememberedPhone");
        if (savedPhone) {
            setPhone(savedPhone);
            setRememberMe(true);
        }
    }, []);

    // Countdown timer for 429 lockout
    const isLockActive = lockSeconds > 0;
    useEffect(() => {
        if (!isLockActive) return;
        const tId = setInterval(() => setLockSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
        return () => clearInterval(tId);
    }, [isLockActive]);

    const fmtLock = (s) => {
        const m = Math.floor(s / 60);
        const r = s % 60;
        return `${m}:${String(r).padStart(2, "0")}`;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (lockSeconds > 0) return; // still locked — don't extend the window
        setError("");
        setLockScope("");
        setLoading(true);

        try {
            const data = await loginUser(phone.trim(), password);
            const user = data.user;

            queryClient.clear();

            if (rememberMe) {
                localStorage.setItem("rememberedPhone", phone);
            } else {
                localStorage.removeItem("rememberedPhone");
            }

            const perms = user?.permissions || {};
            const hasPower =
              user?.is_super_admin ||
              user?.all_access ||
              perms.all_access ||
              perms['system.all_access'] ||
              user?.['system.all_access'];
            const role = user?.role?.toLowerCase() ?? "";
            if (hasPower || role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN) {
                navigate(PATHS.ADMIN_DASHBOARD);
            } else {
                navigate(PATHS.DASHBOARD);
            }
        } catch (err) {
            if (err?.status === 429) {
                const secs =
                    Number(err.retryAfter) > 0 ? Number(err.retryAfter) : 15 * 60;
                setLockSeconds(secs);
                setLockScope(err.scope || "");
                const who =
                    err.scope === "ip"
                        ? "Too many attempts from this network. Others on the same WiFi are also paused — please wait."
                        : "Too many attempts for this phone/email. Other users can still log in.";
                setError(`${err.message || t("login.invalidCreds")} ${who}`);
            } else {
                setError(err.message || t("login.invalidCreds"));
            }
        } finally {
            // Never keep plaintext password in component memory
            setPassword("");
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-centered-container">
                <div className="login-card-wrapper animate-fade-in-up">
                    <div className="login-branding-section">
                        <div className="logo-container">
                            <BrandLogo className="logo" alt="Speed Net Khulna" />
                        </div>
                    </div>
                    
                    <div className="login-form-section">
                        <div className="form-header">
                            <h4 className="fw-bold text-dark">{t("login.welcomeBack")}</h4>
                            <p className="text-muted small">{t("login.subtitle")}</p>
                        </div>

                        {error && (
                            <div className="alert alert-danger py-2 small rounded-3 text-center mb-3">
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit}>
                            <div className="mb-3">
                                <label htmlFor="phone" className="form-label small fw-bold ui-required">
                                    {t("login.phoneLabel")}
                                </label>
                                <div className="input-wrapper">
                                    <UserIcon className="input-icon" />
                                    <input
                                        type="text"
                                        id="phone"
                                        className="form-control with-icon"
                                        placeholder={t("login.phonePlaceholder")}
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="mb-3">
                                <label htmlFor="password" className="form-label small fw-bold ui-required">
                                    {t("login.passwordLabel")}
                                </label>
                                <div className="input-wrapper">
                                    <LockIcon className="input-icon" />
                                    <input
                                        type="password"
                                        id="password"
                                        className="form-control with-icon"
                                        placeholder={t("login.passwordPlaceholder")}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="d-flex justify-content-between align-items-center mb-4">
                                <div className="form-check">
                                    <input
                                        className="form-check-input"
                                        type="checkbox"
                                        id="rememberMe"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                    />
                                    <label className="form-check-label small" htmlFor="rememberMe">
                                        {t("login.rememberMe")}
                                    </label>
                                </div>
                                <Link to="/forgot-password" disabled className="forgot-password-link small">
                                    {t("login.forgotPassword")}
                                </Link>
                            </div>
                            <button
                                type="submit"
                                className="btn btn-primary w-100"
                                disabled={loading || lockSeconds > 0}
                            >
                                {loading
                                    ? t("login.loggingIn")
                                    : lockSeconds > 0
                                      ? `Try again in ${fmtLock(lockSeconds)}`
                                      : t("login.loginNow")}
                            </button>
                        </form>
                        <p className="mt-4 small text-muted text-center">&copy; 2026 Speed Net Khulna</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Login;
