-- Support Reports hub; visibility follows the existing support-ticket read permission.
INSERT INTO sidebar_menus (menu_name, link, icon, permission_column, category, sort_order, parent_id, is_visible)
SELECT 'Support Reports', '/support-reports', 'fa-chart-column', 'p_support_view', 'Internet', 53, NULL, 1
WHERE NOT EXISTS (SELECT 1 FROM sidebar_menus WHERE link = '/support-reports');
