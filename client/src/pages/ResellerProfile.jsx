import React, { useCallback, useState, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";

// Custom hooks
import { useResellerProfile } from "../hooks/useResellerProfile";
import { useChannelPartner } from "../hooks/useChannelPartner";

// Core components
import ProfileHeader from "../components/ResellerProfile/ProfileHeader";
import ProfileStats from "../components/ResellerProfile/ProfileStats";
import ProfileDetails from "../components/ResellerProfile/ProfileDetails";

// Tab components
import BandwidthTab from "../components/ResellerProfile/Tabs/BandwidthTab";
import StatementTab from "../components/ResellerProfile/Tabs/StatementTab";
import LifetimeReportTab from "../components/ResellerProfile/Tabs/LifetimeReportTab";
import OnboardingTab from "../components/ResellerProfile/Tabs/OnboardingTab";

// Channel Partner components
import UsersTab from "../components/ResellerProfile/ChannelPartner/UsersTab";
import CollectionTab from "../components/ResellerProfile/ChannelPartner/CollectionTab";
import CommissionTab from "../components/ResellerProfile/ChannelPartner/CommissionTab";
import CPStatementTab from "../components/ResellerProfile/ChannelPartner/CPStatementTab";
import ProductsTab from "../components/ResellerProfile/ChannelPartner/ProductsTab";
import RealIPTab from "../components/ResellerProfile/ChannelPartner/RealIPTab";

// Modal components
import PaymentModal from "../components/ResellerProfile/Modals/PaymentModal";
import DiscountModal from "../components/ResellerProfile/Modals/DiscountModal";
import ProductChargeModal from "../components/ResellerProfile/Modals/ProductChargeModal";
import EditProfileModal from "../components/ResellerProfile/Modals/EditProfileModal";
import RateChangeModal from "../components/ResellerProfile/Modals/RateChangeModal";
import BillHistoryModal from "../components/ResellerProfile/Modals/BillHistoryModal";
import AddUserModal from "../components/ResellerProfile/Modals/AddUserModal";
import EditUserModal from "../components/ResellerProfile/Modals/EditUserModal";
import CommissionPaymentModal from "../components/ResellerProfile/Modals/CommissionPaymentModal";
import AdjustmentModal from "../components/ResellerProfile/Modals/AdjustmentModal";
import ImportModal from "../components/ResellerProfile/Modals/ImportModal";
import UserProductsModal from "../components/ResellerProfile/Modals/UserProductsModal";
import ConfirmDialog from "../components/ResellerProfile/ConfirmDialog";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
);

