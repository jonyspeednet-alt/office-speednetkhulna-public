import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'react-qr-code';

const EmployeePublicProfile = () => {
  const { employee_id } = useParams();
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!employee_id) return;
    setLoading(true);
    fetch(`/api/public/employees/${encodeURIComponent(employee_id)}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'not_found' : 'server_error');
        return res.json();
      })
      .then((data) => { setEmployee(data); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [employee_id]);

  const isActive = String(employee?.status || 'Active').toLowerCase() === 'active';
  const photoSrc = employee?.profile_pic && employee.profile_pic !== 'default.png'
    ? `/uploads/${employee.profile_pic}`
    : null;
  const initial = (employee?.full_name || 'E').charAt(0).toUpperCase();
  const profileUrl = window.location.href;

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
            <div className="spinner-border text-primary" role="status" style={{ width: 44, height: 44, borderWidth: '3px' }}></div>
            <p style={{ marginTop: 18, fontSize: 15, fontWeight: 600 }}>Verifying employee identity...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error === 'not_found') {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', padding: '50px 24px' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🔍</div>
            <h2 style={{ color: '#0f172a', marginBottom: 8, fontWeight: 800, fontSize: '1.5rem' }}>Employee Not Found</h2>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.5 }}>
              No active employee record found with ID: <br /><strong style={{ color: '#1e293b' }}>{employee_id}</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ textAlign: 'center', padding: '50px 24px' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ color: '#0f172a', marginBottom: 8, fontWeight: 800, fontSize: '1.5rem' }}>Verification Error</h2>
            <p style={{ color: '#64748b', fontSize: 14 }}>Unable to connect to verification server. Please try again later.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Main Verification Card */}
      <div style={styles.card}>
        {/* Header Banner */}
        <div style={styles.header}>
          <div style={styles.headerLogo}>
            <i className="fas fa-network-wired" style={{ fontSize: 20, marginRight: 8 }}></i>
            Speednet Khulna
          </div>
          <div style={styles.headerSub}>Official Staff Verification Portal</div>
        </div>

        {/* Body Content */}
        <div style={styles.body}>
          {/* Status Badge Banner */}
          <div style={{
            ...styles.statusBanner,
            background: isActive ? '#ecfdf5' : '#fef2f2',
            borderColor: isActive ? '#a7f3d0' : '#fecaca',
          }}>
            <span style={{
              width: 9, height: 9, borderRadius: '50%',
              background: isActive ? '#10b981' : '#ef4444',
              display: 'inline-block', marginRight: 8,
              boxShadow: isActive ? '0 0 8px rgba(16, 185, 129, 0.6)' : 'none',
            }}></span>
            <span style={{
              fontWeight: 700, fontSize: 13.5,
              color: isActive ? '#047857' : '#b91c1c',
            }}>
              {isActive ? '✓ Verified Active Staff Member' : '✗ Inactive / Suspended Status'}
            </span>
          </div>

          {/* Avatar / Photo */}
          <div style={styles.photoWrap}>
            {photoSrc ? (
              <img
                src={photoSrc}
                alt={employee.full_name}
                style={styles.photo}
                loading="lazy"
                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
              />
            ) : null}
            <div style={{ ...styles.photoInitial, display: photoSrc ? 'none' : 'flex' }}>
              {initial}
            </div>
          </div>

          {/* Name & Role */}
          <h1 style={styles.name}>{employee.full_name}</h1>
          <div style={styles.designation}>{employee.designation || 'Staff Member'}</div>
          <div style={styles.department}>{employee.department || 'General Operations'}</div>

          {/* Employee ID Badge */}
          <div style={styles.idBadge}>
            <i className="fas fa-id-badge" style={{ marginRight: 6, fontSize: 13 }}></i>
            ID: {employee.employee_id}
          </div>

          {/* Info Details Grid */}
          <div style={styles.infoGrid}>
            <div style={styles.infoItem}>
              <div style={styles.infoLabel}>Father / Guardian</div>
              <div style={styles.infoValue}>{employee.father_name || '—'}</div>
            </div>
            <div style={styles.infoDivider}></div>
            <div style={styles.infoItem}>
              <div style={styles.infoLabel}>Blood Group</div>
              <div style={{ ...styles.infoValue, color: '#ef4444' }}>{employee.blood_group || '—'}</div>
            </div>
            <div style={styles.infoDivider}></div>
            <div style={styles.infoItem}>
              <div style={styles.infoLabel}>Joining Date</div>
              <div style={styles.infoValue}>
                {employee.joining_date
                  ? new Date(employee.joining_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                  : '—'}
              </div>
            </div>
          </div>

          {/* QR Code Section */}
          {isActive && (
            <div style={styles.qrSection}>
              <div style={styles.qrLabel}>Scan QR code to verify authenticity</div>
              <div style={styles.qrBox}>
                <QRCode value={profileUrl} size={110} level="M" />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>
            🛡️ Official Digital Identity Pass • Speednet Khulna
          </div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 3 }}>
            office.speednetkhulna.com
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f0f4ff 0%, #e0e7ff 50%, #eff6ff 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: 440,
    background: '#ffffff',
    borderRadius: 24,
    overflow: 'hidden',
    boxShadow: '0 20px 45px -10px rgba(30, 41, 59, 0.15), 0 0 1px 1px rgba(0, 0, 0, 0.05)',
  },
  header: {
    background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #4338ca 100%)',
    padding: '26px 24px 20px',
    textAlign: 'center',
    color: '#ffffff',
  },
  headerLogo: {
    fontSize: 19,
    fontWeight: 800,
    letterSpacing: '0.6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSub: {
    fontSize: 11,
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    opacity: 0.8,
    marginTop: 6,
    fontWeight: 600,
  },
  body: {
    padding: '26px 24px',
    textAlign: 'center',
  },
  statusBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    border: '1px solid',
    padding: '11px 16px',
    marginBottom: 22,
  },
  photoWrap: {
    width: 110,
    height: 110,
    borderRadius: '50%',
    overflow: 'hidden',
    margin: '0 auto 16px',
    border: '4px solid #ffffff',
    background: '#e0e7ff',
    boxShadow: '0 8px 20px rgba(67, 56, 202, 0.2)',
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  photoInitial: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 40,
    fontWeight: 800,
    color: '#4338ca',
    background: '#e0e7ff',
  },
  name: {
    fontSize: '1.45rem',
    fontWeight: 800,
    color: '#0f172a',
    marginBottom: 4,
    letterSpacing: '-0.01em',
  },
  designation: {
    fontSize: '0.8rem',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.9px',
    fontWeight: 700,
    marginBottom: 3,
  },
  department: {
    fontSize: '0.92rem',
    color: '#334155',
    fontWeight: 600,
    marginBottom: 16,
  },
  idBadge: {
    display: 'inline-block',
    background: 'rgba(79, 70, 229, 0.08)',
    color: '#4338ca',
    border: '1px solid rgba(79, 70, 229, 0.2)',
    borderRadius: 20,
    padding: '6px 18px',
    fontSize: '0.85rem',
    fontWeight: 700,
    marginBottom: 22,
  },
  infoGrid: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'stretch',
    gap: 0,
    background: '#f8fafc',
    borderRadius: 16,
    border: '1px solid #e2e8f0',
    marginBottom: 22,
    padding: '14px 8px',
  },
  infoItem: {
    flex: 1,
    textAlign: 'center',
  },
  infoDivider: {
    width: 1,
    background: '#cbd5e1',
    margin: '4px 0',
  },
  infoLabel: {
    fontSize: '0.68rem',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    color: '#64748b',
    fontWeight: 700,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: '0.88rem',
    fontWeight: 700,
    color: '#1e293b',
  },
  qrSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    background: '#faf5ff',
    padding: '16px',
    borderRadius: 16,
    border: '1px dashed #d8b4fe',
  },
  qrLabel: {
    fontSize: '0.72rem',
    color: '#7e22ce',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    fontWeight: 700,
  },
  qrBox: {
    padding: 10,
    background: '#ffffff',
    border: '1px solid #e9d5ff',
    borderRadius: 12,
    boxShadow: '0 4px 12px rgba(126, 34, 206, 0.08)',
  },
  footer: {
    background: '#f8fafc',
    borderTop: '1px solid #e2e8f0',
    padding: '14px 16px',
    textAlign: 'center',
  },
};

export default EmployeePublicProfile;
