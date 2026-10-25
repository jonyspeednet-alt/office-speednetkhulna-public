import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { listPurchaseOrders } from '../services/procurementService';
import PODetailModal from '../components/PODetailModal';

const STATUS_TABS = ['all', 'pending', 'approved', 'ordered', 'received', 'cancelled', 'rejected'];

const getStatusColor = (status) => {
  switch (status) {
    case 'pending': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'approved': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'ordered': return 'bg-purple-100 text-purple-700 border-purple-200';
    case 'received': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'cancelled': return 'bg-rose-100 text-rose-700 border-rose-200';
    case 'rejected': return 'bg-slate-200 text-slate-600 border-slate-300';
    default: return 'bg-slate-100 text-slate-700 border-slate-200';
  }
};

const PAGE_SIZE = 20;

const ViewPOs = () => {
  const [pos, setPos] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPOs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status !== 'all') params.status = status;
      const { rows, total: t } = await listPurchaseOrders(params);
      setPos(rows);
      setTotal(t);
    } catch (err) {
      toast.error('Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, status]);

  useEffect(() => {
    fetchPOs();
  }, [fetchPOs]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <i className="fa-solid fa-list-check text-indigo-500"></i>
            Purchase Orders
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            {total} order{total === 1 ? '' : 's'} — click a row for details &amp; approval
          </p>
        </div>
        <Link
          to="/create-po"
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-md"
        >
          <i className="fa-solid fa-plus"></i> Create PO
        </Link>
      </div>

      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <input
          type="text"
          placeholder="Search PO number or vendor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
        />
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all capitalize ${
                status === s
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-indigo-400'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                <th className="px-6 py-4 text-sm font-semibold text-slate-700 dark:text-slate-300">PO Number</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Vendor</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Order Date</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Items</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Total Amount</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Status</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-700 dark:text-slate-300 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-slate-500">
                    <i className="fa-solid fa-spinner fa-spin text-2xl mb-2"></i>
                    <p>Loading orders...</p>
                  </td>
                </tr>
              ) : pos.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-slate-500">
                    <i className="fa-solid fa-inbox text-3xl mb-2 opacity-20"></i>
                    <p>No purchase orders found</p>
                  </td>
                </tr>
              ) : (
                pos.map((po) => (
                  <tr
                    key={po.id}
                    onClick={() => setSelectedId(po.id)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-4 font-medium text-indigo-600 dark:text-indigo-400">#{po.po_number}</td>
                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300">{po.vendor_name || 'N/A'}</td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400">{po.order_date ? new Date(po.order_date).toLocaleDateString() : '—'}</td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400">{po.item_count ?? '—'}</td>
                    <td className="px-6 py-4 font-semibold text-slate-800 dark:text-white">৳{Number(po.total_amount || 0).toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium border capitalize ${getStatusColor(po.status)}`}>
                        {po.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedId(po.id); }}
                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        title="View details"
                      >
                        <i className="fa-solid fa-eye"></i>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-between items-center px-6 py-4 border-t border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-500">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 border rounded-lg text-sm disabled:opacity-40 dark:border-slate-600 dark:text-slate-300"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 border rounded-lg text-sm disabled:opacity-40 dark:border-slate-600 dark:text-slate-300"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedId && (
        <PODetailModal
          poId={selectedId}
          onClose={() => setSelectedId(null)}
          onStatusChanged={fetchPOs}
        />
      )}
    </div>
  );
};

export default ViewPOs;
