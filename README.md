# Element Preview

Preview every page an Umbraco Element lives on.

## The idea

Umbraco 18 added **Elements** — reusable content blocks managed in a new **Library** section.
Editing an Element updates it everywhere it's referenced, but there's no built-in way to preview
that effect across the whole site without opening each referencing page individually.

This package adds a **Save and preview** action to an Element's workspace, next to the existing
Save action. Clicking it saves the Element's draft and opens the real front-end preview of the
first page that uses it. Inside that preview tab's own toolbar, next to Umbraco's own "Fit
browser" control, a small Previous / N of M / Next control lets you step through every other page
that references the same Element — reusing a single browser tab rather than opening one per page.

Usage discovery calls Umbraco's own public "referenced by" Management API endpoints
(`ElementService`/`DocumentService`/`MediaService`/`MemberService`) — the same ones behind the
Info workspace view's "where used" list — walking transitively past any non-previewable referrer
(a nested Element, or a Media/Member item) until it reaches an actual previewable page. No custom
backend, no new database tables, no bespoke indexing, no Core changes required.

## Getting started

```bash
dotnet add package Element.Preview
```

Restart the site — there's no configuration step. See [docs/installation.md](docs/installation.md)
for the full walkthrough and [docs/how-it-works.md](docs/how-it-works.md) for how usage resolution
and the preview toolbar control work, including what to expect from usages that can't be
previewed.

## Building this repo

```bash
dotnet build ElementUsagePreview.slnx
```

There's no C# beyond the `.csproj` itself — every bit of this package's logic lives in
`src/ElementUsagePreview/wwwroot`, shipped as static backoffice extension assets. Build and test
the frontend there:

```bash
cd src/ElementUsagePreview/wwwroot
npm install
npm run build
npm test
```

## Contributing

See [CLAUDE.md](CLAUDE.md) for the design decisions and constraints an AI coding agent (or a
human) should follow when working on this repo.
