import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import BrandLogo from '../components/BrandLogo';
import { getPurchaseOrderDetails, updatePOStatus, PO_STATUS_TRANSITIONS, isTerminalPOStatus } from '../services/procurementService';
import { fmtDate } from '../utils/formatters';

const STATUS_LABEL = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  ordered: 'Ordered',
  received: 'Received',
  cancelled: 'Cancelled'
};

const ACTION_STYLE = {
  approved: 'bg-blue-600 hover:bg-blue-700',
  ordered: 'bg-purple-600 hover:bg-purple-700',
  received: 'bg-emerald-600 hover:bg-emerald-700',
  cancelled: 'bg-rose-600 hover:bg-rose-700',
  pending: 'bg-amber-600 hover:bg-amber-700',
  rejected: 'bg-slate-600 hover:bg-slate-700'
};

const PODetailModal = ({ poId, onClose, onStatusChanged }) => {
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!poId) return;
    const fetchDetails = async () => {
      setLoading(true);
      try {
        const data = await getPurchaseOrderDetails(poId);
        setPo(data);
      } catch (err) {
        toast.error('Failed to load PO details');
        onClose();
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [poId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStatusChange = async (next) => {
    if (!po || updating) return;
    setUpdating(true);
    try {
      const updated = await updatePOStatus(po.id, next);
      setPo((prev) => ({ ...prev, ...updated }));
      toast.success(`PO marked as ${STATUS_LABEL[next]}`);
      onStatusChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update status');
    } finally {
      setUpdating(false);
    }
  };

  const handlePrint = () => window.print();

  const nextActions = po ? PO_STATUS_TRANSITIONS[po.status] || [] : [];
  const locked = po ? isTerminalPOStatus(po.status) && nextActions.length === 0 : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <style>{`@media print { body * { visibility: hidden; } .po-print-area, .po-print-area * { visibility: visible; } .po-print-area { position: absolute; left: 0; top: 0; width: 100%; } }`}</style>
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="py-12 text-center text-slate-500">
            <i className="fa-solid fa-spinner fa-spin text-2xl mb-2"></i>
            <p>Loading PO details...</p>
          </div>
        ) : po ? (
          <>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-800 dark:text-white">#{po.po_number}</h2>
                <p className="text-sm text-slate-500">Created by {po.creator_name || '—'}</p>
              </div>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl" title="Close">
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="po-print-area text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 p-2 rounded-xl">
              {/* Speed Net Official Header */}
              <div className="border-b-2 border-slate-800 dark:border-slate-300 pb-4 mb-5">
                <div className="flex justify-between items-center gap-4">
                  <div className="flex items-center gap-3">
                    <BrandLogo
                      alt="Speed Net Khulna"
                      className="h-12 w-auto object-contain"
                    />
                    <div>
                      <h2 className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight leading-none">
                        Speed Net Khulna
                      </h2>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Internet Service Provider (ISP)
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                      Purchase Order
                    </span>
                    <p className="text-[12px] text-slate-700 dark:text-slate-300 font-mono font-bold mt-1">
                      #{po.po_number}
                    </p>
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-dashed border-slate-200 dark:border-slate-700 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span>83/3, Gagan Babu Road, Khulna</span>
                  <span>billing@speednetkhulna.com | +880 1910365577</span>
                </div>
              </div>

              {/* Vendor & Order Details */}
              <div className="grid grid-cols-2 gap-4 text-xs mb-5 bg-slate-50 dark:bg-slate-700/40 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vendor</p>
                  <p className="font-bold text-slate-900 dark:text-white mt-0.5 text-sm">{po.vendor_name || 'N/A'}</p>
                  {po.vendor_phone && <p className="text-slate-500 text-xs mt-0.5">📞 {po.vendor_phone}</p>}
                </div>
                <div className="text-right space-y-0.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">PO Status &amp; Dates</p>
                  <p><span className="text-slate-500 dark:text-slate-400">Order Date:</span> <strong className="text-slate-800 dark:text-slate-200">{fmtDate(po.order_date)}</strong></p>
                  <p><span className="text-slate-500 dark:text-slate-400">Delivery:</span> <strong className="text-slate-800 dark:text-slate-200">{po.expected_delivery_date ? fmtDate(po.expected_delivery_date) : '—'}</strong></p>
                  <p>
                    <span className="text-slate-500 dark:text-slate-400">Status: </span>
                    <span className="font-bold uppercase text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-blue-700 dark:text-blue-400">
                      {STATUS_LABEL[po.status] || po.status}
                    </span>
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded border border-slate-200 dark:border-slate-700 mb-5">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-700/80 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700">
                      <th className="py-2 px-2.5 text-left font-bold w-7">#</th>
                      <th className="py-2 px-2.5 text-left font-bold">Item Description</th>
                      <th className="py-2 px-2.5 text-right font-bold w-12">Qty</th>
                      <th className="py-2 px-2.5 text-right font-bold w-20">Unit Price</th>
                      <th className="py-2 px-2.5 text-right font-bold w-24">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {(po.items || []).map((item, i) => (
                      <tr key={item.id || i} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/30">
                        <td className="py-2 px-2.5 text-slate-500 font-medium">{i + 1}</td>
                        <td className="py-2 px-2.5">
                          <div className="font-semibold text-slate-900 dark:text-white">{item.item_name}</div>
                          {item.description && <div className="text-[10px] text-slate-500 dark:text-slate-400">{item.description}</div>}
                        </td>
                        <td className="py-2 px-2.5 text-right font-semibold text-slate-800 dark:text-slate-200">{item.quantity}</td>
                        <td className="py-2 px-2.5 text-right text-slate-600 dark:text-slate-300">৳{Number(item.unit_price).toLocaleString()}</td>
                        <td className="py-2 px-2.5 text-right font-bold text-slate-900 dark:text-white">৳{Number(item.total_price).toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 dark:bg-slate-700/60 font-bold border-t-2 border-slate-300 dark:border-slate-600">
                      <td colSpan="4" className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">Grand Total:</td>
                      <td className="py-2.5 px-3 text-right text-blue-700 dark:text-blue-400 text-sm font-black">
                        ৳{Number(po.total_amount).toLocaleString()}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {po.notes && (
                <div className="mb-6 p-2.5 bg-slate-50 dark:bg-slate-700/40 rounded border border-slate-200 dark:border-slate-700 text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-300">Instructions / Notes:</span>
                  <p className="text-slate-600 dark:text-slate-400 mt-1 whitespace-pre-wrap">{po.notes}</p>
                </div>
              )}

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-8 pt-8 mt-6 text-xs text-center border-t border-slate-200 dark:border-slate-700">
                <div>
                  <div className="border-t border-slate-400 pt-1.5 font-semibold text-slate-700 dark:text-slate-300">
                    Prepared By ({po.creator_name || 'Speed Net'})
                  </div>
                </div>
                <div>
                  <div className="border-t border-slate-400 pt-1.5 font-semibold text-slate-700 dark:text-slate-300">
                    Approved Authority
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2 items-center">
              {locked ? (
                <p className="text-sm text-slate-500">
                  <i className="fa-solid fa-lock mr-1"></i>
                  This PO is {po.status} — no further changes allowed.
                </p>
              ) : (
                nextActions.map((next) => (
                  <button
                    key={next}
                    onClick={() => handleStatusChange(next)}
                    disabled={updating}
                    className={`px-4 py-2 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50 ${ACTION_STYLE[next] || 'bg-indigo-600 hover:bg-indigo-700'}`}
                  >
                    {updating ? <i className="fa-solid fa-spinner fa-spin mr-1"></i> : null}
                    Mark as {STATUS_LABEL[next]}
                  </button>
                ))
              )}
              <button
                onClick={handlePrint}
                className="ml-auto px-4 py-2 bg-slate-600 text-white text-sm rounded-lg hover:bg-slate-700 transition-all flex items-center gap-2"
              >
                <i className="fa-solid fa-print"></i> Print
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default PODetailModal;
