import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const LOGO = 'https://speednetkhulna.com/assets/img/logo-b.png';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err?.response?.data?.message || 'লগইন ব্যর্থ হয়েছে।');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-card">
        <div className="text-center mb-2">
          <img src={LOGO} alt="Speed Net" style={{ height: 50 }} />
        </div>
        <div className="text-center text-muted mb-4" style={{ fontSize: 14 }}>
          পার্টনার পোর্টাল
        </div>

        {error && (
          <div className="alert alert-danger py-2 rounded-3 small text-center border-0">
            <i className="fas fa-exclamation-circle me-1" /> {error}
          </div>
        )}

        <form onSubmit={submit}>
          <div className="mb-3">
            <label className="form-label fw-bold">ইউজারনেম / কন্টাক্ট নাম্বার</label>
            <div className="input-group">
              <span className="input-group-text bg-transparent">
                <i className="fas fa-user" />
              </span>
              <input
                type="text"
                className="form-control"
                placeholder="আপনার আইডি বা নাম্বার লিখুন"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="form-label fw-bold">পাসওয়ার্ড</label>
            <div className="input-group">
              <span className="input-group-text bg-transparent">
                <i className="fas fa-lock" />
              </span>
              <input
                type="password"
                className="form-control"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>
          <button
            type="submit"
            className="btn btn-primary w-100 py-2 fw-bold rounded-3"
            disabled={busy}
          >
            {busy ? (
              <span className="spinner-border spinner-border-sm" />
            ) : (
              <>
                লগইন করুন <i className="fas fa-arrow-right ms-2" />
              </>
            )}
          </button>
        </form>

        <div className="text-center text-muted mt-4" style={{ fontSize: 13 }}>
          সাপোর্টের জন্য যোগাযোগ করুন
        </div>
      </div>
    </div>
  );
}
