# Development notes — ElementUsagePreview

> This file is the archived build history for this package: the session-by-session log of design
> pivots, live bugs found and fixed, and verification work done while building it. It was split out
> of `CLAUDE.md` during pre-packaging cleanup (2026-09-10) purely to keep that file short and
> current-state-only for a future AI agent or contributor — nothing here was deleted, only moved.
> If you're trying to understand *why* something in the code is shaped the way it is, or you're
> about to "fix" something that looks wrong at first glance, check here first — it's very likely
> already a deliberate decision with a documented reason.
>
> Section numbers below are preserved from the original `CLAUDE.md` for continuity with old commit
> messages and comments that reference them (e.g. "CLAUDE.md §22").

## 12. Scaffold status — history (superseded by §13/§14; read those for current state)

> **This section is historical.** The custom backend (`Composer.cs`, `Controllers/`, `Services/`,
> `Models/`, and its C# tests) described below was **deleted in §14** once it turned out Umbraco
> already exposes public "referenced by" endpoints that do the same job better. Kept here only so
> the reasoning trail (why a backend was built, then removed) stays legible. Do not use this
> section to judge what currently exists in `src/` — see §14 for that.

**Backend (historical — no longer exists) — was built and verified, not just written:**

- `src/ElementUsagePreview/{Composer.cs, Controllers/ElementUsageController.cs,
  Services/{IElementUsageResolver.cs,ElementUsageResolver.cs}, Models/ElementUsageItem.cs}`.
- `dotnet build ElementUsagePreview.slnx` succeeded against the **real**
  `Umbraco.Cms.Core`/`Umbraco.Cms.Api.Management` 18.1.1 NuGet packages (Central Package
  Management via `Directory.Packages.props`), not stubs.
- `tests/ElementUsagePreview.Tests.Unit/ElementUsageResolverTests.cs` — 4 unit tests, all passing,
  covering: direct Document referrers, transitive resolution through a nested Element, a
  non-previewable dead end surfaced (not dropped), and the reference-cycle guard. This coverage
  needs a TS-side replacement now (§14's follow-up) — it wasn't ported, only removed along with
  the C# it tested.

**Frontend — typechecked and bundled clean against the real package; still not run in a browser:**

- `src/ElementUsagePreview/wwwroot/App_Plugins/ElementUsagePreview/` — `manifests.ts`, the
  workspace-action manifest + action, the modal + its token, a repository, `umbraco-package.json`,
  and a `package.json` with an esbuild bundle script.
- **Actually typechecked (2026-09-03)** — installed the real `@umbraco-cms/backoffice@18.1.1` npm
  package into a scratch project and ran `tsc --strict` against every `.ts` file here: **0
  errors**. This caught three real bugs the first draft had, all fixed and re-verified:
  1. `UmbExtensionManifest` doesn't exist as an importable type (it's Core's own ambient global,
     used unimported in its own manifests.ts files) — fixed by typing the root `manifests.ts`
     array as `Array<ManifestWorkspaceAction | ManifestModal>` instead.
  2. The workspace context has no `.save()` method — the real save call is `requestSubmit()`.
  3. The action class must extend `UmbWorkspaceActionBase` (via `UmbSubmitWorkspaceAction`), not a
     bare `UmbActionBase`, to satisfy the `isDisabled`/`isExecuting` contract the extension
     framework requires. Rewritten to **extend `UmbSubmitWorkspaceAction` directly** — the exact
     same base Element's own Save action already uses — and override `execute()` to call
     `super.execute()` first. This is a strict improvement on the original plan, not just a fix:
     it's now provably the *same* save mechanism Save itself uses, not a look-alike.
  - Every other import this scaffold uses (`@umbraco-cms/backoffice/element`'s
    `UMB_ELEMENT_WORKSPACE_ALIAS`/`UMB_ELEMENT_USER_PERMISSION_CONDITION_ALIAS`/
    `UMB_USER_PERMISSION_ELEMENT_READ`, `/workspace`, `/modal`, `/notification`, `/recycle-bin`,
    `/repository`, `/external/lit`, `/external/backend-api`) resolved correctly on the first try —
    the earlier "best-guess import path" hedging in this section is no longer warranted for those.
  - The `esbuild` single-bundle build script mentioned here was **replaced by `tsc` compiling
    every file in place** during §13's live testing (a real bug, not a style choice — see §13
    Bug 2). `package.json`'s `build` script has said `tsc -p tsconfig.json` since then.

## 13. Live-site verification (2026-09-03) — in progress, two real bugs found and fixed so far

Stood up a real Umbraco **18.1.1** site (`dotnet new umbraco`, SQLite unattended install) in a
scratch dir, added this package as a `ProjectReference`, and ran it over HTTPS (the backoffice's
OpenIddict login requires HTTPS — plain HTTP gets `This server only accepts HTTPS requests`, so
`--urls http://...` alone doesn't work; use the `https://localhost:44363`-style profile from
`Properties/launchSettings.json`). Logged into the backoffice with a throwaway local admin account
created for this test site — **not** any real credential. (Aside: Chrome autofilled the
developer's own saved personal credential into this login form unprompted; that autofill was
overwritten with the test site's own throwaway admin login before submitting — real personal
credentials were never used or submitted.)

**Bug 1 — found via Settings → Extension Insights (filter for the package name): the extension
never registered at all.** Root cause: `ElementUsagePreview.csproj` set
`<StaticWebAssetBasePath>App_Plugins/ElementUsagePreview</StaticWebAssetBasePath>` while the
physical files *also* lived under `wwwroot/App_Plugins/ElementUsagePreview/...` — the base path
and the physical folder both encoded the same prefix, so every asset was served at a doubled path
(`/App_Plugins/ElementUsagePreview/App_Plugins/ElementUsagePreview/umbraco-package.json`, 404 at
the real, intended path). Confirmed by inspecting `DevSite.staticwebassets.endpoints.json`
directly, not by guessing. **Fix:** moved every file up one level, so `wwwroot/`'s own contents
*are* `manifests.ts`, `umbraco-package.json`, `workspace-action/`, etc. directly — no nested
`App_Plugins/ElementUsagePreview` folder inside wwwroot — leaving `StaticWebAssetBasePath` to own
that prefix on its own. Re-verified against the endpoints manifest: paths are correct now, and
`GET /App_Plugins/ElementUsagePreview/umbraco-package.json` returns 200 with the right content.

**Bug 2 — found via the browser console after fixing Bug 1: `SyntaxError: Invalid or unexpected
token` instantiating an extension.** Root cause: the frontend build step bundled only
`manifests.ts` into one `manifests.js` (via esbuild), but `manifests.ts`'s `workspaceAction`/modal
entries use *dynamic* `import('./workspace-action/element-usage-preview.action.js')`-style
lazy-loading (the same pattern Core's own manifests use, §3a) — those sibling files were never
compiled, so the browser tried to parse raw TypeScript as JavaScript. **Fix:** dropped the
esbuild-bundle approach entirely in favor of `tsc` compiling every `.ts` file in place (same
relative paths, `.js` siblings, no bundling) — this is actually *more* correct, not just a
workaround: it matches how Core's own compiled packages are structured (many small ES modules
with bare `@umbraco-cms/backoffice/*` specifiers resolved by the browser's import map at runtime),
which the earlier single-bundle approach didn't. `package.json`'s `build` script is now
`tsc -p tsconfig.json`; `tsconfig.json` added alongside it.

**Re-verified after Bug 2's fix (2026-09-04): both bugs are actually fixed, not just theorized.**
Rebuilt both projects clean, restarted the site, logged back in, and checked
Settings → Extension Insights filtered for "ElementUsagePreview": all three of this package's
extensions are registered —

| Type | Name | Alias | Weight |
|---|---|---|---|
| bundle | Element Usage Preview Bundle | `ElementUsagePreview.Bundle` | — |
| modal | Preview Usages Modal | `ElementUsagePreview.Modal.UsageIterator` | — |
| workspaceAction | Preview Usages Element Workspace Action | `ElementUsagePreview.WorkspaceAction.PreviewUsages` | 95 |

Zero console errors on load. This is the extension-loading half of the package fully confirmed
working against a real site — not just typechecked, actually registered by the real backoffice
runtime. Both bugs above were caught by actually running the thing, not by further reading or
typechecking — reinforcing that this step matters and shouldn't be skipped in favor of
"it typechecks, ship it."

**End-to-end functional test (2026-09-04):** created a "Test Page" Document Type with an Element
Picker property, an Element Type ("Callout Banner") with "Allow in Library" on, an actual Element
("Summer Sale Banner"), and a page ("Homepage") referencing it — then clicked "Preview usages".
Confirmed live: the action executes, saves the Element, and calls the resolver. **Found and fixed
a third real bug this way** (below). Confirmed via server logs that the button's click correctly
triggers a real network call — the full modal render (seeing "Homepage" listed and the preview tab
open) was not visually confirmed before this dev environment's OAuth refresh flow started failing
independently (see "Environment instability" below) — this is a test-environment auth issue, not
a code issue, and is being addressed properly rather than worked around (see §14).

**Bug 3 — found live: `Failed to resolve Element usages (401)`.** Root cause: the original
repository implementation used a plain same-origin `fetch()` against this package's own Management
API controller. The backoffice authenticates via a bearer token from its own OpenIddict flow, not
a same-origin cookie — a plain `fetch` never sends it. **Initial fix:** switch to the shared,
already-authenticated `client` from `@umbraco-cms/backoffice/external/backend-api` (the same one
every generated service, e.g. `DocumentService`, uses internally) instead of a raw `fetch`. This
was later superseded entirely — see §14.

**Environment instability, not a code issue:** this scratch dev site's OAuth access token
(`expires_in: 300`s, confirmed in server logs) failed to silently refresh repeatedly
(`"error": "missing_token"` in the OpenIddict token-endpoint logs), logging the session out every
1-2 minutes regardless of which code was being tested. Ruled out as environment noise, not this
package's bug, before pivoting to a better testing approach — see §14.

## 14. Major pivot: use Umbraco's own "referenced by" endpoints, and a proper API-user MCP setup

Two things the user pointed out mid-session, both correct and both acted on:

**1. Umbraco already has a public "referenced by" Management API endpoint per entity type — use
it instead of a custom backend.** Confirmed via the installed `@umbraco-cms/backoffice` package's
generated client types (`sdk.gen.d.ts`/`types.gen.d.ts`, not guessed):

- `ElementService.getElementByIdReferencedBy`, and the exact same shape on
  `DocumentService.getDocumentByIdReferencedBy`, `MediaService.getMediaByIdReferencedBy`,
  `MemberService.getMemberByIdReferencedBy` — all hitting
  `GET /umbraco/management/api/v1/{entity}/{id}/referenced-by`, all returning the same
  `PagedIReferenceResponseModel` (`{ total, items }`).
- `items` is a **discriminated union** (`IReferenceResponseModel`, keyed by `$type`):
  `DocumentReferenceResponseModel` (has `published`, `variants[].culture`/`state`, `documentType`
  with `icon`/`name` — i.e. everything needed to render a previewable usage, including per-culture
  state, with zero extra round-trips), `ElementReferenceResponseModel` /
  `MediaReferenceResponseModel` / `MemberReferenceResponseModel` (non-leaf, keep walking),
  `ElementContainerReferenceResponseModel` (a Library folder), and three
  `*TypePropertyTypeReferenceResponseModel` variants — Element referenced from a **content type's
  property configuration** (e.g. a Block List default value), not from actual content. That last
  category is a real case this brief hadn't considered until the source confirmed it exists.
- This is almost certainly the exact mechanism backing the Info workspace view's "where used" list
  (§1) — so building on it instead of `ITrackedReferencesService` directly means this package's
  notion of "used" can't drift from Core's own, and the type-discrimination step (Document vs.
  Element vs. Media vs. Member) that the original C# resolver did manually via a second
  `IEntityService.GetObjectType` lookup per node is now just reading a `$type` field Core already
  computed.

**Consequence — this package no longer has any custom backend at all.** Deleted:
`Controllers/ElementUsageController.cs`, `Services/{IElementUsageResolver,ElementUsageResolver}.cs`,
`Models/ElementUsageItem.cs`, `Composer.cs`, the `Umbraco.Cms.Api.Management` package reference,
and the C# test project (`tests/ElementUsagePreview.Tests.Unit` — its coverage needs a TS-side
replacement, noted as an open follow-up below, not silently dropped). The transitive-walk algorithm
(§5a) now lives entirely in `wwwroot/repository/element-usage-preview.repository.ts`, calling
`ElementService`/`MediaService`/`MemberService`'s `getXByIdReferencedBy` recursively, switching on
`$type` exactly the way the old C# code switched on `UmbracoObjectTypes`. This also **fully
resolves Bug 3** — there's no custom endpoint left to need custom auth for; every call goes through
Core's own generated, already-authenticated services. Rebuilt and typechecked clean against the
real package after this change (`dotnet build` on the now-C#-free RCL, `npm run build` on the
frontend) — both zero errors.

