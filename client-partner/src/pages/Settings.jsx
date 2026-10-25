import { useState } from 'react';
import api, { resolveImage } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Settings() {
  const { reseller, setReseller } = useAuth();
  const [file, setFile] = useState(null);
  const [imgAlert, setImgAlert] = useState(null);
  const [imgBusy, setImgBusy] = useState(false);

  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [pwAlert, setPwAlert] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);

  const uploadImage = async (e) => {
    e.preventDefault();
    setImgAlert(null);
    if (!file) return;
    if (file.size > 5_000_000) {
      setImgAlert({ type: 'warning', msg: 'ফাইলের আকার ৫ মেগাবাইটের বেশি হতে পারবে না।' });
      return;
    }
    setImgBusy(true);
    try {
      const fd = new FormData();
      fd.append('profile_image', file);
      const { data } = await api.post('/settings/profile-image', fd);
      setReseller((r) => ({ ...r, profile_image: data.profile_image }));
      setFile(null);
      setImgAlert({ type: 'success', msg: data.message });
    } catch (err) {
      setImgAlert({ type: 'danger', msg: err?.response?.data?.message || 'আপলোড ব্যর্থ হয়েছে।' });
    } finally {
      setImgBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwAlert(null);
    if (pw.new_password !== pw.confirm_password) {
      setPwAlert({ type: 'danger', msg: 'নতুন পাসওয়ার্ড এবং কনফার্ম পাসওয়ার্ড মিলছে না।' });
      return;
    }
    if (pw.new_password.length < 8) {
      setPwAlert({ type: 'warning', msg: 'পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে।' });
      return;
    }
    setPwBusy(true);
    try {
      const { data } = await api.post('/settings/password', pw);
      setPw({ current_password: '', new_password: '', confirm_password: '' });
      // Forced-change fulfilled — unlock the rest of the portal.
      setReseller((r) => (r ? { ...r, must_change_password: false } : r));
      setPwAlert({ type: 'success', msg: data.message });
    } catch (err) {
      setPwAlert({ type: 'danger', msg: err?.response?.data?.message || 'পরিবর্তন ব্যর্থ হয়েছে।' });
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <>
      <div className="mb-4">
        <h4 className="fw-bold m-0">প্রোফাইল সেটিংস</h4>
        <p className="text-muted small m-0 mt-1">আপনার অ্যাকাউন্টের নিরাপত্তা ও পাসওয়ার্ড পরিবর্তন করুন</p>
      </div>

      {reseller?.must_change_password && (
        <div className="alert alert-warning shadow-sm fw-bold">
          নিরাপত্তার জন্য প্রথম লগইনে পাসওয়ার্ড বদলানো বাধ্যতামূলক — নিচে নতুন পাসওয়ার্ড (অন্তত ৮ অক্ষর) দিন।
        </div>
      )}

      <div className="row">
        <div className="col-lg-6">
          <div className="card-custom mb-4">
            <h5 className="fw-bold mb-4"><i className="fas fa-camera me-2 text-primary" />প্রোফাইল ছবি</h5>
            {imgAlert && <div className={`alert alert-${imgAlert.type} shadow-sm`}>{imgAlert.msg}</div>}
            <form onSubmit={uploadImage}>
              <div className="d-flex align-items-center gap-3 mb-3">
                <img
                  src={resolveImage(reseller?.profile_image, reseller?.reseller_name)}
                  className="rounded-circle shadow-sm"
                  width="80"
                  height="80"
                  style={{ objectFit: 'cover', border: '3px solid var(--light-bg)' }}
                  alt=""
                />
                <div className="flex-grow-1">
                  <input
                    type="file"
                    className="form-control form-control-sm"
                    accept="image/*"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    required
                  />
                  <small className="text-muted d-block mt-1" style={{ fontSize: 11 }}>Max 5MB (JPG, PNG, WebP)</small>
                </div>
              </div>
              <div className="text-end">
                <button type="submit" className="btn btn-sm btn-primary rounded-pill px-4 fw-bold" disabled={imgBusy}>
                  {imgBusy ? <span className="spinner-border spinner-border-sm" /> : 'আপলোড করুন'}
                </button>
              </div>
            </form>
          </div>

          <div className="card-custom">
            <h5 className="fw-bold mb-4"><i className="fas fa-lock me-2 text-primary" />পাসওয়ার্ড পরিবর্তন</h5>
            {pwAlert && <div className={`alert alert-${pwAlert.type} shadow-sm`}>{pwAlert.msg}</div>}
            <form onSubmit={changePassword}>
              <div className="mb-3">
                <label className="form-label fw-bold">বর্তমান পাসওয়ার্ড</label>
                <input type="password" className="form-control" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required />
              </div>
              <div className="mb-3">
                <label className="form-label fw-bold">নতুন পাসওয়ার্ড</label>
                <input type="password" className="form-control" minLength="8" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required />
              </div>
              <div className="mb-4">
                <label className="form-label fw-bold">নতুন পাসওয়ার্ড নিশ্চিত করুন</label>
                <input type="password" className="form-control" minLength="8" value={pw.confirm_password} onChange={(e) => setPw({ ...pw, confirm_password: e.target.value })} required />
              </div>
              <button type="submit" className="btn btn-primary w-100 py-2 rounded-pill fw-bold" disabled={pwBusy}>
                {pwBusy ? <span className="spinner-border spinner-border-sm" /> : 'পরিবর্তন নিশ্চিত করুন'}
              </button>
            </form>
          </div>
        </div>

        <div className="col-lg-6 mt-4 mt-lg-0">
          <div className="card-custom bg-primary text-white h-100 d-flex flex-column justify-content-center text-center p-5">
            <div className="mb-4"><i className="fas fa-shield-alt fa-4x opacity-50" /></div>
            <h4 className="fw-bold">নিরাপত্তা টিপস</h4>
            <p className="opacity-75">
              আপনার অ্যাকাউন্টের নিরাপত্তার জন্য নিয়মিত পাসওয়ার্ড পরিবর্তন করুন। সহজ অনুমানযোগ্য পাসওয়ার্ড ব্যবহার থেকে বিরত থাকুন।
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
