const pool = require('../utilities/db');
const { resolvePermission, isSuperAdmin: resolveIsSuperAdmin } = require('../utilities/permissionRegistry');
const ALWAYS_VISIBLE_LINKS = new Set(['/employees']);
const HR_DOCUMENTS_LANDING_PATH = '/hr-documents';
const HR_DOCUMENTS_LEGACY_LINKS = new Set([
  '/appointment-generator',
  '/noc-generator',
  '/termination-generator',
  '/department-change-generator',
  '/device-handover-form',
  '/employee-of-the-month-generator',
  '/employee-of-the-year-generator',
  '/employee-issue-suggestion-form',
  '/experience-certificate-generator',
  '/monthly-all-employee-meeting-form',
  '/no-dues-certificate-generator',
  '/salary-increment-letter-generator',
  '/promotion-letter-generator',
  '/performance-improvement-plan-generator',
  '/punishment-letter-generator',
]);
const normalizeMenuLink = (link) => {
  if (!link) return '';
  let cleanPath = String(link).trim().replace(/\\/g, '/');
  if (!cleanPath.startsWith('/')) cleanPath = `/${cleanPath}`;
  cleanPath = cleanPath.replace(/_/g, '-');
  if (cleanPath === '/' || cleanPath === '/index' || cleanPath === '/dashboard') return '/dashboard';
  return cleanPath;
};

/**
 * Get Sidebar Data
 * Replaces logic in sidebar.php
 */
