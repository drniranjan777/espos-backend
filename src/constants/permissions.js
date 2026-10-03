/**
 * Single source of truth for permission codes. Routes reference these constants,
 * the seeder writes them to the `permissions` table and the frontend mirrors them.
 */
export const PERMISSIONS = Object.freeze({
  DASHBOARD_VIEW: 'dashboard.view',

  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_UPDATE: 'products.update',
  PRODUCTS_DELETE: 'products.delete',

  MASTERS_MANAGE: 'masters.manage',
  GST_MANAGE: 'gst.manage',

  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_IN: 'inventory.in',
  INVENTORY_OUT: 'inventory.out',
  INVENTORY_ADJUST: 'inventory.adjust',
  TRANSFER_REQUEST: 'transfer.request',
  TRANSFER_APPROVE: 'transfer.approve',
  TRANSFER_RECEIVE: 'transfer.receive',

  BRANCHES_MANAGE: 'branches.manage',
  BRANCHES_ALL: 'branches.all',

  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_MANAGE: 'customers.manage',

  INVOICE_VIEW: 'invoice.view',
  INVOICE_CREATE: 'invoice.create',
  INVOICE_UPDATE: 'invoice.update',
  INVOICE_CANCEL: 'invoice.cancel',

  REPORTS_VIEW: 'reports.view',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_VIEW: 'audit.view',
});

/** Descriptions shown in the role-permission editor. */
export const PERMISSION_DEFINITIONS = [
  [PERMISSIONS.DASHBOARD_VIEW, 'dashboard', 'View dashboard'],
  [PERMISSIONS.PRODUCTS_VIEW, 'products', 'View and search products'],
  [PERMISSIONS.PRODUCTS_CREATE, 'products', 'Create products'],
  [PERMISSIONS.PRODUCTS_UPDATE, 'products', 'Edit products'],
  [PERMISSIONS.PRODUCTS_DELETE, 'products', 'Deactivate products'],
  [PERMISSIONS.MASTERS_MANAGE, 'masters', 'Manage categories, brands, units and adjustment codes'],
  [PERMISSIONS.GST_MANAGE, 'masters', 'Manage GST rates'],
  [PERMISSIONS.INVENTORY_VIEW, 'inventory', 'View stock and ledger'],
  [PERMISSIONS.INVENTORY_IN, 'inventory', 'Record Stock IN'],
  [PERMISSIONS.INVENTORY_OUT, 'inventory', 'Record Stock OUT'],
  [PERMISSIONS.INVENTORY_ADJUST, 'inventory', 'Record stock adjustments'],
  [PERMISSIONS.TRANSFER_REQUEST, 'transfers', 'Request stock transfers to other branches'],
  [PERMISSIONS.TRANSFER_APPROVE, 'transfers', 'Approve, reject and cancel stock transfers'],
  [PERMISSIONS.TRANSFER_RECEIVE, 'transfers', 'Receive incoming stock transfers'],
  [PERMISSIONS.BRANCHES_MANAGE, 'branches', 'Create and edit branches'],
  [PERMISSIONS.BRANCHES_ALL, 'branches', 'Work in every branch (otherwise only assigned branches)'],
  [PERMISSIONS.CUSTOMERS_VIEW, 'customers', 'View customers'],
  [PERMISSIONS.CUSTOMERS_MANAGE, 'customers', 'Create and edit customers'],
  [PERMISSIONS.INVOICE_VIEW, 'invoices', 'View invoices'],
  [PERMISSIONS.INVOICE_CREATE, 'invoices', 'Create and finalize invoices'],
  [PERMISSIONS.INVOICE_UPDATE, 'invoices', 'Edit draft invoices'],
  [PERMISSIONS.INVOICE_CANCEL, 'invoices', 'Cancel invoices'],
  [PERMISSIONS.REPORTS_VIEW, 'reports', 'View reports'],
  [PERMISSIONS.USERS_MANAGE, 'administration', 'Manage users'],
  [PERMISSIONS.ROLES_MANAGE, 'administration', 'Manage roles and permissions'],
  [PERMISSIONS.SETTINGS_MANAGE, 'administration', 'Manage company and invoice settings'],
  [PERMISSIONS.AUDIT_VIEW, 'administration', 'View audit logs'],
];

const P = PERMISSIONS;

/** Default role → permission mapping used by the seeder. Admin always receives everything. */
export const DEFAULT_ROLES = [
  {
    name: 'Admin',
    description: 'Full system access',
    isSystem: true,
    permissions: Object.values(PERMISSIONS),
  },
  {
    name: 'Warehouse User',
    description: 'Product search, stock view, Stock IN/OUT, transfers and history',
    isSystem: false,
    permissions: [
      P.DASHBOARD_VIEW,
      P.PRODUCTS_VIEW,
      P.INVENTORY_VIEW,
      P.INVENTORY_IN,
      P.INVENTORY_OUT,
      P.TRANSFER_REQUEST,
      P.TRANSFER_RECEIVE,
    ],
  },
  {
    name: 'Salesman',
    description: 'Product search, stock view, Stock OUT, customers and invoices',
    isSystem: false,
    permissions: [
      P.DASHBOARD_VIEW,
      P.PRODUCTS_VIEW,
      P.INVENTORY_VIEW,
      P.INVENTORY_OUT,
      P.CUSTOMERS_VIEW,
      P.CUSTOMERS_MANAGE,
      P.INVOICE_VIEW,
      P.INVOICE_CREATE,
      P.INVOICE_UPDATE,
    ],
  },
];

export const ADMIN_ROLE_NAME = 'Admin';

/**
 * Permissions added after the first release, with the default roles that receive them on
 * existing installations (the seeder only applies defaults when a role is first created).
 */
export const PERMISSION_UPGRADES = [
  { code: P.TRANSFER_REQUEST, roles: ['Warehouse User'] },
  { code: P.TRANSFER_RECEIVE, roles: ['Warehouse User'] },
];
