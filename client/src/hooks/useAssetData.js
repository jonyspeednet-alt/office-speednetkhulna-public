import { useState, useEffect, useCallback } from 'react';
import {
  getAssetSummary,
  getAssetReports,
  getAssetMasters,
  getAssets,
  saveAsset,
  updateAsset,
  deleteAsset,
  getAssetWarranties,
  getAssetIssues,
  getAssetRepairs,
  getAssetReplacements,
  getAssetMovements,
  getAssetStockItems,
  getAssetStockMovements,
  saveAssetStockItem,
  updateAssetStockItem,
  saveAssetStockMovement,
  saveAssetDesk,
  updateAssetDesk,
  getAssetDeskHistory,
} from '../services/assetService';

export const useAssetOverview = () => {
  const [summary, setSummary] = useState(null);
  const [reports, setReports] = useState({});
  const [masters, setMasters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, reportsRes, mastersRes] = await Promise.allSettled([
        getAssetSummary(),
        getAssetReports(),
        getAssetMasters(),
      ]);
      if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value);
      if (reportsRes.status === 'fulfilled') setReports(reportsRes.value);
      if (mastersRes.status === 'fulfilled') setMasters(mastersRes.value);
      const failed = [summaryRes, reportsRes, mastersRes].filter(r => r.status === 'rejected');
      if (failed.length) setError('Some dashboard data could not be loaded');
    } catch (err) {
      setError('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { summary, reports, masters, loading, error, refetch: load };
};

export const useAssets = () => {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [offices, setOffices] = useState([]);
  const [desks, setDesks] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsRes, mastersRes] = await Promise.allSettled([
        getAssets(),
        getAssetMasters(),
      ]);
      if (itemsRes.status === 'fulfilled') setItems(itemsRes.value || []);
      if (mastersRes.status === 'fulfilled') {
        setCategories(mastersRes.value?.categories || []);
        setOffices(mastersRes.value?.offices || []);
        setDesks(mastersRes.value?.desks || []);
        setVendors(mastersRes.value?.vendors || []);
        setUsers(mastersRes.value?.users || []);
      }
      const failed = [itemsRes, mastersRes].filter(r => r.status === 'rejected');
      if (failed.length) setError('Failed to load assets');
    } catch (err) {
      setError('Failed to load assets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (payload) => {
    await saveAsset(payload);
    await load();
  };

  const update = async (id, payload) => {
    await updateAsset(id, payload);
    await load();
  };

  const remove = async (id, reason) => {
    await deleteAsset(id, reason);
    await load();
  };

  return { items, categories, offices, desks, vendors, users, loading, error, refetch: load, create, update, remove };
};

export const useDesks = () => {
  const [items, setItems] = useState([]);
  const [offices, setOffices] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAssetMasters();
      setItems(res?.desks || []);
      setOffices(res?.offices || []);
      setUsers(res?.users || []);
    } catch (err) {
      setError('Failed to load desks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = async (id, payload) => {
    await updateAssetDesk(id, payload);
    await load();
  };

  const create = async (payload) => {
    await saveAssetDesk(payload);
    await load();
  };

  const getHistory = async (id) => getAssetDeskHistory(id);

  return { items, offices, users, loading, error, refetch: load, create, update, getHistory };
};

export const useStock = () => {
  const [items, setItems] = useState([]);
  const [movements, setMovements] = useState([]);
  const [categories, setCategories] = useState([]);
  const [offices, setOffices] = useState([]);
  const [desks, setDesks] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsRes, movementsRes, mastersRes] = await Promise.allSettled([
        getAssetStockItems(),
        getAssetStockMovements(),
        getAssetMasters(),
      ]);
      if (itemsRes.status === 'fulfilled') setItems(itemsRes.value || []);
      if (movementsRes.status === 'fulfilled') setMovements(movementsRes.value || []);
      if (mastersRes.status === 'fulfilled') {
        setCategories(mastersRes.value?.categories || []);
        setOffices(mastersRes.value?.offices || []);
        setDesks(mastersRes.value?.desks || []);
        setVendors(mastersRes.value?.vendors || []);
      }
      const failed = [itemsRes, movementsRes, mastersRes].filter(r => r.status === 'rejected');
      if (failed.length) setError('Failed to load stock');
    } catch (err) {
      setError('Failed to load stock');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createItem = async (payload) => {
    await saveAssetStockItem(payload);
    await load();
  };

  const updateItem = async (id, payload) => {
    await updateAssetStockItem(id, payload);
    await load();
  };

  const createMovement = async (payload) => {
    await saveAssetStockMovement(payload);
    await load();
  };

  return { items, movements, categories, offices, desks, vendors, loading, error, refetch: load, createItem, updateItem, createMovement };
};

export const useHistory = () => {
  const [items, setItems] = useState([]);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [movementsRes, warrantiesRes, issuesRes, repairsRes, replacementsRes] = await Promise.allSettled([
        getAssetMovements(),
        getAssetWarranties(),
        getAssetIssues(),
        getAssetRepairs(),
        getAssetReplacements(),
      ]);

      const allItems = [];

      if (movementsRes.status === 'fulfilled') {
        allItems.push(...(movementsRes.value || []).map(m => ({
          id: `move-${m.id}`,
          type: 'movement',
          date: m.moved_at,
          title: `Asset moved`,
          details: `${m.from_office_name || '—'} → ${m.to_office_name || '—'}`,
          asset: m.asset_tag,
        })));
      }

      if (warrantiesRes.status === 'fulfilled') {
        allItems.push(...(warrantiesRes.value || []).map(w => ({
          id: `warr-${w.id}`,
          type: 'warranty',
          date: w.warranty_end_date,
          title: `Warranty ${w.status}`,
          details: w.warranty_type || 'Warranty',
          asset: w.asset_tag,
        })));
      }

      if (issuesRes.status === 'fulfilled') {
        setIssues(issuesRes.value || []);
        allItems.push(...(issuesRes.value || []).filter(i => i.status !== 'resolved').map(i => ({
          id: `issue-${i.id}`,
          type: 'issue',
          date: i.reported_at,
          title: i.issue_title,
          details: `Severity: ${i.severity}, Status: ${i.status}`,
          asset: i.asset_tag,
        })));
      }

      if (repairsRes.status === 'fulfilled') {
        allItems.push(...(repairsRes.value || []).map(r => ({
          id: `repair-${r.id}`,
          type: 'repair',
          date: r.completed_at || r.started_at,
          title: 'Repair completed',
          details: r.repair_action || 'Repair',
          asset: r.asset_tag,
        })));
      }

      if (replacementsRes.status === 'fulfilled') {
        allItems.push(...(replacementsRes.value || []).map(r => ({
          id: `repl-${r.id}`,
          type: 'replacement',
          date: r.replaced_at,
          title: 'Asset replaced',
          details: r.replacement_reason || 'Replacement',
          asset: r.old_asset_tag,
        })));
      }

      allItems.sort((a, b) => new Date(b.date) - new Date(a.date));
      setItems(allItems);
    } catch (err) {
      setError('Failed to load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { items, issues, loading, error, refetch: load };
};