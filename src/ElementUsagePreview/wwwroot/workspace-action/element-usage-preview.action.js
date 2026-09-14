// Extends the real UmbSubmitWorkspaceAction (the same base Element's own Save action uses,
// src/Umbraco.Web.UI.Client/.../elements/workspace/manifests.ts) rather than a hand-rolled action —
// confirmed against the installed @umbraco-cms/backoffice 18.1.1 package (typechecked, not
// guessed): `super.execute()` awaits workspace-context retrieval and calls `requestSubmit()`,
// exactly what Save itself does, so this genuinely *is* Save-and-Preview, not a look-alike.
//
// CLAUDE.md — 2026-09-04 redesign: no backoffice UI at all. Clicking this immediately opens the
// preview tab for the first previewable usage; Next/Previous live inside that tab's own preview
// toolbar (`preview-app/element-usage-preview-nav.element.ts`), not here.
import { UmbSubmitWorkspaceAction } from '@umbraco-cms/backoffice/workspace';
import { UMB_NOTIFICATION_CONTEXT } from '@umbraco-cms/backoffice/notification';
import { DocumentService } from '@umbraco-cms/backoffice/external/backend-api';
import { ElementUsagePreviewRepository } from '../repository/element-usage-preview.repository.js';
import { ELEMENT_USAGE_PREVIEW_QUERY_PARAM, ELEMENT_USAGE_PREVIEW_SESSION_PARAM, ELEMENT_USAGE_PREVIEW_WINDOW_NAME_PREFIX, } from '../constants.js';
export class ElementUsagePreviewWorkspaceAction extends UmbSubmitWorkspaceAction {
    async execute() {
        // Saves the Element's current draft — CLAUDE.md §2/§7.5: the preview must reflect what was
        // just edited, not a stale draft.
        await super.execute();
        const elementKey = this._workspaceContext?.getUnique();
        if (!elementKey) {
            return;
        }
        const repository = new ElementUsagePreviewRepository(this);
        const iterator = repository.iterateUsages(elementKey);
        // The resolved list can interleave non-previewable dead ends (nested Elements/Media/Member
        // referrer chains, content-type property-type references — CLAUDE.md §14) with real Document
        // usages in whatever order the walk discovers them. There's no backoffice UI left to show a
        // "this usage can't be previewed" message, so this skips forward to the first one that
        // actually has a page to open, rather than stopping at whatever the resolver yields first.
        let firstPreviewable;
        while (true) {
            const { value, done } = await iterator.next();
            if (done)
                break;
            if (value.isPreviewable) {
                firstPreviewable = value;
                break;
            }
        }
        if (!firstPreviewable) {
            const notificationContext = await this.getContext(UMB_NOTIFICATION_CONTEXT);
            notificationContext?.peek('warning', {
                data: {
                    headline: 'No pages found',
                    message: 'This Element is not currently referenced anywhere previewable.',
                },
            });
            return;
        }
        try {
            const { data } = await DocumentService.getDocumentByIdPreviewUrl({
                path: { id: firstPreviewable.key },
                query: { providerAlias: 'umbDocumentUrlProvider' },
            });
            if (!data?.url) {
                const notificationContext = await this.getContext(UMB_NOTIFICATION_CONTEXT);
                notificationContext?.peek('warning', {
                    data: { headline: 'Preview unavailable', message: 'No preview URL could be resolved for this page.' },
                });
                return;
            }
            // The one deliberate deviation from Core's own UmbPreviewController (CLAUDE.md §3a): a
            // window name fixed for the whole iteration session, not per-document, so the nav control
            // inside the tab re-navigates it instead of opening a new tab per page. The query params
            // tell that control which Element/session this tab belongs to, and are what makes it render
            // at all — a normal Save-and-Preview URL never carries them.
            //
            // `data.url` is a *relative* path with no leading slash (e.g. `preview?id=...`), verified
            // live — it's meant to be resolved against the backoffice's own `/umbraco/` base the way
            // Core's own preview controller does when it builds this URL from inside a page already
            // under `/umbraco/...`. Resolving it against `location.origin` alone (i.e. `new URL(data.url,
            // location.origin)`) silently drops that prefix and 404s on the front end — a real bug this
            // caught live, not a hypothetical — so the `/umbraco/` prefix is added explicitly here
            // instead of relying on relative-URL resolution against whatever page happens to be current.
            const url = new URL(`/umbraco/${data.url}`, location.origin);
            url.searchParams.set(ELEMENT_USAGE_PREVIEW_QUERY_PARAM, elementKey);
            url.searchParams.set(ELEMENT_USAGE_PREVIEW_SESSION_PARAM, crypto.randomUUID());
            window.open(url.toString(), `${ELEMENT_USAGE_PREVIEW_WINDOW_NAME_PREFIX}${elementKey}`);
        }
        catch {
            const notificationContext = await this.getContext(UMB_NOTIFICATION_CONTEXT);
            notificationContext?.peek('warning', {
                data: { headline: 'Preview unavailable', message: 'Failed to open the preview for this page.' },
            });
        }
    }
}
export { ElementUsagePreviewWorkspaceAction as api };
