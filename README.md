<<<<<<< HEAD
# TrustVault 🔐

### Secure Document Sharing and Management Platform

TrustVault is a secure document management platform designed to protect confidential documents through authentication, document-level permissions, controlled sharing, and audit logging. It enables users to manage documents while ensuring that access is restricted to authorized users.

## 📌 Problem Statement

Organizations frequently share sensitive documents such as contracts, financial reports, employee records, and business agreements. Uncontrolled access can expose confidential information, while inadequate activity tracking makes it difficult to determine who accessed or modified a document.

TrustVault addresses these challenges through server-side authorization, named-user document permissions, permission revocation, and activity auditing.

## ✨ Key Features

* **Authentication:** Secure login and registration using JWT-based authentication.
* **Role-Based Access Control:** Supports administrator, document owner, editor, and viewer roles.
* **Document Management:** Upload, organize, search, view, download, and manage documents according to permissions.
* **Document-Level Sharing:** Grant named users read or edit access to individual documents.
* **Permission Revocation:** Revoke document access and enforce the current permission state on subsequent requests.
* **Secure File Storage:** Store uploaded files outside the publicly served static directory.
* **Audit Logging:** Record relevant document and access-related events.
* **Administrative Monitoring:** Review audit activity and manage user roles.
* **Document Search:** Filter discoverable documents by name, owner, category, and date.
* **AI Integration:** Optional AI-powered document analysis when configured.
* **Automated Tests:** Test important authorization and application behavior.

> Feature availability and security guarantees depend on the existing implementation and deployment configuration. See the limitations below.

## 🛠️ Technology Stack

| Component             | Technology                  |
| --------------------- | --------------------------- |
| Backend               | Node.js                     |
| Web Framework         | Express.js                  |
| View Engine           | EJS                         |
| Database              | MongoDB                     |
| ODM                   | Mongoose                    |
| Authentication        | JSON Web Tokens (JWT)       |
| Password Security     | bcrypt                      |
| Testing               | Jest                        |
| Background Processing | BullMQ and Redis (optional) |
| AI Integration        | Gemini API (optional)       |

## 🏗️ Architecture

TrustVault uses a server-rendered Express application with MongoDB persistence.

```text
                    ┌─────────────────────┐
                    │       Browser       │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   Express Server    │
                    │  EJS Views & Routes │
                    └──────────┬──────────┘
                               │
                 ┌─────────────┼─────────────┐
                 ▼             ▼             ▼
          ┌────────────┐ ┌────────────┐ ┌────────────┐
          │    Auth    │ │ Documents  │ │   Audit    │
          │ & Roles    │ │ & Access   │ │   Events   │
          └────────────┘ └─────┬──────┘ └────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │   MongoDB/Mongoose  │
                    └─────────────────────┘
```

Uploaded files are stored under `Backend/uploads/`. Only `Backend/public/` is configured for static content. Protected document access should use the application's authenticated routes.

## 👥 User Roles and Permissions

| Role           | Responsibilities                                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Administrator  | Manage users and review administrative audit activity. Document access still requires ownership or an applicable document grant or assignment. |
| Document Owner | Manage owned documents, update document metadata, and grant or revoke document-level permissions.                                              |
| Editor         | Access documents according to the permissions granted by the owner and perform permitted editing operations.                                   |
| Viewer         | Read or download documents when authorized by the document's access rules.                                                                     |

The application also contains legacy role values. Refer to the existing authorization logic before changing or migrating existing user roles.

## 📄 Document Management

TrustVault supports document upload and management through its backend application.

* Upload documents using the document upload endpoint.
* Search documents using supported metadata filters.
* View or download documents through authorized routes.
* Manage document metadata according to ownership and permissions.
* Store uploaded files in a directory that is not publicly served.
* Validate file size, extension, MIME type, and applicable content signatures.

**Upload restrictions currently documented:**

* Maximum file size: 10 MiB per file.
* Maximum files per upload request: 20.
* File validation is not a replacement for malware scanning.

## 🔑 Document-Level Permissions

TrustVault supports named-user permissions for individual documents.

* Owners can grant `read` or `edit` access to a user.
* Permission records include grant information.
* Owners can revoke previously granted access.
* Revocation information is retained in the permission record.
* Protected document routes check the current permission state on the server.
* An `edit` grant does not automatically grant permission to manage access or delete a document.

An administrator's system role alone does not automatically provide access to every document.

## 🛡️ Authentication and Authorization

Authentication uses a signed JWT stored in an HTTP-only cookie.

The application reloads the authenticated user's current database record and role for protected requests rather than relying solely on a role supplied by the client.

Security-related implementation details include:

* Protected routes for authenticated operations.
* Server-side document ownership and permission checks.
* Restrictions on public administrator registration.
* Token invalidation through the application's token-version mechanism on supported logout and password-change flows.
* Responses that avoid disclosing whether inaccessible documents exist.

These controls should be verified against the current implementation and tested in the target deployment environment.

## 📊 Audit Logging

TrustVault stores audit events in MongoDB. The application documents events with information such as:

* Actor and role
* Action performed
* Resource type and identifier
* Operation outcome
* Additional details
* IP address and user agent, where recorded
* Timestamp