**2. Set up a proper, stable way to test this going forward: an Umbraco API User + the official
Developer MCP Server**, instead of driving the flaky interactive SPA session repeatedly. Done this
session:
- Created an **API User** ("Claude MCP", Administrators group) in the scratch dev site via
  Users → Create → API User, and generated client credentials for it (id
  `umbraco-back-office-claude-mcp`; secret generated and stored only in this session's local
  scratch dir, never printed into this file or the conversation).
- Registered the official `@umbraco-cms/mcp-dev` server
  (confirmed real via `docs.umbraco.com/umbraco-in-ai/mcp/cms-developer-mcp`) with Claude Code:
  `claude mcp add umbraco-mcp -s local -e UMBRACO_CLIENT_ID=... -e UMBRACO_CLIENT_SECRET=... -e
  UMBRACO_BASE_URL=https://localhost:44399 -e NODE_TLS_REJECT_UNAUTHORIZED=0 -e
  UMBRACO_INCLUDE_TOOL_COLLECTIONS=document,media,document-type,data-type,template,element --
  npx -y @umbraco-cms/mcp-dev@latest`, local scope (this project only, not committed anywhere).
- **This requires a Claude Code session restart to take effect** — MCP servers are discovered at
  startup, and this was added mid-session. Confirmed via `ToolSearch` that the new tools aren't
  loaded yet in the current session.

