import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSidebarMenus } from '../services/sidebarService';
import { getBandwidthRequests } from '../services/resellerService';
import ImageWithFallback from './ImageWithFallback';
import BrandLogo from './BrandLogo';
import { t } from '../i18n';
import '../styles/Sidebar.css';

const resolveUploadUrl = (pic) => {
  if (!pic || pic === 'default.png') return null;
  if (/^https?:\/\//i.test(pic)) return pic;
  if (String(pic).startsWith('/api/')) return pic;
  const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  const path = String(pic).startsWith('/') ? pic : `/uploads/${pic}`;
  return `${base}${path}`;
};

const Sidebar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('darkMode') === 'true';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [openSubMenus, setOpenSubMenus] = useState({});
  const [collapsedCategories, setCollapsedCategories] = useState(() => {
    try {
      const stored = localStorage.getItem('sidebarCollapsedCategories');
      if (stored) return JSON.parse(stored);
    } catch {
      // ignore
    }
    return {};
  });
  const [notificationCount, setNotificationCount] = useState(0);
  const [pendingToast, setPendingToast] = useState(null);
  const mismatchRetriedRef = useRef(false);
  const pendingCountRef = useRef(0);
  const toastTimerRef = useRef(null);
  const location = useLocation();

  const user = useMemo(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser);
        return {
          id: parsedUser.id,
          name: parsedUser.full_name || t('sidebar.defaultUser'),
          role: parsedUser.role || t('sidebar.defaultRole'),
          role_id: parsedUser.role_id ?? null,
          profile_pic: parsedUser.profile_pic || parsedUser.profile_image || parsedUser.photo_path || null,
          permissions: parsedUser.permissions || {},
          all_access: parsedUser.all_access || parsedUser?.permissions?.all_access || false,
          is_super_admin: parsedUser.is_super_admin || false,
        };
      } catch (e) {
        console.error('Error parsing user data', e);
      }
    }
    return { id: null, name: t('sidebar.defaultUser'), role: t('sidebar.defaultRole') };
  }, []);

  const hasPerm = useCallback((key) => Boolean(
    user?.is_super_admin || user?.all_access ||
    user?.permissions?.all_access || user?.permissions?.['system.all_access'] ||
    user?.permissions?.[key]
  ), [user]);
  const isPowerRole = (() => {
    const r = String(user?.role || '').trim().toLowerCase();
    return r === 'super admin' || r === 'superadmin' || hasPerm('audit.system_logs.view');
  })();
  const userKey = `${user?.id ?? 'default'}:${(user?.role || 'staff').toLowerCase()}`;

  const { data: sidebarData, refetch } = useQuery({
    queryKey: ['sidebarMenus', userKey],
    queryFn: getSidebarMenus,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    enabled: !!user?.id,
  });

  const userRoleFromStorage = (user?.role || '').trim().toLowerCase();
  const userRoleFromApi = (sidebarData?.role || '').trim().toLowerCase();
  const isRoleMismatch = Boolean(
    sidebarData &&
    userRoleFromStorage &&
    userRoleFromApi &&
    userRoleFromStorage !== userRoleFromApi
  );

  const rawMenuData = useMemo(
    () => isRoleMismatch ? {} : (sidebarData?.menuData || {}),
    [isRoleMismatch, sidebarData?.menuData]
  );
  const userRole = isRoleMismatch ? user.role : (sidebarData?.role || '');

  // Body scroll lock on mobile drawer open
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('sidebar-locked');
    } else {
      document.body.classList.remove('sidebar-locked');
    }
    return () => {
      document.body.classList.remove('sidebar-locked');
    };
  }, [isOpen]);

  // Dark mode attribute and custom event dispatch
  useEffect(() => {
    document.body.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
    localStorage.setItem('darkMode', isDarkMode);
    window.dispatchEvent(new CustomEvent('theme-change', { detail: isDarkMode ? 'dark' : 'light' }));
  }, [isDarkMode]);

  // Sync theme change from external events or storage
  useEffect(() => {
    const handleThemeEvent = (e) => {
      if (e && typeof e.detail === 'string') {
        setIsDarkMode(e.detail === 'dark');
      }
    };
    const handleStorage = (e) => {
      if (!e || e.key === 'darkMode') {
        setIsDarkMode(localStorage.getItem('darkMode') === 'true');
      }
    };
    window.addEventListener('theme-change', handleThemeEvent);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('theme-change', handleThemeEvent);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('sidebarCollapsedCategories', JSON.stringify(collapsedCategories));
  }, [collapsedCategories]);

  useEffect(() => {
    if (isRoleMismatch && !mismatchRetriedRef.current) {
      mismatchRetriedRef.current = true;
      refetch();
    }
    if (!isRoleMismatch) {
      mismatchRetriedRef.current = false;
    }
  }, [isRoleMismatch, refetch]);

  useEffect(() => {
    if (!user?.id) return undefined;

    const canViewRequests = (() => {
      if (!sidebarData?.menuData) return false;
      return Object.values(sidebarData.menuData).some((menus) =>
        (Array.isArray(menus) ? menus : []).some((m) => {
          const links = [m?.link, ...((Array.isArray(m?.children) ? m.children : []).map((c) => c?.link))];
          return links.some((link) => typeof link === 'string' && (link.includes('/requests-admin') || link.includes('/request-bw')));
        })
      );
    })();
    if (!canViewRequests) return undefined;

    let cancelled = false;

    const loadPendingNotifications = async ({ silent } = { silent: false }) => {
      try {
        const data = await getBandwidthRequests('pending');
        if (cancelled) return;
        const count = Array.isArray(data) ? data.length : 0;
        const previousCount = pendingCountRef.current;
        pendingCountRef.current = count;
        setNotificationCount(count);

        if (!silent && count > previousCount) {
          const diff = count - previousCount;
          setPendingToast({
            count,
            message: `${diff} new pending request(s) received`
          });
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(() => {
            setPendingToast(null);
          }, 5000);
        }
      } catch (error) {
        // Ignore notification polling errors to keep sidebar stable.
      }
    };

    loadPendingNotifications({ silent: true });
    const intervalId = setInterval(() => loadPendingNotifications({ silent: false }), 30000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [user?.id, sidebarData]);

  const getCleanLink = useCallback((link) => {
    if (!link) return '#!';
    if (link.startsWith('http')) return link;

    let cleanPath = link.trim().replace(/\\/g, '/');

    if (!cleanPath.startsWith('/')) {
      cleanPath = `/${cleanPath}`;
    }

    cleanPath = cleanPath.replace(/_/g, '-');

    if (cleanPath === '/dashboard' || cleanPath === '/index' || cleanPath === '/') return '/dashboard';

    return cleanPath;
  }, []);

  const dedupeMenus = useCallback((menus = []) => {
    const seen = new Set();
    const out = [];
    for (const menu of menus) {
      if (!menu) continue;

      const normalizedLink = getCleanLink(menu.link || '').toLowerCase();
      if (normalizedLink === '/system-logs' && !isPowerRole) continue;
      if (normalizedLink === '/dashboard' || normalizedLink === '/profile' || normalizedLink === '/logout') continue;

      const dedupeKey = `${String(menu.menu_name || '').trim().toLowerCase()}|${normalizedLink}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      let children = Array.isArray(menu.children) ? menu.children : [];
      if (children.length > 0) {
        const childSeen = new Set();
        children = children.filter((child) => {
          const childKey = `${String(child?.menu_name || '').trim().toLowerCase()}|${getCleanLink(child?.link || '').toLowerCase()}`;
          if (childSeen.has(childKey)) return false;
          childSeen.add(childKey);
          return true;
        });
      }

      out.push({ ...menu, children });
    }

    return out;
  }, [getCleanLink, isPowerRole]);

  const menuData = useMemo(() => {
    const normalized = {};
    Object.keys(rawMenuData || {}).forEach((category) => {
      normalized[category] = dedupeMenus(rawMenuData[category]);
    });

    const canSeeAssets = isPowerRole || hasPerm('assets.view') || hasPerm('assets.manage');
    const canSeePO = isPowerRole || hasPerm('procurement.manage') || hasPerm('p_manage_procurement');
    const assetMenuPresent = Object.values(normalized).some((menus) =>
      Array.isArray(menus) && menus.some((menu) => getCleanLink(menu.link) === '/asset-management')
    );
    const poMenuPresent = Object.values(normalized).some((menus) =>
      Array.isArray(menus) && menus.some((menu) => getCleanLink(menu.link) === '/create-po')
    );

    const providedLinks = new Set();
    Object.values(normalized).forEach((menus) => {
      (Array.isArray(menus) ? menus : []).forEach((menu) => {
        providedLinks.add(getCleanLink(menu?.link || '').toLowerCase());
        (Array.isArray(menu?.children) ? menu.children : []).forEach((child) => {
          providedLinks.add(getCleanLink(child?.link || '').toLowerCase());
        });
      });
    });

    if (canSeeAssets && !assetMenuPresent && !providedLinks.has('/asset-management')) {
      if (!normalized['Work & Assets']) normalized['Work & Assets'] = [];
      normalized['Work & Assets'].push({
        id: 9013,
        menu_name: 'Asset Management',
        link: '/asset-management',
        icon: 'fa-boxes-stacked',
        category: 'Work & Assets',
        parent_id: null,
        sort_order: 41,
        children: [],
      });
      normalized['Work & Assets'].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }

    if (canSeePO && !poMenuPresent && !providedLinks.has('/create-po')) {
      if (!normalized['Work & Assets']) normalized['Work & Assets'] = [];
      normalized['Work & Assets'].push({
        id: 9014,
        menu_name: 'Purchase Order',
        link: '/create-po',
        icon: 'fa-file-invoice-dollar',
        category: 'Work & Assets',
        parent_id: null,
        sort_order: 42,
        children: [],
      });
      normalized['Work & Assets'].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }

    const isSupportStaff =
      !isPowerRole &&
      (hasPerm('support.ticket.view') ||
        hasPerm('p_support_view') ||
        hasPerm('reseller.status_noc.view') ||
        hasPerm('p_noc_view'));
    if (isSupportStaff) {
      const PIN_LINKS = new Set(['/support', '/reseller-status-noc']);
      const pinned = [];
      const rest = {};
      Object.entries(normalized).forEach(([cat, menus]) => {
        const keep = [];
        (Array.isArray(menus) ? menus : []).forEach((m) => {
          if (m && PIN_LINKS.has(getCleanLink(m.link || '').toLowerCase())) pinned.push(m);
          else keep.push(m);
        });
        if (keep.length) rest[cat] = keep;
      });
      if (pinned.length) {
        const rank = (m) => (getCleanLink(m.link || '').toLowerCase() === '/support' ? 0 : 1);
        pinned.sort((a, b) => rank(a) - rank(b));
        if (hasPerm('support.ticket.view') || hasPerm('p_support_view')) {
          pinned.unshift({
            id: 'my-tickets',
            menu_name: 'My Tickets',
            link: '/support?tab=my',
            icon: 'fa-user-check',
            children: [],
          });
        }
        return { Support: pinned, ...rest };
      }
    }

    return normalized;
  }, [dedupeMenus, getCleanLink, hasPerm, isPowerRole, rawMenuData]);

  // Pre-calculate all known menu links for precise isActive matching
  const allKnownLinks = useMemo(() => {
    const links = new Set(['/dashboard', '/profile']);
    Object.values(menuData || {}).forEach((menus) => {
      (Array.isArray(menus) ? menus : []).forEach((m) => {
        if (m?.link) links.add(getCleanLink(m.link.split('?')[0]).toLowerCase());
        (Array.isArray(m?.children) ? m.children : []).forEach((c) => {
          if (c?.link) links.add(getCleanLink(c.link.split('?')[0]).toLowerCase());
        });
      });
    });
    return links;
  }, [getCleanLink, menuData]);

  const isActive = useCallback((path) => {
    if (!path) return false;
    const currentPath = location.pathname.toLowerCase();
    const currentQuery = (location.search || '').toLowerCase();
    const [targetPathRaw, targetQueryRaw] = String(path).split('?');
    const targetPath = getCleanLink(targetPathRaw).toLowerCase();
    const targetQuery = (targetQueryRaw || '').toLowerCase();

    if (targetQuery) {
      return currentPath === targetPath && currentQuery.includes(targetQuery);
    }

    // Exact match
    if (currentPath === targetPath) return true;

    // Nested sub-path match: ONLY if currentPath is NOT an exact match for another known menu link
    if (targetPath !== '/' && targetPath !== '/dashboard' && currentPath.startsWith(`${targetPath}/`)) {
      const hasExactMatchInMenu = allKnownLinks.has(currentPath);
      return !hasExactMatchInMenu;
    }

    return false;
  }, [allKnownLinks, getCleanLink, location.pathname, location.search]);

  const toggleSidebar = () => setIsOpen(!isOpen);

  const toggleTheme = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDarkMode(!isDarkMode);
  };

  const toggleSubMenu = (id) => {
    setOpenSubMenus((prev) => {
      const next = {};
      Object.keys(prev).forEach((key) => {
        next[key] = false;
      });
      next[id] = !(prev[id] !== undefined ? prev[id] : true);
      return next;
    });
  };

  const toggleCategoryCollapse = (category) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  const filterMenus = (menus, query) => {
    if (!query) return menus;
    const q = query.toLowerCase();
    const filtered = {};
    Object.keys(menus).forEach((category) => {
      const categoryMenus = menus[category].filter((menu) =>
        (menu.menu_name || '').toLowerCase().includes(q) ||
        (category || '').toLowerCase().includes(q) ||
        (menu.children && menu.children.some((child) => (child.menu_name || '').toLowerCase().includes(q)))
      );
      if (categoryMenus.length > 0) {
        filtered[category] = categoryMenus;
      }
    });
    return filtered;
  };

  const filteredMenuData = filterMenus(menuData, searchQuery);

  useEffect(() => {
    const ids = [];
    Object.values(menuData || {}).forEach((menus) => {
      (Array.isArray(menus) ? menus : []).forEach((menu) => {
        if (menu?.children?.length && menu.children.some((child) => isActive(child?.link))) {
          ids.push(menu.id);
        }
      });
    });
    if (!ids.length) return;
    setOpenSubMenus((prev) => {
      let changed = false;
      const next = { ...prev };
      ids.forEach((id) => {
        if (next[id] !== true) {
          next[id] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [isActive, location.pathname, menuData]);

  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  const renderSideLink = (item, isSub = false) => {
    const hasChildren = item.children && item.children.length > 0;
    const isChildActive = hasChildren && item.children.some((child) => isActive(child.link));
    const isMenuOpen = openSubMenus[item.id] !== undefined ? openSubMenus[item.id] : isChildActive;

    if (hasChildren) {
      return (
        <React.Fragment key={item.id}>
          <a
            href="#!"
            className={`side-link d-flex justify-content-between align-items-center ${isChildActive ? 'active' : ''}`}
            onClick={(e) => { e.preventDefault(); toggleSubMenu(item.id); }}
            aria-label={item.menu_name}
            aria-expanded={isMenuOpen}
          >
            <span>
              <i className={`fa-solid ${item.icon || 'fa-circle'}`} aria-hidden="true"></i>
              <span>{item.menu_name}</span>
            </span>
            <i className={`fa-solid fa-chevron-${isMenuOpen ? 'up' : 'down'}`} style={{ fontSize: '10px', opacity: 0.5 }}></i>
          </a>
          <div className={`sub-collapse-wrapper ${isMenuOpen ? 'is-open' : ''}`}>
            <div className="sub-collapse-inner">
              <div className="sub-menu-container">
                {item.children.map((child) => (
                  <Link
                    key={child.id}
                    to={getCleanLink(child.link)}
                    className={`side-link sub-link ${isActive(child.link) ? 'active' : ''}`}
                    onClick={() => setIsOpen(false)}
                  >
                    <i className={`fa-solid ${child.icon || 'fa-circle'}`} style={{ fontSize: '10px' }}></i>
                    {child.menu_name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </React.Fragment>
      );
    }

    return (
      <Link
        key={item.id}
        to={getCleanLink(item.link)}
        className={`side-link ${isActive(item.link) ? 'active' : ''} ${isSub ? 'sub-link' : ''}`}
        aria-label={item.menu_name}
        aria-current={isActive(item.link) ? 'page' : undefined}
        onClick={() => setIsOpen(false)}
      >
        <i className={`fa-solid ${item.icon || 'fa-circle'}`} aria-hidden="true"></i>
        <span>{item.menu_name}</span>
        {getCleanLink(item.link) === '/requests-admin' && notificationCount > 0 && (
          <span className="menu-notification-pill">{notificationCount}</span>
        )}
      </Link>
    );
  };

  return (
    <>
      {pendingToast && (
        <Link to="/requests-admin" className="pending-toast" onClick={() => setPendingToast(null)}>
          <div className="pending-toast-icon">
            <i className="fa-solid fa-bell"></i>
          </div>
          <div className="pending-toast-copy">
            <strong>New Pending Request</strong>
            <span>{pendingToast.message}</span>
          </div>
        </Link>
      )}

      <button className="mobile-toggle" onClick={toggleSidebar} aria-label="Toggle navigation menu" aria-expanded={isOpen} aria-controls="sidebar">
        <i className="fa-solid fa-bars" aria-hidden="true"></i>
      </button>

      <div className={`sidebar-overlay ${isOpen ? 'active' : ''}`} onClick={toggleSidebar}></div>

      <div className={`sidebar ${isOpen ? 'active' : ''} ${isDarkMode ? 'dark-mode' : ''}`} id="sidebar">
        <div className="sidebar-brand">
          <BrandLogo className="brand-logo" alt="Speed Net" />
          <div className="role-badge" title={userRole || 'Speed Net'}>{userRole || 'Speed Net'} {t('sidebar.portal')}</div>
        </div>

        <div className="user-profile-section">
          <div className="user-avatar-container">
            <ImageWithFallback
              src={resolveUploadUrl(user.profile_pic)}
              fallbackName={user.name}
              className="user-avatar"
              alt={user.name}
              width="40px"
              height="40px"
            />
            <span className="status-indicator online"></span>
          </div>
          <div className="user-info">
            <p className="user-name">{user.name}</p>
            <p className="user-role">{user.role}</p>
          </div>
        </div>

        <div className="search-container">
          <div className="search-input-wrapper">
            <i className="fa-solid fa-magnifying-glass search-icon" aria-hidden="true"></i>
            <input
              type="text"
              className="search-input"
              aria-label="Search menu"
              placeholder={t('sidebar.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear-btn" onClick={() => setSearchQuery('')} aria-label="Clear search">
                <i className="fa-solid fa-times" aria-hidden="true"></i>
              </button>
            )}
          </div>
        </div>

        <div className="nav-menu">
          {searchQuery && (
            <div className="search-results-info" style={{ fontSize: '12px', color: 'var(--side-text)', padding: '0 12px 10px', opacity: 0.7 }}>
              {Object.keys(filteredMenuData).length > 0
                ? t('sidebar.found', { query: searchQuery })
                : t('sidebar.notFound', { query: searchQuery })}
            </div>
          )}

          <Link
            to="/dashboard"
            className={`side-link ${isActive('/dashboard') ? 'active' : ''}`}
            title={t('sidebar.dashboard')}
            aria-label={t('sidebar.dashboard')}
            aria-current={isActive('/dashboard') ? 'page' : undefined}
            onClick={() => setIsOpen(false)}
          >
            <i className="fa-solid fa-chart-pie" aria-hidden="true"></i>
            <span>{t('sidebar.dashboard')}</span>
          </Link>

          {Object.keys(filteredMenuData || {}).map((category) => {
            const isCategoryCollapsed = Boolean(collapsedCategories[category]);
            const categoryMenus = filteredMenuData[category];
            const isSingleItemCategory = categoryMenus.length === 1 && !categoryMenus[0].children?.length;

            return (
              <div key={category} className="sidebar-category">
                {!isSingleItemCategory && (
                  <div
                    className="nav-label nav-label-clickable"
                    onClick={() => toggleCategoryCollapse(category)}
                    title={isCategoryCollapsed ? `Expand ${category}` : `Collapse ${category}`}
                  >
                    <span className="nav-label-text">{category}</span>
                    <i className={`fa-solid fa-chevron-${isCategoryCollapsed ? 'right' : 'down'} nav-label-chevron`}></i>
                  </div>
                )}
                <div className={`category-collapse-wrapper ${!isSingleItemCategory && isCategoryCollapsed ? 'is-collapsed' : ''}`}>
                  <div className="category-collapse-inner">
                    {categoryMenus.map((menu) => renderSideLink(menu))}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="nav-label">{t('sidebar.account')}</div>
          <Link
            to="/profile"
            className={`side-link ${isActive('/profile') ? 'active' : ''}`}
            aria-label={t('sidebar.profile')}
            aria-current={isActive('/profile') ? 'page' : undefined}
            onClick={() => setIsOpen(false)}
          >
            <i className="fa-solid fa-user-astronaut" aria-hidden="true"></i>
            <span>{t('sidebar.profile')}</span>
          </Link>
          <Link
            to="/logout"
            className="side-link text-danger"
            aria-label={t('sidebar.logout')}
            onClick={() => setIsOpen(false)}
          >
            <i className="fa-solid fa-power-off" aria-hidden="true"></i>
            <span>{t('sidebar.logout')}</span>
          </Link>
        </div>

        <div className="quick-actions">
          <button className="quick-action-btn" title={t('sidebar.notifications')} aria-label={t('sidebar.notifications')}>
            <i className="fa-solid fa-bell" aria-hidden="true"></i>
            {notificationCount > 0 && <span className="notification-badge">{notificationCount}</span>}
          </button>
          <button className="quick-action-btn" title={t('sidebar.themeToggle')} aria-label={t('sidebar.themeToggle')} onClick={toggleTheme} aria-pressed={isDarkMode}>
            <i className={`fa-solid fa-${isDarkMode ? 'sun' : 'moon'}`} aria-hidden="true"></i>
          </button>
          <button className="quick-action-btn" title={t('sidebar.settings')} aria-label={t('sidebar.settings')}>
            <i className="fa-solid fa-cog" aria-hidden="true"></i>
          </button>
        </div>

        <div className="sidebar-footer">
          <p className="footer-text">© 2026 Speed Net Khulna</p>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
