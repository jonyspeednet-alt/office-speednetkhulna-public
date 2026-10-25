import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getAssetSummary,
  getAssetReports,
  getAssetMasters,
  getAssets,
  saveAsset,
  updateAsset,
  getAssetComponents,
  addAssetComponent,
  replaceAssetComponent,
  getAssetComponentMovements,
  getAssetWarranties,
  saveAssetWarranty,
  getAssetIssues,
  saveAssetIssue,
  updateAssetIssueStatus,
  getAssetRepairs,
  saveAssetRepair,
  getAssetReplacements,
  saveAssetReplacement,
  getAssetMovements,
  getAssetStockItems,
  saveAssetStockItem,
  updateAssetStockItem,
  getAssetStockMovements,
  saveAssetStockMovement,
  updateAssetDesk,
  getAssetDeskHistory,
  moveAsset
} from '../services/assetService';
import {
  emptyWarrantyForm,
  emptyIssueForm,
  emptyRepairForm,
  emptyReplacementForm,
  emptyAssetEditForm,
  emptyComponentForm,
  emptyComponentReplaceForm,
  emptyStockItemForm,
  emptyStockMovementForm,
  emptyDeskForm,
  emptyDeskMoveForm
} from './asset-management/constants';
import { apiErrorMessage, getDeskFloorLabel, floorSortKey, getDeskNoSortValue } from './asset-management/utils';
import { Card } from './asset-management/SummaryCards';
import DashboardTab from './asset-management/tabs/DashboardTab';
import DeskMapTab from './asset-management/tabs/DeskMapTab';
import AssetsTab from './asset-management/tabs/AssetsTab';
import WarrantyTab from './asset-management/tabs/WarrantyTab';
import IssuesTab from './asset-management/tabs/IssuesTab';
import RepairsTab from './asset-management/tabs/RepairsTab';
import ReplacementsTab from './asset-management/tabs/ReplacementsTab';
import MovementsTab from './asset-management/tabs/MovementsTab';
import StockTab from './asset-management/tabs/StockTab';
import DeskMoveModal from './asset-management/modals/DeskMoveModal';
import AssetEditModal from './asset-management/modals/AssetEditModal';
import '../styles/AssetManagement.css';

