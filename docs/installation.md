# Installation

## Prerequisites

- Umbraco CMS **18.1.1** or later.
- .NET **10**.

There is no other add-on this package depends on — it's built entirely on Umbraco CMS Core's own
public APIs (relation tracking, the Document preview-URL endpoint), so there's no equivalent of a
connected app, an OAuth client, or a config section to set up.

## Install

```bash
dotnet add package ElementUsagePreview
```

Restart the site. That's it — there is no configuration step. The new action appears next to
**Save** on any Element's workspace in the **Library** section as soon as the package is
installed.

## Verifying it worked

1. Open (or create) an Element in the Library section.
2. Reference it from at least one page (a Content page with an Element Picker property pointing
   at it).
3. Open the Element again — you should see a new **Save and preview** action next to **Save**.
4. Click it. It saves the Element and opens a new browser tab showing the real front-end preview
   of the first page that uses it. If the Element is used on more than one page, that tab's own
   preview toolbar shows a Previous / N of M / Next control (next to Umbraco's "Fit browser"
   button) for stepping through the rest, or jumping straight to one from its dropdown.

If the action doesn't appear, or clicking it reports "No pages found" when you expect a usage, see
`docs/how-it-works.md` for what counts as a previewable usage and why one might not qualify.
