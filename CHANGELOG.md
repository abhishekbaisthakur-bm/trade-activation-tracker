# Version history

Each production push receives a version tag. Use the tag to identify or restore
the exact frontend, API and database code deployed at that point.

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
