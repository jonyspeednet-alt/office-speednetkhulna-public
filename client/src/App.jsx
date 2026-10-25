import React, { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import SessionWarning from "./components/SessionWarning";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import PrivateRoute from "./components/PrivateRoute";
import Layout from "./components/Layout";
import { protectedRouteConfig } from "./routes/routeConfig";
import { canManagePermissions, currentUserFromStorage, isSuperAdminUser } from "./utils/pageAccess";
import { t } from "./i18n";
import { Toaster } from "react-hot-toast";

// Chunk-load retry: after a deploy, an old tab may request a deleted hashed
// chunk (JS/CSS 404) and render a broken page until hard refresh. Retry once,
// then reload once to pick up the fresh shell (guarded to avoid loops).
const lazyWithRetry = (factory) => lazy(async () => {
  try {
    const mod = await factory();
    try { sessionStorage.removeItem("chunk-retry"); } catch (e) {}
    return mod;
  } catch (err) {
    let retried = false;
    try { retried = sessionStorage.getItem("chunk-retry") === "1"; } catch (e) {}
    if (!retried) {
      try { sessionStorage.setItem("chunk-retry", "1"); } catch (e) {}
      window.location.reload();
    }
    throw err;
  }
});

const Login = lazyWithRetry(() => import("./pages/Login"));
const Dashboard = lazyWithRetry(() => import("./pages/Dashboard"));
const AdminDashboard = lazyWithRetry(() => import("./components/AdminDashboard"));
const Employees = lazyWithRetry(() => import("./pages/Employees"));
const MyLeaves = lazyWithRetry(() => import("./pages/MyLeaves"));
const ManageLeaves = lazyWithRetry(() => import("./pages/ManageLeaves"));
const ManageEntitlements = lazyWithRetry(() => import("./pages/ManageEntitlements"));
const ManageMenus = lazyWithRetry(() => import("./pages/ManageMenus"));
const ManagePermissions = lazyWithRetry(() => import("./pages/ManagePermissions"));
const Profile = lazyWithRetry(() => import("./pages/Profile"));
const PhoneDirectory = lazyWithRetry(() => import("./pages/PhoneDirectory"));
const LeaveReport = lazyWithRetry(() => import("./pages/LeaveReport"));
const UserDashboard = lazyWithRetry(() => import("./pages/UserDashboard"));
const ApprovalLetter = lazyWithRetry(() => import("./pages/ApprovalLetter"));
const Logout = lazyWithRetry(() => import("./components/Logout"));
const ApplyLeave = lazyWithRetry(() => import("./components/ApplyLeave"));
const LeaveCalendar = lazyWithRetry(() => import("./components/LeaveCalendar"));
const EditEmployee = lazyWithRetry(() => import("./components/EditEmployee"));
const ResellerStatusNoc = lazyWithRetry(() => import("./pages/ResellerStatusNoc"));
const ResellerList = lazyWithRetry(() => import("./pages/ResellerList"));
const ResellerProfile = lazyWithRetry(() => import("./pages/ResellerProfile"));
const TasksEngineer = lazyWithRetry(() => import("./pages/TasksEngineer"));
const BillingLogs = lazyWithRetry(() => import("./pages/BillingLogs"));
const RequestBw = lazyWithRetry(() => import("./pages/RequestBw"));
const RequestsAdmin = lazyWithRetry(() => import("./pages/RequestsAdmin"));
const MonthlySummary = lazyWithRetry(() => import("./pages/MonthlySummary"));
const Invoice = lazyWithRetry(() => import("./pages/Invoice"));
const ViewStaticInvoice = lazyWithRetry(() => import("./pages/ViewStaticInvoice"));
const AddReseller = lazyWithRetry(() => import("./pages/AddReseller"));
const ForgotPassword = lazyWithRetry(() => import("./pages/ForgotPassword"));
const SystemLogs = lazyWithRetry(() => import("./pages/SystemLogs"));
const OfficeWorkTracker = lazyWithRetry(() => import("./pages/OfficeWorkTracker"));
const RouteVisits = lazyWithRetry(() => import("./pages/RouteVisits"));
const AssetManagementV2 = lazyWithRetry(() => import("./pages/AssetManagementV2"));
const InternetRegistration = lazyWithRetry(() => import("./pages/InternetRegistration"));
const FreeInternetIds = lazyWithRetry(() => import("./pages/FreeInternetIds"));
const SupportTickets = lazyWithRetry(() => import("./pages/SupportTickets"));
const SupportHistory = lazyWithRetry(() => import("./pages/SupportHistory"));
const SupportRouters = lazyWithRetry(() => import("./pages/SupportRouters"));
const SupportVerification = lazyWithRetry(() => import("./pages/SupportVerification"));
const SupportReports = lazyWithRetry(() => import("./pages/SupportReports"));
const TechnicianSupportRegister = lazyWithRetry(() => import("./pages/TechnicianSupportRegister"));
const CreatePO = lazyWithRetry(() => import("./pages/CreatePO"));
const ViewPOs = lazyWithRetry(() => import("./pages/ViewPOs"));
const PartnerReport = lazyWithRetry(() => import("./pages/PartnerReport"));
const EmployeePublicProfile = lazyWithRetry(() => import("./pages/EmployeePublicProfile"));
const AppointmentGenerator = lazyWithRetry(() => import("./pages/AppointmentGenerator"));
const NocGenerator = lazyWithRetry(() => import("./pages/NocGenerator"));
const TerminationGenerator = lazyWithRetry(() => import("./pages/TerminationGenerator"));
const DepartmentChangeGenerator = lazyWithRetry(() => import("./pages/DepartmentChangeGenerator"));
const DeviceHandoverForm = lazyWithRetry(() => import("./pages/DeviceHandoverForm"));
const EmployeeOfTheMonthGenerator = lazyWithRetry(() => import("./pages/EmployeeOfTheMonthGenerator"));
const EmployeeOfTheYearGenerator = lazyWithRetry(() => import("./pages/EmployeeOfTheYearGenerator"));
const EmployeeIssueSuggestionForm = lazyWithRetry(() => import("./pages/EmployeeIssueSuggestionForm"));
const ExperienceCertificateGenerator = lazyWithRetry(() => import("./pages/ExperienceCertificateGenerator"));
const MonthlyAllEmployeeMeetingForm = lazyWithRetry(() => import("./pages/MonthlyAllEmployeeMeetingForm"));
const NoDuesCertificateGenerator = lazyWithRetry(() => import("./pages/NoDuesCertificateGenerator"));
const SalaryIncrementLetterGenerator = lazyWithRetry(() => import("./pages/SalaryIncrementLetterGenerator"));
const PromotionLetterGenerator = lazyWithRetry(() => import("./pages/PromotionLetterGenerator"));
const PerformanceImprovementPlanGenerator = lazyWithRetry(() => import("./pages/PerformanceImprovementPlanGenerator"));
const PunishmentLetterGenerator = lazyWithRetry(() => import("./pages/PunishmentLetterGenerator"));
const PartnerOnboardingForm = lazyWithRetry(() => import("./pages/PartnerOnboardingForm"));
const HrDocumentsLandingPage = lazyWithRetry(() => import("./pages/HrDocumentsLandingPage"));
const ImplementationApprovalForm = lazyWithRetry(() => import("./pages/ImplementationApprovalForm"));

const RouteVisitsRedirect = () => <Navigate to="/sales-marketing" replace />;

const LoadingSpinner = () => (
  <div className="d-flex justify-content-center align-items-center vh-100">
    <div className="spinner-border text-primary" role="status">
      <span className="visually-hidden">{t("app.loading")}</span>
    </div>
  </div>
);

const UnderConstruction = () => (
  <div className="d-flex flex-column justify-content-center align-items-center vh-100">
    <h2 className="text-warning">
      <i className="fas fa-tools me-2"></i>
      {t("app.underConstructionTitle")}
    </h2>
    <p className="text-muted">{t("app.underConstructionText")}</p>
    <a href="/" className="btn btn-primary mt-3">
      {t("app.backToDashboard")}
    </a>
  </div>
);

const routeComponentByKey = {
  Dashboard,
  AdminDashboard,
  Employees,
  EditEmployee,
  MyLeaves,
  ManageLeaves,
  ManageEntitlements,
  ManageMenus,
  ManagePermissions,
  Profile,
  PhoneDirectory,
  LeaveReport,
  UserDashboard,
  ApprovalLetter,
  ApplyLeave,
  LeaveCalendar,
  ResellerStatusNoc,
  ResellerList,
  ResellerProfile,
  TasksEngineer,
  BillingLogs,
  RequestBw,
  RequestsAdmin,
  MonthlySummary,
  Invoice,
  ViewStaticInvoice,
  AddReseller,
  SystemLogs,
  OfficeWorkTracker,
  RouteVisits,
  RouteVisitsRedirect,
  AssetManagementV2,
  InternetRegistration,
  FreeInternetIds,
  SupportTickets,
  SupportHistory,
  SupportRouters,
  SupportVerification,
  SupportReports,
  TechnicianSupportRegister,
  CreatePO,
  ViewPOs,
  PartnerReport,
  AppointmentGenerator,
  NocGenerator,
  TerminationGenerator,
  DepartmentChangeGenerator,
  DeviceHandoverForm,
  EmployeeOfTheMonthGenerator,
  EmployeeOfTheYearGenerator,
  EmployeeIssueSuggestionForm,
  ExperienceCertificateGenerator,
  MonthlyAllEmployeeMeetingForm,
  NoDuesCertificateGenerator,
  SalaryIncrementLetterGenerator,
  PromotionLetterGenerator,
  PerformanceImprovementPlanGenerator,
  PunishmentLetterGenerator,
  PartnerOnboardingForm,
  HrDocumentsLandingPage,
  ImplementationApprovalForm,
  UnderConstruction,
};

function App() {
  // Route-level permission gate (display only; API enforcement is server-side).
  // Pages without r.permission render for any authenticated user.
  const hasRoutePermission = (r) => {
    if (!r.permission) return true;
    const u = currentUserFromStorage();
    if (r.permission === "permissions.manage") {
      return canManagePermissions(u);
    }
    if (isSuperAdminUser(u)) return true;
    const p = u.permissions || {};
    return Boolean(
      u.all_access || p.all_access || p[r.permission] || (r.legacy && p[r.legacy]),
    );
  };
  const RouteDenied = () => (
    <div className="manage-permissions-page">
      <div className="alert alert-danger m-4" role="alert">
        <i className="fas fa-lock me-2" aria-hidden="true" />
        {t("managePermissions.accessDenied")}
      </div>
    </div>
  );
  return (
    <ErrorBoundary>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Suspense fallback={<LoadingSpinner />}>
          <Toaster position="top-right" reverseOrder={false} />
          <SessionWarning />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/logout" element={<Logout />} />
            <Route path="/employee/:employee_id" element={<EmployeePublicProfile />} />
            <Route element={<PrivateRoute />}>
              <Route element={<Layout />}>
                {protectedRouteConfig.map((r) => {
                  const Component = routeComponentByKey[r.key];
                  const element = !Component ? (
                    <UnderConstruction />
                  ) : !hasRoutePermission(r) ? (
                    <RouteDenied />
                  ) : (
                    <Component />
                  );
                  return (
                    <Route
                      key={r.path}
                      path={r.path}
                      element={element}
                    />
                  );
                })}
              </Route>
            </Route>

            <Route
              path="*"
              element={
                <div className="d-flex flex-column justify-content-center align-items-center vh-100">
                  <h1 className="display-1 fw-bold text-primary">404</h1>
                  <p className="lead">{t("app.notFoundTitle")}</p>
                  <a href="/" className="btn btn-primary mt-3">
                    {t("app.goHome")}
                  </a>
                </div>
              }
            />
          </Routes>
        </Suspense>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
