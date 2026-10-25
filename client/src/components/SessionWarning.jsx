import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../config/axiosConfig';

const WARNING_BEFORE_MS = 60 * 60 * 1000; // Show warning 1 hour before expiry
const CHECK_INTERVAL_MS = 60 * 1000;       // Check every 1 minute

const SessionWarning = () => {
  const [showWarning, setShowWarning] = useState(false);
  const [minutesLeft, setMinutesLeft] = useState(0);
  const [renewing, setRenewing] = useState(false);
  const [renewed, setRenewed] = useState(false);

  const checkExpiry = useCallback(() => {
    // Use expiresAt from httpOnly migration (no token in localStorage)
    const expiryMs = Number(localStorage.getItem('expiresAt') || 0);
    if (!expiryMs) return;

    const now = Date.now();
    const msLeft = expiryMs - now;

    if (msLeft <= 0) {
      // Already expired — PrivateRoute will handle redirect
      return;
    }

    if (msLeft <= WARNING_BEFORE_MS) {
      const mins = Math.max(1, Math.ceil(msLeft / 60000));
      setMinutesLeft(mins);
      setShowWarning(true);
    } else {
      setShowWarning(false);
    }
  }, []);

  useEffect(() => {
    checkExpiry();
    const interval = setInterval(checkExpiry, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkExpiry]);

  const handleRenew = async () => {
    setRenewing(true);
    try {
      const response = await apiClient.post('/api/auth/refresh');
      if (response.data?.expiresAt) {
        localStorage.setItem('expiresAt', String(response.data.expiresAt));
      }
      // token is httpOnly cookie — do not store
      try { localStorage.removeItem('token'); } catch {}
      setRenewed(true);
      setShowWarning(false);
      setTimeout(() => setRenewed(false), 3000);
    } catch (err) {
      console.error('Session renewal failed:', err);
      // If renewal fails (401), the axiosConfig interceptor will handle logout
    } finally {
      setRenewing(false);
    }
  };

  const handleLogout = () => {
    try { localStorage.removeItem('token'); } catch {}
    try { sessionStorage.removeItem('token'); } catch {}
    localStorage.removeItem('user');
    localStorage.removeItem('expiresAt');
    window.location.href = '/login';
  };

  if (renewed) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: '1.5rem',
          right: '1.5rem',
          zIndex: 9999,
          background: '#198754',
          color: '#fff',
          borderRadius: '12px',
          padding: '0.75rem 1.25rem',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.9rem',
          fontWeight: 600,
          animation: 'fadeIn 0.3s ease',
        }}
      >
        ✅ Session renewed successfully!
      </div>
    );
  }

  if (!showWarning) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1.5rem',
        right: '1.5rem',
        zIndex: 9999,
        background: '#fff',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        padding: '1.25rem 1.5rem',
        maxWidth: '340px',
        width: '100%',
        borderLeft: '4px solid #fd7e14',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '1rem' }}>
        <span style={{ fontSize: '1.5rem' }}>⏰</span>
        <div>
          <div style={{ fontWeight: 700, color: '#343a40', fontSize: '0.95rem', marginBottom: '0.25rem' }}>
            Session Expiring Soon
          </div>
          <div style={{ color: '#6c757d', fontSize: '0.82rem' }}>
            Your session has about <strong style={{ color: '#fd7e14' }}>{minutesLeft} minutes</strong> left.
            Extend your session, otherwise you will be logged out.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={handleRenew}
          disabled={renewing}
          style={{
            flex: 1,
            background: '#0d6efd',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '0.5rem 0.75rem',
            fontWeight: 600,
            cursor: renewing ? 'not-allowed' : 'pointer',
            fontSize: '0.85rem',
            opacity: renewing ? 0.7 : 1,
          }}
        >
          {renewing ? '⏳ Renewing...' : '🔄 Extend Session'}
        </button>
        <button
          onClick={handleLogout}
          style={{
            flex: 1,
            background: '#f8f9fa',
            color: '#495057',
            border: '1px solid #dee2e6',
            borderRadius: '8px',
            padding: '0.5rem 0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.85rem',
          }}
        >
          Logout
        </button>
      </div>
    </div>
  );
};

export default SessionWarning;
