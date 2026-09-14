export const ELEMENT_USAGE_PREVIEW_WORKSPACE_ACTION_ALIAS = 'ElementUsagePreview.WorkspaceAction.PreviewUsages';
export const ELEMENT_USAGE_PREVIEW_PREVIEW_APP_ALIAS = 'ElementUsagePreview.PreviewApp.UsageNav';
/**
 * Base name for the reused preview browser tab/window. Deliberately NOT keyed per referencing
 * document the way Core's own `UmbPreviewController` names its window (`umbpreview-${unique}`) —
 * that per-document naming is exactly wrong for an iterator, since it would open one tab per page
 * instead of reusing one across Next/Previous. Keyed per Element instead, so stepping through
 * usages re-navigates the same tab. See CLAUDE.md §3a/§5a.
 */
export const ELEMENT_USAGE_PREVIEW_WINDOW_NAME_PREFIX = 'elementUsagePreview-';
/**
 * How many usages the nav control pulls from the resolver at a time. Chosen to be big enough that
 * an editor stepping through Next rarely has to wait on a fresh network round-trip, small enough
 * that an Element used on hundreds of pages never has all of them resolved just because the editor
 * clicked Next a couple of times.
 */
export const ELEMENT_USAGE_PREVIEW_BATCH_SIZE = 10;
/**
 * Query param appended to the preview URL to identify which Element's usage session this preview
 * tab belongs to. Its presence is what tells the previewApp nav control to render at all — a normal
 * document preview (opened via Umbraco's own Save-and-Preview) never carries this param, so the
 * control stays invisible there. See `preview-app/element-usage-preview-nav.element.ts`.
 */
export const ELEMENT_USAGE_PREVIEW_QUERY_PARAM = 'umbElementUsageKey';
/**
 * Query param carrying a random per-click session id, appended alongside
 * `ELEMENT_USAGE_PREVIEW_QUERY_PARAM` each time the workspace action opens the preview tab. The
 * resolved-usage cache in `sessionStorage` is namespaced by this value (not just the Element's key)
 * so that re-clicking "Preview usages" after further edits always starts from a fresh resolution
 * instead of trusting a stale list left over from a previous click earlier in the same tab's
 * lifetime — `sessionStorage` persists across the full-page navigations Next/Previous cause
 * *within* one tab, but a brand new "Preview usages" click is a deliberately new session.
 */
export const ELEMENT_USAGE_PREVIEW_SESSION_PARAM = 'umbElementUsageSession';