**TS unit tests added (2026-09-04), replacing the deleted C# coverage — done without needing the
MCP restart.** The transitive-walk algorithm was extracted out of `element-usage-preview.repository.ts`
into a standalone, dependency-free function in `element-usage-resolver.ts` — `resolveElementUsages`
takes a `GetReferencedByPage` callback instead of calling `ElementService`/`MediaService`/
`MemberService` directly, so it's testable without Umbraco's live services or any mocking
framework. The repository class just supplies the real callback (wrapping the generated services,
catching their throw-on-error behavior into a graceful `undefined`). Tests live in
`element-usage-resolver.test.ts`, run via Node's built-in test runner
(`npm test` → `pretest` runs `tsc` first so the sibling `.js` files the `.ts` test imports by
explicit `.js` extension actually exist, then `node --test repository/*.test.ts`). **7 tests, all
passing** — the four cases the deleted C# tests covered (direct referrer, transitive walk through
a nested Element, a non-previewable dead end surfaced not dropped, the reference-cycle guard) plus
three new ones the C# version didn't have: a content-type property-type reference surfaced with
its own reason (§14's newly-discovered case), a failed page fetch degrading gracefully, and paging
applied after full resolution. `tsconfig.json` excludes `**/*.test.ts` from the production compile
so no test file or its output ships in the package (later found to still leak into the *packed
nupkg* itself, since the exclusion only covered the TS→JS compile step, not the `.csproj`'s own
static-web-asset packing — fixed by excluding `.ts`/tooling files from `Content` items directly;
see the pre-packaging cleanup entry at the end of this file).

**Definition of done, updated:** backend is gone (nothing to test there); resolver logic has real,
passing unit tests; the modal/action/manifest wiring around it is still only typechecked, not
exercised end-to-end. **Next session's first steps, superseded — see §15**: the scratch site and
API user described above lived in a session-scratch temp dir that no longer exists; §15 re-does
this setup from the now-confined project folder.

## 15. Workspace confined to this folder (2026-09-04)

The prior session worked from the parent `Downloads\Packages` directory (one level up from this
repo), which the user reported was "messing with my other packages" — that directory also holds
unrelated sibling projects (`Umbraco.Automate`, a `Salesforce v1` package). Working scoped one
level too high let MCP config, scratch state, and context bleed across packages that share nothing
but a parent folder. **Fix, done this session, no code changes:**

- **`git init` here**, first commit made (33 files: everything in §14's file list plus docs/config
  — nothing from sibling packages, `bin/`/`obj/`/`node_modules/` correctly excluded by the existing
  `.gitignore`). This repo's history now starts at this folder, not the parent.
- **Re-verified the 7 TS unit tests (§14) pass standalone** — `npm test` in
  `src/ElementUsagePreview/wwwroot`, no dependency on anything outside this repo. Confirms the
  frontend-only architecture (§14) really doesn't need the parent directory for anything.
- **The old scratch Umbraco site was gone** (it lived under the previous session's temp scratch
  dir, which doesn't persist) — respun a fresh one the same way as §13: `dotnet new umbraco -n
  DevSite --development-database-type SQLite` targeting **18.1.1** (confirmed via
  `Directory.Packages.props` in the new scaffold — still the correct GA target, §3), this package
  added via `dotnet add reference`, `dotnet build` clean (0 warnings/errors), running over HTTPS at
  `https://localhost:44374`. Lives under this session's own scratchpad temp dir, not under this
  repo — same "scratch site is disposable, the package repo is not" separation as §13.
- **Re-created the API User the same way as §14** — "Claude MCP", Administrators group, via
  Users → Create → API User in the backoffice UI (browser automation was fine for this one-time
  setup click-through; §13's flakiness was specifically about *repeated* interactive testing of the
  package's own flow, not one-off admin tasks). New client credential id
  `umbraco-back-office-claude-mcp`, secret generated locally and never written to this file or
  committed. **Verified working before wiring up MCP** — a direct `client_credentials` token
  request against `/umbraco/management/api/v1/security/back-office/token` succeeded, and the
  returned bearer token authenticated a real Management API call (`GET
  .../server/information` → 200). Confirms the credential is live, not just "created."
- **Re-registered `umbraco-mcp` scoped to *this* folder specifically**, not the parent —
  `claude mcp add umbraco-mcp -s local -e UMBRACO_CLIENT_ID=... -e UMBRACO_CLIENT_SECRET=... -e
  UMBRACO_BASE_URL=https://localhost:44374 -e NODE_TLS_REJECT_UNAUTHORIZED=0 -e
  UMBRACO_INCLUDE_TOOL_COLLECTIONS=document,media,document-type,data-type,template,element --
  npx -y @umbraco-cms/mcp-dev@latest`, run with this repo folder as the working directory. The
  tool's own output confirmed the local-scope config file entry was written under this exact
  project path, not the parent — the cross-package leakage this section exists to fix shouldn't
  recur. `claude mcp list` reports it `✔ Connected`.
- **Still blocked on the same thing §14 was blocked on:** this running session's tool list does
  not have the `umbraco-mcp` tools yet (confirmed via `ToolSearch` — no matches), even though the
  server is registered and connects at the CLI level. MCP servers are discovered at session start;
  adding one mid-session doesn't retroactively load its tools into the current session. **A Claude
  Code session restart is required before the live click-through can happen.**

**Next session's actual first steps:**
1. Confirm `https://localhost:44374` is still up (the scratch site was started via a background
   process tied to the prior session — it may or may not have survived the restart; if not, re-run
   `dotnet run --launch-profile Umbraco.Web.UI --no-build` from the `DevSite` project under this
   session's scratchpad, or respin a fresh scratch site per this section if the old scratchpad is
   also gone).
2. Confirm the `umbraco-mcp` tools are now loaded (`ToolSearch` for `umbraco`/`element` should
   return real matches, not zero).
3. Use those tools — not browser automation — to click through: create/confirm a Library Element
   Type with an Element Picker, an Element instance, and referencing Document(s) including a
   multi-culture one and a non-previewable dead-end case; trigger "Preview usages"; confirm the
   resolved list, per-culture variant data, and non-previewable-leaf surfacing all render correctly
   in the real modal (§9's remaining unchecked items).
4. Flip the relevant §9 checkboxes once verified, and fold this section's findings back into a
   trimmed status note rather than letting §13/§14/§15 keep accreting in parallel.

**Update (2026-09-04, next session): restart happened, but hit a new ordering problem.** The
background `dotnet run` process from §15's setup did *not* survive the restart (confirmed —
`curl` to `https://localhost:44374` failed outright), but the scratch site's files and SQLite DB
under the old session's scratchpad (`.../797e1966-.../scratchpad/DevSite/DevSite`) were still on
disk, so no re-scaffold was needed — `dotnet run --launch-profile Umbraco.Web.UI --no-build` from
that folder brought it back up with the unattended install already done. **The "Claude MCP" API
user's client credential still worked against the restarted instance** (re-verified with the same
direct `client_credentials` token request as before — 200) confirming the SQLite file itself
persisted, not just the folder.

**But `umbraco-mcp` still failed to connect this session** — `CONNECTION_CLOSED`, confirmed via
both the startup system-reminder and a `ToolSearch` for it. Root cause, inferred from the timing:
Claude Code connects configured MCP servers once at session startup, *before* any user turn runs —
at that moment the scratch site was still down (its background process hadn't survived the
restart yet), so `@umbraco-cms/mcp-dev`'s own startup handshake against `UMBRACO_BASE_URL` almost
certainly failed and the server exited, closing the stdio connection. `claude mcp list` (a fresh
CLI subprocess run *after* the site was brought back up) reports `✔ Connected` — because that's a
brand-new connection attempt made now, with the site actually up — but it does not retroactively
fix *this* session's already-failed connection from moments earlier. **Net effect: the ordering
matters.** The scratch site must be confirmed up *before* the session that needs `umbraco-mcp`
starts, not after. This session needs one more restart now that the site is confirmed reachable;
if that also races (site not up yet at session start), start the site first, wait for "Now
listening on" in its log, verify with `curl`, *then* restart/launch the Claude Code session.

**This ordering lesson recurred in later sessions too (2026-09-08, 2026-09-09)** — whenever the
scratch site wasn't already running when a new Claude Code session started, `umbraco-mcp` failed
to connect for that entire session regardless of bringing the site up afterward, and testing had
to fall back to driving the real backoffice UI via browser automation instead. Bring the scratch
site up and confirm it with `curl` (or equivalent) *before* the session that needs `umbraco-mcp`
tools starts.

## 16. Live end-to-end click-through (2026-09-04) — the ordering fix worked

The restart landed with the scratch site already up: `umbraco-mcp`'s tools appeared in this
session's tool list on the first `ToolSearch`, and a real call
(`get-all-document-types` → `{"items":[]}`) confirmed a live, working connection against a clean
site. §15's ordering fix (site up *before* session start) is now confirmed sufficient — no further
process needed here.

**Test content built via `umbraco-mcp` (not browser automation — matches §15 step 3's intent):**
an `Element Picker` data type (had to be created from scratch — none existed on the fresh site;
`editorAlias: Umbraco.ElementPicker` / `editorUiAlias: Umb.PropertyEditorUi.ElementPicker` worked
first try, confirming §3a's naming inference), a `Callout Banner` Element Type (`allowedInLibrary:
true`, a text `heading` property, and its own `nestedElements` Element Picker property for the
nested-reuse case), a `Test Page` Document Type (invariant, with its own `featuredElement` Element
Picker), and:

- **`Summer Sale Banner`** (Element) — referenced directly from **`Homepage`** (Document,
  published). `get-element-by-id-referenced-by` confirmed a `DocumentReferenceResponseModel` with
  `published: true` before any UI was touched.
- **`Nested Callout`** (Element) — referenced only via `Summer Sale Banner`'s own `nestedElements`
  picker (Element→Element), which is itself referenced by `Homepage`. `referenced-by` on Nested
  Callout confirmed an `ElementReferenceResponseModel` (non-leaf) pointing at Summer Sale Banner —
  exactly the shape §5a's algorithm recurses on.
- **`Orphan Callout`** (Element) — created with no referrers at all (`referenced-by` → `total: 0`),
  standing in for the "used nowhere previewable" branch of §5a's dead-end handling.

**Not built this session:** a Media/Member-referrer dead-end (an Element referenced only from a
Media item with nothing pointing back at that Media item) and a content-type property-type
reference (§14's `*TypePropertyTypeReferenceResponseModel` case) — both need a custom Media Type,
and this session's registered `umbraco-mcp` tool collection (`document, media, document-type,
data-type, template, element`) has no media-*type* creation tool, only media *item* tools. A
multi-culture Document was also skipped — no language-management tool is in the registered
collection either, and the site only has its default language. Neither is a package limitation,
just an untested path; if these matter before release, either extend the MCP tool collection
(add whatever collection covers media types and languages) or set them up once by hand in the
backoffice UI.

**The click-through itself, done with the user logged in (browser automation cannot type
credentials, per the standing rule — the user confirmed the site was up and logged in
themselves):**

1. **`Summer Sale Banner` → Preview usages.** Footer showed `Save` / `Preview usages` / `Save and
   publish` side by side, exactly the toolbar placement §5 specifies. Clicking it saved the
   element, opened a **new browser tab** at `/umbraco/preview?id=<Homepage's id>&culture=&segment=`
   (confirming the real `DocumentPreviewUrlController` round-trip, not a stub), and the backoffice
   showed a **"Preview usages"** modal listing `Homepage` with "Opened in the preview tab." The
   opened tab showed the site's own "Page Not Found — No template exists to render the document"
   error — expected and not a package bug, since `Test Page` was created via MCP without a
   template (`create-document-type` doesn't support one, per its own tool description) and never
   got one assigned. Clicking **Next** with only one item in the list left it on `Homepage` without
   erroring — correct, though the button stayed visually enabled rather than disabling itself at
   the list boundary (cosmetic, tracked in §9).
2. **`Nested Callout` → Preview usages.** Same flow, and it opened **a different new tab** (not the
   one from step 1) at the same Homepage preview URL. This is correct, not a bug: §5a's "one stable
   window name for the whole iteration session" is scoped per *source Element*
   (`umbpreview-elementusage-{elementKey}`), so two different Elements' sessions legitimately get
   two different tabs even when they resolve to the same underlying page. The modal correctly
   showed `Homepage` as the (deduplicated) resolved usage, proving the transitive walk through a
   nested Element to its nearest previewable Document works against a real relation graph, not just
   the unit-test fixtures.
3. **`Orphan Callout` → Preview usages.** No tab opened, and the backoffice showed a yellow
   **"No usages found — This Element is not currently referenced anywhere previewable."**
   notification instead of a modal or an error — the graceful-degradation behavior §7.5/§5a called
   for, confirmed live rather than only unit-tested.

**Two things this surfaced that aren't yet resolved (carried into §9, not swept under a "done"
checkbox):**
- No visible per-usage draft/published indicator was observed in the modal for a usage that *is*
  published — the row showed only the page name and "Opened in the preview tab." Whether the
  `NodePublished` indicator (§2, §7.5) is simply absent, or present but only surfaced for
  *unpublished* usages, needs checking against a draft-only referencing page before treating this
  as a real gap.
- Every live usage list so far had exactly one item, so Next/Previous cycling across 2+ distinct
  pages — the actual point of the feature — is still unexercised. Building a second referencing
  Document (e.g. a "Landing Page" also picking `Summer Sale Banner`) is the natural next step.

**Environment note:** the scratch site and its data live under this session's own scratchpad temp
dir (same pattern as §13/§15) — disposable, not part of this repo. The three test Elements/
Documents/types described above exist only there, not in any committed file.

## 17. Stress-testing real previews and block/nesting edge cases (2026-09-04)

Follow-up session, prompted by the user asking to make previews actually render (not 404) and to
specifically go after edge cases around Elements referenced from inside Block List/Grid blocks,
nested blocks, fan-out across multiple pages, and anything else that might break the preview flow.
Everything below was done against the same live scratch site as §16, extending it rather than
rebuilding it.

**Getting a real (non-404) preview working — one real Razor bug found and fixed:**
Created a Template (`create-template`) and assigned it as `Test Page`'s default template via
`update-document-type`. First render attempt threw a **compilation error**: "Argument 1: cannot
convert from 'method group' to 'object?'" for every `@Model.Value<string>("alias")` call. Root
cause: `@Model.Value<string>(...)` written directly in an HTML/markup position is genuinely
ambiguous to the Razor parser — it can read `<`/`>` as comparison operators around the method
group `Model.Value`, rather than as a generic type argument, and picks the wrong parse. This is a
real, general Razor gotcha (not specific to this package), and worth calling out in
`docs/how-it-works.md` or example templates if this project ever ships sample views: **assign the
generic `Model.Value<T>(...)` call to a local variable in a `@{ }` code block first**, then
reference the plain variable in markup — don't call it inline with `@Model.Value<T>(...)` in HTML
position. Fixed the template this way and it rendered correctly. Separately, **a document's own
`template` field must be set explicitly** (via `update-and-publish-document`) — setting only the
*document type's* `defaultTemplate` did not retroactively apply to an already-created document in
this session; not fully root-caused (possibly a content-cache staleness issue specific to
retrofitting a template onto a type after content already existed under it), but the workaround
(explicitly set `template` on the document) is simple and reliable, and any document created via
`create-and-publish-document` *after* the type had a default template picked it up automatically
with no extra step.

**Confirmed the real Element Picker and Block List value converters render correctly in a live
view** — not just that the API returns the right JSON. `Model.Value<IEnumerable<IPublishedElement>>("featuredElement")`
and `Model.Value<BlockListModel>("contentBlocks")` both resolved and rendered actual referenced
Element content (headings, nested block content) in the real rendered HTML, confirmed via
screenshot of the live preview tab, not just inspecting property values through the API.

**The core new finding — Elements referenced from inside a Block List block ARE tracked, with zero
extra code needed:**
1. Created a `Content Blocks` Block List data type (`Umbraco.BlockList` / `Umb.PropertyEditorUi.BlockList`)
   configured to allow `Callout Banner` (the same Element Type already used for standalone Library
   Elements) as its block content type — the same Element Type doing double duty as both a
   standalone Library Element type and a Block List block type, which Umbraco allows without
   friction.
2. Added a `Content Blocks` property to `Test Page`, and created a new Document (`Blocks Page`)
   whose Block List value contains one block instance, and that block instance's own
   `nestedElements` (Element Picker) property points at a fresh Library Element
   (`Block Nested Callout`) — i.e. the Element being referenced is picked from a property that
   lives *inside* embedded block content, not from a top-level Document property.
3. `get-element-by-id-referenced-by` on `Block Nested Callout` returned a
   `DocumentReferenceResponseModel` pointing straight at `Blocks Page` — **Core's Block List value
   tracking recurses into a block's own property values** to find nested `IDataValueReference`s,
   exactly the same as it does for a plain top-level property. This was a real, non-obvious
   question going in (block value converters could easily *not* walk into nested property
   references — see GitHub #13364 about relations not always updating on a picker value change),
   and it resolves cleanly in this package's favor: since the resolver relies entirely on Core's
   own `referenced-by` endpoints (§14), this case needed **no extra code in the package at all** to
   work correctly — confirmed with a live click-through (Preview usages on `Block Nested Callout` →
   modal correctly showed `Blocks Page` → opened a working, fully-rendered preview showing "Nested
   in block: Referenced only from inside a block").
4. **Not tested:** Block Grid *areas* — i.e. an actual block nested inside another block's area
   (block-in-block), as opposed to an Element Picker property nested inside a block's own content
   (which is now confirmed). Block Grid area configuration is more involved to set up via the raw
   Management API than Block List was, and this session's `umbraco-mcp` tool collection has no
   higher-level helper for it. Worth doing before calling this fully proven, though the mechanism
   that makes the Block List case work (Core recursing into embedded property values) is generic
   enough that there's no obvious reason a Block Grid area would behave differently — this is an
   inference, not a verified fact.

**Fan-out / multi-item Next-Previous — the thing no single-usage test could exercise:**
Added `Summer Sale Banner` as the `featuredElement` on `Blocks Page` too (already used on
`Homepage`), so a single Element now has two real, distinct previewable usages. Clicking
Preview usages showed both rows in the modal; clicking **Next** re-navigated the *same* reused
preview tab from `Blocks Page`'s preview URL to `Homepage`'s (confirmed via the tab's URL changing
in place, not a new tab opening), and the modal's active row and rendered heading both updated
correctly; clicking **Previous** correctly navigated the same tab back. This is the first live
confirmation that the "one stable window, re-navigated" mechanism (§3a/§5a) actually behaves as
designed across multiple distinct usages, not just the single-item case §16 covered.

**Circular reference — the resolver terminates cleanly, does not hang or crash:**
Built a genuine cycle: `Cycle A`'s `nestedElements` → `Cycle B`, and `Cycle B`'s `nestedElements` →
`Cycle A`, with neither reachable from any Document. Confirmed via the API first (`referenced-by`
on `Cycle A` → `Cycle B`, an `ElementReferenceResponseModel`, i.e. a true A↔B cycle, not a typo).
Clicking Preview usages on `Cycle A` in the real UI did **not** hang, crash the tab, or open any
preview tab — it resolved immediately to a clean result: **"Cycle B — This usage isn't on a page
that can be previewed."** No console errors. This is a live confirmation that the reference-cycle
guard the unit tests (§14) cover also holds against a real cyclic relation graph fetched over the
network, not just an in-memory test fixture with a mocked callback.

**Recursion depth — a 4-hop chain resolves correctly with no perceptible delay:**
Built `Chain Page` (Document) → `Chain 1` → `Chain 2` → `Chain 3` → `Chain 4` → `Chain 5 Leaf`
(Element→Element four times deep). Clicking Preview usages on `Chain 5 Leaf` resolved straight to
`Chain Page` on the first click, with no visible lag and no console errors — the recursion-depth
cap mentioned as "a defensive backstop" is not kicking in prematurely at a realistic depth. A
pathologically deep chain (dozens of hops) was not tested — 4 hops was judged a reasonable stand-in
for "deeper than any real content model would plausibly nest," not an attempt to find the actual
cap.

**Draft-vs-published indicator — confirmed as a real gap, not just an open question anymore:**
§16 flagged uncertainty about whether a `NodePublished` indicator shows anywhere in the modal.
This session built an actual unpublished-draft test case: `Draft Only Callout` (Element) referenced
only by `Draft Page (Unpublished)` (Document), created via `create-document` and deliberately never
published. Verified via the API first that Core correctly reports this relation as
`published: false` / `state: "Draft"`. Clicked Preview usages on the element: the modal opened, the
row showed only the page's name and "Opened in the preview tab." — **no visual difference from a
published usage's row** (compare the `Blocks Page`/`Homepage` rows earlier in this section, which
look identical in shape). **This is now a confirmed gap against §2/§7.5**, not a question needing
more testing: the modal does not currently surface draft-vs-published state per usage at all. The
underlying preview mechanism is fine — the opened tab correctly rendered the draft page's content
(Umbraco's preview mode legitimately shows unpublished drafts) — the gap is purely that the modal's
UI never surfaces the `NodePublished` field it presumably already has available from the
`referenced-by` response.

**Still not covered by any live test (carried forward, not newly discovered this session):** a
Media/Member Element-Picker referrer specifically, the content-type property-type reference case
(§14's `*TypePropertyTypeReferenceResponseModel`), Block Grid nested areas (block-in-block, as
opposed to the now-confirmed Element-Picker-inside-a-block case), multi-culture referencing pages,
permissions with a non-admin user, and a genuinely stale/moved-page relation (as opposed to a
relation to a page that simply has no template, or is unpublished).

## 18. Two real bugs, reported by the user and fixed live (2026-09-04)

Follow-up session. The user actually used the feature and reported two problems in their own
words: "the ui isnt readable when you click on the preview, looks squished" and "make the preview
usage buttons to the left of the save button like how the content pages look." Both turned out to
be real, confirmed bugs — not environment noise — and both were root-caused and fixed against the
live running site before being called done.

### Bug 1: the Published/Draft/Not-previewable tag was in the DOM, never on screen

§17 had already flagged "no visible draft/published indicator" as a confirmed gap. Reading the
actual component source this session showed that was wrong as a description of the *cause*: the
`uui-tag` badge was already coded, with correct `color`/text, correctly reflecting the real
`isPublished`/`isPreviewable` values — the bug was purely visual.

Root-caused by measuring, not guessing, via `getBoundingClientRect()` on the live page:
1. `#usage-list` (the `<uui-box>` wrapping the usage rows) used `flex: 1; max-width: 320px;` with
   no `flex-basis`. Under the real modal's actual flex context this collapsed to as little as
   **~114px** — nowhere near 320px — because a flex item with no explicit basis sizes toward its
   own min-content when the layout doesn't otherwise force it wider. Every row's tag, positioned in
   `<uui-menu-item>`'s "actions" slot, rendered past that collapsed edge and was clipped invisibly
   by the container's `overflow-y: auto` (which computes `overflow-x: auto` too once `overflow-y`
   isn't `visible`, per the CSS overflow spec). **First fix:** `flex: 0 0 300px; min-width: 300px;`
   — a real, guaranteed width instead of one that can collapse. Verified the container really was
   ~114px before this and ~300px after via direct measurement, not inference.
2. That fix alone was **not sufficient** — re-measuring after it showed the same ~57px of tag
   overflow past the row's own edge, unchanged by the outer container getting wider. The actual
   cause: `<uui-menu-item>` itself does not stretch to fill its container by default (it rendered
   at a fixed ~264px regardless of whether its parent was 114px or 300px) — it appears to size
   itself to its own icon+label content and treat the "actions" slot as something that doesn't
   count toward its own box width, which is a reasonable design for a menu item whose actions are
   meant to reveal on hover, but wrong for a status tag meant to always be visible. Setting
   `width: 100%` on it from our own stylesheet did not override this (confirmed empirically — the
   computed width stayed 264px after adding that rule), most likely losing a specificity or
   internal-`:host` battle inside the library's own shadow root that wasn't worth reverse-engineering
   further.
3. **Real fix:** stopped using `<uui-menu-item>` for the usage rows entirely. Replaced it with a
   plain `<div class="usage-row" role="button" tabindex="0">` that this package fully owns —
   icon, an ellipsis-truncating `<span class="usage-row-label">`, and the `<uui-tag>`(s) laid out
   with normal flexbox (`display:flex; align-items:center; gap:...`), the label given
   `flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;` and the tag
   given `flex-shrink:0`. This guarantees the tag always has real, reserved space regardless of
   label length, without depending on `uui-menu-item`'s internal layout assumptions at all.
   Click and keyboard (Enter/Space) activation, an `aria-current` attribute, and a `[data-active]`
   background are hand-rolled to replace what `uui-menu-item`'s `label`/`?active` used to provide.
4. **Verified live, visually, after the fix** — not just via rects this time: a real screenshot of
   the "Preview usages" modal on `Summer Sale Banner` (referenced by both `Blocks Page` and
   `Homepage`) shows both rows with a fully legible green "Published" badge, properly spaced, no
   clipping. `getBoundingClientRect()` on the same state confirmed the tag's right edge (1057.6)
   sits safely inside both the row's edge (1066.6) and the list container's edge (1085.4) — a swing
   from *overflowing the container by ~57px* to *comfortably inside it* before vs. after. Draft and
   "Not previewable" tags render through the identical markup/CSS path and weren't separately
   screenshotted, but nothing in the fix branches on which tag variant is shown.

This is also the resolution to a mystery from earlier in this same session: at one point a
screenshot appeared to show the *entire modal tiled/repeated* across the viewport in a grid — that
was chased down and confirmed to be a screenshot-capture-tool artifact specific to this automation
session (`getBoundingClientRect()` and a DOM query both confirmed exactly one real modal instance
existed at the time), not a real rendering bug, and is unrelated to the tag-clipping bug above.
Noted here only so a future reader doesn't go looking for a "tiling" bug that was never real.

### Bug 2: the workspace action rendered in the wrong position, and Save's weight isn't in source

The user wanted "Preview usages" positioned like the real Document workspace's own toolbar:
**"Save and preview" | "Save" | "Save and publish"**, left to right — i.e., to the *left* of Save,
mirroring a pattern that already exists elsewhere in Core. At the time, this package's own action
rendered *between* Save and Save-and-publish (`weight: 95`).

Confirmed directly from the real, running 18.1.1 client bundle (fetched and read, not assumed)
that Document's three actions declare explicit weights: `SaveAndPreview` 90, `Save` 80,
`SaveAndPublish` 70 — and confirmed the render order is governed by `(t.weight||0) - (s.weight||0)`
(descending: higher weight renders further left), from `libs/extension-api/index.js`. That fully
explains Document's own layout. But **Element's own `Umb.WorkspaceAction.Element.Save` manifest
declares no `weight` key at all**, confirmed two ways: static analysis of the fetched
`elements/manifests-*.js` chunk, and — more conclusively — querying the *live*
`umbExtensionsRegistry.getAllExtensions()` from inside the running page, which returned the raw
manifest object with the `weight` property simply absent. No `type: "kind"` manifest matching
`workspaceAction`/`default` exists to supply a default either (`getAllExtensions().filter(e =>
e.type === 'kind' ...)` returned empty). So Element Save's *effective* sort weight, whatever value
actually resolves at render time, is not present in any manifest or kind this package can read —
it's presumably a hardcoded runtime default somewhere in Core's submit-workspace-action base class
that isn't exposed as inspectable manifest data.

Rather than keep reverse-engineering minified internals, this was **bisected empirically against
the live backoffice**: set a candidate weight, rebuild (`npm run build` — no site restart needed,
static assets are served live off disk in this dev setup), hard-reload, and read the actual DOM
order of the three `<umb-workspace-action>` elements via a `deepFind`-through-shadow-roots query.
Results: `weight: 1000` → still lost to Save (Save still leftmost). `weight: 10000` → won (Preview
usages leftmost, matching the target order). `weight: 100000` also won, confirming 10000 isn't a
fluke sitting exactly on a boundary. Shipped at `10000`, with a comment explaining *why* this
number exists and telling a future maintainer to re-verify the same way (load the workspace, check
live DOM order) rather than trust it blindly if a future Core release changes Save's internal
default.

### Process note: this session's dev environment was extremely slow

Every hard-reload cycle in this session took 5-15+ seconds before the Element tree and workspace
footer actions became interactive/queryable — confirmed not caused by any of this session's code
changes (a fresh tab, a `curl` direct to the Management API, and checking the console for errors
all independently confirmed the site itself was simply slow to respond, not broken). Budget for
this if repeating this workflow: don't treat a `getElementById`-style query returning empty as a
failure signal after only 1-2 seconds — this session needed up to ~10 seconds after a hard reload
before the workspace action buttons existed in the DOM at all.

## 19. UX change, not a bug fix: stop auto-opening a preview on open (2026-09-04)

Immediate follow-up in the same session, prompted by the user actually clicking through the fixed
build: "when i click the preview button, it opens up the preview but i dont see the menu, what i
was thinking it should open up the menu and we click on the pages we wanna preview, not
automatically open one."

This is the same underlying mechanism §18 fixed the *readability* of, but a different complaint:
the modal was working and readable, but `connectedCallback()` called `#openOrUpdatePreview()`
immediately on open, which called `window.open(...)?.focus()` (or, post-§18, navigated the held
`#previewWindow` and called `.focus()` on it) for the *first* item in the list, before the editor
had done anything. That `.focus()` call — needed for Next/Previous to feel responsive once the
editor is actively stepping through pages — was, on the very first open, shifting the OS/browser's
window focus straight to the preview tab. The modal was genuinely still there, correctly rendered,
sitting behind that tab; the user's own description ("it opens up the preview but I don't see the
menu") is exactly what that looks like from the outside.

**Fix:** `_currentIndex` now starts at `-1` ("nothing picked yet") instead of `0`, and
`connectedCallback()` no longer calls `#openOrUpdatePreview()` at all. The list renders with no row
marked active and the detail pane reads "Select a page from the list to open it in the preview
tab." Clicking a row (or Next/Previous, once something has been picked) is the only thing that
calls `#openOrUpdatePreview()` — at that point stealing focus to the preview tab is correct and
expected, the same way clicking any link that opens a new tab would behave. Previous's `?disabled`
bound changed from `=== 0` to `<= 0` to also cover the new `-1` state; Next's bound was already
`>= items.length - 1` and needed no change (from `-1`, Next correctly steps to `0`).

**Verified live:** clicking "Preview usages" now opens only the modal — confirmed via
`tabs_context_mcp` that no new tab appears — showing both usages with their Published tags legible
(§18's fix) and neither row highlighted. Clicking a row (tested: "Blocks Page") then correctly
opens exactly one new tab at that page's preview URL. This is the behavior the user asked for.

## 20. More content, real styling, and the copy-document/copy-element edge case (2026-09-04)

Follow-up in the same session: "add more pages and make sure they all render... try copying a
whole page and adding it to the content tree to see if the references are updated as well...
try all edge cases, add some styling as well, and some more content."

**Styling:** the Test Page template was bare unstyled HTML through §16-§19 (enough to prove data
flow, not to look like a real site). Added a real embedded stylesheet — gradient header with nav,
a constrained content column, styled callout/block cards, monospace page-id metadata, a footer —
so the preview a click-through actually opens looks like a site, not a debug dump. One build note:
`update-template`'s content validation rejects any payload containing a literal `?` or `&`
character ("contains query parameter characters") — this rejected the first draft, which used
`&mdash;`/`&middot;` HTML entities in the title/footer. Fixed by using plain `-` characters
instead of entities. **This restriction turned out to be specific to the `umbraco-mcp` tool's own
client-side validation, not a real Management API constraint** — see §27's correction, where a
genuine `&&` was sent successfully through the raw `TemplateService.putTemplateById` client.

**More content:** two new Library Elements (`Newsletter Signup`, `Feature Highlight`) and three
new Documents — `About Us` (references `Feature Highlight` directly, plus a **two-block** Block
List: one block nesting `Newsletter Signup` via its own Element Picker, one block with no nested
reference at all), `Pricing` (references `Newsletter Signup`), and `Contact` (references nothing —
exercises the "No featured element." empty-state branch, previously only unit-tested, not
observed live). All six Documents in the site now render correctly with real content and the new
styling — verified with `curl` against each one's actual friendly URL (`get-document-urls`, not
guessed), checking both HTTP 200 and the absence of exception/error markers in the response body,
not just a status code.

**A real regression this caught, unrelated to the new content:** `Blocks Page` came back **404**
during this systematic re-check. Root cause: back in §17, an `update-and-publish-document` call
that added `featuredElement` to `Blocks Page` omitted the `template` field from its payload — and
per the tool's own documented semantics ("the full set of values AND variants... are replaced
wholesale"), `template` follows the same replace-wholesale rule and was silently cleared to `null`.
Every "Preview usages" click-through on that page since §17 still reported "Opened in the preview
tab." successfully, because opening the URL is all the modal does — it never inspects whether the
opened page actually rendered. **This is the concrete lesson from this session: the modal
reporting success is not the same as the page actually rendering; verify rendered output
independently (curl/screenshot), not just that the modal said it opened something.** Fixed by
re-issuing `update-and-publish-document` with `template` explicitly included this time.

### The core ask: does copying a page (or an Element) keep its references live?

**Copying a Document does NOT immediately register a relation for its own copied property
values — only publishing the copy does.** Reproduced deliberately: baseline `Newsletter Signup`
had 2 referrers (`Pricing`, `About Us`). Copied `Pricing` via `copy-document`
(`relateToOriginal: false`) → the draft copy (`Pricing (1)`) came back with the *exact same*
`featuredElement` value pointing at `Newsletter Signup`, confirmed by reading the copy directly —
but `get-element-by-id-referenced-by` on `Newsletter Signup` still showed only the original 2
referrers, unchanged, even after a 2-second pause (ruling out async indexing lag, not just assumed
away). Only after calling `publish-document` on the copy did the count become 3, with the copy
correctly appearing as a `Published` referrer. **This is the opposite of what a plain
`create-document` does** (§17/§18 already showed a freshly *created*, never-published Document
shows up immediately with `state: "Draft"`) — copying and creating apparently go through different
code paths in Core's relation-tracking, and only *creating* triggers it at save time; *copying*
apparently doesn't re-trigger it until publish. This is a real, non-obvious Umbraco behavior —
**a page freshly duplicated from one that references an Element will not appear in "Preview
usages" until the duplicate itself is published**, even though the property value was copied
correctly and even though a *brand-new* draft page in the identical situation would have appeared
immediately. See `docs/how-it-works.md`'s "Known limitations" section, where this is documented for
end users.

**Copying an Element behaves the opposite way — its relation *is* tracked immediately, in Draft
state, no publish required.** Reproduced the same way: baseline `Nested Callout` had 1 referrer
(`Summer Sale Banner`, an `ElementReferenceResponseModel`). Copied `Summer Sale Banner` via
`copy-element` → immediately (no publish, no delay), `get-element-by-id-referenced-by` on
`Nested Callout` showed 2 referrers, the new one (`Summer Sale Banner (1)`) correctly reported as
`published: false` / `state: "Draft"`. This is a genuine, confirmed asymmetry between how Core
tracks relations for copied Documents versus copied Elements — not a guess, both directions were
tested back-to-back against the same running site with the same tool (`copy-document` vs.
`copy-element`) and the same verification method.

**Full end-to-end confirmation, including a case no earlier session had exercised: two tags on one
row.** `Summer Sale Banner (1)` is itself unused by anything (a fresh, dangling library copy), so
clicking "Preview usages" on `Nested Callout` — which the copy transitively references — correctly
walked: `Blocks Page` (Published, direct), `Homepage` (Published, direct, via the *original*
Summer Sale Banner), and `Summer Sale Banner (1)` itself surfaced as a **non-previewable leaf**,
its row showing *both* a yellow "Draft" tag *and* a blue "Not previewable" tag side by side, with
its long label ("Summer Sale Banner (1)") correctly ellipsis-truncated to make room for both —
confirmed via a zoomed screenshot, fully legible, no clipping. This is the multi-tag case §18's
fix didn't happen to get exercised by at the time, and it holds up. Publishing the copied element
afterward correctly flipped its tag from Draft to Published on the next check, confirming the
draft-to-published transition is live, not just a one-time snapshot.

## 21. Redesign: no more usage list — a resumable, batched iterator instead (2026-09-04)

Direct design request from the user, given verbatim: "remove that whole ui with the list of pages,
instead change the preview ui slightly, add a button at the bottom where you iterate and tells you
pages are being referenced... so the preview looks the same, but now you have a button that allows
you to go next or back... maybe do 5 or 10 at a time on button click, so every time someone clicks
next you don't have to wait... and don't do all at once because you might have 100+ pages."

**The design change, and why it's more than a UI tweak.** §16-§20's modal was a two-pane
list-and-detail dialog: every usage rendered as its own clickable row, and the editor picked one.
That's gone. The modal (still a backoffice dialog at this point — see §22 for its later, full
removal) became a single status view — page name, its Published/Draft (+ Not-previewable, where
applicable) tags, and a "N of M" counter — driven entirely by Previous/Next.

**The part that isn't just UI: the resolver became a resumable async generator.** The user's
instinct that "resolving 100+ pages upfront is wasteful" was correct, and it required a real
architecture change, not just a cosmetic one. The previous resolver (`resolveElementUsages`) walked
the *entire* transitive reference graph to completion, sorted the results, and only then sliced out
a page — meaning even the old list UI would have silently done all that work the instant "Preview
usages" was clicked, regardless of how many rows the editor ever actually looked at. The resolver
is now `iterateElementUsages`, an `async function*` — walking Umbraco's referenced-by graph exactly
as before (same recursion, same cycle guard, same dead-end surfacing), but suspending at each
`yield` until the caller actually asks for the next item via `.next()`. This is possible with zero
manual cursor/state bookkeeping specifically *because* JS async generators natively suspend and
resume their whole call stack — including work several recursion levels deep — at a `yield`, which
is what makes "stop doing work exactly where the caller stopped asking" free instead of a
hand-rolled pagination cursor to get right. One necessary trade-off: items now come out in
**discovery order** from Core's own referenced-by pages, not the old design's
alphabetical-with-previewable-first sort — a global sort needs to see everything before it can
order anything, which is exactly the eager behavior being removed.

**Batching and prefetch, concretely, at the time.** The modal pulled from the generator
`ELEMENT_USAGE_PREVIEW_BATCH_SIZE` (10) items at a time into an internal buffer, and once fewer
than a prefetch threshold of unseen buffered items remained ahead of the current position, it
quietly started loading the next batch in the background. (The dedicated prefetch-threshold
constant and its background-prefetch behavior did not survive §22's later redesign into a
`previewApp` toolbar control — the current control loads reactively on demand instead; the unused
constant was removed during pre-packaging cleanup, see the entry at the end of this file.)

**Unit tests rewritten around the new contract**, not just adjusted for a renamed function — the
old "paging is applied after full resolution" test (which literally asserted the eager behavior
being removed) was replaced with two tests that assert the opposite property: **"pulling fewer
items than exist does not fetch or recurse into referrers beyond what was asked for"** (a poisoned
fetcher entry that throws if ever queried, placed behind items never pulled — proof by construction
that a partial pull never reaches it) and **"resuming a partially-drained generator continues from
where it left off"** (asserting the underlying Core endpoint is queried exactly once across two
separate `.next()` batches, not re-walked).

**Verified live, end to end, after a real detour.** First attempt looked completely broken —
clicking "Preview usages" and "Next" appeared to do nothing at all, no modal, no tab, no error.
Two things turned out to be true at once, and neither was a bug in this session's code:
1. Clicking a button via a synthetic `element.click()` call (used throughout this session for
   speed, since the dev environment's screenshot tool was intermittently timing out) **does**
   trigger Lit event handlers and state changes correctly, but **does not** count as a trusted user
   gesture for `window.open()` — Chrome's popup blocker silently swallows it, no exception, no
   console output, nothing. This is a testing-methodology gotcha specific to how this session was
   driving the browser, not a defect in the modal's code — confirmed by checking the modal's actual
   rendered DOM state after a synthetic click (correct: item name, tags, "1 of 2" counter, all
   present) even though no tab had opened.
2. Separately, and coincidentally close in time, this dev environment's backoffice session
   genuinely timed out mid-test (a real OpenIddict token expiry, the same class of issue noted back
   in §13), redirecting to a login screen — which is what made a *second* round of real clicks also
   appear to do nothing. Signing back in with the throwaway admin account (its unattended-install
   credentials are readable straight from `DevSite/appsettings.Development.json` on disk, since
   this is a fully local, disposable scratch site — not shared with, or typed in on behalf of, the
   real user) fully resolved it.

With a real signed-in session and genuine (`computer` tool) clicks throughout, the whole flow was
confirmed end-to-end on `Summer Sale Banner` (2 real usages), including correct same-tab
re-navigation both directions and correct boundary disabling once the generator was exhausted.

## 22. Redesign: no backoffice UI at all — Next/Previous move into the preview tab itself (2026-09-04)

Direct correction from the user to §21's design, given verbatim: "Completely remove the ui when
you click the preview button. what i want is when you click the preview button, it opens up the
preview tab with the first page in the referencing that element, and within that preview, add a
button to the left of the fit browser button where you can click next/arrows to iterate through
all the content referencing that element. I dont need the extra ui you have in the backoffice."
§21's lean single-item modal (still a backoffice dialog, just simplified from a list to one status
view) was not what was being asked for — the ask is for **zero backoffice UI**, with Next/Previous
literally inside Umbraco's own front-end preview toolbar. This is the design that shipped.

### Research done before writing any code

- **`previewApp` is a real, first-class Umbraco extension type**, confirmed by reading
  `dist-cms/packages/core/extension-registry/extensions/preview-app.extension.d.ts`
  (`export interface ManifestPreviewAppProvider extends ManifestElement { type: 'previewApp'; }`)
  and by querying a live entry from the running backoffice's own `umbExtensionsRegistry`
  (`Umb.PreviewApps.Device`, the "Fit browser" control itself) — its manifest shape is exactly
  `{ type, alias, name, element, weight }`, nothing more. Also read Core's own compiled
  `packages/preview/preview-apps/manifests.js`, which registers six of these:
  `Umb.PreviewApps.Device` (weight 400, "Fit browser"), `Culture` (310), `Segment` (300),
  `Environments` (210), `OpenWebsite` (200), `Exit` (100) — confirming descending weight renders
  further left (consistent with the workspace-action-bar finding from §18) and that weight 500
  (one above Device) puts a new control immediately to the *left* of "Fit browser," exactly where
  the user asked for it.
- **`ManifestPreviewAppProvider` has no importable path from this package.** It isn't re-exported
  by `@umbraco-cms/backoffice/extension-api`, `/extension-registry`, or `/preview` — the only three
  plausible subpath exports — and `moduleResolution: "Bundler"` enforces the package's own
  `exports` map, so a deep relative import into the file that declares it doesn't resolve either.
  A minimal local interface is declared instead (`preview-app/manifests.ts`), matching the exact
  shape confirmed above.
- **Confirmed, by reading real source, that there is no supported way to swap which document a
  preview tab shows without a full top-level navigation.** `UmbPreviewContext`
  (`@umbraco-cms/backoffice/preview`) exposes `updateIFrame(args?: {culture?, height?, segment?,
  width?, wrapperClass?})` — culture/segment/sizing of the *current* document only, no `unique`/id
  parameter, so it cannot switch documents. `UmbPreviewController.preview()` (what "Save and
  Preview" itself calls) reuses a window keyed by the *document's* unique id, not a stable name,
  and `attachLinkInterceptor`'s same-origin in-iframe navigation handling doesn't update the outer
  shell's own tracked document either. **Consequence:** Next/Previous has to do a real
  `location.href` reassignment to a new preview URL, and since that's a full page reload of a brand
  new component instance, all iteration state (which usages are known, current position) must live
  in `sessionStorage`, not in memory.

### Design decisions made while implementing

- **Non-previewable usages are silently skipped when stepping through**, rather than shown with an
  explanation — the compact arrow-counter-arrow control has no room for one. Next/Previous search
  forward/backward through the resolved list for the next *previewable* item, extending the
  resolved batch (via the same resumable generator, §21) if needed. The counter only counts
  previewable items for the same reason.
- **`sessionStorage` is namespaced by Element key *and* a random per-click session id**, not just
  the Element key. Reasoning: `sessionStorage` is per-tab, and the workspace action (running in the
  *backoffice* tab) cannot write into the *preview* tab's `sessionStorage` before opening it — they
  are different browsing contexts even though same-origin. So a second "Preview usages" click after
  further edits, reusing the same named window, would otherwise resume the *previous* click's
  cached position instead of starting fresh. Fixed by having the workspace action mint a
  `crypto.randomUUID()` each time and pass it as a second query param
  (`umbElementUsageSession`) alongside the Element key (`umbElementUsageKey`).
- **The workspace action itself skips forward past non-previewable items** to find the first real
  page to open, rather than opening whatever the resolver yields first.

### Two real bugs found live, both fixed and re-verified

1. **The preview URL was missing its `/umbraco/` prefix, producing a real front-end 404.**
   `DocumentService.getDocumentByIdPreviewUrl()`'s `data.url` is a *relative* string with no
   leading slash (confirmed directly: `"preview?id=...&culture=...&segment=..."`) — resolving it as
   `new URL(data.url, location.origin)` drops the `/umbraco/` segment. **Fix:**
   `new URL(`/umbraco/${data.url}`, location.origin)` in both places that build this URL.
2. **The enabled Next button was invisible — present in the DOM, correctly wired, rendering with a
   dark-navy icon on a dark-navy toolbar background.** Root cause: `<uui-button look="default"
   color="default">`'s enabled-state icon color is a dark navy meant for a light background — fine
   inside a white modal, unreadable on Core's own dark preview toolbar. Core's own toolbar buttons
   ("Fit browser," "Preview website," "Exit") are all `look="primary"`. **Fix:** both `uui-button`s
   now render with `look="primary"`.

### Live verification (2026-09-04)

Confirmed: clicking "Save and preview" opens a new tab directly at the preview URL with **no
backoffice modal at all**; the preview toolbar shows, left to right: our nav control, "Fit
browser," "Preview website," "Exit"; Next/Previous correctly re-navigate the same tab and disable
at the correct boundary; a second "Preview usages" click reuses the same named window but resets
the session (per-click nonce); a genuine circular reference (no reachable Document) opens no tab
and falls through to the existing "No usages found" notification, unchanged.

### Trade-offs surfaced to the user, not silently absorbed

- Every Next/Previous click is a full page reload of the preview tab — unavoidable given Umbraco's
  own preview architecture has no supported document-switching API.
- The per-usage Published/Draft distinction the old modal surfaced (§17/§18) has no equivalent in
  this compact control and was not preserved — a deliberate scope cut that came bundled with the
  redesign request, not a regression to silently fix later without being asked.

## 23. A real "Next does nothing" bug, found and reproduced, plus a dropdown for direct jumps (2026-09-04)

User report, verbatim: "some page have the arrows but tehy dont do anything, also the colors are
off, make sure it matches the clors for the rest of the buttons on the preview, make sure the
arrows make sense for the preview. also add a drop down (up) like hwo the fit brower button looks,
but it opens up a selction of the previews avabilbe."

### The "arrows do nothing" bug — root-caused and reproduced live

`#pullBatch()`/`#resolveInitial()` only ever discovered that the resolver was exhausted by asking
it for *one item too many* — a generator only reports `done: true` once you actually call `.next()`
past its last real value. Both methods stopped pulling the instant they'd satisfied their immediate
need, **without ever making that one extra confirming call.** Whenever the true remaining count
happened to land exactly on that boundary, `_hasMore` stayed `true` even though nothing was
actually left. The Next button rendered fully enabled; clicking it called `#loadMore()`, which
correctly discovered exhaustion *this time* and set `_hasMore = false` — but by then the click
itself had already been swallowed as a silent no-op.

**Reproduced deliberately:** temporarily set `ELEMENT_USAGE_PREVIEW_BATCH_SIZE` to `1` (forcing the
boundary condition on nearly every click) and added a third real referrer to `Summer Sale Banner`.
Clicked Next twice, watching the tab's URL directly at each step: the second click's URL genuinely
did not change, while the counter had already claimed "3 / 3+" (stale `+`).

**Fix:** both methods now peek one item past whatever they actually needed, via a shared
`#peekOneMore()` helper — if the peek comes back `done`, `_hasMore` is correctly set `false`
immediately (so the *current* render already shows Next disabled, no dead click possible); if it
yields a value, that item is simply added to the buffer. Re-verified live with the same batch-
size-1 stress setup: the exact sequence that previously went silently inert now correctly disables
Next the instant the last real usage is reached.

### Colors — matched Core's own "Fit browser" button, not guessed at

Fetched and read Core's real `preview-device.element.js` to copy its pattern exactly:
- `:host` sets `--uui-button-font-weight: 400` and `--uui-menu-item-flat-structure: 1` — copied
  verbatim into this control's own `:host` block.
- Its button carries `look="primary" color="default"` — added `color="default"` to match exactly.
- Its popover (`uui-popover-container placement="top-end"`, wrapping an `umb-popover-layout`) is
  the literal "drop down (up)" mechanism the user described — this control's own popover reuses the
  identical two elements and the identical `umb-popover-layout` CSS variable overrides so its dark
  styling matches Core's own popovers pixel-for-pixel.
- Kept `icon-arrow-left`/`icon-arrow-right` but added `label="Previous usage"`/`"Next usage"`
  tooltips and gave the new middle button an `icon-documents` glyph plus an explicit
  `label="Choose a page to preview"`.

### The dropdown itself

Clicking the middle button (showing the "N / M" counter, an `icon-documents` glyph, and a
`uui-symbol-expand` caret that rotates open/closed) opens a `uui-popover-container` **upward**
(`placement="top"`). It lists every currently-loaded *previewable* usage as a `uui-menu-item` (non-
previewable dead ends excluded here too), the current page marked `?active`, each clickable to jump
straight there via the same `#navigateTo()` used by Next/Previous. A trailing "Load more pages…"
entry calls the same batched `#loadMore()` the arrows use and re-renders the list in place without
navigating away. A `_popoverTick` state field exists purely to force a re-render when the list
grows without a page change (`#items` is a plain field Lit can't observe, and `_hasMore` alone
doesn't reliably change on every load).

### Naming pass: dropped "usages" from every user-visible string (2026-09-04)

Settled on plain **"Save and preview"** (no suffix) — Elements have exactly one preview-like
action, so there's nothing else it could be confused with, and it now matches the Document
workspace's own "Save and preview" naming exactly. Changed the workspace action's `meta.label` and
manifest `name`, the "No usages found" notification headline (now **"No pages found"**), and the
arrow buttons' hover tooltips (now **"Previous page"/"Next page"**). Internal identifiers (aliases,
constants, file/class names, `sessionStorage` keys) were deliberately left alone.

**Verified live end-to-end** on `Summer Sale Banner` (3 real usages): fresh click opens Contact
showing "1 / 2+"; opening the dropdown lists Contact (active) and Blocks Page, plus "Load more
pages…"; clicking it updates the list in place to all three pages and flips the trigger to "1 / 3";
clicking Homepage directly from the list jumps straight there, skipping Blocks Page entirely.

## 24. Auto-loading a full batch upfront instead of stopping at one item (2026-09-04)

Follow-up user feedback in the same session as §23's naming pass. The user noticed some pages
opened showing "1 / 2+" with a "Load more" click needed almost immediately, and asked for it to
just load up to the existing batch size (10) automatically. Changed `#resolveInitial()` to keep
pulling past the first previewable item, up to a full batch, before its usual §23 peek — with one
hard invariant preserved: it can never stop *before* finding the current page.

**Verified live** with dedicated test content: exactly 10 referrers → dropdown shows all 10 with a
clean "1 / 10", no "Load more" row at all. 11 referrers → dropdown shows all 11 (the batch of 10
plus the one item the exhaustion-peek happens to catch) with "1 / 11+" and a "Load more pages…"
entry still present; clicking it re-queries, finds nothing new, and immediately self-corrects to
"1 / 11" with no `+` and no "Load more" row. This minor asymmetry (11 shows an unnecessary "Load
more" for one click, self-correcting immediately) is a known, accepted consequence of the peek-
based exhaustion check (§23) — closing it fully would need a *second* peek past the batch on every
load, more network cost than the one harmless extra click it would save.

## 25. Popover scroll cap, and a real browser-HTTP-cache gotcha (2026-09-08)

User ask: "for the drop down box, if there are more than 10 references, can you add a scroll
functionality instead of extending the dropdown." Fix: `umb-popover-layout` gets
`max-height: 280px` + `overflow-y: auto` from this control's own stylesheet. It needed
`!important` — confirmed live: without it, the computed `overflow-y` was `clip` and `max-height`
was `none`, because `umb-popover-layout` declares its own host-scoped `overflow: clip` internally,
and a component's own host style outranks a plain type-selector reaching in from outside it.
`!important` is the correct, standard tool for overriding a library component's own internal
default from consuming code in exactly this situation.

**A real debugging detour, worth recording since it will recur:** after the fix compiled clean and
the server was confirmed (via a direct `curl`) to be serving the new content, the *browser* kept
rendering the *old* un-capped popover — through a normal reload, a synthetic `Ctrl+Shift+R`, and
even a brand-new tab. Root cause: ASP.NET's static-file middleware sends no `Cache-Control` header
for these `.js` files, so Chrome falls back to *heuristic* freshness based on
`Last-Modified`/`ETag` — and the browser's HTTP cache is **shared across the whole profile, not
per-tab**, so a "brand-new tab" is not a clean slate. A synthetic `Ctrl+Shift+R` keypress via
browser automation also did not reliably bypass the cache (it's a Chrome-application-level
accelerator, not guaranteed to route through a CDP-dispatched key event the same way a real
physical keypress would). **The reliable fix:** from the page's own console, run
`await fetch(<the stale script's exact URL>, { cache: 'reload' })` to force a real fetch that
updates the shared cache entry, *then* do a normal reload.

**Verified live** on an 11-referrer test Element: the dropdown now shows a fixed-height list (~8
rows visible) instead of growing to fit all 11, confirmed both visually and by measurement
(`clientHeight: 280` capped vs. `scrollHeight: 432` real content), and confirmed genuinely
scrollable (not just clipped) by setting `scrollTop` directly and watching the visible rows shift.

## 26. Edge-case / limit-testing sweep (2026-09-08) — no new code bugs found

Direct user ask: "try everything that might break this extension" — deleting pages, copying pages,
pasting pages, different property editors, different cultures, refreshing, etc. `umbraco-mcp` was
disconnected this session (site was down at session start — the §15 ordering issue recurring), so
every scenario was driven through the real backoffice UI via browser automation instead. Every
scenario confirmed an already-documented trade-off or correct graceful degradation; no new code bug
was found or fixed.

- **Trashing a referencing page mid-session** — Core's `referenced-by` endpoint still reports the
  trashed page as a normal referrer, so it still appears in the dropdown, clickable,
  indistinguishable from a live page; clicking it correctly shows the front end's own "Page Not
  Found." No visual cue in the dropdown flags a trashed entry — a real, low-severity gap, noted in
  `docs/how-it-works.md`'s "Known limitations."
- **Permanently deleting the source Element mid-session** — a fresh session against the now-
  nonexistent `elementKey` resolves to nothing; the nav control correctly renders nothing at all
  (no error, no console output).
- **Trashing (not deleting) the source Element** — Core's `referenced-by` endpoint still returns
  full, correct data for a trashed Element, so the control keeps working normally.
- **Real UI-driven copy (`Duplicate to…`) reconfirms §20's finding**, this time through the actual
  backoffice UI an editor would use, not just the MCP tool's API call.
- **A genuine Umbraco Core UI bug found along the way — not in this package.** `Feature
  Highlight`'s own Info tab → "Referenced by" panel showed "This item has no references" even after
  a hard reload, while a direct call to the exact same underlying endpoint from the console
  returned the correct result immediately. This package's own "Save and preview" button opened the
  correct real referrer with a working toolbar, proving this package calls the live API directly
  and is not affected by whatever staleness/caching affects Core's own Info-tab panel.
- **XSS / HTML-injection safety, confirmed clean.** Renamed a real referencing page to
  `<img src=x onerror=alert(1)> & "quotes" <b>bold</b>` and republished it: the name rendered as
  fully literal, escaped plain text in the dropdown — no image tag, no bold formatting, no alert
  fired. This is Lit's default auto-escaping behavior (this control never uses `unsafeHTML`
  anywhere), verified against a real malicious-looking name rather than assumed safe by code
  inspection alone.
- **Rapid double-click / concurrency guard** — reviewed rather than forced into a genuine same-tick
  race: `#goNext()`/`#goPrevious()` both set `_isNavigating = true` as their first synchronous
  statement, before any `await`, so a second invocation arriving before the first `await` yields
  correctly bails out via the guard at entry. Correct by construction regardless of timing.

**Explicitly not attempted this session (still open):** Block Grid nested areas (block-in-block), a
Media/Member Element-Picker referrer specifically, multi-culture referencing pages, and permissions
with a non-admin user.

## 27. Richer demo content: one Element, five pages, five genuinely different renderings (2026-09-08)

Scratch-site **demo/test content** work (not a package code change) — added a `Display Style`
dropdown Data Type and an optional `displayStyle` property on the shared `Test Page` Document Type,
a second Element Type (`Spotlight`, with `quote`/`authorName`/`authorRole`), one `Customer
Spotlight` Element instance, and five new pages each referencing it with a different display style.
The shared template branches on `displayStyle` to render five visually distinct treatments (Hero,
Sidebar, Inline, Footer, Grid), with the pre-existing rendering kept byte-for-byte as the fallback
for every page/element combination that doesn't opt in.

**A correction to §20's finding, made along the way:** §20 recorded that `update-template` (the
`umbraco-mcp` tool) rejects any payload containing a literal `&` or `?` character. This session's
new Razor code needed a real `&&`, and going through `TemplateService.putTemplateById` directly
(the Management API client, since `umbraco-mcp` was disconnected this session) succeeded
immediately with two literal `&` characters in the payload — confirming the restriction was
specific to the `umbraco-mcp` tool's own client-side validation, not a real constraint of Umbraco's
template API.

**Verified live:** all five new pages return HTTP 200 with the expected distinct wrapper markup per
treatment, screenshotted to confirm they're genuinely visually different (not just different class
names), the five pre-existing pages re-checked with zero regression, and this package's own "Save
and preview" feature re-verified against the new content (opened "1 / 5" immediately, no "Load
more" needed since 5 < the batch size of 10; the dropdown listed and correctly jumped between all
five pages).

## Pre-packaging cleanup (2026-09-10)

The user asked for a code/docs cleanup pass ahead of packaging this as a real NuGet package, plus a
look for security issues and edge cases. Findings and fixes, beyond the CLAUDE.md/docs
restructuring that produced this file:

- **Fixed a real permission bug:** the workspace action's manifest gated on
  `UMB_USER_PERMISSION_ELEMENT_READ`, but `execute()` calls `super.execute()`, which saves the
  Element. Core's own real Element Save action (confirmed against source, §3a) gates on
  `UMB_USER_PERMISSION_ELEMENT_UPDATE`. A read-only user could previously see this action rendered
  as enabled, even though clicking it would attempt a save. Fixed to require Update, matching Core.
- **Fixed a state-desync/silent-failure bug in the nav control's `#navigateTo`:** `_currentIndex`
  and its `sessionStorage` persistence were being committed *before* the preview-URL fetch was
  confirmed to succeed. A failed fetch (network error, or a missing `data.url`) left the toolbar's
  counter, active dropdown row, and Previous/Next disabled state pointing at the *new* position
  while the tab itself never actually navigated there — indistinguishable from the "arrow does
  nothing" bug already fixed once in §23, just via a different trigger (a live failure rather than
  a stale `_hasMore` flag). Fixed by only committing the new index once the URL is confirmed, and
  added a "Preview unavailable" notification on failure (matching the workspace action's own
  failure UX) so a failed Next/Previous is never silently indistinguishable from a broken button.
