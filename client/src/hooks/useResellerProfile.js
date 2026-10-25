import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "react-hot-toast";
import {
  getResellerProfileDetails,
  updateReseller,
  addBillingLog,
  addDiscount,
  changeResellerRate,
  getResellerRateChangeLogs,
} from "../services/resellerService";
import { toDhakaDateInputValue, getDhakaDateYmd } from "../utils/formatters";

export const useResellerProfile = (profileId) => {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);

  // Modal visibility states
  const [showPay, setShowPay] = useState(false);
  const [showDiscount, setShowDiscount] = useState(false);
  const [showProductCharge, setShowProductCharge] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showBillHistory, setShowBillHistory] = useState(false);
  const [showRateChange, setShowRateChange] = useState(false);

  // Form states
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(getDhakaDateYmd());
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [paymentNote, setPaymentNote] = useState("");

  const [discountAmount, setDiscountAmount] = useState("");
  const [discountDate, setDiscountDate] = useState(getDhakaDateYmd());
  const [discountNote, setDiscountNote] = useState("");

  const [productChargeAmount, setProductChargeAmount] = useState("");
  const [productChargeDate, setProductChargeDate] = useState(getDhakaDateYmd());
  const [productChargeNote, setProductChargeNote] = useState("");

  const [editForm, setEditForm] = useState(null);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [discountSaving, setDiscountSaving] = useState(false);
  const [productChargeSaving, setProductChargeSaving] = useState(false);
  const [rateChangeForm, setRateChangeForm] = useState(null);
  const [rateChangeSaving, setRateChangeSaving] = useState(false);
  const [rateChangeLogs, setRateChangeLogs] = useState([]);

  // Synchronous ref guard to prevent race conditions (faster than useState)
  const submittingRef = useRef(false);
  const genIdempotencyKey = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const load = useCallback(async () => {
    if (!profileId) return;
    setLoadError("");
    try {
      const payload = await getResellerProfileDetails(profileId);
      setData(payload);
      const r = payload.reseller;
      const partnersData = Array.isArray(payload.partners) && payload.partners.length > 0
        ? payload.partners.map((p) => ({ partner_name: p.partner_name || '', contact_no: p.contact_no || '' }))
        : [{ partner_name: r.name || '', contact_no: r.phone || '' }];
      setEditForm({
        name: r.name || "",
        company_name: r.company_name || "",
        phone: r.phone || "",
        pop_location: r.pop_location || "",
        latitude: r.latitude || "",
        longitude: r.longitude || "",
        reseller_code: r.reseller_code || "",
        status: r.status || "active",
        partner_type: r.partner_type || "distribution_partner",
        partners: partnersData,
        iig_bw: Number(r.iig_bw || 0),
        bdix_bw: Number(r.bdix_bw || 0),
        ggc_bw: Number(r.ggc_bw || 0),
        fna_bw: Number(r.fna_bw || 0),
        cdn_bw: Number(r.cdn_bw || 0),
        bcdn_bw: Number(r.bcdn_bw || 0),
        nttn_capacity: Number(r.nttn_capacity || 0),
        nttn_type: r.nttn_type || "",
        nttn_link: r.nttn_link || "",
        connection_type: r.connection_type || "",
        rate_iig: Number(r.rate_iig || 0),
        rate_bdix: Number(r.rate_bdix || 0),
        rate_ggc: Number(r.rate_ggc || 0),
        rate_fna: Number(r.rate_fna || 0),
        rate_cdn: Number(r.rate_cdn || 0),
        rate_bcdn: Number(r.rate_bcdn || 0),
        rate_nttn: Number(r.rate_nttn || 0),
        monthly_rate: Number(r.current_projected_bill || 0),
        due_amount: Number(r.previous_month_due || 0),
        next_pay_date: toDhakaDateInputValue(r.next_pay_date),
        security_deposit: Number(r.security_deposit || 0),
        otc_charge: Number(r.otc_charge || 0),
        real_ip_count: Number(r.real_ip_count || 0),
        real_ip_price: Number(r.real_ip_price || 0),
        channel_user_count: Number(r.channel_user_count || 0),
        profit_share_percentage: Number(r.profit_share_percentage || 0),
        joining_date: toDhakaDateInputValue(r.joining_date || r.created_at),
      });
    } catch (e) {
      setData(null);
      setLoadError(e?.response?.data?.message || "Profile data load failed");
    }
  }, [profileId]);

  const loadRateChangeLogs = useCallback(async () => {
    if (!profileId) return;
    try {
      const logs = await getResellerRateChangeLogs(profileId);
      setRateChangeLogs(logs || []);
    } catch (_) {
      /* ignore */
    }
  }, [profileId]);

  useEffect(() => {
    load();
    loadRateChangeLogs();
  }, [load, loadRateChangeLogs]);

  const submitPayment = async (e) => {
    e.preventDefault();
    if (!Number(paymentAmount) || submittingRef.current) return;
    submittingRef.current = true;
    setPaymentSaving(true);
    const idempotencyKey = genIdempotencyKey();
    try {
      const note = `Payment Received (${paymentMethod}): ${Number(paymentAmount).toFixed(2)} Tk.${paymentNote ? ` Note: ${paymentNote}` : ""}`;
      await addBillingLog({
        reseller_id: profileId,
        log_type: "payment",
        amount: Number(paymentAmount),
        note,
        effective_date: `${paymentDate}T${new Date().toTimeString().slice(0, 8)}`,
        idempotency_key: idempotencyKey,
      });
      toast.success("Payment saved successfully!");
      setShowPay(false);
      setPaymentAmount("");
      setPaymentMethod("Cash");
      setPaymentNote("");
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save payment");
    } finally {
      setPaymentSaving(false);
      submittingRef.current = false;
    }
  };

  const submitDiscount = async (e) => {
    e.preventDefault();
    if (!Number(discountAmount) || submittingRef.current) return;
    submittingRef.current = true;
    setDiscountSaving(true);
    const idempotencyKey = genIdempotencyKey();
    try {
      const payload = {
        amount: Number(discountAmount),
        note: discountNote || "Monthly discount",
        effective_date: `${discountDate}T${new Date().toTimeString().slice(0, 8)}`,
        idempotency_key: idempotencyKey,
      };
      await addDiscount(profileId, payload);
      toast.success("Discount saved successfully!");
      setShowDiscount(false);
      setDiscountAmount("");
      setDiscountNote("");
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save discount");
    } finally {
      setDiscountSaving(false);
      submittingRef.current = false;
    }
  };

  const submitProductCharge = async (e) => {
    e.preventDefault();
    if (!Number(productChargeAmount) || submittingRef.current) return;
    submittingRef.current = true;
    setProductChargeSaving(true);
    const idempotencyKey = genIdempotencyKey();
    try {
      const note = `Product Charge: ${Number(productChargeAmount).toFixed(2)} Tk.${productChargeNote ? ` Note: ${productChargeNote}` : ""}`;
      await addBillingLog({
        reseller_id: profileId,
        log_type: "product",
        amount: Number(productChargeAmount),
        note,
        effective_date: `${productChargeDate}T${new Date().toTimeString().slice(0, 8)}`,
        idempotency_key: idempotencyKey,
      });
      toast.success("Product charge added successfully!");
      setShowProductCharge(false);
      setProductChargeAmount("");
      setProductChargeNote("");
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to add product charge");
    } finally {
      setProductChargeSaving(false);
      submittingRef.current = false;
    }
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...editForm };
      if (!String(payload.password || "").trim()) delete payload.password;
      // Send partners array if it exists in editForm
      if (Array.isArray(payload.partners)) {
        payload.partners = payload.partners.filter((p) => p.partner_name.trim() || p.contact_no.trim());
      } else {
        delete payload.partners;
      }
      if (payload.partner_type !== "channel_partner") {
        delete payload.channel_user_count;
      }
      if (
        payload.partner_type !== "channel_partner" &&
        payload.partner_type !== "mac_partner"
      ) {
        delete payload.profit_share_percentage;
      }

      await updateReseller(profileId, payload);
      toast.success("Profile updated successfully!");
      setShowEdit(false);
      await load();
    } catch (err) {
      console.error("Update failed:", err);
      toast.error(err?.response?.data?.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const openRateChangeModal = () => {
    const r = data?.reseller || {};
    setRateChangeForm({
      effective_date: getDhakaDateYmd(),
      note: "",
      rate_iig: Number(r.rate_iig || 0),
      rate_bdix: Number(r.rate_bdix || 0),
      rate_ggc: Number(r.rate_ggc || 0),
      rate_fna: Number(r.rate_fna || 0),
      rate_cdn: Number(r.rate_cdn || 0),
      rate_bcdn: Number(r.rate_bcdn || 0),
      rate_nttn: Number(r.rate_nttn || 0),
    });
    setShowRateChange(true);
  };

  const submitRateChange = async (e) => {
    e.preventDefault();
    setRateChangeSaving(true);
    try {
      const result = await changeResellerRate(profileId, rateChangeForm);
      setShowRateChange(false);
      await load();
      await loadRateChangeLogs();
      if (
        result?.new_projected_bill !== undefined &&
        result?.new_projected_bill !== null
      ) {
        toast.success(
          `Rate changed successfully! New Projected Bill: ${Number(result.new_projected_bill).toLocaleString("en-BD", { minimumFractionDigits: 2 })} Tk`,
        );
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to save rate change");
    } finally {
      setRateChangeSaving(false);
    }
  };

  return {
    data,
    loadError,
    saving,
    load,
    // Modal states
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
    // Payment form
    paymentSaving,
    paymentAmount,
    setPaymentAmount,
    paymentDate,
    setPaymentDate,
    paymentMethod,
    setPaymentMethod,
    paymentNote,
    setPaymentNote,
    submitPayment,
    // Discount form
    discountSaving,
    discountAmount,
    setDiscountAmount,
    discountDate,
    setDiscountDate,
    discountNote,
    setDiscountNote,
    submitDiscount,
    // Product Charge form
    productChargeSaving,
    showProductCharge,
    setShowProductCharge,
    productChargeAmount,
    setProductChargeAmount,
    productChargeDate,
    setProductChargeDate,
    productChargeNote,
    setProductChargeNote,
    submitProductCharge,
    // Edit form
    editForm,
    setEditForm,
    saveProfile,
    // Rate change
    rateChangeForm,
    setRateChangeForm,
    rateChangeSaving,
    rateChangeLogs,
    openRateChangeModal,
    submitRateChange,
  };
};
