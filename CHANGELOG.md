# Changelog

All notable changes to this project follow [Conventional Commits](https://www.conventionalcommits.org/).

## Unreleased

- `feat`: a **Save and preview** workspace action on the Element workspace, next to Save. Saves
  the Element's draft, then opens the real front-end preview of the first page that uses it.
- `feat`: a compact Previous / N of M / Next control inside the preview tab's own toolbar (next to
  Umbraco's "Fit browser" button), for stepping through every other page that references the same
  Element — reusing one browser tab rather than opening one per page — plus a dropdown for jumping
  straight to any already-resolved page.
- Usage resolution calls Umbraco's own public "referenced by" Management API endpoints
  (`ElementService`/`DocumentService`/`MediaService`/`MemberService`) directly from the frontend —
  no custom backend, no persistence, no database migrations.
- Usage resolution is an incremental, resumable walk (an async generator) rather than an
  eager resolve-then-slice: an Element used on hundreds of pages is never fully resolved just
  because an editor stepped through a few of them.
- `fix`: the workspace action's permission condition now requires Element **Update** (matching
  Umbraco Core's own Save action) rather than Read — the action triggers a save, so a read-only
  user should never see it as enabled.
- `fix`: Next/Previous no longer advance the toolbar's position (or persist it) before the target
  page's preview URL is confirmed — a failed lookup used to leave the toolbar showing a page the
  tab never actually navigated to, silently, with no feedback.
- The transitive usage-resolution algorithm is a standalone, dependency-free function
  (`element-usage-resolver.ts`) with 8 passing unit tests run via Node's built-in test runner
  (`npm test`) — no live Umbraco services or mocking needed.

### Removed

- An earlier custom backend (a Management API controller + a C# resolver wrapping
  `ITrackedReferencesService`) was built, unit-tested, and then deleted once Umbraco's own
  "referenced by" endpoints turned out to cover the same need with richer, already-discriminated
  data.
- An earlier backoffice modal/dialog listing every usage was replaced by the in-toolbar
  Previous/Next control described above — clicking "Save and preview" now opens the preview tab
  directly, with no intermediate backoffice UI.
