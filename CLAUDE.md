# CLAUDE.md — ElementUsagePreview

This is the working brief for an AI coding agent (or a human) working on **ElementUsagePreview**:
a standalone Umbraco 18 addon package that adds a "Save and preview" action to the Element
workspace, so an editor can preview the effect of an Element's edits across every page that
references it, without a custom backend.

> **For the full build history** — every design pivot, live bug found and fixed, and verification
> session that got this package to its current state — see [`docs/dev-notes.md`](docs/dev-notes.md).
> This file was trimmed down to current-state-only during pre-packaging cleanup (2026-09-10); the
> history was moved, not deleted. If something below looks surprising, check there first — it's
> very likely a deliberate decision with a documented reason, not an oversight.

**Package name:** the NuGet `PackageId` is `Element.Preview` (display title "Element Preview") —
deliberately **not** `Umbraco.*`-prefixed. This is not an official Umbraco-branded package, even
though it's built to an Umbraco-grade quality bar. The repo, project folder, `.csproj`/`.slnx`
filenames, and internal extension aliases still say `ElementUsagePreview` — only the public-facing
NuGet identity and display names were renamed; nothing internal was touched, so don't be surprised
by the mismatch when reading file paths below.

---

## 1. What this package does

Umbraco 18 introduced **Elements** (managed in the backoffice **Library** section): reusable,
non-routable content blocks referenced from many pages, so an edit in one place propagates
everywhere it's used. Umbraco already shows an editor *that* an Element is used elsewhere (the Info
workspace view's "where used" list), but there's no way to see the rendered *effect* of an edit
across all of them without opening each referencing page one at a time.

This package adds a **Save and preview** workspace action next to Element's existing Save action.
Clicking it:

1. Saves the Element's current draft (same as Save).
2. Resolves the first previewable page that references it (walking transitively past any
   non-previewable referrer — a nested Element, or a Media/Member item — until it finds an actual
   Document).
3. Opens that page's real front-end preview in a new browser tab.

If the Element is used on more than one page, that preview tab's own toolbar shows a compact
Previous / N of M / Next control (rendered immediately to the left of Umbraco's own "Fit browser"
button) for stepping through every other usage, plus a dropdown for jumping straight to any
already-resolved one. There is **no backoffice modal or dialog** — this is the current, final
design; earlier iterations that did have one are historical (see `docs/dev-notes.md` §5/§19-§21).

## 2. Architecture — no backend at all

This package ships **zero C# logic beyond the `.csproj` itself**. It is a single Razor SDK RCL
(matching the packaging shape of an Umbraco Automate provider package) whose only job is to carry
the compiled backoffice extension assets under `wwwroot/`. Usage resolution runs entirely
client-side, against Umbraco Core's own public, already-authenticated Management API "referenced
by" endpoints (`ElementService`/`DocumentService`/`MediaService`/`MemberService`
`.getXByIdReferencedBy`) — the same endpoints that back the Info workspace view's own "where used"
list, and the exact same discriminated-union response shape used to tell a previewable Document
apart from a non-previewable Element/Media/Member/property-type referrer.

Consequences of this shape:

- **No database migrations, no persistence, no cache.** There is nothing to build or maintain a
  second index of — this package can't drift from what Core's own "where used" list already shows.
- **`Umbraco.Cms.Core` is a `PackageReference` purely for version-compatibility signaling.** Nothing
  in the C# actually references its types.
