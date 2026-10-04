# Version history

Each production push receives a version tag. Use the tag to identify or restore
the exact frontend, API and database code deployed at that point.

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