Administrators can review recent audit events through the administrative activity interface. Document owners can review available activity for their documents.

**Important limitation:** Application-level restrictions do not make the audit trail tamper-proof. A database administrator or process with direct database write access may alter or delete records. External immutable retention and stronger integrity verification are not configured by the existing project.

## ⚙️ Prerequisites

Install the following before running the application:

* Node.js 20.19 or later
* npm
* MongoDB, locally or through a managed service
* Redis, only if persistent BullMQ background processing is required

## 🚀 Installation and Setup

### 1. Clone the repository

```powershell
git clone <YOUR_REPOSITORY_URL>
cd <YOUR_PROJECT_DIRECTORY>
```

Replace the placeholders with the actual repository URL and directory name.

### 2. Configure environment variables

From the repository root:

```powershell
Copy-Item Backend\.env.example Backend\.env
```

Open `Backend/.env` and configure the required values:

```env
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_unique_random_secret
PORT=3000
NODE_ENV=development
```

Use your own database connection string and a strong, randomly generated JWT secret. Do not commit `.env` or expose credentials publicly.

### 3. Install dependencies

```powershell
Set-Location Backend
npm install
```

### 4. Create an administrator account

For a new database, configure the administrator seed variables in `Backend/.env`:

```env
SEED_ADMIN_USERNAME=trustvault-admin
SEED_ADMIN_EMAIL=your_admin_email
SEED_ADMIN_PASSWORD=your_unique_strong_password
```

Then run:

```powershell
npm run seed:admin
```

Use a unique password and keep it private. The seed script is intended to create the initial administrator when its required conditions are satisfied.

### 5. Start the application

From the `Backend/` directory:

```powershell
npm start
```

Open the application in your browser:

```text
http://localhost:3000/
```

Available browser pages include `/`, `/register`, `/login`, and `/dashboard`, subject to authentication and authorization.

## 🔧 Environment Variables

| Variable               | Purpose                           |
| ---------------------- | --------------------------------- |
| `MONGO_URI`            | MongoDB connection string         |
| `JWT_SECRET`           | Secret used to sign JWTs          |
| `PORT`                 | Server port; defaults to `3000`   |
| `NODE_ENV`             | Application environment           |
| `JWT_EXPIRES_IN`       | JWT expiration setting            |
| `CORS_ALLOWED_ORIGINS` | Allowed browser origins           |
| `LOG_LEVEL`            | Application logging level         |
| `GEMINI_API_KEY`       | Optional AI integration           |
| `REDIS_HOST`           | Optional Redis host               |
| `REDIS_PORT`           | Optional Redis port               |
| `REDIS_PASSWORD`       | Optional Redis password           |
| `ESCALATION_SLA_MS`    | Workflow escalation interval      |
| `EMAIL_PROVIDER`       | Optional email-ingestion provider |

Additional email-ingestion settings are documented in `Backend/EMAIL_INGESTION_README.md`, if that file is present.

Never publish real environment values, API keys, database credentials, or passwords.

## 🗄️ Database Schema Overview

The application uses Mongoose models backed by MongoDB collections.

| Collection           | Purpose                                                             |
| -------------------- | ------------------------------------------------------------------- |
| `users`              | User accounts, password hashes, roles, and token version            |
| `documents`          | Document metadata, ownership, permissions, and workflow information |
| `auditevents`        | Application audit events                                            |
| `activities`         | User-facing activity feed                                           |
| `approvals`          | Existing approval-related records                                   |
| `workflows`          | Workflow definitions                                                |
| `workflowexecutions` | Workflow execution state                                            |
| `storageconfigs`     | Storage-provider configuration                                      |
| `processedemails`    | Email-ingestion deduplication records                               |

The exact fields and indexes are defined by the existing Mongoose models.

## 🧪 Running Automated Tests

Run tests from the `Backend/` directory:

```powershell
npm test
```

The documented test suite covers areas such as document authorization, permission revocation, role restrictions, token behavior, and workflow policies.

Some tests use mocked persistence. Passing tests do not establish that the application is production-ready or that its real MongoDB, Redis, and hosting configuration is secure.

## 📚 API Documentation

Refer to [`API.md`](./API.md) for the application's documented API routes and authorization requirements.

Protected requests use the application's authentication mechanism. Document-specific access must be authorized on the server. Check the actual route definitions and middleware before relying on any endpoint for a particular role.

## 🔐 Security Considerations

TrustVault is designed to reduce unauthorized document access, but deployment security also depends on infrastructure and operational controls.

Recommended practices include:

* Use HTTPS in production.
* Store secrets in environment variables or a secret manager.
* Restrict MongoDB and Redis network access.
* Use least-privilege database credentials.
* Keep uploaded files outside public static directories.
* Back up documents and database records.
* Configure appropriate log retention.
* Perform security testing before production use.
* Consider malware scanning for uploaded files.
* Verify backup restoration and incident-response procedures.

=======
# TrustVault
TrustVault is a secure document-sharing platform with role-based access control, document permissions, and audit logging, built using Angular, Node.js, Express, and MongoDB.