const ResellerProfile = () => {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const profileId = id || searchParams.get("id");

  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'profile');
  const switchTab = useCallback((tab) => { setActiveTab(tab); setSearchParams({ tab }, { replace: true }); }, [setSearchParams]);

  // Use custom hooks
  const {
    data,
    loadError,
    saving,
    load,
    showPay,
    setShowPay,
    showDiscount,
    setShowDiscount,
    showEdit,
    setShowEdit,
    showBillHistory,
    setShowBillHistory,
    showRateChange,
    setShowRateChange,
    paymentSaving,
    discountSaving,
    productChargeSaving,
    paymentAmount,
    setPaymentAmount,
    paymentDate,
    setPaymentDate,
    paymentMethod,
    setPaymentMethod,
    paymentNote,
    setPaymentNote,
    submitPayment,
    discountAmount,
    setDiscountAmount,
    discountDate,
    setDiscountDate,
    discountNote,
    setDiscountNote,
    submitDiscount,
    showProductCharge,
    setShowProductCharge,
    productChargeAmount,
    setProductChargeAmount,
    productChargeDate,
    setProductChargeDate,
    productChargeNote,
    setProductChargeNote,
    submitProductCharge,
    editForm,
    setEditForm,
    saveProfile,
    rateChangeForm,
    setRateChangeForm,
    rateChangeSaving,
    rateChangeLogs,
    openRateChangeModal,
    submitRateChange,
  } = useResellerProfile(profileId);

  const isChannel = data?.reseller?.partner_type === "channel_partner";

  const {
    cpUsers,
    cpMonth,
    setCpMonth,
    cpUserPayments,
    cpCommission,
    cpHistory,
    cpStatement,
    cpLoading,
    cpUserSearch,
    setCpUserSearch,
    showAddUser,
    setShowAddUser,
    showEditUser,
    setShowEditUser,
    showCommissionPay,
    setShowCommissionPay,
    showAdjust,
    setShowAdjust,
    showImport,
    setShowImport,
    newUser,
    setNewUser,
    commPayForm,
    setCommPayForm,
    adjForm,
    setAdjForm,
    importing,
    importFile,
    setImportFile,
    importMonth,
    setImportMonth,
    handleAddUser,
    handleEditUser,
    handleDeleteUser,
    handleInitPayments,
    handleRecordPayment,
    handleBulkFullPaid,
    handleGenerateCommission,
    handleCommissionPayment,
    handleAdjustment,
    handleFinalize,
    handleUnfinalize,
    handleImport,
    handleDownloadReport,
    maximSyncing,
    maximStatus,
    maximPrefillRows,
    maximPrefillLoading,
    maximHealth,
    maximHealthLoading,
    loadMaximPrefill,
    handleMaximSync,
    handleSaveMaximSuffix,
    openCommissionPayment,
    cpProductSummary,
    cpProductCatalog,
    showUserProducts,
    userProductsUsage,
    userProductsLoading,
    savingUserProducts,
    importingCatalog,
    lastImportResult,
    setLastImportResult,
    handleImportCatalog,
    handleEditUserProducts,
    handleSaveUserProducts,
    closeUserProductsModal,
    showManualProductCharge,
    setShowManualProductCharge,
    manualProductChargeForm,
    setManualProductChargeForm,
    manualProductChargeLoading,
    handleSaveManualProductCharge,
    confirmAction,
    setConfirmAction,
    executeConfirm,
  } = useChannelPartner(profileId, isChannel, load);

  // Auto-switch tab based on partner type
  useEffect(() => {
    if (!data) return;
    const type = data.reseller?.partner_type;
    const cpOnlyTabs = ["cp_profile", "cp_realip", "cp_users", "cp_collection", "cp_products", "cp_commission", "cp_statement"];
    if (type === "channel_partner" && (activeTab === "bandwidth" || activeTab === "profile")) {
      switchTab("cp_profile");
    } else if (type !== "channel_partner" && cpOnlyTabs.includes(activeTab)) {
      // Non-channel partner landed on a CP-only tab (e.g. from a copied URL) — redirect to profile
      switchTab("profile");
    }
  }, [data, activeTab, switchTab]);

  if (loadError) {
    return (
      <div className="container-fluid py-4 reseller-page">
        <div className="alert alert-danger border-0 shadow-sm">{loadError}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="container-fluid py-4 reseller-page rp-loading-page">
        <div className="spinner-border text-primary" role="status" aria-hidden="true" />
        <span>Loading profile...</span>
      </div>
    );
  }

  const can = data?.permissions || {};
  const reseller = data?.reseller || {};
  const partners = data?.partners || [];
  const stats = data?.stats || {};
  const statementItems = data?.statement_items || [];
  const billHistory = data?.bill_history || [];

  return (
    <div className="container-fluid py-3 reseller-page">
      {!isChannel && stats.pending_bill_warning && (
        <div className="alert alert-warning border-0 shadow-sm mb-3">
          <i className="fas fa-exclamation-triangle text-warning me-2" />
          {stats.pending_bill_warning}
        </div>
      )}

      <ProfileHeader
        reseller={reseller}
        can={can}
        isChannel={isChannel}
        onPaymentClick={() => setShowPay(true)}
        onDiscountClick={() => setShowDiscount(true)}
        onProductChargeClick={() => setShowProductCharge(true)}
        onCommissionPayClick={() => openCommissionPayment()}
      />

      <ProfileStats
        isChannel={isChannel}
        can={can}
        stats={stats}
        reseller={reseller}
        cpCommission={cpCommission}
        cpLoading={cpLoading}
        onBillHistoryClick={() => setShowBillHistory(true)}
      />

      <div className="card rp-tabs-card">
            <div className="card-header border-0 bg-transparent p-2 p-sm-3">
              <div className="d-flex flex-column flex-sm-row align-items-stretch align-items-sm-center gap-2">
                <ul className="nav nav-pills rp-tabs-scroll flex-nowrap mb-0">
                {reseller.partner_type !== "channel_partner" && (
                  <>
                    <li className="nav-item">
                      <button
                        className={`nav-link btn-sm py-1 px-3 ${activeTab === "profile" ? "active" : ""}`}
                        onClick={() => switchTab("profile")}
                      >
                        Profile
                      </button>
                    </li>
                    <li className="nav-item">
                      <button
                        className={`nav-link btn-sm py-1 px-3 ${activeTab === "bandwidth" ? "active" : ""}`}
                        onClick={() => switchTab("bandwidth")}
                      >
                        Bandwidth
                      </button>
                    </li>
                  </>
                )}
                {isChannel && (
                  <li className="nav-item">
                    <button
                      className={`nav-link btn-sm py-1 px-3 ${activeTab === "cp_profile" ? "active" : ""}`}
                      onClick={() => switchTab("cp_profile")}
                    >
                      Profile
                    </button>
                  </li>
                )}
                {isChannel && (
                  <li className="nav-item">
                    <button
                      className={`nav-link btn-sm py-1 px-3 ${activeTab === "cp_realip" ? "active" : ""}`}
                      onClick={() => switchTab("cp_realip")}
                    >
                      Real IP
                    </button>
                  </li>
                )}
                {isChannel && (
                  <li className="nav-item">
                    <button
                      className={`nav-link btn-sm py-1 px-3 ${activeTab === "cp_users" ? "active" : ""}`}
                      onClick={() => switchTab("cp_users")}
                    >
                      Users
                    </button>
                  </li>
                )}
                {isChannel && can.can_view_financials && (
                  <li className="nav-item">
                    <button
                      className={`nav-link btn-sm py-1 px-3 ${activeTab === "cp_collection" ? "active" : ""}`}
                      onClick={() => switchTab("cp_collection")}
                    >
                      Collection
                    </button>
                  </li>
                )}
                {isChannel && can.can_view_financials && (
                  <li className="nav-item">
                    <button
                      className={`nav-link btn-sm py-1 px-3 ${activeTab === "cp_products" ? "active" : ""}`}
                      onClick={() => switchTab("cp_products")}
                    >
                      Products
                    </button>
                  </li>
                )}
                {isChannel && can.can_view_financials && (
                  <li className="nav-item">
                    <button
                      className={`nav-link btn-sm py-1 px-3 ${activeTab === "cp_commission" ? "active" : ""}`}
                      onClick={() => switchTab("cp_commission")}
                    >
                      Commission
                    </button>
                  </li>
                )}
                {isChannel && can.can_view_financials && (
                  <li className="nav-item">
                    <button
                      className={`nav-link btn-sm py-1 px-3 ${activeTab === "cp_statement" ? "active" : ""}`}
                      onClick={() => switchTab("cp_statement")}
                    >
                      Statement
                    </button>
                  </li>
                )}
                {!isChannel && can.can_view_financials && (
                  <li className="nav-item">
                    <button
                      className={`nav-link btn-sm py-1 px-3 ${activeTab === "statement" ? "active" : ""}`}
                      onClick={() => switchTab("statement")}
                    >
                      Statement
                    </button>
                  </li>
                )}
                {!isChannel && can.can_view_financials && (
                  <li className="nav-item">
                    <button
                      className={`nav-link btn-sm py-1 px-3 ${activeTab === "lifetime_report" ? "active" : ""}`}
                      onClick={() => switchTab("lifetime_report")}
                    >
                      <i className="fas fa-chart-column" style={{ marginRight: 4, fontSize: '0.7rem' }} /> Lifetime Report
                    </button>
                  </li>
                )}
                <li className="nav-item">
                  <button
                    className={`nav-link btn-sm py-1 px-3 ${activeTab === "onboarding" ? "active" : ""}`}
                    onClick={() => switchTab("onboarding")}
                  >
                    <i className="fas fa-handshake" style={{ marginRight: 4, fontSize: '0.7rem' }} /> Onboarding
                  </button>
                </li>
                </ul>
                {isChannel && ["cp_collection", "cp_products", "cp_commission"].includes(activeTab) && (
                  <div className="ms-sm-auto align-self-start align-self-sm-center mb-2 mb-sm-0">
                    <div className="rp-month-picker shadow-sm bg-white border-primary-subtle" style={{ padding: "0.25rem 0.65rem" }}>
                      <i className="far fa-calendar-alt text-primary" />
                      <input
                        type="month"
                        value={cpMonth}
                        onChange={(e) => setCpMonth(e.target.value)}
                        aria-label="Select month"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="card-body p-0">
              {activeTab === "profile" && reseller.partner_type !== "channel_partner" && (
                <ProfileDetails
                  reseller={reseller}
                  partners={partners}
                  can={can}
                  onEditClick={() => setShowEdit(true)}
                />
              )}

              {activeTab === "bandwidth" && (
                <BandwidthTab
                  reseller={reseller}
                  can={can}
                  rateChangeLogs={rateChangeLogs}
                  onRateChangeClick={openRateChangeModal}
                />
              )}

              {activeTab === "statement" && can.can_view_financials && (
                <StatementTab statementItems={statementItems} />
              )}

              {activeTab === "lifetime_report" && can.can_view_financials && (
                <LifetimeReportTab resellerId={id} />
              )}

              {activeTab === "onboarding" && (
                <OnboardingTab resellerId={profileId} />
              )}

              {activeTab === "cp_profile" && isChannel && (
                <ProfileDetails
                  reseller={reseller}
                  partners={partners}
                  can={can}
                  onEditClick={() => setShowEdit(true)}
                />
              )}

              {activeTab === "cp_realip" && isChannel && (
                <RealIPTab reseller={reseller} can={can} />
              )}

              {activeTab === "cp_users" && isChannel && (
                <UsersTab
                  cpUsers={cpUsers}
                  cpUserSearch={cpUserSearch}
                  setCpUserSearch={setCpUserSearch}
                  onAddUser={() => {
                    setNewUser({
                      user_name: "",
                      user_id_code: "",
                      phone: "",
                      package_name: "",
                      monthly_rate: "",
                    });
                    setShowAddUser(true);
                  }}
                  onEditUser={(user) => setShowEditUser(user)}
                  onDeleteUser={handleDeleteUser}
                  onMaximSync={handleMaximSync}
                  maximSyncing={maximSyncing}
                  maximStatus={maximStatus}
                />
              )}

              {activeTab === "cp_collection" && isChannel && (
                <CollectionTab
                  cpUserPayments={cpUserPayments}
                  cpMonth={cpMonth}
                  setCpMonth={setCpMonth}
                  onInitPayments={handleInitPayments}
                  onRecordPayment={handleRecordPayment}
                  onBulkFullPaid={handleBulkFullPaid}
                  onImportClick={() => setShowImport(true)}
                  onMaximSync={handleMaximSync}
                  maximSyncing={maximSyncing}
                  maximStatus={maximStatus}
                  maximSuffix={data?.reseller?.maxim_suffix || ""}
                  onSaveMaximSuffix={handleSaveMaximSuffix}
                  maximHealth={maximHealth}
                  maximHealthLoading={maximHealthLoading}
                />
              )}

              {activeTab === "cp_products" && isChannel && can.can_view_financials && (
                  <ProductsTab
                    profileId={reseller.id}
                    cpUsers={cpUsers}
                    cpMonth={cpMonth}
                    setCpMonth={setCpMonth}
                    cpProductSummary={cpProductSummary}
                    cpProductCatalog={cpProductCatalog}
                    onEditUserProducts={handleEditUserProducts}
                    onImportCatalog={handleImportCatalog}
                    importingCatalog={importingCatalog}
                    lastImportResult={lastImportResult}
                    onClearImportResult={() => setLastImportResult(null)}
                    showManualProductCharge={showManualProductCharge}
                    setShowManualProductCharge={setShowManualProductCharge}
                    manualProductChargeForm={manualProductChargeForm}
                    setManualProductChargeForm={setManualProductChargeForm}
                    manualProductChargeLoading={manualProductChargeLoading}
                    handleSaveManualProductCharge={handleSaveManualProductCharge}
                  />
              )}

              {activeTab === "cp_commission" && isChannel && (
                <CommissionTab
                  cpMonth={cpMonth}
                  setCpMonth={setCpMonth}
                  cpCommission={cpCommission}
                  cpHistory={cpHistory}
                  onGenerateCommission={handleGenerateCommission}
                  onCommissionPayment={(log) => {
                    setCommPayForm({
                      commission_log_id: log?.id || null,
                      commission_month: log?.month || "",
                      closing_balance: Number(log?.closing_balance || 0),
                      amount: log?.closing_balance
                        ? String(Number(log.closing_balance || 0))
                        : "",
                      payment_date: paymentDate,
                      payment_method: "Cash",
                      reference_no: "",
                      note: "",
                    });
                    setShowCommissionPay(true);
                  }}
                  onAdjustment={(log) => {
                    setAdjForm({ type: "adjustment", amount: "", note: "" });
                    setShowAdjust(log);
                  }}
                  onFinalize={handleFinalize}
                  onUnfinalize={handleUnfinalize}
                  onDownloadReport={handleDownloadReport}
                />
              )}

              {activeTab === "cp_statement" && isChannel && (
                <CPStatementTab cpStatement={cpStatement} />
              )}
            </div>
          </div>

      {/* Modals */}
      {showPay && (
        <PaymentModal
          saving={paymentSaving}
          paymentAmount={paymentAmount}
          setPaymentAmount={setPaymentAmount}
          paymentDate={paymentDate}
          setPaymentDate={setPaymentDate}
          paymentMethod={paymentMethod}
          setPaymentMethod={setPaymentMethod}
          paymentNote={paymentNote}
          setPaymentNote={setPaymentNote}
          onSubmit={submitPayment}
          onClose={() => setShowPay(false)}
        />
      )}

      {showDiscount && (
        <DiscountModal
          saving={discountSaving}
          discountAmount={discountAmount}
          setDiscountAmount={setDiscountAmount}
          discountDate={discountDate}
          setDiscountDate={setDiscountDate}
          discountNote={discountNote}
          setDiscountNote={setDiscountNote}
          onSubmit={submitDiscount}
          onClose={() => setShowDiscount(false)}
        />
      )}

      {showProductCharge && (
        <ProductChargeModal
          saving={productChargeSaving}
          productChargeAmount={productChargeAmount}
          setProductChargeAmount={setProductChargeAmount}
          productChargeDate={productChargeDate}
          setProductChargeDate={setProductChargeDate}
          productChargeNote={productChargeNote}
          setProductChargeNote={setProductChargeNote}
          onSubmit={submitProductCharge}
          onClose={() => setShowProductCharge(false)}
        />
      )}

      {showEdit && (
        <EditProfileModal
          editForm={editForm}
          setEditForm={setEditForm}
          saving={saving}
          onSubmit={saveProfile}
          onClose={() => setShowEdit(false)}
        />
      )}

      {showRateChange && (
        <RateChangeModal
          reseller={reseller}
          rateChangeForm={rateChangeForm}
          setRateChangeForm={setRateChangeForm}
          rateChangeSaving={rateChangeSaving}
          onSubmit={submitRateChange}
          onClose={() => setShowRateChange(false)}
        />
      )}

      {showBillHistory && can.can_view_financials && (
        <BillHistoryModal
          billHistory={billHistory}
          onClose={() => setShowBillHistory(false)}
        />
      )}

      {showAddUser && (
        <AddUserModal
          newUser={newUser}
          setNewUser={setNewUser}
          onSubmit={handleAddUser}
          onClose={() => setShowAddUser(false)}
        />
      )}

      {showEditUser && (
        <EditUserModal
          showEditUser={showEditUser}
          setShowEditUser={setShowEditUser}
          onSubmit={handleEditUser}
          onClose={() => setShowEditUser(null)}
        />
      )}

      {showCommissionPay && (
        <CommissionPaymentModal
          cpCommission={cpCommission}
          commPayForm={commPayForm}
          setCommPayForm={setCommPayForm}
          onSubmit={handleCommissionPayment}
          onClose={() => setShowCommissionPay(false)}
        />
      )}

      {showAdjust && (
        <AdjustmentModal
          adjForm={adjForm}
          setAdjForm={setAdjForm}
          onSubmit={handleAdjustment}
          onClose={() => setShowAdjust(false)}
        />
      )}

      {showImport && (
        <ImportModal
          importMonth={importMonth}
          setImportMonth={setImportMonth}
          importFile={importFile}
          setImportFile={setImportFile}
          importing={importing}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
          maximRows={maximPrefillRows}
          maximLoading={maximPrefillLoading}
          onFetchMaxim={() => loadMaximPrefill(importMonth)}
        />
      )}

      {showUserProducts && !userProductsLoading && (
        <UserProductsModal
          user={showUserProducts}
          month={cpMonth}
          catalog={cpProductCatalog}
          initialUsage={userProductsUsage}
          onSave={handleSaveUserProducts}
          onClose={closeUserProductsModal}
          saving={savingUserProducts}
        />
      )}

      {showUserProducts && userProductsLoading && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
          style={{ background: "rgba(0,0,0,0.25)", zIndex: 1050 }}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="spinner-border text-light" />
        </div>
      )}

      {confirmAction && <ConfirmDialog message={confirmAction.message} onConfirm={executeConfirm} onCancel={() => setConfirmAction(null)} />}
    </div>
  );
};

export default ResellerProfile;
