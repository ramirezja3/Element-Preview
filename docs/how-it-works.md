# How it works

## Finding where an Element is used

Umbraco already tracks this: the built-in Element Picker records a relation every time it's used
to reference an Element. This package reads that data through the same public "referenced by"
endpoint that backs the Info workspace view's own "where used" list — it doesn't build or
maintain a second index, and it can't drift from what that list already shows you.

## Why some usages need extra steps to resolve

An Element isn't always referenced directly by a page. It can be:

- **Nested** — referenced by another Element, which is itself used on a page.
- **Indirect** — referenced from a Media or Member item's Element Picker property, which itself
  may or may not be used anywhere previewable.

Only a Document (a page) has something to actually preview. So when a direct reference isn't a
Document, this package keeps walking — it asks "who references *that*?" — until it finds a
Document, or runs out of referrers to follow.

If it never reaches a Document, that usage is a dead end: the resolver still knows about it
internally (so it isn't silently dropped from the walk), but there's nothing to preview, so it's
skipped over everywhere in the toolbar control — Next/Previous, the counter, and the dropdown list
all only ever count and show previewable pages. If an Element's usage count here seems lower than
what the Info view's own "where used" panel reports, a non-previewable referrer chain is the
most likely reason.

## What "Save and preview" means for an Element

Elements have no page of their own to preview — clicking the action:

1. Saves the Element's current draft (same as the normal Save action).
2. Resolves the first previewable page that uses it (see above), skipping past any non-previewable
   referrers it finds along the way.
3. Opens that page's live preview in a new browser tab.

The usage list includes pages regardless of whether *they've* published their reference to this
Element yet — an unpublished draft page is still previewable, since Umbraco's preview mode shows
draft content. The toolbar control does not currently distinguish published from draft usages
visually; that per-usage detail was a deliberate scope cut, not an oversight.

## The preview toolbar control

Umbraco's preview always opens the real site in its own browser tab — never an iframe inside the
backoffice (the site can't safely be iframed cross-origin, and its preview session relies on being
loaded like a normal page). Because of this, there's no supported way to swap which page a preview
tab shows without a full page reload: clicking Next or Previous, or picking a page from the
dropdown, re-navigates that same tab to the chosen page's preview URL, rather than opening a new
tab per page. Each navigation is a real page load, so expect a brief flash rather than an instant
transition.

If an Element has many usages, they're loaded in batches rather than all at once, so opening the
preview for an Element used on hundreds of pages doesn't resolve them all up front — the dropdown's
"Load more pages…" entry pulls the next batch on demand.

## Known limitations

- **Duplicating a page doesn't register its copied references until you publish the copy** — this
  is Umbraco Core's own relation-tracking behavior, not something this package controls. A brand
  new, never-saved-before page shows up as a usage immediately; a page *duplicated* from an
  existing referencing page does not, until it's published. Duplicating an Element itself doesn't
  have this restriction — a copied Element's own references are tracked immediately, in draft
  state.
- **A trashed referencing page still appears as a usage.** Moving a page to the recycle bin doesn't
  remove or flag its relation to the Element, so it can still be picked from the list — clicking it
  opens the front end's own "Page Not Found" rather than an error from this package.
- **Non-admin permissions have not been verified end-to-end.** This package calls the same
  Management API endpoints (`ElementService`/`DocumentService`/`MediaService`/`MemberService`) any
  authenticated backoffice user's session already has access to, and does not add or bypass any
  permission check of its own — but the full behavior for a restricted (non-admin) user has not
  been specifically tested against a real permission-scoped account.