const AssetManagement = () => {
  const [summary, setSummary] = useState(null);
  const [masters, setMasters] = useState({ offices: [], desks: [], categories: [], vendors: [], users: [] });
  const [assets, setAssets] = useState([]);
  const [warranties, setWarranties] = useState([]);
  const [issues, setIssues] = useState([]);
  const [repairs, setRepairs] = useState([]);
  const [replacements, setReplacements] = useState([]);
  const [movements, setMovements] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [stockMovements, setStockMovements] = useState([]);
  const [reports, setReports] = useState({
    assets_by_office: [],
    assets_by_category: [],
    asset_status_counts: [],
    warranty_soon_assets: [],
    open_issues: [],
    low_stock_items: [],
    vendor_spend: [],
    monthly_purchase_summary: [],
    repair_cost_summary: []
  });
  const [search, setSearch] = useState('');
  const [assetOfficeFilter, setAssetOfficeFilter] = useState('all');
  const [assetCategoryFilter, setAssetCategoryFilter] = useState('all');
  const [assetStatusFilter, setAssetStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState('assets');
  const [editingAsset, setEditingAsset] = useState(null);
  const [creatingAsset, setCreatingAsset] = useState(false);
  const [editingStockItem, setEditingStockItem] = useState(null);
  const [assetComponents, setAssetComponents] = useState([]);
  const [componentMovements, setComponentMovements] = useState([]);
  const [componentForm, setComponentForm] = useState(emptyComponentForm);
  const [componentReplaceForm, setComponentReplaceForm] = useState(emptyComponentReplaceForm);
  const [componentBusy, setComponentBusy] = useState(false);
  const [componentStatus, setComponentStatus] = useState(null);
  const [warrantyForm, setWarrantyForm] = useState(emptyWarrantyForm);
  const [issueForm, setIssueForm] = useState(emptyIssueForm);
  const [repairForm, setRepairForm] = useState(emptyRepairForm);
  const [replacementForm, setReplacementForm] = useState(emptyReplacementForm);
  const [assetEditForm, setAssetEditForm] = useState(emptyAssetEditForm);
  const [stockItemForm, setStockItemForm] = useState(emptyStockItemForm);
  const [stockEditForm, setStockEditForm] = useState(emptyStockItemForm);
  const [stockMovementForm, setStockMovementForm] = useState(emptyStockMovementForm);
  const [deskOfficeFilter, setDeskOfficeFilter] = useState('all');
  const [deskFloorFilter, setDeskFloorFilter] = useState('all');
  const [deskSearch, setDeskSearch] = useState('');
  const [selectedDeskId, setSelectedDeskId] = useState(null);
  const [deskForm, setDeskForm] = useState(emptyDeskForm);
  const [deskMoveForm, setDeskMoveForm] = useState(emptyDeskMoveForm);
  const [deskMoveModalOpen, setDeskMoveModalOpen] = useState(false);
  const [deskMoveError, setDeskMoveError] = useState('');
  const [deskAssignmentSaving, setDeskAssignmentSaving] = useState(false);
  const [deskAssignmentStatus, setDeskAssignmentStatus] = useState(null);
  const [deskHistory, setDeskHistory] = useState([]);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const showToast = (type, message) => {
    setToast({ type, message });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const assetOptions = useMemo(() => assets, [assets]);

  const load = async (assetSearch = search) => {
    setLoading(true);
    setLoadError('');
    try {
      const [
        summaryResult,
        reportsResult,
        mastersResult,
        assetsResult,
        warrantiesResult,
        issuesResult,
        repairsResult,
        replacementsResult,
        movementsResult,
        stockItemsResult,
        stockMovementsResult
      ] = await Promise.allSettled([
        getAssetSummary(),
        getAssetReports(),
        getAssetMasters(),
        getAssets({ search: assetSearch }),
        getAssetWarranties(),
        getAssetIssues(),
        getAssetRepairs(),
        getAssetReplacements(),
        getAssetMovements(),
        getAssetStockItems(),
        getAssetStockMovements()
      ]);

      const pickValue = (result, fallback) => (result.status === 'fulfilled' ? result.value : fallback);
      const failedResults = [
        summaryResult,
        reportsResult,
        mastersResult,
        assetsResult,
        warrantiesResult,
        issuesResult,
        repairsResult,
        replacementsResult,
        movementsResult,
        stockItemsResult,
        stockMovementsResult
      ].filter((result) => result.status === 'rejected');

      const summaryData = pickValue(summaryResult, null);
      const reportsData = pickValue(reportsResult, null);
      const mastersData = pickValue(mastersResult, null);
      const assetsData = pickValue(assetsResult, []);
      const warrantiesData = pickValue(warrantiesResult, []);
      const issuesData = pickValue(issuesResult, []);
      const repairsData = pickValue(repairsResult, []);
      const replacementsData = pickValue(replacementsResult, []);
      const movementsData = pickValue(movementsResult, []);
      const stockItemsData = pickValue(stockItemsResult, []);
      const stockMovementsData = pickValue(stockMovementsResult, []);

      setSummary(summaryData);
      setReports({
        assets_by_office: Array.isArray(reportsData?.assets_by_office) ? reportsData.assets_by_office : [],
        assets_by_category: Array.isArray(reportsData?.assets_by_category) ? reportsData.assets_by_category : [],
        asset_status_counts: Array.isArray(reportsData?.asset_status_counts) ? reportsData.asset_status_counts : [],
        warranty_soon_assets: Array.isArray(reportsData?.warranty_soon_assets) ? reportsData.warranty_soon_assets : [],
        open_issues: Array.isArray(reportsData?.open_issues) ? reportsData.open_issues : [],
        low_stock_items: Array.isArray(reportsData?.low_stock_items) ? reportsData.low_stock_items : [],
        vendor_spend: Array.isArray(reportsData?.vendor_spend) ? reportsData.vendor_spend : [],
        monthly_purchase_summary: Array.isArray(reportsData?.monthly_purchase_summary) ? reportsData.monthly_purchase_summary : [],
        repair_cost_summary: Array.isArray(reportsData?.repair_cost_summary) ? reportsData.repair_cost_summary : []
      });
      setMasters({
        offices: Array.isArray(mastersData?.offices) ? mastersData.offices : [],
        desks: Array.isArray(mastersData?.desks) ? mastersData.desks : [],
        categories: Array.isArray(mastersData?.categories) ? mastersData.categories : [],
        vendors: Array.isArray(mastersData?.vendors) ? mastersData.vendors : [],
        users: Array.isArray(mastersData?.users) ? mastersData.users : []
      });
      setAssets(Array.isArray(assetsData) ? assetsData : []);
      setWarranties(Array.isArray(warrantiesData) ? warrantiesData : []);
      setIssues(Array.isArray(issuesData) ? issuesData : []);
      setRepairs(Array.isArray(repairsData) ? repairsData : []);
      setReplacements(Array.isArray(replacementsData) ? replacementsData : []);
      setMovements(Array.isArray(movementsData) ? movementsData : []);
      setStockItems(Array.isArray(stockItemsData) ? stockItemsData : []);
      setStockMovements(Array.isArray(stockMovementsData) ? stockMovementsData : []);

      if (failedResults.length) {
        const unauthorized = failedResults.some((result) => Number(result.reason?.response?.status) === 403);
        setLoadError(
          unauthorized
            ? 'You do not have permission to view Asset Management data yet.'
            : 'Some asset data could not be loaded right now. Desk map may be partially available.'
        );
      }
    } catch (error) {
      console.error('[AssetManagement] load:', error);
      const statusCode = Number(error?.response?.status || 0);
      setLoadError(
        statusCode === 403
          ? 'You do not have permission to view Asset Management data yet.'
          : 'Asset Management data could not be loaded right now.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load(search);
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const loadAssetComponentData = async (assetId) => {
    if (!assetId) {
      setAssetComponents([]);
      setComponentMovements([]);
      return;
    }
    const [componentsData, movementsData] = await Promise.all([
      getAssetComponents(assetId),
      getAssetComponentMovements(assetId)
    ]);
    setAssetComponents(Array.isArray(componentsData) ? componentsData : []);
    setComponentMovements(Array.isArray(movementsData) ? movementsData : []);
  };

  useEffect(() => {
    const assetId = editingAsset?.id;
    if (!assetId) {
      setAssetComponents([]);
      setComponentMovements([]);
      return;
    }
    loadAssetComponentData(assetId).catch((error) => {
      console.error('[AssetManagement] loadAssetComponentData:', error);
      setAssetComponents([]);
      setComponentMovements([]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingAsset]);

  const submitWarranty = async (event) => {
    event.preventDefault();
    if (!warrantyForm.asset_id) {
      showToast('error', 'Select an asset before saving the warranty.');
      return;
    }
    try {
      await saveAssetWarranty(warrantyForm);
      setWarrantyForm(emptyWarrantyForm);
      await load();
      showToast('success', 'Warranty saved successfully.');
    } catch (error) {
      showToast('error', apiErrorMessage(error, 'Failed to save warranty.'));
    }
  };

  const submitIssue = async (event) => {
    event.preventDefault();
    if (!issueForm.asset_id || !issueForm.issue_title.trim()) {
      showToast('error', 'Asset and issue title are required.');
      return;
    }
    try {
      await saveAssetIssue(issueForm);
      setIssueForm(emptyIssueForm);
      await load();
      showToast('success', 'Issue reported successfully.');
    } catch (error) {
      showToast('error', apiErrorMessage(error, 'Failed to save issue.'));
    }
  };

  const submitRepair = async (event) => {
    event.preventDefault();
    if (!repairForm.asset_id) {
      showToast('error', 'Select an asset before saving the repair log.');
      return;
    }
    try {
      await saveAssetRepair(repairForm);
      setRepairForm(emptyRepairForm);
      await load();
      showToast('success', 'Repair log saved successfully.');
    } catch (error) {
      showToast('error', apiErrorMessage(error, 'Failed to save repair log.'));
    }
  };

  const submitReplacement = async (event) => {
    event.preventDefault();
    if (!replacementForm.old_asset_id) {
      showToast('error', 'Select the old asset before saving the replacement.');
      return;
    }
    try {
      await saveAssetReplacement(replacementForm);
      setReplacementForm(emptyReplacementForm);
      await load();
      showToast('success', 'Replacement saved successfully.');
    } catch (error) {
      showToast('error', apiErrorMessage(error, 'Failed to save replacement.'));
    }
  };

  const openAssetEdit = (asset) => {
    setCreatingAsset(false);
    setEditingAsset(asset);
    setComponentForm(emptyComponentForm);
    setComponentReplaceForm(emptyComponentReplaceForm);
    setComponentStatus(null);
    setAssetEditForm({
      asset_tag: asset.asset_tag || '',
      asset_name: asset.asset_name || '',
      category_id: asset.category_id || '',
      vendor_id: asset.vendor_id || '',
      office_id: asset.office_id || '',
      desk_id: asset.desk_id || '',
      assigned_user_id: asset.assigned_user_id || '',
      brand: asset.brand || '',
      model: asset.model || '',
      serial_number: asset.serial_number || '',
      purchase_date: asset.purchase_date || '',
      purchase_price: asset.purchase_price ?? '',
      warranty_start_date: asset.warranty_start_date || '',
      warranty_end_date: asset.warranty_end_date || '',
      warranty_type: asset.warranty_type || '',
      status: asset.status || 'in_stock',
      condition: asset.condition || 'good',
      notes: asset.notes || '',
      warranty_notes: asset.warranty_notes || ''
    });
  };

  const openStockEdit = (item) => {
    setCreatingAsset(false);
    setEditingStockItem(item);
    setStockEditForm({
      item_code: item.item_code || '',
      item_name: item.item_name || '',
      item_type: item.item_type || 'spare',
      category_id: item.category_id || '',
      vendor_id: item.vendor_id || '',
      office_id: item.office_id || '',
      desk_id: item.desk_id || '',
      quantity_on_hand: item.quantity_on_hand ?? 0,
      minimum_quantity: item.minimum_quantity ?? 0,
      unit_price: item.unit_price ?? '',
      serial_number: item.serial_number || '',
      status: item.status || 'available',
      notes: item.notes || ''
    });
  };

  const openDeskDetail = (desk) => {
    setSelectedDeskId(desk.id);
    setDeskForm({
      office_id: desk.office_id || '',
      desk_label: desk.desk_label || '',
      official_email: desk.official_email || '',
      assigned_user_id: desk.assigned_user_id || '',
      floor_label: desk.floor_label || '',
      location_note: desk.location_note || ''
    });
    setDeskMoveForm(emptyDeskMoveForm);
    setDeskMoveModalOpen(false);
    setDeskMoveError('');
    setDeskAssignmentStatus(null);
    setDeskHistory([]);
  };

  const openDeskMoveModal = (assetId = '') => {
    if (!selectedDesk) return;
    const moveReason = `Moved from Desk ${selectedDesk.desk_no}`;
    setDeskMoveForm({
      asset_id: assetId ? String(assetId) : '',
      to_office_id: selectedDesk.office_id ? String(selectedDesk.office_id) : '',
      to_desk_id: '',
      reason: moveReason
    });
    setDeskMoveError('');
    setDeskMoveModalOpen(true);
  };

  const closeDeskMoveModal = () => {
    setDeskMoveModalOpen(false);
    setDeskMoveError('');
    setDeskMoveForm(emptyDeskMoveForm);
  };

  const closeEdit = () => {
    setCreatingAsset(false);
    setEditingAsset(null);
    setEditingStockItem(null);
    setAssetEditForm(emptyAssetEditForm);
    setStockEditForm(emptyStockItemForm);
    setAssetComponents([]);
    setComponentMovements([]);
    setComponentForm(emptyComponentForm);
    setComponentReplaceForm(emptyComponentReplaceForm);
    setComponentStatus(null);
  };

  const openAddAsset = () => {
    setCreatingAsset(true);
    setEditingStockItem(null);
    setEditingAsset(null);
    setAssetComponents([]);
    setComponentMovements([]);
    setComponentForm(emptyComponentForm);
    setComponentReplaceForm(emptyComponentReplaceForm);
    setComponentStatus(null);
    setAssetEditForm({
      ...emptyAssetEditForm,
      office_id: selectedDesk?.office_id || '',
      desk_id: selectedDesk?.id || '',
      assigned_user_id: selectedDesk?.assigned_user_id || ''
    });
  };

  const submitAssetEdit = async (event) => {
    event.preventDefault();
    if (!editingAsset) return;
    try {
      await updateAsset(editingAsset.id, assetEditForm);
      closeEdit();
      await load();
      showToast('success', 'Asset updated successfully.');
    } catch (error) {
      showToast('error', apiErrorMessage(error, 'Failed to update asset.'));
    }
  };

  const submitAssetComponent = async () => {
    if (!editingAsset?.id) return;
    if (!componentForm.component_type || !componentForm.component_name) {
      setComponentStatus({ type: 'error', message: 'Component type and component name are required.' });
      return;
    }
    setComponentBusy(true);
    setComponentStatus(null);
    try {
      await addAssetComponent(editingAsset.id, componentForm);
      setComponentForm(emptyComponentForm);
      await loadAssetComponentData(editingAsset.id);
      await load(search);
      setComponentStatus({ type: 'success', message: 'Component added successfully.' });
    } catch (error) {
      setComponentStatus({ type: 'error', message: apiErrorMessage(error, 'Failed to add component.') });
    } finally {
      setComponentBusy(false);
    }
  };

  const submitComponentReplace = async () => {
    if (!editingAsset?.id) return;
    if (!componentReplaceForm.component_id) {
      setComponentStatus({ type: 'error', message: 'Select a component to replace.' });
      return;
    }
    if (!componentReplaceForm.serial_number) {
      setComponentStatus({ type: 'error', message: 'New serial number is required for replacement.' });
      return;
    }
    setComponentBusy(true);
    setComponentStatus(null);
    try {
      await replaceAssetComponent(componentReplaceForm.component_id, componentReplaceForm);
      setComponentReplaceForm(emptyComponentReplaceForm);
      await loadAssetComponentData(editingAsset.id);
      await load(search);
      setComponentStatus({ type: 'success', message: 'Component replaced successfully.' });
    } catch (error) {
      setComponentStatus({ type: 'error', message: apiErrorMessage(error, 'Failed to replace component.') });
    } finally {
      setComponentBusy(false);
    }
  };

  const submitAssetCreate = async (event) => {
    event.preventDefault();
    if (!assetEditForm.asset_name.trim()) {
      showToast('error', 'Asset name is required.');
      return;
    }
    try {
      await saveAsset(assetEditForm);
      closeEdit();
      await load();
      showToast('success', 'Asset created successfully.');
    } catch (error) {
      showToast('error', apiErrorMessage(error, 'Failed to create asset.'));
    }
  };

  const submitStockEdit = async (event) => {
    event.preventDefault();
    if (!editingStockItem) return;
    try {
      await updateAssetStockItem(editingStockItem.id, stockEditForm);
      closeEdit();
      await load();
      showToast('success', 'Stock item updated successfully.');
    } catch (error) {
      showToast('error', apiErrorMessage(error, 'Failed to update stock item.'));
    }
  };

  const submitStockItem = async (event) => {
    event.preventDefault();
    if (!stockItemForm.item_name.trim()) {
      showToast('error', 'Item name is required.');
      return;
    }
    try {
      await saveAssetStockItem(stockItemForm);
      setStockItemForm(emptyStockItemForm);
      await load();
      showToast('success', 'Stock item saved successfully.');
    } catch (error) {
      showToast('error', apiErrorMessage(error, 'Failed to save stock item.'));
    }
  };

  const submitStockMovement = async (event) => {
    event.preventDefault();
    if (!stockMovementForm.stock_item_id || !String(stockMovementForm.quantity_change).trim()) {
      showToast('error', 'Stock item and quantity change are required.');
      return;
    }
    try {
      await saveAssetStockMovement(stockMovementForm);
      setStockMovementForm(emptyStockMovementForm);
      await load();
      showToast('success', 'Stock movement saved successfully.');
    } catch (error) {
      showToast('error', apiErrorMessage(error, 'Failed to save stock movement.'));
    }
  };

  const submitDeskAssignment = async (event) => {
    event.preventDefault();
    if (!selectedDeskId) return;
    setDeskAssignmentSaving(true);
    setDeskAssignmentStatus(null);
    try {
      const updatedDesk = await updateAssetDesk(selectedDeskId, deskForm);
      setMasters((prev) => ({
        ...prev,
        desks: (prev.desks || []).map((desk) => (
          String(desk.id) === String(selectedDeskId)
            ? { ...desk, ...updatedDesk }
            : desk
        ))
      }));

      setDeskAssignmentStatus({ type: 'success', message: 'Desk assignment updated successfully.' });

      // Refresh history in background; avoid blocking save UX on this secondary request.
      if (selectedDeskId) {
        getAssetDeskHistory(selectedDeskId)
          .then((history) => setDeskHistory(Array.isArray(history) ? history : []))
          .catch((historyError) => {
            console.error('[AssetManagement] getAssetDeskHistory after save:', historyError);
          });
      }
    } catch (error) {
      setDeskAssignmentStatus({ type: 'error', message: apiErrorMessage(error, 'Failed to update desk assignment.') });
    } finally {
      setDeskAssignmentSaving(false);
    }
  };

  const submitDeskAssetMove = async (event) => {
    event.preventDefault();
    const destinationDesk = (masters.desks || []).find((desk) => String(desk.id) === String(deskMoveForm.to_desk_id));
    if (!deskMoveForm.asset_id) {
      setDeskMoveError('Select an asset to transfer.');
      return;
    }
    if (!deskMoveForm.to_desk_id) {
      setDeskMoveError('Select a destination desk.');
      return;
    }
    if (String(deskMoveForm.to_desk_id) === String(selectedDeskId)) {
      setDeskMoveError('Destination desk must be different from current desk.');
      return;
    }
    setDeskMoveError('');
    try {
      await moveAsset(deskMoveForm.asset_id, {
        to_office_id: deskMoveForm.to_office_id || destinationDesk?.office_id || null,
        to_desk_id: deskMoveForm.to_desk_id || null,
        reason: deskMoveForm.reason || 'Moved from desk map'
      });
      closeDeskMoveModal();
      await load();
      showToast('success', 'Asset transferred successfully.');
    } catch (error) {
      setDeskMoveError(apiErrorMessage(error, 'Failed to move asset.'));
    }
  };

  const issueComplete = async (issue) => {
    try {
      await updateAssetIssueStatus(issue.id, {
        status: 'resolved',
        close_issue: true,
        resolution_notes: 'Marked resolved from asset management'
      });
      await load();
      showToast('success', `Issue "${issue.issue_title}" marked resolved.`);
    } catch (error) {
      showToast('error', apiErrorMessage(error, 'Failed to resolve issue.'));
    }
  };

  const openIssueCount = useMemo(
    () => issues.filter((issue) => String(issue.status || '').toLowerCase() !== 'resolved').length,
    [issues]
  );

  const lowStockCount = useMemo(
    () => stockItems.filter((item) => Number(item.quantity_on_hand || 0) <= Number(item.minimum_quantity || 0)).length,
    [stockItems]
  );

  const tabs = [
    { key: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie' },
    { key: 'desks', label: 'Desk Map', icon: 'fa-table-cells-large', count: (masters.desks || []).length },
    { key: 'assets', label: 'Assets', icon: 'fa-laptop', count: assets.length },
    { key: 'warranties', label: 'Warranty Tracker', icon: 'fa-shield-halved', count: warranties.length },
    { key: 'issues', label: 'Issues', icon: 'fa-triangle-exclamation', count: openIssueCount, tone: openIssueCount ? 'danger' : undefined, countTitle: `${openIssueCount} open issues` },
    { key: 'repairs', label: 'Repairs', icon: 'fa-screwdriver-wrench', count: repairs.length },
    { key: 'replacements', label: 'Replacement', icon: 'fa-rotate', count: replacements.length },
    { key: 'movements', label: 'Movements', icon: 'fa-truck-arrow-right', count: movements.length },
    { key: 'stock', label: 'Stock Room', icon: 'fa-boxes-stacked', count: lowStockCount, tone: lowStockCount ? 'warning' : undefined, countTitle: `${lowStockCount} low stock items` }
  ];

  const assetStatusOptions = useMemo(() => {
    const unique = new Set(
      assets
        .map((asset) => String(asset.status || '').trim())
        .filter(Boolean)
    );
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [assets]);

  const filteredAssets = useMemo(() => (
    assets.filter((asset) => {
      const officeMatch = assetOfficeFilter === 'all' || String(asset.office_id) === String(assetOfficeFilter);
      const categoryMatch = assetCategoryFilter === 'all' || String(asset.category_id) === String(assetCategoryFilter);
      const statusMatch = assetStatusFilter === 'all' || String(asset.status) === String(assetStatusFilter);
      return officeMatch && categoryMatch && statusMatch;
    })
  ), [assets, assetOfficeFilter, assetCategoryFilter, assetStatusFilter]);

  const filteredAssetSummary = useMemo(() => ({
    active: filteredAssets.filter((asset) => String(asset.status || '').toLowerCase() === 'active').length,
    warrantySoon: filteredAssets.filter((asset) => {
      const raw = String(asset.warranty_end_date || '').trim();
      if (!raw) return false;
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return false;
      const now = new Date();
      const in30Days = new Date();
      in30Days.setDate(now.getDate() + 30);
      return date >= now && date <= in30Days;
    }).length,
    assigned: filteredAssets.filter((asset) => asset.desk_id || asset.assigned_user_id).length
  }), [filteredAssets]);

  const deskCards = useMemo(() => {
    const query = deskSearch.trim().toLowerCase();
    return (masters.desks || []).filter((desk) => {
      const officeMatch = deskOfficeFilter === 'all' || String(desk.office_id) === String(deskOfficeFilter);
      if (!officeMatch) return false;
      if (!query) return true;
      const haystack = [
        desk.office_name,
        desk.office_code,
        desk.desk_no,
        desk.desk_label,
        desk.official_email,
        desk.assigned_user_name,
        desk.assigned_user_email,
        desk.assigned_user_designation,
        desk.assigned_user_department,
        desk.floor_label
      ].map((value) => String(value || '').toLowerCase()).join(' ');
      return haystack.includes(query);
    });
  }, [deskOfficeFilter, deskSearch, masters.desks]);

  const deskFloorOptions = useMemo(() => {
    const unique = new Set();
    deskCards.forEach((desk) => unique.add(getDeskFloorLabel(desk)));
    return Array.from(unique).sort((a, b) => {
      const floorDiff = floorSortKey(a) - floorSortKey(b);
      if (floorDiff !== 0) return floorDiff;
      return a.localeCompare(b);
    });
  }, [deskCards]);

  const officeMetaById = useMemo(() => {
    const map = new Map();
    (masters.offices || []).forEach((office) => {
      const parsedSortOrder = Number(office?.sort_order);
      map.set(String(office.id), {
        office_type: String(office?.office_type || 'branch_office').toLowerCase(),
        office_code: String(office?.code || '').toUpperCase(),
        sort_order: Number.isFinite(parsedSortOrder) ? parsedSortOrder : 999,
        office_name: String(office?.name || '')
      });
    });
    return map;
  }, [masters.offices]);

  const selectedDesk = useMemo(
    () => (masters.desks || []).find((desk) => String(desk.id) === String(selectedDeskId)) || null,
    [masters.desks, selectedDeskId]
  );
  const selectedDeskOffice = useMemo(
    () => masters.offices.find((office) => String(office.id) === String(deskForm.office_id)) || null,
    [masters.offices, deskForm.office_id]
  );

  const selectedDeskAssets = useMemo(
    () => assets.filter((asset) => String(asset.desk_id) === String(selectedDeskId)),
    [assets, selectedDeskId]
  );

  const selectedDeskStockItems = useMemo(
    () => stockItems.filter((item) => String(item.desk_id) === String(selectedDeskId)),
    [stockItems, selectedDeskId]
  );

  const deskMoveDestinationDesks = useMemo(() => (
    (masters.desks || []).filter((desk) => {
      if (String(desk.id) === String(selectedDeskId)) return false;
      if (!deskMoveForm.to_office_id) return true;
      return String(desk.office_id) === String(deskMoveForm.to_office_id);
    })
  ), [masters.desks, selectedDeskId, deskMoveForm.to_office_id]);

  useEffect(() => {
    const loadDeskHistory = async () => {
      if (!selectedDeskId) {
        setDeskHistory([]);
        return;
      }
      try {
        const history = await getAssetDeskHistory(selectedDeskId);
        setDeskHistory(Array.isArray(history) ? history : []);
      } catch (error) {
        console.error('[AssetManagement] getAssetDeskHistory:', error);
        setDeskHistory([]);
      }
    };

    loadDeskHistory();
  }, [selectedDeskId]);

  useEffect(() => {
    const anyModalOpen = deskMoveModalOpen || creatingAsset || Boolean(editingAsset) || Boolean(editingStockItem);
    if (!anyModalOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (deskMoveModalOpen) {
        closeDeskMoveModal();
      } else {
        closeEdit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deskMoveModalOpen, creatingAsset, editingAsset, editingStockItem]);

  useEffect(() => {
    if (deskFloorFilter === 'all') return;
    if (!deskFloorOptions.includes(deskFloorFilter)) {
      setDeskFloorFilter('all');
    }
  }, [deskFloorFilter, deskFloorOptions]);

  const deskGroups = useMemo(() => {
    const byGroup = new Map();

    deskCards.forEach((desk) => {
      const floorLabel = getDeskFloorLabel(desk);
      if (deskFloorFilter !== 'all' && floorLabel !== deskFloorFilter) return;

      const officeMeta = officeMetaById.get(String(desk.office_id));
      const officeType = officeMeta?.office_type === 'head_office' || String(desk.office_code || '').toUpperCase() === 'HQ'
        ? 'head_office'
        : 'branch_office';
      const key = `${desk.office_id}:${floorLabel}`;
      if (!byGroup.has(key)) {
        byGroup.set(key, {
          office_id: desk.office_id,
          office_name: officeMeta?.office_name || desk.office_name,
          office_code: officeMeta?.office_code || desk.office_code,
          office_sort_order: officeMeta?.sort_order ?? 999,
          office_type: officeType,
          floor_label: floorLabel,
          desks: []
        });
      }
      byGroup.get(key).desks.push(desk);
    });

    const groups = Array.from(byGroup.values()).map((group) => ({
      ...group,
      desks: [...group.desks].sort((a, b) => {
        const deskNoDiff = getDeskNoSortValue(a?.desk_no) - getDeskNoSortValue(b?.desk_no);
        if (deskNoDiff !== 0) return deskNoDiff;
        return String(a?.desk_no || '').localeCompare(String(b?.desk_no || ''));
      })
    }));

    return groups.sort((a, b) => {
      if (a.office_type !== b.office_type) {
        return a.office_type === 'head_office' ? -1 : 1;
      }
      const sortOrderDiff = (a.office_sort_order ?? 999) - (b.office_sort_order ?? 999);
      if (sortOrderDiff !== 0) return sortOrderDiff;
      const officeDiff = String(a.office_name || '').localeCompare(String(b.office_name || ''));
      if (officeDiff !== 0) return officeDiff;
      return floorSortKey(a.floor_label) - floorSortKey(b.floor_label);
    });
  }, [deskCards, deskFloorFilter, officeMetaById]);

  const deskSections = useMemo(() => {
    const headOfficeGroups = deskGroups.filter((group) => group.office_type === 'head_office');
    const branchOfficeGroups = deskGroups.filter((group) => group.office_type !== 'head_office');

    return [
      {
        key: 'head',
        label: 'Head Office',
        subtitle: 'HQ desks together',
        groups: headOfficeGroups
      },
      {
        key: 'branch',
        label: 'Branch Offices',
        subtitle: 'All branches grouped together',
        groups: branchOfficeGroups
      }
    ].filter((section) => section.groups.length);
  }, [deskGroups]);

  return (
    <div className="asset-management-page container-fluid py-4">
      <div className="asset-hero mb-4">
        <div className="asset-hero-copy">
          <div className="asset-hero-kicker">Operations control</div>
          <h3 className="fw-bold mb-2">Asset Management</h3>
          <p className="asset-hero-text mb-3">
            Track office IT assets, desk placement, warranty, issues, repairs, replacement history, and spare stock from one register.
          </p>
          <div className="asset-hero-chips">
            <span className="asset-chip">4 offices</span>
            <span className="asset-chip">{summary?.assets ?? 0} assets</span>
            <span className="asset-chip">{summary?.warranty_soon ?? 0} expiring soon</span>
            <span className="asset-chip">{summary?.low_stock_items ?? 0} low stock</span>
          </div>
        </div>
        <div className="asset-hero-actions">
          <div className="asset-search">
            <i className="fa-solid fa-magnifying-glass" />
            <input
              className="form-control border-0 shadow-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets by tag, name, brand, model"
            />
          </div>
          <button className="btn btn-primary asset-search-btn" onClick={() => load(search)}>
            Search assets
          </button>
        </div>
      </div>

      {loadError && (
        <div className={`alert ${loadError.includes('permission') ? 'alert-warning' : 'alert-danger'} mb-4`} role="alert">
          {loadError}
        </div>
      )}

      {loading && (
        <div className="asset-loading-strip mb-4" role="status">
          <span className="spinner-border spinner-border-sm" aria-hidden="true" />
          <span>Loading asset data...</span>
        </div>
      )}

      <div className="row g-3 mb-4 asset-summary-grid">
        <div className="col-md-3"><Card label="Offices" value={summary?.offices ?? 0} hint="Head office and branches" tone="blue" /></div>
        <div className="col-md-3"><Card label="Assets" value={summary?.assets ?? 0} hint="Registered items" tone="gold" /></div>
        <div className="col-md-3"><Card label="Warranty Soon" value={summary?.warranty_soon ?? 0} hint="Expiring within 30 days" tone="rose" /></div>
        <div className="col-md-3"><Card label="Low Stock" value={summary?.low_stock_items ?? 0} hint={`${summary?.stock_quantity ?? 0} total spare units`} tone="teal" /></div>
      </div>

      <div className="card shadow-sm mb-4 asset-tab-rail">
        <div className="card-body d-flex gap-2 flex-wrap">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`btn asset-tab-btn ${activeTab === tab.key ? 'asset-tab-btn-active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
              title={tab.countTitle || undefined}
            >
              {tab.icon && <i className={`fa-solid ${tab.icon} me-1`} aria-hidden="true" />}
              {tab.label}
              {typeof tab.count === 'number' && tab.count > 0 && (
                <span className={`asset-tab-count ${tab.tone ? `asset-tab-count-${tab.tone}` : ''}`}>{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'desks' && (
        <DeskMapTab
          masters={masters}
          loading={loading}
          deskSearch={deskSearch}
          setDeskSearch={setDeskSearch}
          deskOfficeFilter={deskOfficeFilter}
          setDeskOfficeFilter={setDeskOfficeFilter}
          deskFloorFilter={deskFloorFilter}
          setDeskFloorFilter={setDeskFloorFilter}
          deskFloorOptions={deskFloorOptions}
          deskGroups={deskGroups}
          deskSections={deskSections}
          selectedDeskId={selectedDeskId}
          selectedDesk={selectedDesk}
          selectedDeskOffice={selectedDeskOffice}
          openDeskDetail={openDeskDetail}
          deskForm={deskForm}
          setDeskForm={setDeskForm}
          submitDeskAssignment={submitDeskAssignment}
          deskAssignmentSaving={deskAssignmentSaving}
          deskAssignmentStatus={deskAssignmentStatus}
          selectedDeskAssets={selectedDeskAssets}
          selectedDeskStockItems={selectedDeskStockItems}
          deskHistory={deskHistory}
          openDeskMoveModal={openDeskMoveModal}
        />
      )}
      {activeTab === 'assets' && (
        <AssetsTab
          masters={masters}
          assets={assets}
          filteredAssets={filteredAssets}
          filteredAssetSummary={filteredAssetSummary}
          assetOfficeFilter={assetOfficeFilter}
          setAssetOfficeFilter={setAssetOfficeFilter}
          assetCategoryFilter={assetCategoryFilter}
          setAssetCategoryFilter={setAssetCategoryFilter}
          assetStatusFilter={assetStatusFilter}
          setAssetStatusFilter={setAssetStatusFilter}
          assetStatusOptions={assetStatusOptions}
          openAddAsset={openAddAsset}
          openAssetEdit={openAssetEdit}
          loading={loading}
        />
      )}
      {activeTab === 'dashboard' && (
        <DashboardTab
          assets={assets}
          openIssueCount={openIssueCount}
          lowStockCount={lowStockCount}
          reports={reports}
          loading={loading}
          setActiveTab={setActiveTab}
        />
      )}
      {activeTab === 'warranties' && (
        <WarrantyTab
          warrantyForm={warrantyForm}
          setWarrantyForm={setWarrantyForm}
          submitWarranty={submitWarranty}
          assetOptions={assetOptions}
          masters={masters}
          warranties={warranties}
          loading={loading}
        />
      )}
      {activeTab === 'issues' && (
        <IssuesTab
          issueForm={issueForm}
          setIssueForm={setIssueForm}
          submitIssue={submitIssue}
          assetOptions={assetOptions}
          masters={masters}
          issues={issues}
          issueComplete={issueComplete}
          loading={loading}
        />
      )}
      {activeTab === 'repairs' && (
        <RepairsTab
          repairForm={repairForm}
          setRepairForm={setRepairForm}
          submitRepair={submitRepair}
          assetOptions={assetOptions}
          issues={issues}
          masters={masters}
          repairs={repairs}
          loading={loading}
        />
      )}
      {activeTab === 'replacements' && (
        <ReplacementsTab
          replacementForm={replacementForm}
          setReplacementForm={setReplacementForm}
          submitReplacement={submitReplacement}
          assetOptions={assetOptions}
          replacements={replacements}
          loading={loading}
        />
      )}
      {activeTab === 'movements' && <MovementsTab movements={movements} loading={loading} />}
      {activeTab === 'stock' && (
        <StockTab
          stockItemForm={stockItemForm}
          setStockItemForm={setStockItemForm}
          submitStockItem={submitStockItem}
          masters={masters}
          stockItems={stockItems}
          openStockEdit={openStockEdit}
          stockMovementForm={stockMovementForm}
          setStockMovementForm={setStockMovementForm}
          submitStockMovement={submitStockMovement}
          stockMovements={stockMovements}
          loading={loading}
        />
      )}
      {deskMoveModalOpen && selectedDesk && (
        <DeskMoveModal
          selectedDesk={selectedDesk}
          masters={masters}
          deskMoveForm={deskMoveForm}
          setDeskMoveForm={setDeskMoveForm}
          deskMoveError={deskMoveError}
          selectedDeskAssets={selectedDeskAssets}
          deskMoveDestinationDesks={deskMoveDestinationDesks}
          closeDeskMoveModal={closeDeskMoveModal}
          submitDeskAssetMove={submitDeskAssetMove}
        />
      )}
      {(creatingAsset || editingAsset || editingStockItem) && (
        <AssetEditModal
          creatingAsset={creatingAsset}
          editingAsset={editingAsset}
          editingStockItem={editingStockItem}
          closeEdit={closeEdit}
          submitAssetCreate={submitAssetCreate}
          submitAssetEdit={submitAssetEdit}
          submitStockEdit={submitStockEdit}
          assetEditForm={assetEditForm}
          setAssetEditForm={setAssetEditForm}
          stockEditForm={stockEditForm}
          setStockEditForm={setStockEditForm}
          masters={masters}
          assetComponents={assetComponents}
          componentMovements={componentMovements}
          componentForm={componentForm}
          setComponentForm={setComponentForm}
          componentReplaceForm={componentReplaceForm}
          setComponentReplaceForm={setComponentReplaceForm}
          componentBusy={componentBusy}
          componentStatus={componentStatus}
          submitAssetComponent={submitAssetComponent}
          submitComponentReplace={submitComponentReplace}
        />
      )}
      {toast && (
        <div className={`asset-toast asset-toast-${toast.type}`} role="alert">
          <i className={`fa-solid ${toast.type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}`} aria-hidden="true" />
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};

export default AssetManagement;
