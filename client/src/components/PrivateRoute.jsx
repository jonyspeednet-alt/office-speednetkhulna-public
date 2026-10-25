import React from "react";
import { Navigate, useLocation, Outlet } from "react-router-dom";

/**
 * Private Route Wrapper — cookie-only auth (httpOnly)
 * No token in localStorage; check user + expiresAt.
 * Real auth is validated server-side on every /api call (401 -> redirect).
 */
const PrivateRoute = () => {
  const location = useLocation();

  // Migration: clear legacy token if present (XSS mitigation)
  try {
    if (localStorage.getItem("token")) localStorage.removeItem("token");
    if (sessionStorage.getItem("token")) sessionStorage.removeItem("token");
  } catch {}

  const userString = localStorage.getItem("user");
  const expiresAt = localStorage.getItem("expiresAt");

  // If no user data, redirect to login (cookie check happens server-side)
  if (!userString) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Optional client-side expiry check using stored expiresAt (no token needed)
  // If expired, clear and redirect — server will also return 401.
  if (expiresAt) {
    const exp = Number(expiresAt);
    if (exp && Date.now() > exp - 30 * 1000) {
      localStorage.removeItem("user");
      localStorage.removeItem("expiresAt");
      try { localStorage.removeItem("token"); } catch {}
      return <Navigate to="/login" state={{ from: location }} replace />;
    }
  }

  return <Outlet />;
};

export default PrivateRoute;