- **Removed a dead constant:** `ELEMENT_USAGE_PREVIEW_PREFETCH_THRESHOLD` was left over from §21's
  modal-era background-prefetch design, never wired into the §22 `previewApp` redesign that
  replaced it, and unused anywhere in the codebase — removed along with its now-inaccurate doc
  comment.
- **Added diagnostics to two silently-swallowed `catch` blocks** (a failed "referenced by" page
  fetch in the repository, and a corrupt/inaccessible `sessionStorage` read in the nav control) —
  both now `console.warn` with enough context to debug a real "usages didn't show up" report,
  without logging anything sensitive (only Umbraco entity kinds/ids, which aren't secrets).
- **Fixed a real nupkg packaging bug:** `dotnet pack` was shipping the raw `.ts` sources, the
  `.test.ts` file, `package-lock.json`, and `tsconfig.json` into every consumer's site under
  `staticwebassets/` — none of which do anything at runtime (only the compiled `.js` is loaded).
  Excluded via `<Content Remove>` in the `.csproj`; re-verified with a real `dotnet pack` that the
  resulting nupkg now contains only the compiled `.js`, `umbraco-package.json`, the DLL, and
  standard build props.
- **Filled in missing NuGet metadata** on the `.csproj` (`PackageId`, `Version`, `PackageTags`,
  `PackageReadmeFile` + packing README.md in) and added a `RepositoryUrl` alongside the existing
  `PackageProjectUrl`, plus a root `LICENSE` file matching the already-declared
  `PackageLicenseExpression: MIT` (which previously had no corresponding license text in the repo
  at all). **`PackageProjectUrl`/`RepositoryUrl` are still placeholders
  (`https://github.com/your-org/ElementUsagePreview`)** — this was not guessed at further; replace
  with the real repository URL before publishing.
- Reviewed for XSS, open-redirect, and IDOR-style risk in the client-side surface (this package has
  no backend to review): confirmed clean per §26's live XSS test; the `window.open()` call
  deliberately matches Core's own `UmbPreviewController.preview()` exactly (no `noopener`, since
  the target is same-origin and Core's own equivalent call has the identical shape); the
  `umbElementUsageKey`/`umbElementUsageSession` query params are not a privilege-escalation vector
  since they only ever address the same public, already-authenticated "referenced by" endpoint any
  session can already call directly.
- Confirmed non-admin permission behavior is still genuinely untested end-to-end (not just an old
  note carried forward without re-checking) — this remains open, called out explicitly in
  `docs/how-it-works.md`'s "Known limitations" rather than asserted either way.
