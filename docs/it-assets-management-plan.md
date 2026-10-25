# IT Assets Management Plan

## Implementation Status
- Phase 1 backend schema and API skeleton are added.
- Phase 2 workflow tables and endpoints are being added for warranty, issues, repairs, replacements, and movement history.
- Phase 3 stock room tables, endpoints, and UI tab are added.
- Dashboard/reporting views are added in the frontend.
- Edit modals for assets and stock items are added in the frontend.
- Next step is polishing forms, validation, and export views.

## Goal
Build an internal asset tracking module for Speed Net Khulna's office operations. The module should track IT equipment across 4 offices, desk locations, warranty details, purchase history, maintenance/issues, replacements, and stock movement.

## Business Context
- Total offices: 4
- Office types: Head Office + 3 Branch Offices
- Each office has multiple desks
- Desks can contain one or more assets
- Assets include PCs, monitors, UPS, routers, switches, printers, accessories, and other IT equipment
- Assets may be repaired, replaced, transferred, written off, or under warranty

## Core Outcomes
- Know where each asset is located right now
- Know which desk/office is using the asset
- Track purchase cost, purchase date, vendor, warranty period, and serial numbers
- Track issue/repair/replacement history
- Track asset movement between offices and desks
- Track consumable stock and spare inventory separately from assigned assets

## Recommended Module Structure

### 1. Master Data
Maintain the fixed reference data used by the module.
- Offices
- Desks
- Asset categories
- Asset brands and models
- Vendors/suppliers
- Warranty types and statuses
- Condition/status values

### 2. Asset Register
One row per physical asset.
Fields should include:
- Asset tag / inventory code
- Category
- Brand
- Model
- Serial number
- Purchase date
- Purchase price
- Vendor
- Warranty start date
- Warranty end date
- Warranty type
- Current condition
- Current status
- Current office
- Current desk
- Assigned employee, if any
- Notes

### 3. Location Tracking
Track where each asset is physically located.
- Office
- Floor, room, or zone, if needed
- Desk number
- Assigned to department or employee
- Movement history

### 4. Warranty Tracking
Track warranty status and expiry.
- Warranty duration in days or months
- Warranty end date auto-calculated from purchase date
- Status: active, expiring soon, expired
- Vendor warranty claim notes
- Warranty claim history

### 5. Asset Lifecycle
Track the full lifecycle of each item.
- Purchased
- Received
- Assigned
- In use
- Under maintenance
- Repaired
- Replaced
- Transferred
- Lost
- Broken
- Written off

### 6. Issue and Repair Logs
Record every incident.
- Issue date
- Reported by
- Problem summary
- Severity
- Diagnosis
- Repair action
- Repair cost
- Parts used
- Vendor/technician
- Completion date
- Outcome

### 7. Replacement and Disposal
Track when assets are replaced or removed from service.
- Replacement reason
- Old asset status
- New replacement asset
- Disposal or write-off reason
- Approval trail

### 8. Stock and Spare Items
Separate module for unassigned stock.
- Spare monitor
- Spare mouse
- Spare keyboard
- Spare PSU
- Spare RAM/HDD/SSD
- Other consumables
- Minimum stock alerts

### 9. Reports and Dashboards
Recommended dashboards:
- Assets by office
- Assets by desk
- Warranty expiring soon
- Broken assets
- Assets under repair
- Purchase summary by month
- Vendor-wise spending
- Replacement history
- Current stock summary

## Data Model Recommendation

### Primary Tables
- `asset_offices`
- `asset_desks`
- `asset_categories`
- `asset_vendors`
- `assets`
- `asset_movements`
- `asset_warranties`
- `asset_issues`
- `asset_repairs`
- `asset_replacements`
- `asset_stock_items`
- `asset_stock_movements`

### Important Fields
- `id`
- `asset_tag`
- `office_id`
- `desk_id`
- `category_id`
- `vendor_id`
- `serial_number`
- `purchase_price`
- `purchase_date`
- `warranty_end_date`
- `status`
- `condition`
- `notes`
- `created_at`
- `updated_at`

## Permission Model
Suggested access levels:
- Super Admin: full access
- IT Admin: create/update/transfer/repair
- Branch Manager: view office assets, raise issues
- Employee/Office staff: view assigned assets, report issue

## Workflow
### New Asset Entry
1. Purchase recorded
2. Asset tag generated
3. Vendor and warranty entered
4. Office and desk assigned
5. Asset becomes active

### Asset Movement
1. Current location recorded
2. Move request submitted or approved
3. Movement log created
4. Desk and office updated

### Issue and Repair
1. Issue reported
2. IT team reviews
3. Repair logged
4. Status updated
5. Warranty claim recorded if applicable

### Replacement
1. Broken or outdated asset marked
2. Replacement asset assigned
3. Old asset archived, repaired, or written off
4. History preserved

## UI Recommendation
- Dashboard
- Asset Register
- Office/Desk View
- Add Asset
- Move Asset
- Repair Log
- Warranty Tracker
- Stock Room
- Reports
- Settings / Master Data

## Implementation Phases

### Phase 1
- Master data
- Asset register
- Office/desk mapping
- Basic view and search

### Phase 2
- Movement history
- Warranty tracking
- Issue/repair logs
- Permission control

### Phase 3
- Replacement and disposal
- Stock room
- Dashboard cards and reports
- Alerts for warranty expiry

### Phase 4
- Advanced analytics
- Export to Excel/PDF
- Optional barcode/QR scan support

## Design Principles
- Keep every asset traceable
- Do not overwrite history
- Use logs for every change
- Make desk and office mapping mandatory
- Separate active assets from spare stock
- Make warranty expiration visible

## Open Questions
- Should desks be fixed per office or user-defined?
- Do you want asset assignment to employee, desk, or both?
- Should stock items be tracked as counted inventory or individual assets?
- Do you need QR/barcode scanning in the first release?
