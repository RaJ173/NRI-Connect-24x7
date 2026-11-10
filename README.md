# NRI Connect 24/7 — standalone interactive prototype

Open `index.html` in a modern browser. It is self-contained: no npm install, backend, database, external font, or network connection is needed to use it. You can also publish this file on any static host.

Use **Preview as** at the top to explore customers, operations, field engineers, representatives, travel partners, and the super admin. **Demo guide** explains a complete walkthrough. **Demo inbox** contains simulated emails and verification/password reset links. **Reset demo** restores the original sample records and removes this prototype's uploaded files.

The prototype reuses the React screens and most route handlers, validation, permission checks, notifications, and workflow rules from the sibling `NRI-Connect-247-code` project. Browser adapters replace HTTP transport, server storage, password handling, and file storage. The build reads the original source and its synthetic `seed.ts`; it does not copy the original application's `server/storage` data, `.env`, or encryption keys.

## Included actions

- Landing, registration, simulated login/logout, email verification, password reset, profile and password editing.
- Customer dashboards, property creation/editing, archival/restoration, property files, and representative invitations.
- Service and travel request creation/editing, filters, assignment/reassignment, status transitions, comments, attachments, and status history.
- Field visit scheduling, start/update/block/complete, checklists, notes, photographic evidence, customer acknowledgment, closure and reopening.
- Representative acceptance/decline/revocation and scoped property/request access.
- Travel partner cases and completion notes.
- Admin overview, user creation/roles/status, categories, completion/upload settings, audit log, notifications, and email outbox.
- Demo role switching, sample visit evidence, browser-local persistence, data export, and reset.

## Demo behavior and limits

All data is browser-local. Separate devices and browsers do not share changes. Records use localStorage; uploaded file contents use IndexedDB. If storage is blocked or unavailable, the prototype shows a message and some state may last only for that visit. Clearing browser site data removes saved changes.

This is a demonstration, not a secure service. Authentication, access scoping, and password handling simulate application behavior entirely in browser code; anyone opening the file can inspect or reset its data. Use sample information and demo passwords only. No real emails, payments, cloud uploads, or external service calls occur.

The seeded accounts all use `Demo@1234`:

| Email | Role |
|---|---|
| customer@ppo.test | Customer |
| customer2@ppo.test | Second customer |
| ops@ppo.test | Operations admin |
| engineer@ppo.test | Field engineer |
| engineer2@ppo.test | Second field engineer |
| rep@ppo.test | Local representative |
| travel@ppo.test | Travel partner |
| super@ppo.test | Super admin |

Uploads support JPEG, PNG, WebP and PDF, subject to the configured types and size limits, with an additional 10 MB prototype cap per file. Browser quotas can impose lower practical limits. Export includes sample record data but excludes passwords, session/token collections, authentication links, access notes, and uploaded file contents.

Existing application rate limits are not applied to the browser demo. Workflow and role checks are retained for demonstration purposes. They are not a security boundary.

## Publish

Upload `index.html` (and optionally `.nojekyll`) to the root of a static hosting site. No build command is required on the host. Routes use `#/...`, so browser refresh and repository subfolder hosting work without server rewrites. Keep the original full application repository private if desired; only the demo file is needed on the static host.

## Rebuild after original application changes

Keep both project folders beside each other. The original application's `app/node_modules` must contain its existing dependencies.

```powershell
cd "C:\Users\GaKa809\OneDrive - HP Inc\Office Space\Projects\NRI-Connect-247-code-static"
node tools/build.mjs
```

This updates `index.html` and temporary output under `.build/`; it does not modify the original application source. The tools are build-time sources and are not needed to open or deploy the generated HTML.

## Verification

The browser check uses installed Microsoft Edge in an isolated headless profile. It checks HTTP subfolder hosting and direct file opening, role switching, responsive layout, and absence of external application requests. Its full mode exercises request/visit completion rules, file handling, customer isolation, representative access and revocation, travel cases, admin settings, simulated verification/recovery and persistence after reload.

```powershell
node tools/browser-check.mjs --full
```

Test profiles and screenshots are stored under `.checks/`, which is excluded from Git.
