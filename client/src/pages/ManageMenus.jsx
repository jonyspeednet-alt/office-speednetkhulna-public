import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import Sortable from 'sortablejs';
import { Modal, Button } from 'react-bootstrap';
import { getMenus, saveMenu, deleteMenu, updateMenuOrder } from '../services/menuService';
import { confirmAction } from '../utils/confirm';
import { t } from '../i18n';
import '../styles/ManageMenus.css';

// Known permission-key catalog — mirrors `permissionGroups` in
// ManagePermissions.jsx plus legacy/dot-notation keys. Used to block saves
// with typo'd permission_column values.
const KNOWN_PERMISSION_KEYS = new Set([
  // user_management
  'p_manage_users', 'p_edit_any_profile', 'p_employees', 'p_employee_create_edit',
  // leave_management
  'p_manage_leaves', 'p_leave_submission', 'p_my_leaves', 'p_approvals', 'p_entitlements', 'p_apply_leave',
  // reseller_management
  'p_reseller_list', 'p_reseller_profile', 'p_request_bw', 'p_requests_admin',
  'p_tech_task', 'p_billing_logs', 'p_add_discount', 'p_monthly_summary',
  'p_generate_bill', 'p_invoice', 'p_view_static_invoice', 'p_add_reseller', 'p_noc_view',
  // support
  'p_support_view', 'p_support_create', 'p_support_update', 'p_support_assign',
  'p_support_mikrotik_sync', 'p_support_router_manage',
  // hr_documents
  'p_appointment_letter', 'p_termination_letter',
  // assets / officeWork
  'p_assets_view', 'p_assets_manage', 'p_office_work',
  // system
  'p_manage_permissions', 'p_manage_menus', 'p_reports', 'p_notices', 'p_calendar',
  'p_phone_directory', 'p_system_logs',
  // procurement / work_tracker / asset
  'p_manage_procurement', 'p_office_work_tracker', 'p_work_tracker_admin', 'p_asset_management',
  // legacy / dot-notation keys accepted by ManagePermissions guards
  'permissions.manage', 'all_access',
]);

const SUGGESTED_CATEGORIES = [
  'Leave Management',
  'HR Documents',
  'Employees',
  'Work & Assets',
  'Internet',
  'System',
];

