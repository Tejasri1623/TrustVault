# TrustVault API and authorization

Base URL for local development: `http://localhost:3000`. Protected browser/API requests use the `token` HTTP-only cookie set by `POST /login`. The server re-loads the user from MongoDB on each authenticated request; a client-supplied role is not trusted.

## Pages and public endpoints

| Method | Path | Required access |
|---|---|---|
| `GET` | `/` | Public landing page |
| `GET` | `/test` | Public legacy test response |
| `GET` | `/dashboard`, `/documents`, `/documents/:id`, `/analytics` | Authenticated; document data is fetched through protected APIs |
| `GET` | `/settings` | Authenticated; renders the caller's profile |
| `GET` | `/workflows` | Administrator |
| `GET` | `/admin/dashboard`, `/admin/pending-docs`, `/admin/users` | Administrator |
| `GET` | `/health/live`, `/health/ready` | Public |

## Document permissions

- **Administrator** (`role: admin`): admin-only functions do not automatically grant document read, edit, delete, or sharing access. The administrator must also own the document, have a current document grant, or be assigned in its workflow.
- **Document Owner**: the user referenced by `Document.userId`; may read, update metadata, delete, view document activity, and grant/revoke named-user permissions for that document.
- **Named user**: may read when granted `read` or `edit`; may use edit actions only when granted `edit`.
- **Workflow assignee**: a user in `routedTo`, `currentApprover`, or `approvalChain` may discover/read the document for workflow purposes. Approval decisions are restricted to the current assignee (or the legacy routed approver where there is no current approver).
- Per-document grants record the target user, `read`/`edit` access, grantor, and grant timestamp. Revocation retains the record with revocation actor and timestamp; protected endpoints check current MongoDB state on each request.
- Unauthenticated users and users without the required access are denied. Document-specific APIs return `404` for a missing or inaccessible document to avoid exposing its existence.

## Authentication and account routes

| Method | Path | Required access |
|---|---|---|
| `GET` | `/register`, `/login` | Public page |
| `POST` | `/register` | Public; server validates name/email/password and accepts only `owner`, `editor`, or `viewer`; `admin` is rejected |
| `POST` | `/login` | Public; rate-limited; sets HTTP-only cookie |
| `GET`, `POST` | `/logout` | Public; revokes the JWT token version and clears the HTTP-only cookie |
| `GET`, `POST` | `/forgot-password` | Public; reset-token flow |
| `GET`, `POST` | `/reset-password/:token` | Public; valid, unexpired token required |
| `PUT` | `/api/settings/profile` | Authenticated user; updates only their own profile |
| `PUT` | `/api/settings/password` | Authenticated user; current password required; invalidates existing tokens |

## Documents

| Method | Path | Required role/permission |
|---|---|---|
| `POST` | `/api/documents/upload` | Authenticated `owner` or `admin`; multipart field `documents`; up to 20 files, 10 MiB each. The uploader owns the resulting document |
| `GET` | `/api/documents` | Authenticated; returns documents discoverable by the caller |
| `GET` | `/api/documents/my` | Authenticated; same visibility policy, retained legacy endpoint |
| `GET` | `/api/documents/stats` | Authenticated; totals are visibility-scoped |
| `GET` | `/api/documents/recent` | Authenticated; latest visible documents |
| `GET` | `/api/documents/search` | Authenticated; results are constrained by document visibility. `q` searches file name, category metadata, keywords, and owner name/email; `owner`, `category` (or legacy `department`), `date`, `type`, and `status` filters are supported |
| `POST` | `/api/documents/reanalyze` | Administrator only; global re-analysis job |
| `GET` | `/api/documents/:id/view` | Owner, named `read`/`edit` user, or workflow assignee; administrator role alone is insufficient |
| `GET` | `/api/documents/:id/download` | Same as `view` |
| `GET` | `/api/documents/:id/analysis` | Same as `view` |
| `POST` | `/api/documents/:id/reanalyze` | Owner or named user with `edit` |
| `PATCH` | `/api/documents/:id/metadata` | Owner or named user with `edit`; only `fileName`, `documentType`, and `department` are accepted |
| `GET` | `/api/documents/:id/permissions` | Owner only; returns active named-user grants |
| `PUT` | `/api/documents/:id/permissions` | Owner only; JSON `{ "email": "user@example.com", "access": ["read"] }` or `["edit"]` |
| `DELETE` | `/api/documents/:id/permissions/:userId` | Owner only; records revocation and denies future requests |
| `GET` | `/api/documents/:id/activity` | Owner only; latest 100 audit events for that document |
| `DELETE` | `/api/documents/:id` | Owner only |

