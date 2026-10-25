import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout, { normalizePartnerType } from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import RequestNew from './pages/RequestNew.jsx';
import RequestEdit from './pages/RequestEdit.jsx';
import History from './pages/History.jsx';
import PaymentHistory from './pages/PaymentHistory.jsx';
import Settings from './pages/Settings.jsx';
import Invoice from './pages/Invoice.jsx';

function Loader() {
  return (
    <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
      <div className="spinner-border text-primary" role="status" />
    </div>
  );
}

function Protected({ children }) {
  const { reseller, loading } = useAuth();
  if (loading) return <Loader />;
  if (!reseller) return <Navigate to="/login" replace />;
  return children;
}

// First-login forced password change: resellers with a generated or legacy
// guessable password must visit Settings before anything else.
function MustChangePassword({ children }) {
  const { reseller, loading } = useAuth();
  if (loading) return <Loader />;
  if (reseller?.must_change_password) return <Navigate to="/settings" replace />;
  return children;
}

function DistributionOnly({ children }) {
  const { reseller } = useAuth();
  if (['channel_partner', 'mac_partner'].includes(normalizePartnerType(reseller?.partner_type))) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  const { reseller, loading } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? <Loader /> : reseller ? <Navigate to="/" replace /> : <Login />}
      />
      {/* Invoice opens in its own tab, full-page (no sidebar) */}
      <Route
        path="/invoice/:id"
        element={
          <Protected>
            <DistributionOnly><Invoice /></DistributionOnly>
          </Protected>
        }
      />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<MustChangePassword><Dashboard /></MustChangePassword>} />
        <Route path="/request/new" element={<MustChangePassword><DistributionOnly><RequestNew /></DistributionOnly></MustChangePassword>} />
        <Route path="/request/edit/:id" element={<MustChangePassword><DistributionOnly><RequestEdit /></DistributionOnly></MustChangePassword>} />
        <Route path="/history" element={<MustChangePassword><DistributionOnly><History /></DistributionOnly></MustChangePassword>} />
        <Route path="/payments" element={<MustChangePassword><PaymentHistory /></MustChangePassword>} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