const ManageMenus = () => {
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const listRef = useRef(null);
  const sortableInstances = useRef([]);

  const [showModal, setShowModal] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [formData, setFormData] = useState({
    id: '', menu_name: '', link: '', icon: '', permission_column: '', category: '', sort_order: 0, parent_id: '', is_visible: true
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [permError, setPermError] = useState('');

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const fetchMenus = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMenus();
      setMenus(data || []);
    } catch (error) {
      console.error('Error fetching menus', error);
      setMessage({ type: 'danger', text: t('manageMenus.loadFailed') });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMenus();
  }, [fetchMenus]);

  const handleSortEnd = useCallback(async () => {
    // Backend orders menus GLOBALLY by sort_order, so per-parent 1..n indexes
    // collide across groups. Offset each parent group by groupIndex * stride to
    // keep sort_order globally unique. Drag-drop UX is unchanged.
    const GROUP_STRIDE = 1000;
    const groupIndexByParent = new Map([['root', 0]]);
    const items = [];
    document.querySelectorAll('.menu-item').forEach((el) => {
      const id = el.getAttribute('data-id');
      const parent = el.parentElement.closest('.menu-item');
      const parentId = parent ? parent.getAttribute('data-id') : null;
      const parentKey = parentId || 'root';
      if (!groupIndexByParent.has(parentKey)) {
        groupIndexByParent.set(parentKey, groupIndexByParent.size);
      }
      const index = Array.from(el.parentElement.children).indexOf(el) + 1;
      if (id) {
        items.push({
          id: parseInt(id, 10),
          parent_id: parentId ? parseInt(parentId, 10) : null,
          sort_order: groupIndexByParent.get(parentKey) * GROUP_STRIDE + index,
        });
      }
    });

    try {
      await updateMenuOrder(items);
      setMessage({ type: 'success', text: t('manageMenus.orderSaved') });
      fetchMenus();
    } catch (error) {
      setMessage({ type: 'danger', text: t('manageMenus.orderSaveFailed') });
    }
  }, [fetchMenus]);

  const initSortables = useCallback(() => {
    if (listRef.current) {
      sortableInstances.current.forEach((instance) => {
        try { instance.destroy(); } catch { }
      });
      sortableInstances.current = [];

      const nestedSortables = document.querySelectorAll('.sortable-list');
      nestedSortables.forEach((el) => {
        const s = new Sortable(el, {
          group: 'nested',
          handle: '.handle',
          animation: 150,
          fallbackOnBody: true,
          swapThreshold: 0.65,
          ghostClass: 'sortable-ghost',
          onEnd: handleSortEnd
        });
        sortableInstances.current.push(s);
      });
    }
  }, [handleSortEnd]);

  useEffect(() => {
    if (!loading && menus.length > 0) {
      initSortables();
    }

    return () => {
      sortableInstances.current.forEach((instance) => {
        try { instance.destroy(); } catch { }
      });
      sortableInstances.current = [];
    };
  }, [menus, loading, initSortables]);

  const handleDelete = useCallback(async (id) => {
    if (await confirmAction({ title: t('manageMenus.deleteConfirm'), danger: true })) {
      try {
        await deleteMenu(id);
        setMessage({ type: 'warning', text: t('manageMenus.deleted') });
        fetchMenus();
      } catch (error) {
        setMessage({ type: 'danger', text: t('manageMenus.deleteFailed') });
      }
    }
  }, [fetchMenus]);

  const toggleVisibility = useCallback(async (menu) => {
    try {
      const payload = {
        ...menu,
        is_visible: !(menu.is_visible === 1 || menu.is_visible === true)
      };
      await saveMenu(payload);
      setMessage({ type: 'success', text: payload.is_visible ? t('manageMenus.published') : t('manageMenus.hidden') });
      fetchMenus();
    } catch (error) {
      setMessage({ type: 'danger', text: t('manageMenus.visibilityFailed') });
    }
  }, [fetchMenus]);

  const handleModalSubmit = async (e) => {
    e.preventDefault();
    // Validate permission_column against the known key catalog (mirrors
    // permissionGroups in ManagePermissions.jsx + legacy keys + keys already
    // stored in the DB). Blocks typo'd keys instead of silently saving them.
    const permKey = String(formData.permission_column || '').trim();
    const knownInDb = menus.some((m) => m.permission_column === permKey);
    if (permKey && !KNOWN_PERMISSION_KEYS.has(permKey) && !knownInDb) {
      setPermError(
        `Unknown permission key "${permKey}". Use a key from the Manage Permissions catalog (or register it there first). Save blocked.`
      );
      return;
    }
    setPermError('');
    try {
      const payload = {
        ...formData,
        id: isEdit ? parseInt(formData.id, 10) : null,
        parent_id: formData.parent_id ? parseInt(formData.parent_id, 10) : null,
        sort_order: parseInt(formData.sort_order, 10) || 0
      };

      await saveMenu(payload);
      setMessage({ type: 'success', text: isEdit ? t('manageMenus.updated') : t('manageMenus.created') });
      setShowModal(false);
      fetchMenus();
    } catch (error) {
      console.error('Submit Error:', error);
      setMessage({ type: 'danger', text: error.response?.data?.message || t('manageMenus.operationFailed') });
    }
  };

  const openModal = useCallback((menu = null) => {
    setPermError('');
    if (menu) {
      setIsEdit(true);
      setFormData({
        id: menu.id || '',
        menu_name: menu.menu_name || '',
        link: menu.link || '',
        icon: menu.icon || '',
        permission_column: menu.permission_column || '',
        category: menu.category || '',
        sort_order: menu.sort_order || 0,
        parent_id: menu.parent_id || '',
        is_visible: menu.is_visible === 1 || menu.is_visible === true
      });
    } else {
      setIsEdit(false);
      setFormData({
        id: '', menu_name: '', link: '', icon: '', permission_column: '', category: '', sort_order: 0, parent_id: '', is_visible: true
      });
    }
    setShowModal(true);
  }, []);

  const handleNameChange = (e) => {
    const val = e.target.value;
    setFormData((prev) => {
      const newData = { ...prev, menu_name: val };
      if (!isEdit && !prev.id) {
        newData.permission_column = 'p_' + val.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
      }
      return newData;
    });
  };

  const renderMenuItems = useCallback((parentId = null, depth = 0) => {
    if (depth > 10) return null;

    let items = menus.filter((m) => {
      if (parentId === null) return !m.parent_id;
      return String(m.parent_id) === String(parentId);
    });

    if (searchTerm) {
      const matchesSearch = (item) => {
        const nameMatch = item.menu_name.toLowerCase().includes(searchTerm.toLowerCase());
        const linkMatch = item.link.toLowerCase().includes(searchTerm.toLowerCase());
        const categoryMatch = item.category.toLowerCase().includes(searchTerm.toLowerCase());

        if (nameMatch || linkMatch || categoryMatch) return true;

        const children = menus.filter((m) => String(m.parent_id) === String(item.id));
        return children.some(matchesSearch);
      };

      items = items.filter(matchesSearch);
    }

    if (items.length === 0) return null;

    items.sort((a, b) => a.sort_order - b.sort_order);

    return items.map((m) => (
      <li className="menu-item" data-id={m.id} key={m.id}>
        <div className="menu-card shadow-sm">
          <div className="menu-info">
            <i className="fas fa-grip-vertical drag-handle handle" title={t('manageMenus.dragToReorder')}></i>
            <div className="menu-icon-box">
              <i className={`fa-solid ${m.icon || 'fa-circle'}`}></i>
            </div>
            <div className="menu-details">
              <strong>{m.menu_name}</strong>
              <small>{m.link}</small>
            </div>
          </div>

          <div className="menu-meta">
            <span className="badge-category">{m.category}</span>
            <button
              type="button"
              className={`visibility-indicator border-0 bg-transparent ${!(m.is_visible === 1 || m.is_visible === true) ? 'hidden' : 'text-success'}`}
              onClick={(e) => { e.stopPropagation(); toggleVisibility(m); }}
              title={m.is_visible ? t('manageMenus.hideFromSidebar') : t('manageMenus.showInSidebar')}
            >
              <i className={`fas ${!(m.is_visible === 1 || m.is_visible === true) ? 'fa-eye-slash' : 'fa-eye'}`}></i>
            </button>
            <div className="action-buttons ms-3">
              <button
                type="button"
                className="action-btn edit"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openModal(m);
                }}
                title={t('manageMenus.editMenu')}
              >
                <i className="fas fa-pen"></i>
              </button>
              <button
                type="button"
                className="action-btn delete"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDelete(m.id);
                }}
                title={t('manageMenus.deleteMenu')}
              >
                <i className="fas fa-trash-can"></i>
              </button>
            </div>
          </div>
        </div>
        <ul className="sortable-list nested-list ps-5">
          {renderMenuItems(m.id, depth + 1)}
        </ul>
      </li>
    ));
  }, [handleDelete, menus, openModal, searchTerm, toggleVisibility]);

  const menuTree = useMemo(() => {
    if (loading) return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status"></div>
        <p className="mt-3 text-muted">{t('manageMenus.loadingStructure')}</p>
      </div>
    );
    return renderMenuItems(null);
  }, [loading, renderMenuItems]);

  const parentOptions = useMemo(() => {
    return menus
      .filter((m) => !m.parent_id)
      .sort((a, b) => (a.menu_name || '').localeCompare(b.menu_name || ''));
  }, [menus]);

  const uniqueCategories = useMemo(() => {
    const dbCats = menus.map((m) => m.category).filter(Boolean);
    const merged = [...new Set([...SUGGESTED_CATEGORIES, ...dbCats])];
    return merged.sort();
  }, [menus]);

  return (
    <div className="manage-menus-page fade-in">
      <div className="page-header">
        <div className="header-title">
          <h3><i className="fas fa-sitemap text-primary me-2"></i>{t('manageMenus.title')}</h3>
          <p>{t('manageMenus.subtitle')}</p>
        </div>
        <div className="d-flex gap-3">
          <div className="search-box">
            <div className="input-group shadow-sm rounded-4 overflow-hidden">
              <span className="input-group-text bg-white border-0"><i className="fas fa-search text-muted"></i></span>
              <input
                type="text"
                className="form-control border-0 py-2"
                placeholder={t('manageMenus.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: '250px' }}
              />
              {searchTerm && (
                <button className="btn btn-white border-0" onClick={() => setSearchTerm('')}>
                  <i className="fas fa-times text-muted"></i>
                </button>
              )}
            </div>
          </div>
          <button className="btn btn-primary shadow-lg" onClick={() => openModal()}>
            <i className="fas fa-plus me-2"></i>{t('manageMenus.createNew')}
          </button>
        </div>
      </div>

      {message && (
        <div className={`alert alert-${message.type} border-0 shadow-sm rounded-4 mb-4`}>
          <i className={`fas fa-${message.type === 'success' ? 'check-circle' : (message.type === 'warning' ? 'trash' : 'exclamation-triangle')} me-2`}></i>
          {message.text}
        </div>
      )}

      <div className="menu-list-container">
        <div className="alert alert-info py-2 px-3 small border-0 bg-light-primary text-primary mb-4 d-flex align-items-center rounded-3">
          <i className="fas fa-info-circle me-2"></i>
          <span><strong>{t('manageMenus.tipLabel')}</strong> {t('manageMenus.tipText')}</span>
        </div>

        <ul className="sortable-list" ref={listRef}>
          {menuTree}
        </ul>
      </div>

      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg" centered backdrop="static">
        <Modal.Header closeButton>
          <Modal.Title>{isEdit ? t('manageMenus.modifyEntry') : t('manageMenus.newConfig')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <form onSubmit={handleModalSubmit} className="p-2">
            <div className="row g-4">
              <div className="col-md-6">
                <label className="form-label">{t('manageMenus.displayName')}</label>
                <input
                  type="text"
                  className="form-control bg-light border-0"
                  placeholder={t('manageMenus.displayNamePlaceholder')}
                  value={formData.menu_name}
                  onChange={handleNameChange}
                  required
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">{t('manageMenus.securityIdentifier')}</label>
                <input
                  type="text"
                  className="form-control bg-light border-0"
                  value={formData.permission_column}
                  onChange={(e) => { setFormData({ ...formData, permission_column: e.target.value }); setPermError(''); }}
                  required
                />
                {permError && (
                  <small className="text-danger mt-1 d-block" role="alert">{permError}</small>
                )}
              </div>
              <div className="col-md-8">
                <label className="form-label">{t('manageMenus.navUrl')}</label>
                <div className="input-group">
                  <span className="input-group-text bg-light border-0"><i className="fas fa-link text-muted"></i></span>
                  <input
                    type="text"
                    className="form-control bg-light border-0"
                    placeholder={t('manageMenus.navUrlPlaceholder')}
                    value={formData.link}
                    onChange={(e) => setFormData({ ...formData, link: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="col-md-4">
                <label className="form-label">{t('manageMenus.icon')}</label>
                <div className="input-group">
                  <span className="input-group-text bg-light border-0" style={{ width: '45px', justifyContent: 'center' }}>
                    <i className={`fa-solid ${formData.icon || 'fa-icons'} text-primary`}></i>
                  </span>
                  <input
                    type="text"
                    className="form-control bg-light border-0"
                    placeholder={t('manageMenus.iconPlaceholder')}
                    value={formData.icon}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                  />
                </div>
                <small className="text-muted mt-1 d-block" style={{ fontSize: '0.7rem' }}>
                  {t('manageMenus.iconHint')}
                </small>
              </div>
              <div className="col-md-6">
                <label className="form-label">{t('manageMenus.categoryGrouping')}</label>
                <div className="input-group">
                  <input
                    type="text"
                    className="form-control bg-light border-0"
                    placeholder={t('manageMenus.categoryPlaceholder')}
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    list="category-suggestions"
                    required
                  />
                  <datalist id="category-suggestions">
                    {uniqueCategories.map((cat) => (
                      <option key={cat} value={cat} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="col-md-6">
                <label className="form-label">{t('manageMenus.placement')}</label>
                <select
                  className="form-select bg-light border-0"
                  value={formData.parent_id}
                  onChange={(e) => setFormData({ ...formData, parent_id: e.target.value })}
                >
                  <option value="">{t('manageMenus.rootLevel')}</option>
                  {parentOptions.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.id === formData.id}>{p.menu_name}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-6">
                <label className="form-label">{t('manageMenus.priority')}</label>
                <input
                  type="number"
                  className="form-control bg-light border-0"
                  value={formData.sort_order}
                  onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value, 10) || 0 })}
                />
              </div>
              <div className="col-md-6 d-flex align-items-center mt-5">
                <div className="form-check form-switch custom-switch">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id="isVisible"
                    checked={formData.is_visible}
                    onChange={(e) => setFormData({ ...formData, is_visible: e.target.checked })}
                  />
                  <label className="form-check-label fw-bold ms-2" htmlFor="isVisible">{t('manageMenus.publishSidebar')}</label>
                </div>
              </div>
            </div>
            <div className="d-flex justify-content-end gap-2 mt-5">
              <Button variant="light" className="px-4" onClick={() => setShowModal(false)}>{t('manageMenus.cancel')}</Button>
              <Button type="submit" variant="primary" className="px-5">{t('manageMenus.saveConfig')}</Button>
            </div>
          </form>
        </Modal.Body>
      </Modal>
    </div>
  );
};

export default ManageMenus;