- Everything interesting lives in `src/ElementUsagePreview/wwwroot/`:
  - `workspace-action/` — the "Save and preview" action (extends the real
    `UmbSubmitWorkspaceAction`, the same base Element's own Save action uses) and its manifest.
  - `preview-app/` — the `previewApp`-type extension rendering the Previous/N-of-M/Next control
    inside the real front-end preview toolbar.
  - `repository/element-usage-resolver.ts` — the pure, dependency-free transitive-walk algorithm
    (an **async generator**, not a function returning a resolved array — see §3), unit-tested
    without any live Umbraco dependency in `element-usage-resolver.test.ts`.
  - `repository/element-usage-preview.repository.ts` — wires the pure resolver up to the real
    generated `ElementService`/`MediaService`/`MemberService` clients.
  - `constants.ts`, `manifests.ts` — shared constants and the extension-manifest registration.

## 3. Design constraints worth knowing before "fixing" something

These read like arbitrary choices at first glance; they aren't — see `docs/dev-notes.md` for the
full reasoning trail on each.

- **Usage resolution is an async generator, not an eager resolve-then-return.** An Element can be
  referenced by hundreds of pages; the walk only does as much work (including recursing into
  non-Document referrers) as the caller has actually pulled via `.next()`. Consumers pull in
  batches (`ELEMENT_USAGE_PREVIEW_BATCH_SIZE`, currently 10), not all at once.
- **A preview tab is reused, not multiplied, per Element.** `window.open(url, name)` uses one
  window name per Element (`elementUsagePreview-{elementKey}`) instead of Core's own
  per-*document* naming, deliberately — otherwise Next/Previous would open a new tab per page.
- **There is no supported way to swap which document a preview tab shows without a full page
  reload.** Confirmed against Core's real `UmbPreviewContext`/`UmbPreviewController` source — its
  `updateIFrame()` only adjusts culture/segment/size of the *current* document. Next/Previous does
  a real `location.href` reassignment, and all iteration state lives in `sessionStorage` (scoped by
  Element key **and** a per-click session id — see the constants file) rather than in memory, since
  a fresh component instance is created on every navigation.
- **Non-previewable usages (dead-end Element/Media/Member chains, or a content-type property-type
  reference) are resolved and known internally, but silently skipped everywhere in the toolbar
  control** — Next/Previous, the counter, and the dropdown only ever count/show previewable pages.
  There's no room in this compact control to explain why one was skipped.
- **The preview URL from `DocumentService.getDocumentByIdPreviewUrl()` is relative with no leading
  slash** and must be resolved against `/umbraco/` explicitly (`new URL(`/umbraco/${data.url}`,
  location.origin)`), not against `location.origin` alone — the latter silently drops the prefix
  and 404s. This bug was caught live twice (workspace action and nav control both build this URL).

## 4. Target framework & stack

- Umbraco CMS **18.1.1** (the newest version actually published as GA on nuget.org — verify this is
  still current before bumping; a `release/18.x` branch existing in the CMS repo is not the same as
  that version having shipped, confirmed the hard way once already).
- **.NET 10** / `net10.0`.
- TypeScript compiled with `tsc` directly (no bundler) — compiled `.js` sits next to its `.ts`
  source at the same relative path, matching how Core's own compiled packages are structured (many
  small ES modules with bare `@umbraco-cms/backoffice/*` specifiers resolved by the browser's
  import map at runtime). An esbuild single-bundle approach was tried and abandoned — it breaks the
  dynamic `import()` lazy-loading this package's manifests use, the same pattern Core's own
  manifests use.
- Central Package Management via `Directory.Packages.props` at the solution root.

## 5. Non-negotiables

1. **Zero required config from the implementer.** Install the NuGet package, restart the site,
   done — no connected app, no OAuth client, no config section (unlike an Umbraco Automate
   provider package, this reads Core APIs directly).
2. **Auto-discovered registration** via `umbraco-package.json` + extension manifests — no manual
   wiring.
3. **Respects Umbraco's existing Library/Elements permission model.** The workspace action's
   manifest gates on `UMB_USER_PERMISSION_ELEMENT_UPDATE` (matching Core's own real Save action
   exactly, since this action also triggers a save) — not Read, which would let a user without
   edit rights see an action that's enabled but silently fails server-side. **Full non-admin
   permission behavior has not been verified end-to-end** — see `docs/how-it-works.md`'s "Known
   limitations."
4. **Doesn't duplicate or cache content/PII beyond what Umbraco's own preview pipeline already
   renders.** No second index of anything.
5. **Works against draft state, not just published** — the action mirrors normal "Save and
   Preview" semantics exactly, so it always reflects the just-saved draft, and an unpublished
   referencing page is still a valid, previewable usage.

## 6. Data & migrations

None. See §2 — this package reads through Core's existing relation-tracking and preview-URL
endpoints only.

## 7. Testing