const getSidebarData = async (req, res) => {
  try {
    // Prevent any intermediary/browser cache from reusing sidebar data across users.
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

    // 1. User Context from auth middleware
    const { id: userId, role_name, permissions } = req.user;
    const isSuperAdmin = resolveIsSuperAdmin(req.user);

    // 2. Fetch menus from DB (Super Admin sees all, others only visible)
    const menuQuery = isSuperAdmin
      ? 'SELECT * FROM sidebar_menus ORDER BY sort_order ASC'
      : 'SELECT * FROM sidebar_menus WHERE is_visible = 1 ORDER BY sort_order ASC';
    const menuResult = await pool.query(menuQuery);
    const allMenus = menuResult.rows;

    // Fallback: if DB menus are empty, provide a default set for Super Admin.
    if (isSuperAdmin && allMenus.length === 0) {
      return res.json({
        role: role_name || 'Super Admin',
        menuData: {
          'Leave Management': [
            { id: 1003, menu_name: 'Apply Leave', link: '/apply-leave', icon: 'fa-paper-plane', children: [] },
            { id: 1004, menu_name: 'Manage Leaves', link: '/manage-leaves', icon: 'fa-calendar-check', children: [] },
            { id: 1005, menu_name: 'Entitlements', link: '/manage-entitlements', icon: 'fa-layer-group', children: [] },
            { id: 1009, menu_name: 'Leave Calendar', link: '/leave-calendar', icon: 'fa-calendar-days', children: [] },
            { id: 1010, menu_name: 'Leave Report', link: '/leave-report', icon: 'fa-chart-line', children: [] },
          ],
          'HR Documents': [
            { id: 1014, menu_name: 'HR Documents', link: '/hr-documents', icon: 'fa-folder-open', children: [] },
          ],
          'Employees': [
            { id: 1002, menu_name: 'Employees', link: '/employees', icon: 'fa-users', children: [] },
            { id: 1008, menu_name: 'Phone Directory', link: '/phone-directory', icon: 'fa-address-book', children: [] },
          ],
          'Work & Assets': [
            { id: 1011, menu_name: 'Office Work Tracker', link: '/office-work-tracker', icon: 'fa-clipboard-list', children: [] },
            { id: 1013, menu_name: 'Asset Management', link: '/asset-management', icon: 'fa-boxes-stacked', children: [] },
            { id: 1017, menu_name: 'Sales & Marketing', link: '/sales-marketing', icon: 'fa-route', children: [] },
          ],
          'Internet': [
            { id: 1012, menu_name: 'Internet Registration', link: '/internet-registration', icon: 'fa-wifi', children: [] },
            { id: 1015, menu_name: 'Support Tickets', link: '/support', icon: 'fa-headset', children: [] },
            { id: 1016, menu_name: 'MikroTik Routers', link: '/support/routers', icon: 'fa-network-wired', children: [] },
          ],
          'System': [
            { id: 1006, menu_name: 'Permissions', link: '/manage-permissions', icon: 'fa-user-shield', children: [] },
            { id: 1007, menu_name: 'Menus', link: '/manage-menus', icon: 'fa-bars', children: [] },
          ],
        }
      });
    }

    // 3. Filter Menus based on RBAC permissions
    const visibleMenus = allMenus.filter(menu => {
      const normalizedLink = normalizeMenuLink(menu.link);
      const isLegacyHrDocumentLink = HR_DOCUMENTS_LEGACY_LINKS.has(normalizedLink);
      const isHrDocumentCategory = (menu.category || '').trim() === 'HR Documents';

      if (isLegacyHrDocumentLink || isHrDocumentCategory) {
        return false;
      }

      if (isSuperAdmin || (permissions && permissions['all_access'])) return true;
      if (ALWAYS_VISIBLE_LINKS.has(normalizedLink)) return true;
      // MikroTik Routers is strictly gated: only roles explicitly granted
      // router-manage (or super admin / all_access via resolvePermission)
      // see it. mikrotik-sync alone only permits the sync API, never the
      // routers UI — e.g. Noc Executive must not see /support/routers.
      if (normalizedLink === '/support/routers') {
        return resolvePermission(req.user, 'support.router.manage');
      }
      if (!menu.permission_column) return true;
      return resolvePermission(req.user, menu.permission_column);
    });

    // HR Documents hub is NOT public: only users with at least one HR-doc
    // permission (or all_access / super admin) get the landing menu.
    // Everyone else (e.g. Noc Executive) no longer sees /hr-documents.
    const canAccessHrDocuments = isSuperAdmin
      || resolvePermission(req.user, 'appointment_letters.generate')
      || resolvePermission(req.user, 'termination_letters.generate')
      || resolvePermission(req.user, 'employees.create_edit')
      || resolvePermission(req.user, 'users.manage');
    const hasHrDocumentsLandingMenu = visibleMenus.some((m) => normalizeMenuLink(m.link) === HR_DOCUMENTS_LANDING_PATH);
    if (canAccessHrDocuments && !hasHrDocumentsLandingMenu) {
      visibleMenus.unshift({
        id: 99999,
        menu_name: 'HR Documents',
        link: HR_DOCUMENTS_LANDING_PATH,
        icon: 'fa-folder-open',
        category: 'HR Documents',
        parent_id: null,
        sort_order: 20,
        children: [],
      });
    }

    const hasEmployeesMenu = visibleMenus.some((m) => normalizeMenuLink(m.link) === '/employees');
    if (!hasEmployeesMenu) {
      visibleMenus.push({
        id: 1002,
        menu_name: 'Employees',
        link: '/employees',
        icon: 'fa-users',
        category: 'Employees',
        parent_id: null,
        sort_order: 30,
      });
    }

    const hasOfficeWorkTracker = visibleMenus.some((m) => normalizeMenuLink(m.link) === '/office-work-tracker');
    if (!hasOfficeWorkTracker) {
      visibleMenus.push({
        id: 1011,
        menu_name: 'Office Work Tracker',
        link: '/office-work-tracker',
        icon: 'fa-clipboard-list',
        category: 'Work & Assets',
        parent_id: null,
        sort_order: 40,
      });
    }

    const hasRouteVisits = visibleMenus.some((m) => normalizeMenuLink(m.link) === '/sales-marketing');
    if (!hasRouteVisits) {
      visibleMenus.push({
        id: 1017,
        menu_name: 'Sales & Marketing',
        link: '/sales-marketing',
        icon: 'fa-route',
        category: 'Work & Assets',
        parent_id: null,
        sort_order: 42,
      });
    }

    const hasInternetRegistration = visibleMenus.some((m) => normalizeMenuLink(m.link) === '/internet-registration');
    if (!hasInternetRegistration) {
      visibleMenus.push({
        id: 1012,
        menu_name: 'Internet Registration',
        link: '/internet-registration',
        icon: 'fa-wifi',
        category: 'Internet',
        parent_id: null,
        sort_order: 50,
      });
    }

    const canAccessSupport = isSuperAdmin || (permissions && (permissions['all_access'] || resolvePermission(req.user, 'support.ticket.view')));
    const hasSupport = visibleMenus.some((m) => normalizeMenuLink(m.link) === '/support');
    if (canAccessSupport && !hasSupport) {
      visibleMenus.push({ id: 1015, menu_name: 'Support Tickets', link: '/support', icon: 'fa-headset', category: 'Internet', parent_id: null, sort_order: 51 });
    }

    // MikroTik Routers — manage-only UI (mirrors the strict filter above and the
    // SupportRouters page gate): sync-only users get "No access" on the page,
    // so the menu stays hidden for them instead of leading to a dead page.
    // The sync API itself still accepts support.mikrotik.sync.
    const canAccessRouters = isSuperAdmin
      || resolvePermission(req.user, 'support.router.manage');
    const hasRouters = visibleMenus.some((m) => normalizeMenuLink(m.link) === '/support/routers');
    if (canAccessRouters && !hasRouters) {
      visibleMenus.push({ id: 1016, menu_name: 'MikroTik Routers', link: '/support/routers', icon: 'fa-network-wired', category: 'Internet', parent_id: null, sort_order: 52 });
    }

    const canAccessAssetManagement =
      isSuperAdmin
      || (permissions && (
        permissions['all_access']
        || resolvePermission(req.user, 'assets.view')
        || resolvePermission(req.user, 'assets.manage')
      ));
    const hasAssetManagement = visibleMenus.some((m) => normalizeMenuLink(m.link) === '/asset-management');
    if (canAccessAssetManagement && !hasAssetManagement) {
      visibleMenus.push({
        id: 1013,
        menu_name: 'Asset Management',
        link: '/asset-management',
        icon: 'fa-boxes-stacked',
        category: 'Work & Assets',
        parent_id: null,
        sort_order: 41,
      });
    }

    // Re-apply DB sort_order after unshift/push injections above so the
    // final nesting follows sort_order (injected entries keep their values).
    visibleMenus.sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999));

    // 4. Structure Data
    const groupedMenus = {};
    const subMenusMap = {};

    // First pass: Identify submenus (children)
    visibleMenus.forEach(menu => {
      if (menu.parent_id) {
        if (!subMenusMap[menu.parent_id]) {
          subMenusMap[menu.parent_id] = [];
        }
        subMenusMap[menu.parent_id].push(menu);
      }
    });

    // Second pass: Group top-level menus by category and filter out parents without permissions (if children have permissions)
    visibleMenus.forEach(menu => {
      if (!menu.parent_id) {
        const category = menu.category || 'General';
        
        // Attach children if any
        const children = subMenusMap[menu.id] || [];
        
        // If it's not a super admin, we should only show the parent if it has permission OR if it has children that are visible
        // However, visibleMenus already contains only menus the user has permission for (including children)
        // So if a parent is in visibleMenus, the user has permission for it.
        // If it's NOT in visibleMenus but has children that ARE (though children usually require parent's category), 
        // we might need to adjust logic. In the PHP version, it seems parents are checked individually.
        
        if (!groupedMenus[category]) {
          groupedMenus[category] = [];
        }

        groupedMenus[category].push({
          ...menu,
          children
        });
      }
    });

    // Orphan children: a child can survive the RBAC filter while its parent
    // is filtered out. Keep such children reachable under a synthetic
    // top-level 'General' parent grouped by the child's own category, so the
    // response shape {role, menuData:{category:[items]}} is unchanged for
    // normal cases (no orphans => no synthetic entries).
    const visibleIds = new Set(visibleMenus.map((m) => String(m.id)));
    Object.entries(subMenusMap).forEach(([parentId, orphanChildren]) => {
      if (!visibleIds.has(String(parentId))) {
        const byCategory = {};
        orphanChildren.forEach((child) => {
          const cat = child.category || 'General';
          if (!byCategory[cat]) byCategory[cat] = [];
          byCategory[cat].push(child);
        });
        Object.entries(byCategory).forEach(([cat, items]) => {
          if (!groupedMenus[cat]) {
            groupedMenus[cat] = [];
          }
          groupedMenus[cat].push({
            id: `orphan-${parentId}`,
            menu_name: 'General',
            category: cat,
            link: null,
            children: items,
          });
        });
      }
    });

    // Final pass: Remove empty categories
    const finalGroupedMenus = {};
    Object.keys(groupedMenus).forEach(cat => {
      if (groupedMenus[cat].length > 0) {
        finalGroupedMenus[cat] = groupedMenus[cat];
      }
    });

    res.json({
      role: role_name || 'Staff',
      menuData: finalGroupedMenus
    });

  } catch (error) {
    console.error('Sidebar Data Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getSidebarData };