The `/documents` page routes render the existing EJS document interface; data operations are enforced by the `/api/documents` routes above. Uploaded files are not exposed at public `/uploads/...` URLs.

## Approval and workflow routes

| Method | Path | Required role/permission |
|---|---|---|
| `GET` | `/approvals` | Authenticated |
| `GET` | `/api/approvals/pending` | Authenticated; only documents routed/assigned to the caller |
| `POST` | `/api/approvals/:id/decision` | Stored current approver, or routed approver where no current approver exists |
| `POST` | `/api/workflow/documents/:id/approve` | Authenticated current approver in the active approval chain |
| `POST` | `/api/workflow/documents/:id/reject` | Authenticated current approver in the active approval chain |
| `GET` | `/api/workflow/documents/:id/history` | Owner, named `read`/`edit` user, or workflow assignee |
| `GET`, `POST`, `PUT`, `DELETE` | `/api/workflows...` | Administrator; operates on workflow definitions, not document ACLs |

Workflow-definition routes are `GET/POST /api/workflows`, `GET/PUT/DELETE /api/workflows/:id`, and `POST /api/workflows/:id/publish` or `/execute`. Each requires `admin`.

## Administrator and operations routes

| Method | Path | Required role/permission |
|---|---|---|
| `GET` | `/admin/dashboard`, `/admin/pending-docs` | Administrator |
| `GET` | `/admin/users`, `/admin/api/users` | Administrator; lists at most 100 accounts |
| `PATCH` | `/admin/api/users/:id/role` | Administrator; target role must be `admin`, `owner`, `editor`, or `viewer`; cannot change self or demote an administrator here |
| `GET` | `/admin/pending` | Administrator; results still require document visibility/assignment |
| `GET` | `/admin/document/:id` | Administrator plus document read permission/ownership/workflow assignment |
| `POST` | `/admin/approve/:id`, `/admin/reject/:id`, `/admin/request-changes/:id` | Administrator and the document's current approver (or routed approver if no current approver is set) |
| `GET` | `/admin/activity`, `/admin/api/activity` | Administrator; audit events are read-only in the application and the API returns at most the latest 100 |
| `GET` | `/api/analytics/data`, `/dashboard/stats` | Authenticated; document metrics are restricted to visible documents |
| `GET` | `/activities/recent` | Authenticated; caller's own user-facing activity, or all activity for administrator |
| `POST` | `/activities` | Authenticated; writes only to the caller's user-facing activity feed. This is not the authoritative audit trail |
| `GET`, `PUT`, `DELETE` | `/api/settings/storage` | Administrator |
| `POST` | `/api/settings/storage/test`, `/api/settings/storage/migrate` | Administrator |
| `GET` | `/api/settings/storage/migration-status` | Administrator |

The authoritative application audit events are stored separately from the user-facing `Activity` feed. Database-level privilege separation, external immutable retention, and tamper-proof verification are not configured; see [THREATS.md](./THREATS.md).

Legacy account role strings are retained in the database to avoid destructive or surprise migrations. At runtime `editor` is a core role; legacy manager/user role values map to `viewer`; `admin` remains `admin`. Existing workflow role labels remain configuration labels, while current assignments are checked by user ID. New account creation and role updates accept only the four core roles.
