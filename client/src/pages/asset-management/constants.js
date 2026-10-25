export const inputClass = 'form-control';

export const ASSET_STATUS_TONES = {
  active: 'success',
  in_stock: 'secondary',
  maintenance: 'warning',
  repair: 'warning',
  broken: 'danger',
  replaced: 'dark'
};

export const CONDITION_TONES = { good: 'success', fair: 'warning', poor: 'danger' };
export const SEVERITY_TONES = { low: 'secondary', medium: 'info', high: 'warning', critical: 'danger' };
export const ISSUE_STATUS_TONES = { open: 'danger', in_progress: 'warning', resolved: 'success' };
export const STOCK_STATUS_TONES = { available: 'success', reserved: 'info', low_stock: 'warning', out_of_stock: 'danger' };
export const WARRANTY_STATUS_TONES = { active: 'success', expiring_soon: 'warning', expired: 'danger' };

export const emptyWarrantyForm = {
  asset_id: '',
  vendor_id: '',
  warranty_type: '',
  warranty_start_date: '',
  warranty_end_date: '',
  coverage_notes: '',
  notes: ''
};

export const emptyIssueForm = {
  asset_id: '',
  issue_title: '',
  issue_description: '',
  severity: 'medium',
  warranty_claimed: false,
  office_id: '',
  desk_id: ''
};

export const emptyRepairForm = {
  asset_id: '',
  issue_id: '',
  vendor_id: '',
  technician_name: '',
  repair_action: '',
  parts_used: '',
  repair_cost: '',
  started_at: '',
  completed_at: '',
  outcome: '',
  notes: ''
};

export const emptyReplacementForm = {
  old_asset_id: '',
  new_asset_id: '',
  replacement_reason: '',
  disposal_method: '',
  notes: ''
};

export const emptyAssetEditForm = {
  asset_tag: '',
  asset_name: '',
  category_id: '',
  vendor_id: '',
  office_id: '',
  desk_id: '',
  assigned_user_id: '',
  brand: '',
  model: '',
  serial_number: '',
  purchase_date: '',
  purchase_price: '',
  warranty_start_date: '',
  warranty_end_date: '',
  warranty_type: '',
  status: 'in_stock',
  condition: 'good',
  notes: '',
  warranty_notes: ''
};

export const emptyComponentForm = {
  component_type: '',
  component_name: '',
  brand: '',
  model: '',
  serial_number: '',
  specification: '',
  notes: ''
};

export const emptyComponentReplaceForm = {
  component_id: '',
  component_type: '',
  component_name: '',
  brand: '',
  model: '',
  serial_number: '',
  specification: '',
  reason: '',
  notes: ''
};

export const emptyStockItemForm = {
  item_code: '',
  item_name: '',
  item_type: 'spare',
  category_id: '',
  vendor_id: '',
  office_id: '',
  desk_id: '',
  quantity_on_hand: '0',
  minimum_quantity: '0',
  unit_price: '',
  serial_number: '',
  status: 'available',
  notes: ''
};

export const emptyStockMovementForm = {
  stock_item_id: '',
  movement_type: 'received',
  quantity_change: '',
  from_office_id: '',
  from_desk_id: '',
  to_office_id: '',
  to_desk_id: '',
  reason: '',
  notes: ''
};

export const emptyDeskForm = {
  office_id: '',
  desk_label: '',
  official_email: '',
  assigned_user_id: '',
  floor_label: '',
  location_note: ''
};

export const emptyDeskMoveForm = {
  asset_id: '',
  to_office_id: '',
  to_desk_id: '',
  reason: ''
};
