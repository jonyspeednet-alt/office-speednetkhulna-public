import { useState, useEffect, useCallback } from "react";
import { toast } from "react-hot-toast";
import { confirmAction } from "../utils/confirm";
import { notify } from "../utils/notify";
import {
  getChannelUsers,
  addChannelUser,
  updateChannelUser,
  deleteChannelUser,
  getUserPayments,
  initMonthlyPayments,
  recordUserPayment,
  bulkRecordPayments,
  getCommissionSummary,
  generateCommission,
  adjustCommission,
  finalizeCommission,
  unfinalizeCommission,
  getCommissionHistory,
  recordCommissionPayment,
  getCommissionPayments,
  getChannelStatement,
  importChannelData,
  getReconciliations,
  downloadReconciliationReport,
  listChannelProducts,
  importResellerProducts,
  getProductSummary,
  getUserProducts,
  saveUserProducts,
  getManualProductCharge,
  saveManualProductCharge,
  startMaximSync,
  getMaximSyncStatus,
  getMaximPrefill,
  saveMaximSuffix,
  getMaximHealth,
} from "../services/channelPartnerService";
import { getDhakaDateYmd } from "../utils/formatters";

export const useChannelPartner = (profileId, isChannel, onProfileRefresh) => {
  const [cpUsers, setCpUsers] = useState([]);
  const [cpMonth, setCpMonth] = useState(getDhakaDateYmd().slice(0, 7));
  const [cpUserPayments, setCpUserPayments] = useState([]);
  const [cpCommission, setCpCommission] = useState(null);
  const [cpHistory, setCpHistory] = useState([]);
  const [cpStatement, setCpStatement] = useState([]);
  const [cpPayments, setCpPayments] = useState([]);
  const [cpLoading, setCpLoading] = useState(false);
  const [cpUserSearch, setCpUserSearch] = useState("");
  const [cpProductSummary, setCpProductSummary] = useState(null);
  const [cpProductCatalog, setCpProductCatalog] = useState([]);
  const [showUserProducts, setShowUserProducts] = useState(null);
  const [userProductsUsage, setUserProductsUsage] = useState([]);
  const [userProductsLoading, setUserProductsLoading] = useState(false);
  const [savingUserProducts, setSavingUserProducts] = useState(false);
  const [importingCatalog, setImportingCatalog] = useState(false);
  const [lastImportResult, setLastImportResult] = useState(null);
  const [maximSyncing, setMaximSyncing] = useState(false);
  const [maximStatus, setMaximStatus] = useState(null);
  const [maximPrefillRows, setMaximPrefillRows] = useState([]);
  const [maximPrefillLoading, setMaximPrefillLoading] = useState(false);
  const [maximHealth, setMaximHealth] = useState([]);
  const [maximHealthLoading, setMaximHealthLoading] = useState(false);

  // Modal states
  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(null);
  const [showCommissionPay, setShowCommissionPay] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showManualProductCharge, setShowManualProductCharge] = useState(false);

  // Form states
  const [newUser, setNewUser] = useState({
    user_name: "",
    user_id_code: "",
    phone: "",
    package_name: "",
    monthly_rate: "",
  });
  const [commPayForm, setCommPayForm] = useState({
    amount: "",
    payment_date: getDhakaDateYmd(),
    payment_method: "Cash",
    reference_no: "",
    note: "",
  });
  const [adjForm, setAdjForm] = useState({
    type: "adjustment",
    amount: "",
    note: "",
  });
  const [manualProductChargeForm, setManualProductChargeForm] = useState({
    amount: "",
    note: "",
  });
  const [manualProductChargeLoading, setManualProductChargeLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importMonth, setImportMonth] = useState(getDhakaDateYmd().slice(0, 7));
  const [confirmState, setConfirmAction] = useState(null);

  const loadChannelData = useCallback(async () => {
    if (!profileId || !isChannel) return;
    setCpLoading(true);
    try {
      const [users, commission, history, statement, payments, productSummary, manualCharge] =
        await Promise.all([
          getChannelUsers(profileId).catch(() => []),
          getCommissionSummary(profileId, cpMonth).catch(() => null),
          getCommissionHistory(profileId).catch(() => []),
          getChannelStatement(profileId).catch(() => []),
          getCommissionPayments(profileId).catch(() => []),
          getProductSummary(profileId, cpMonth).catch(() => null),
          getManualProductCharge(profileId, cpMonth).catch(() => null),
        ]);
      setCpUsers(users);
      setCpCommission(commission);
      setCpHistory(history);
      setCpStatement(statement);
      setCpPayments(payments);
      setCpProductSummary(productSummary);
      setManualProductChargeForm({
        amount: manualCharge?.amount ?? "",
        note: manualCharge?.note || "",
      });
    } catch (e) {
      toast.error(e?.response?.data?.message || "Channel partner data load failed");
    }
    setCpLoading(false);
  }, [profileId, isChannel, cpMonth]);

  const loadMaximStatus = useCallback(async (monthOverride) => {
    if (!profileId || !isChannel) return;
    try {
      const st = await getMaximSyncStatus(profileId, monthOverride || cpMonth);
      setMaximStatus(st);
    } catch {
      setMaximStatus(null);
    }
  }, [profileId, isChannel, cpMonth]);

  const loadMaximPrefill = async (monthOverride) => {
    if (!profileId || !isChannel) return [];
    setMaximPrefillLoading(true);
    try {
      const res = await getMaximPrefill(profileId, monthOverride || cpMonth);
      const rows = Array.isArray(res?.rows) ? res.rows : [];
      setMaximPrefillRows(rows);
      return rows;
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load Maxim prefill");
      return [];
    } finally {
      setMaximPrefillLoading(false);
    }
  };

  const loadMaximHealth = useCallback(async () => {
    if (!profileId || !isChannel) return;
    setMaximHealthLoading(true);
    try {
      const res = await getMaximHealth(profileId);
      setMaximHealth(Array.isArray(res?.rows) ? res.rows : []);
    } catch {
      setMaximHealth([]);
    } finally {
      setMaximHealthLoading(false);
    }
  }, [profileId, isChannel]);

  const loadUserPayments = useCallback(async () => {
    if (!profileId) return;
    try {
      const rows = await getUserPayments(profileId, cpMonth);
      setCpUserPayments(rows);
    } catch (e) {
      /* ignore */
    }
  }, [profileId, cpMonth]);

  useEffect(() => {
    if (isChannel) {
      loadChannelData();
      loadUserPayments();
      loadMaximStatus();
      loadMaximHealth();
    }
  }, [isChannel, loadChannelData, loadUserPayments, loadMaximStatus, loadMaximHealth]);

  useEffect(() => {
    if (!isChannel) return;
    listChannelProducts(true)
      .then((rows) => setCpProductCatalog(Array.isArray(rows) ? rows : []))
      .catch(() => setCpProductCatalog([]));
  }, [isChannel]);

  const refreshProfile = useCallback(async () => {
    if (typeof onProfileRefresh === "function") {
      await onProfileRefresh();
    }
  }, [onProfileRefresh]);

  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      await addChannelUser(profileId, newUser);
      setShowAddUser(false);
      setNewUser({
        user_name: "",
        user_id_code: "",
        phone: "",
        package_name: "",
        monthly_rate: "",
      });
      await loadChannelData();
      await refreshProfile();
      toast.success("User added");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to add user");
    }
  };

  const handleEditUser = async (e) => {
    e.preventDefault();
    try {
      await updateChannelUser(profileId, showEditUser.id, showEditUser);
      setShowEditUser(null);
      await loadChannelData();
      await refreshProfile();
      toast.success("User updated");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to update user");
    }
  };

  const handleDeleteUser = (userId) => {
    setConfirmAction({
      message: 'Delete this user?',
      onConfirm: async () => {
        try {
          await deleteChannelUser(profileId, userId);
          await loadChannelData();
          await refreshProfile();
          toast.success('User deleted');
        } catch (err) {
          toast.error(err?.response?.data?.message || 'Failed to delete user');
        }
      }
    });
  };

  const handleInitPayments = async () => {
    const ok = await confirmAction({ title: 'Initialize monthly payments for all users?' });
    if (!ok) return;
    try {
      await initMonthlyPayments(profileId, cpMonth);
      await loadUserPayments();
      notify.success('Init successful');
    } catch (err) {
      notify.error(err?.response?.data?.message || 'Init failed');
    }
  };

  const handleRecordPayment = async (userId, amount) => {
    const ok = await confirmAction({ title: `Record payment of ${amount} BDT?` });
    if (!ok) return;
    try {
      await recordUserPayment(profileId, {
        user_id: userId,
        month: cpMonth,
        amount_paid: amount,
        payment_date: getDhakaDateYmd(),
      });
      await loadUserPayments();
      await loadChannelData();
      notify.success('Payment recorded');
    } catch (err) {
      notify.error(err?.response?.data?.message || 'Failed to record payment');
    }
  };

  const handleBulkFullPaid = () => {
    const unpaid = cpUserPayments.filter((p) => Number(p.amount_paid) === 0);
    if (unpaid.length === 0) return;
    setConfirmAction({
      message: `Mark ${unpaid.length} unpaid user(s) as fully paid?`,
      onConfirm: async () => {
        try {
          await bulkRecordPayments(
            profileId,
            cpMonth,
            unpaid.map((p) => ({
              user_id: p.user_id,
              amount_paid: Number(p.amount_due || p.monthly_rate || 0),
              payment_date: getDhakaDateYmd(),
            })),
          );
          await loadUserPayments();
          await loadChannelData();
          notify.success(`Payments completed for ${unpaid.length} user(s)`);
        } catch (err) {
          notify.error(err?.response?.data?.message || 'Bulk payment failed');
        }
      }
    });
  };

  const handleGenerateCommission = async () => {
    try {
      await generateCommission(profileId, cpMonth);
      await loadChannelData();
      toast.success("Commission generated and updated");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to generate commission");
    }
  };

  const handleCommissionPayment = async (e) => {
    e.preventDefault();
    if (!commPayForm.commission_log_id) {
      toast.error("Select a finalized commission month before recording commission payment.");
      return;
    }
    try {
      await recordCommissionPayment(profileId, {
        commission_log_id: commPayForm.commission_log_id,
        amount: Number(commPayForm.amount),
        payment_method: commPayForm.payment_method,
        payment_date: commPayForm.payment_date,
        reference_no: commPayForm.reference_no,
        note: commPayForm.note,
      });
      setShowCommissionPay(false);
      setCommPayForm({
        commission_log_id: null,
        commission_month: "",
        closing_balance: 0,
        amount: "",
        payment_date: getDhakaDateYmd(),
        payment_method: "Cash",
        reference_no: "",
        note: "",
      });
      await loadChannelData();
      toast.success("Commission payment recorded");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save commission payment");
    }
  };

  const handleAdjustment = async (e) => {
    e.preventDefault();
    const ok = await confirmAction({ title: 'Apply commission adjustment?', danger: true });
    if (!ok) return;
    try {
      await adjustCommission(profileId, showAdjust.id, adjForm);
      setShowAdjust(false);
      setAdjForm({ type: "adjustment", amount: "", note: "" });
      await loadChannelData();
      notify.success('Adjustment successful');
    } catch (err) {
      notify.error(err?.response?.data?.message || 'Adjustment failed');
    }
  };

  const handleFinalize = (logId) => {
    setConfirmAction({
      message: 'Finalize commission?',
      onConfirm: async () => {
        try {
          await finalizeCommission(profileId, logId);
          await loadChannelData();
          notify.success('Finalized successfully');
        } catch (err) {
          notify.error(err?.response?.data?.message || 'Finalize failed');
        }
      }
    });
  };

  const handleUnfinalize = (logId) => {
    setConfirmAction({
      message: 'Unfinalizing commission will allow changes again. Confirm?',
      onConfirm: async () => {
        try {
          await unfinalizeCommission(profileId, logId);
          await loadChannelData();
          toast.success("Commission unfinalized");
        } catch (err) {
          toast.error(err?.response?.data?.message || "Failed to unfinalize");
        }
      }
    });
  };

  const handleMaximSync = async (suffixOverride) => {
    if (!profileId) return;
    setMaximSyncing(true);
    try {
      const month = cpMonth;
      await startMaximSync(profileId, month, suffixOverride || undefined);
      toast.success("Maxim sync started — you will be notified when it finishes");
      // Poll status (worker runs in background; full POP fetch can take minutes)
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const st = await getMaximSyncStatus(profileId, month);
          setMaximStatus(st);
          if (st?.log?.status === "completed") {
            toast.success(
              `Maxim sync completed! Payments: ${st.log.rows_payments}, Customers: ${st.log.rows_customers} — fetch from Excel Import → Maxim`,
            );
            await loadMaximPrefill(month);
            loadMaximHealth();
            break;
          }
          if (st?.log?.status === "failed") {
            toast.error(`Maxim sync failed: ${st.log.error || ""}`.slice(0, 200));
            break;
          }
        } catch {
          break;
        }
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to start Maxim sync");
    } finally {
      setMaximSyncing(false);
    }
  };

  const handleSaveMaximSuffix = async (suffix) => {
    try {
      const res = await saveMaximSuffix(profileId, suffix);
      toast.success("Maxim suffix saved");
      loadMaximStatus();
      return res;
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save suffix");
      throw err;
    }
  };

  const handleImport = async (customFile = null) => {    setImporting(true);
    try {
      const res = await importChannelData(profileId, importMonth, customFile || importFile);
      toast.success(
        `Import successful! Total: ${res.total}, New: ${res.created}, Updated: ${res.updated}, Skipped: ${res.skipped || 0}`,
      );
      setShowImport(false);
      setImportFile(null);
      loadChannelData();
      loadUserPayments();
      loadMaximHealth();
    } catch (err) {
      toast.error(
        err?.response?.data?.message || "Import failed.",
      );
    } finally {
      setImporting(false);
    }
  };

  const openCommissionPayment = (log) => {
    const target =
      log ||
      (cpHistory || []).find(
        (h) => h.status === "finalized" && Number(h.closing_balance || 0) > 0,
      );
    if (!target) {
      toast.error("No payable finalized commission found");
      return;
    }
    setCommPayForm({
      commission_log_id: target.id,
      commission_month: target.month || "",
      closing_balance: Number(target.closing_balance || 0),
      amount: target.closing_balance
        ? String(Number(target.closing_balance || 0))
        : "",
      payment_date: getDhakaDateYmd(),
      payment_method: "Cash",
      reference_no: "",
      note: "",
    });
    setShowCommissionPay(true);
  };

  const handleImportCatalog = async (fileOrEvent) => {
    // Accept either a File object directly (from visible input) or trigger file picker
    let file = null;
    if (fileOrEvent instanceof File) {
      file = fileOrEvent;
    } else {
      // Fallback: open hidden file picker (legacy behavior)
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        input.onchange = async (e) => {
          const f = e.target.files?.[0];
          if (!f) { resolve(); return; }
          await doImport(f);
          resolve();
        };
        input.click();
      });
    }
    if (file) await doImport(file);

    async function doImport(f) {
      setImportingCatalog(true);
      try {
        const res = await importResellerProducts(profileId, cpMonth, f);
        const rows = await listChannelProducts(true);
        setCpProductCatalog(Array.isArray(rows) ? rows : []);

        let msg = "";
        if (res.type === "partner_total") {
          msg = `Product charge import successful! Total: ${res.amount || 0} ৳ (Catalog: ${res.catalog_created || 0} new, ${res.catalog_updated || 0} updated)`;
          setLastImportResult({
            created: res.catalog_created || 0,
            updated: res.catalog_updated || 0,
            skipped: 0,
            total: res.total_rows || 0,
            amount: res.amount,
            type: "partner_total",
          });
        } else {
          msg = `Catalog import: ${res.created || 0} new, ${res.updated || 0} updated`;
          setLastImportResult({
            created: res.created || 0,
            updated: res.updated || 0,
            skipped: res.skipped || 0,
            total: res.total || 0,
          });
        }

        toast.success(msg);
        await loadChannelData();
      } catch (err) {
        const errMsg = err?.response?.data?.message || err?.message || "Product import failed";
        toast.error(errMsg);
        console.error("[ImportCatalog] Error:", err?.response?.data || err?.message);
        setLastImportResult(null);
      } finally {
        setImportingCatalog(false);
      }
    }
  };

  const handleEditUserProducts = async (user) => {
    setShowUserProducts(user);
    setUserProductsLoading(true);
    setUserProductsUsage([]);
    try {
      const data = await getUserProducts(profileId, user.id, cpMonth);
      if (Array.isArray(data?.catalog) && data.catalog.length) {
        setCpProductCatalog(data.catalog);
      }
      setUserProductsUsage(data?.usage || []);
    } catch (err) {
      toast.error(
        err?.response?.data?.message || "Failed to load user products",
      );
      setShowUserProducts(null);
    } finally {
      setUserProductsLoading(false);
    }
  };

  const closeUserProductsModal = () => {
    setShowUserProducts(null);
    setUserProductsUsage([]);
  };

  const handleSaveUserProducts = async ({ month, items }) => {
    if (!showUserProducts?.id) return;
    setSavingUserProducts(true);
    try {
      await saveUserProducts(profileId, showUserProducts.id, { month, items });
      closeUserProductsModal();
      await loadChannelData();
      toast.success("Product assignment saved");
    } catch (err) {
      toast.error(
        err?.response?.data?.message || "Failed to save products",
      );
    } finally {
      setSavingUserProducts(false);
    }
  };

  const handleDownloadReport = async (log) => {
    try {
      // First find the reconciliation ID for this month
      const reconciliationPayload = await getReconciliations(profileId);
      const reconciliations = Array.isArray(reconciliationPayload)
        ? reconciliationPayload
        : reconciliationPayload?.data || [];
      const matched = reconciliations.find((r) =>
        String(r.reconciliation_month || "").startsWith(log.month),
      );

      if (!matched) {
        toast.error(
          "Settlement report for this month not found. Initiate/approve reconciliation first.",
        );
        return;
      }

      await downloadReconciliationReport(profileId, matched.id);
    } catch (err) {
      toast.error("Failed to download report.");
    }
  };

  const handleSaveManualProductCharge = async (e) => {
    e.preventDefault();
    setManualProductChargeLoading(true);
    try {
      await saveManualProductCharge(profileId, {
        month: cpMonth,
        amount: manualProductChargeForm.amount,
        note: manualProductChargeForm.note,
      });
      toast.success("Manual product charge saved successfully!");
      setShowManualProductCharge(false);
      await loadChannelData();
      await refreshProfile();
    } catch (error) {
      toast.error(error?.response?.data?.error || "Failed to save manual product charge");
    } finally {
      setManualProductChargeLoading(false);
    }
  };

  const executeConfirm = async () => {
    if (confirmState?.onConfirm) {
      await confirmState.onConfirm();
    }
    setConfirmAction(null);
  };

  return {
    cpUsers,
    cpMonth,
    setCpMonth,
    cpUserPayments,
    cpCommission,
    cpHistory,
    cpStatement,
    cpPayments,
    cpLoading,
    cpUserSearch,
    setCpUserSearch,
    cpProductSummary,
    cpProductCatalog,
    showUserProducts,
    setShowUserProducts,
    userProductsUsage,
    userProductsLoading,
    savingUserProducts,
    importingCatalog,
    lastImportResult,
    setLastImportResult,
    loadChannelData,
    loadUserPayments,
    // Modal states
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
    // Form states
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
    // Handlers
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
    loadMaximHealth,
    loadMaximStatus,
    loadMaximPrefill,
    handleMaximSync,
    handleSaveMaximSuffix,
    openCommissionPayment,
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
    confirmAction: confirmState,
    setConfirmAction,
    executeConfirm,
  };
};
