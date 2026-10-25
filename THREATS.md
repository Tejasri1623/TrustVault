# TrustVault threat model and security notes

## Assets and trust boundaries

- Document bytes and extracted document data are private to the owner, explicitly shared users, and workflow assignees. An administrator's system role alone does not grant document access.
- MongoDB contains user credentials (bcrypt hashes), document metadata, permission grants, workflow state, user activity, and the application audit-event collection.
- The browser is untrusted. Hiding controls in EJS/JavaScript is not an authorization boundary.
- `Backend/uploads/` is server-side private storage. Only `Backend/public/` is mounted at `/assets`.

## Threat scenarios and mitigations

| Scenario | Mitigation in the application | Verification / remaining gap |
|---|---|---|
| A user guesses a document ID and reads another user's file or analysis (IDOR). | Each document-specific endpoint loads the document on the server and checks current ownership, named-user permissions, or workflow assignment. System roles alone do not grant document access. Inaccessible IDs return 404. | Jest tests cover cross-user denial, role-only denial, and valid read grants. They use mocked persistence; MongoDB integration tests are still needed. |
| A revoked viewer continues using a stale JWT or cached permission. | Grants are stored on the document, not in JWT claims. The authorization middleware queries MongoDB on each document request. Permission grants/revocations use atomic database updates. | A Jest test removes a grant between requests and verifies the next request is denied. In-flight requests already authorized before revocation may complete. |
| A stolen JWT remains valid after logout or password change. | Tokens carry a `tokenVersion` compared to the current user record; logout and password changes increment that version. The auth middleware also loads the current database role on each request. | Tests cover stale-token rejection and database-derived roles. This invalidates all sessions for that user and depends on MongoDB availability. |
| Search filters accidentally replace the visibility predicate and reveal other documents. | Search combines visibility and search criteria using `$and`; owner/category/date filters are server-side. Dashboard and analytics document aggregates use the shared visibility query. | Unit coverage currently focuses on the authorization guard rather than every MongoDB query plan; add real-database tests before a high-assurance deployment. |
| Malicious filename causes traversal or response-header injection. | File names are reduced to a base name, control/markup characters are replaced, and stored disk names include a random UUID. Download names are sanitized again. | No dedicated fuzz/property test suite is present. |
| Spoofed file extension or MIME is uploaded. | Multer restricts extension/MIME pairs, files are limited to 10 MiB and 20/request, and content signatures or UTF-8 text are checked before records are created. | This is format validation, not malware scanning or comprehensive parser validation. Polyglot and malformed files remain a risk. |
| Uploaded HTML runs script in the TrustVault origin. | HTML/HTM view requests are forced to download, with `nosniff` and a sandbox CSP; other document previews also receive `nosniff`. | Browser-specific content handling should be verified against the supported browsers. |
| A file is fetched from a guessed public URL. | Express static hosting is mounted only on `Backend/public/`; uploads are under `Backend/uploads/` and have no public route. Document access uses authenticated ID-based endpoints. | Deployment must not configure a reverse proxy/CDN to expose `Backend/uploads/`. Local files are not encrypted by the application. |
| A viewer changes another user's document ACL or deletes a document. | Metadata edits require ownership or a current `edit` grant. Permission management and deletion require ownership. Named `edit` grants do not imply ACL management or deletion. | Administrators can manage accounts and audit events but do not receive document access solely from their role. |
| A non-assigned user approves/rejects a document. | Approval lists and decisions are scoped to the stored routed/current approver identity; workflow definitions require administrator authorization. | Legacy workflow role labels remain in routing configuration; verify approver assignments before converting legacy account records. |
| Audit events are altered or erased by an application user. | Audit events are stored separately from the user-facing Activity feed, immutable through Mongoose, and have no application update/delete route. Administrative activity pages are read-only. | **Not tamper-proof.** A MongoDB administrator or any process with direct database write access can change/delete events. There is no hash chain, separate restricted DB role, external WORM retention, or verified immutable backup configured here. |
| Audit persistence fails while a document operation succeeds. | Audit writes are awaited and errors are surfaced/logged rather than silently treated as success. | Some state changes are not in a MongoDB transaction with the audit insert. For example, a permission/document change can persist before the audit insert fails. Configure transactions or a durable outbox if atomic evidence is required. |
| Forged user activity is mistaken for authoritative audit history. | `/activities` remains a separate user-facing feed; `/admin/activity` reads only `AuditEvent`. | The legacy activity POST allows users to write entries under their own account. Do not use that feed as security evidence. |
| Cross-origin scripts read cookie-authenticated API responses. | An empty CORS allowlist no longer enables arbitrary origins; configured origins must match exactly. The production cookie is Secure, HTTP-only, and SameSite Strict. | CORS is not a CSRF defense. The application disables Helmet's global CSP to support existing inline scripts/CDN assets, so XSS defense-in-depth remains limited. |

## Tests

The final observed local run of `npm test` after the role/auth changes passed **6 suites / 61 tests**. The tests cover role-only denial, revoked grants, public role restrictions, database-derived roles, token revocation, and existing approval/workflow behavior. ACL and authentication route tests use mocked persistence and do not connect to a real MongoDB/Redis deployment. No production penetration test or independent security audit has been performed.

## Accepted risks and follow-up

- Local file bytes are not encrypted at rest by this application. Apply disk encryption, OS access control, and backup protection.
- File type validation does not replace antivirus/content disarm and reconstruction. Consider malware scanning and asynchronous quarantine before processing.
- Application audit events are not tamper-proof until database roles, external write-once retention, integrity verification, and backup controls are provisioned and tested.
- Existing AI/OCR and email-ingestion paths process documents asynchronously. Their service credentials and data-retention behavior need a separate deployment review.
- `JWT_SECRET`, MongoDB credentials, email/Redis/AI credentials, and storage credentials must be supplied through a secret manager and rotated when exposed. Never use placeholders from `.env.example`.
- Profile-photo upload was not added: there is no existing safe image-storage lifecycle, and introducing one would need separate validation, private storage, and deletion controls.