- **Unit tests** (`src/ElementUsagePreview/wwwroot/repository/element-usage-resolver.test.ts`, run
  via `npm test`, Node's built-in test runner, no live Umbraco dependency): cover direct/transitive/
  dead-end/circular resolution, graceful degradation on a failed fetch, and — because the resolver
  is an async generator — that pulling fewer items than exist never fetches or recurses beyond what
  was asked for, and that resuming a partially-drained generator continues rather than restarting.
- **No backend tests** (there's no backend) and **no automated backoffice/browser tests** — the
  frontend has been live-verified extensively by hand against a real running Umbraco 18.1.1 site
  (see `docs/dev-notes.md`), but that verification isn't automated/repeatable in CI.
- `dotnet build ElementUsagePreview.slnx` and `npm run build && npm test` (from
  `src/ElementUsagePreview/wwwroot`) should both be clean before considering any change done.

## 8. Setting up a local dev site to test against

There's no reference package to mirror for "how a standalone addon extends the Umbraco 18
backoffice with a new workspace action/previewApp extension" — when in doubt, read Core's own real
compiled source under `node_modules/@umbraco-cms/backoffice/dist-cms/` (installed as a devDependency
specifically so this is possible) rather than guessing at an API shape.

To test live changes, spin up a scratch Umbraco site outside this repo (e.g. in this session's
scratchpad temp dir — never commit it):

```bash
dotnet new umbraco -n DevSite --development-database-type SQLite
cd DevSite
dotnet add reference <path-to>/src/ElementUsagePreview/ElementUsagePreview.csproj
dotnet run --launch-profile Umbraco.Web.UI --no-build
```

Static assets are served live off disk in this setup — no site restart is needed after
`npm run build`, just a browser reload (see the cache gotcha below).

**Important ordering lesson if using the official `@umbraco-cms/mcp-dev` MCP server against this
site:** MCP servers are connected once, at Claude Code session startup. If the scratch site isn't
already up and reachable at that moment, the MCP server's own startup handshake fails and the
connection closes for the rest of that session — bringing the site up afterward does not
retroactively fix it. **Confirm the site is up (e.g. `curl`) before starting the session that needs
those tools**, not after. This has recurred across multiple sessions; it's not a one-off fluke.

**Browser cache gotcha:** ASP.NET's static-file middleware sends no `Cache-Control` header for
these `.js` files in this dev setup, so Chrome can serve a stale cached copy even after a normal
reload, a hard reload, or in a brand-new tab (the HTTP cache is shared across the whole browser
profile, not per-tab). The reliable fix: from the page's own console, run
`await fetch(<the stale script's exact URL>, { cache: 'reload' })`, then reload normally.

## 9. Known limitations

See `docs/how-it-works.md`'s "Known limitations" section for the user-facing version of these.
Not yet live-verified at all: Block Grid nested areas (block-in-block, as opposed to the confirmed
Element-Picker-inside-a-block case), a Media/Member referrer dead-end, multi-culture referencing
pages, and non-admin permissions.

## 10. Documentation to ship

- `README.md` — what it is, quick start, links to install guide.
- `docs/installation.md` — install via NuGet, zero required config.
- `docs/how-it-works.md` — the transitive-resolution algorithm explained for editors/devs, plus
  known limitations.
- `docs/dev-notes.md` — the archived build history (this file's former §12-§27).
- `CHANGELOG.md` — Conventional Commits.

## 11. Before publishing this package

- [x] `PackageProjectUrl`/`RepositoryUrl` in `Directory.Build.props` point at the real repository:
      `https://github.com/ramirezja3/Element-Preview`.
- [x] License confirmed as MIT, copyright holder "Element Usage Preview contributors" (matching
      `Directory.Build.props`'s `Authors`).
- [ ] Decide the first published `Version` (currently `0.1.0` in both the `.csproj` and
      `wwwroot/umbraco-package.json` — keep these two in lockstep on every bump).
- [ ] Re-run `dotnet pack` and spot-check the resulting `.nupkg` contents — confirm only compiled
      `.js` (no `.ts`/test/tooling files) ships under `staticwebassets/`.

## 12. When you (the AI agent) get stuck

1. Check `docs/dev-notes.md` first — a huge fraction of "this looks wrong" turns out to already be
   a documented, deliberate decision with a reason.
2. Re-check current Umbraco 18 CMS source/docs directly — don't rely on cached knowledge of the
   backoffice extension API, since it's changed release to release. Everything in §3 above was
   verified against real source at the time it was written; spot-check it still holds before
   trusting it verbatim against a newer Umbraco version.
3. Scope is settled (§1/§5) — if you find yourself about to make a *new* architectural choice not
   already covered here or in `docs/dev-notes.md`, flag it rather than deciding silently.
