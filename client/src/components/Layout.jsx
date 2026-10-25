import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import apiClient from '../config/axiosConfig';
import '../styles/AdminDashboard.css';

const getSidebarIdentity = () => {
  const user = localStorage.getItem('user');
  if (!user) return 'default';

  try {
    const parsed = JSON.parse(user);
    const id = parsed?.id ?? 'default';
    const role = (parsed?.role || 'staff').toLowerCase();
    return `${id}:${role}`;
  } catch (error) {
    return 'default';
  }
};

const Layout = () => {
  const [sidebarKey, setSidebarKey] = useState(getSidebarIdentity);

  useEffect(() => {
    const syncSidebarKey = () => {
      const nextKey = getSidebarIdentity();
      setSidebarKey((prev) => (prev === nextKey ? prev : nextKey));
    };

    const handleStorageChange = (e) => {
      if (!e || e.key === 'user' || e.key === 'token') {
        syncSidebarKey();
      }
    };

    syncSidebarKey();
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('auth-change', syncSidebarKey);

    // Fresh permissions on every app load: /api/auth/me is the server source
    // of truth. Without this, a permission granted after login stays invisible
    // until logout-login (pages gate on the cached localStorage user while the
    // sidebar/API use fresh DB permissions).
    let cancelled = false;
    (async () => {
      try {
        const { data } = await apiClient.get('/api/auth/me');
        if (!cancelled && data?.user) {
          try {
            const cached = JSON.parse(localStorage.getItem('user') || '{}');
            localStorage.setItem(
              'user',
              JSON.stringify({ ...cached, ...data.user, permissions: data.user.permissions || cached.permissions })
            );
          } catch { /* ignore cache write errors */ }
          window.dispatchEvent(new Event('auth-change'));
        }
      } catch { /* non-blocking: keep cached session */ }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('auth-change', syncSidebarKey);
    };
  }, []);

  return (
    <div className="admin-wrapper">
      <Sidebar key={sidebarKey} />
      <main id="main-content" className="main-content admin-dashboard-page">
        <Outlet />
      </main>
    </div>
  );
};

export default Layout;