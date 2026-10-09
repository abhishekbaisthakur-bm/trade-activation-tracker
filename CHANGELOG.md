# Version history

Each production push receives a version tag. Use the tag to identify or restore
the exact frontend, API and database code deployed at that point.

## v1.6.0 — 9 October 2026

- Populate Admin State, City and Area filters from the live pharmacy master list.
- Add cascading Regional Head, City Head, Team Lead and Salesman filters.
- Apply hierarchy filters to dashboards, activation records and downloads.
- Make activation photos clickable at full size and show actionable photo-loading errors.

## v1.5.0 — 8 October 2026

- Share pharmacy targets and activation reporting between Regional Heads with the same Region.
- Keep each Regional Head's user-management hierarchy separate.
- Apply shared-region scope to performance totals, activation access, photos and Excel exports.
- Assign every Regional Head to the ADMIN001 reporting root.
- Normalize region matching for capitalization and extra spaces.

## v1.4.1 — 8 October 2026

- Count each unique RIO ID + Party/Alt Code as a target-store assignment.
- Show distributor-specific pharmacy options to salesmen during activation.
- Link an activation only when both its pharmacy and Party/Alt Code match.
- Keep exact duplicate RIO + Party/Alt Code rows consolidated.

## v1.4.0 — 8 October 2026

- Support multiple distributor Party/Alt Codes for one pharmacy/RIO ID.
- Import large Regional Head master files using two bulk database operations.
- Keep one pharmacy record per RIO while preserving every distinct distributor code.
- Search and display all Party/Alt Codes associated with a pharmacy.
- Remove the incorrect duplicate-RIO rejection from CSV preflight validation.

## v1.3.0 — 7 October 2026

- Show the Regional Head's total active master-list stores on Overview.
- Replace the cluttered flat team table with a collapsible hierarchy.
- Show City Heads first, then Team Leads, then Salesmen on expansion.
- Keep store and activation results visible in compact hierarchy rows.

## v1.2.1 — 7 October 2026

- Populate Regional Head City and Area filters from the active pharmacy master list.
- Remove stale Mumbai/Ghatkopar options inherited from old target geography.
- Match master geography despite harmless case or spacing differences.
- Apply the same normalized geography rules when leaders view their master list.

## v1.2.0 — 7 October 2026

- Calculate planned-shop performance from active pharmacies in the master list.
- Scope Regional Head planned counts to master shops uploaded by their hierarchy.
- Replace the blank merge dropdown with a searchable, explained merge dialog.
- Show the master list in compact pages of 10 rows with totals and navigation.

## v1.1.3 — 7 October 2026

- Remove the production database's actual legacy Pharmacy Name + City constraint.
- Fix the remaining false RIO-conflict error during Regional Head master uploads.

## v1.1.2 — 7 October 2026

- Make RIO ID the sole unique identifier for master pharmacies.
- Allow different retailers to share the same pharmacy name and city.
- Fix Regional Head imports of real master files containing repeated trade names.
- Preserve duplicate-RIO validation and atomic CSV imports.

## v1.1.1 — 7 October 2026

- Fix Regional Head pharmacy master CSV uploads failing with a generic server error.
- Report the exact row when Pharmacy Name + City conflicts with an existing RIO ID.
- Report duplicate RIO IDs inside the uploaded file by row.
- Keep failed imports atomic so no earlier rows are partially saved.

## v1.1.0 — 4 October 2026

- Replace the cluttered Admin user table with a collapsible reporting hierarchy.
- Show Admins first and Regional Heads as expandable roots for City Heads, Team
  Leads and Salesmen.
- Add All, Regional Heads, City Heads and Team Leads quick filters.
- Separate legacy accounts that have no reporting manager so they can be fixed.

## v1.0.1 — 4 October 2026

- Show the default employee password only in the first template row.
- Keep later password cells blank while still applying `12345678` when an
  uploaded employee row has no password.

## v1.0.0 — 4 October 2026

- Add employee bulk upload inside the existing Users page.
- Add role-specific Excel templates with Role and Reporting Manager dropdowns.
- Enforce creator permissions, reporting hierarchy and territory inheritance.
- Reject duplicate identifiers and invalid rows without partially creating users.
- Keep the existing manual Add team member form.
# v1.7.0 — User search and salesman profiles

- Added a universal Admin Data search across names, IDs, contact details, territory and reporting managers.
- Added direct salesman profile links from activation records and record details.
- Salesman profiles show account details, reporting information and recent activations.
