var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
// A `previewApp` extension (CLAUDE.md — 2026-09-04 redesign): renders directly inside Umbraco's
// own front-end preview toolbar, to the left of the "Fit browser" control (see manifests.ts's
// weight comment), instead of any backoffice modal/dialog. Confirmed feasible by reading Core's
// real preview architecture (UmbPreviewContext/UmbPreviewController): `/umbraco/preview` is the
// full backoffice SPA shell, not the raw front-end site, and its `updateIFrame()` can only change
// culture/segment/size of the *current* document — there is no supported way to swap which
// document is shown without a full top-level navigation. So Next/Previous here does a real
// `location.href` reassignment, and all iteration state is kept in `sessionStorage` (scoped to
// this one browser tab, but explicitly surviving full-page navigation within it) rather than in
// memory, since a fresh instance of this element is created from scratch on every step.
import { css, html, nothing, repeat } from '@umbraco-cms/backoffice/external/lit';
import { customElement, state } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UMB_NOTIFICATION_CONTEXT } from '@umbraco-cms/backoffice/notification';
import { DocumentService } from '@umbraco-cms/backoffice/external/backend-api';
import { ElementUsagePreviewRepository } from '../repository/element-usage-preview.repository.js';
import { ELEMENT_USAGE_PREVIEW_BATCH_SIZE, ELEMENT_USAGE_PREVIEW_QUERY_PARAM, ELEMENT_USAGE_PREVIEW_SESSION_PARAM, } from '../constants.js';
function storageKeyFor(elementKey, sessionId) {
    return `elementUsagePreview:${elementKey}:${sessionId}`;
}
let ElementUsagePreviewNavElement = class ElementUsagePreviewNavElement extends UmbLitElement {
    constructor() {
        super(...arguments);
        // Whether this preview tab was opened for an Element-usage session at all — false on every
        // normal document preview, which is what keeps this control invisible there.
        this._active = false;
        this._currentIndex = -1;
        this._hasMore = true;
        this._isNavigating = false;
        this._popoverOpen = false;
        this._isLoadingPopoverMore = false;
        // Bumped whenever `#items` grows without an accompanying navigation (i.e. "Load more" clicked
        // inside the popover) — `#items` itself is a plain field Lit can't see into, and `_hasMore` alone
        // doesn't reliably change on every such load (a batch can load more items and still leave
        // `_hasMore` true), so this is what tells Lit the popover's list needs to re-render.
        this._popoverTick = 0;
        this.#items = [];
        this.#loadingPromise = null;
    }
    #elementKey;
    #sessionId;
    #storageKey;
    #items;
    #iterator;
    #loadingPromise;
    connectedCallback() {
        super.connectedCallback();
        void this.#init();
    }
    async #init() {
        const params = new URLSearchParams(location.search);
        const elementKey = params.get(ELEMENT_USAGE_PREVIEW_QUERY_PARAM);
        const sessionId = params.get(ELEMENT_USAGE_PREVIEW_SESSION_PARAM);
        if (!elementKey || !sessionId)
            return;
        this.#elementKey = elementKey;
        this.#sessionId = sessionId;
        this.#storageKey = storageKeyFor(elementKey, sessionId);
        const stored = this.#readStorage();
        if (stored) {
            this.#items = stored.items;
            this._hasMore = stored.hasMore;
            this._currentIndex = stored.currentIndex;
        }
        else {
            // A brand-new session: this preview tab is already showing the first previewable usage
            // (the workspace action found it before opening this tab), so re-walk from the start to
            // rebuild that same list rather than trying to detect "which document is this" from the
            // page itself — there's no reliable way to do that from inside the sandboxed preview iframe.
            await this.#resolveInitial();
        }
        if (this._currentIndex >= 0) {
            this._active = true;
        }
    }
    // Finding the current page (whatever the workspace action opened) is mandatory — that's what
    // this loop can never stop before doing, regardless of batch size. Once found, it keeps pulling
    // up to a full batch (matching what Next/Previous's own `#pullBatch` loads at a time) instead of
    // stopping the instant that one item is found — so the popover shows a useful page's worth of
    // choices on the very first click instead of needing an extra "Load more" tap almost immediately.
    // This was a deliberate change from the original design (which stopped at the first previewable
    // item to minimize work) after the user found "1 / 2+, click to load more" less useful than just
    // seeing what a normal batch already contains.
    async #resolveInitial() {
        const repository = new ElementUsagePreviewRepository(this);
        this.#iterator = repository.iterateUsages(this.#elementKey);
        this.#items = [];
        this._hasMore = true;
        this._currentIndex = -1;
        while (true) {
            const { value, done } = await this.#iterator.next();
            if (done) {
                this._hasMore = false;
                break;
            }
            this.#items.push(value);
            if (this._currentIndex < 0 && value.isPreviewable) {
                this._currentIndex = this.#items.length - 1;
            }
            if (this._currentIndex >= 0 && this.#items.length >= ELEMENT_USAGE_PREVIEW_BATCH_SIZE) {
                break;
            }
        }
        // See the comment on `#pullBatch` for why this peek matters: without it, an Element whose
        // total usage count happens to land exactly on the batch boundary leaves `_hasMore` stale-true.
        if (this._hasMore) {
            await this.#peekOneMore();
        }
        this.#writeStorage();
    }
    async #peekOneMore() {
        const { value, done } = await this.#iterator.next();
        if (done) {
            this._hasMore = false;
        }
        else {
            this.#items.push(value);
        }
    }
    // A fresh page load means a fresh element instance with no live generator — re-create one and
    // fast-forward past the items already known (proven safe by this walk's own resolver tests:
    // resuming a partially-drained generator continues where it left off rather than restarting the
    // underlying page fetches from scratch page-by-page). This does mean every page's already-seen
    // referenced-by pages get re-fetched once per reload that needs *more* than what's cached — an
    // accepted trade-off of not being able to persist a live generator across a full navigation.
    async #ensureIterator() {
        if (this.#iterator)
            return;
        const repository = new ElementUsagePreviewRepository(this);
        const fresh = repository.iterateUsages(this.#elementKey);
        for (let i = 0; i < this.#items.length; i++) {
            await fresh.next();
        }
        this.#iterator = fresh;
    }
    async #loadMore() {
        if (!this._hasMore)
            return;
        if (this.#loadingPromise) {
            await this.#loadingPromise;
            return;
        }
        this.#loadingPromise = this.#pullBatch();
        try {
            await this.#loadingPromise;
        }
        finally {
            this.#loadingPromise = null;
        }
    }
    // Pulls up to a full batch, THEN peeks one item past it. Without the peek, a batch that happens
    // to end exactly on the last real item leaves `_hasMore` stale-true (the generator only reports
    // `done` once asked for one item too many) — Next would render enabled but silently do nothing
    // on the next click, since there's nothing left to advance to. Confirmed live: with a small
    // batch size this reproduced exactly as "the arrow is there but doesn't do anything." The peek
    // is cheap: resuming the resolver's generator to discover it has nothing left costs no extra
    // network call unless a genuinely new referenced-by page has to be fetched to find out.
    async #pullBatch() {
        await this.#ensureIterator();
        let filledBatch = true;
        for (let pulled = 0; pulled < ELEMENT_USAGE_PREVIEW_BATCH_SIZE; pulled++) {
            const { value, done } = await this.#iterator.next();
            if (done) {
                this._hasMore = false;
                filledBatch = false;
                break;
            }
            this.#items.push(value);
        }
        if (filledBatch) {
            await this.#peekOneMore();
        }
        this.#writeStorage();
    }
    #nextPreviewableIndex(from) {
        for (let i = from; i < this.#items.length; i++) {
            if (this.#items[i].isPreviewable)
                return i;
        }
        return null;
    }
    #prevPreviewableIndex(from) {
        for (let i = from; i >= 0; i--) {
            if (this.#items[i].isPreviewable)
                return i;
        }
        return null;
    }
    // Non-previewable usages (a dead-end Element/Media/Member referrer chain, or a content-type
    // property-type reference — CLAUDE.md §14) have no page to show at all, and this compact
    // toolbar control has no room to explain why one was skipped, so Next/Previous silently step
    // over them to the next real page. The counter below only counts previewable usages, for the
    // same reason.
    async #goNext() {
        if (this._isNavigating)
            return;
        this._isNavigating = true;
        try {
            let idx = this.#nextPreviewableIndex(this._currentIndex + 1);
            while (idx === null && this._hasMore) {
                await this.#loadMore();
                idx = this.#nextPreviewableIndex(this._currentIndex + 1);
            }
            if (idx !== null)
                await this.#navigateTo(idx);
        }
        finally {
            this._isNavigating = false;
        }
    }
    async #goPrevious() {
        if (this._isNavigating)
            return;
        const idx = this.#prevPreviewableIndex(this._currentIndex - 1);
        if (idx === null)
            return;
        this._isNavigating = true;
        try {
            await this.#navigateTo(idx);
        }
        finally {
            this._isNavigating = false;
        }
    }
    // Jumping to an arbitrary item from the popover list, rather than stepping one at a time — the
    // item is always already loaded (the popover only ever lists what's in `#items`), so this never
    // needs to load more the way `#goNext` does.
    async #jumpTo(index) {
        if (this._isNavigating || index === this._currentIndex)
            return;
        this._isNavigating = true;
        try {
            await this.#navigateTo(index);
        }
        finally {
            this._isNavigating = false;
        }
    }
    async #loadMoreForPopover() {
        if (this._isLoadingPopoverMore)
            return;
        this._isLoadingPopoverMore = true;
        try {
            await this.#loadMore();
            this._popoverTick++;
        }
        finally {
            this._isLoadingPopoverMore = false;
        }
    }
    // `_currentIndex`/storage are only committed once a real navigation is about to happen — not
    // before the network call. Committing them eagerly (an earlier version of this method did) left
    // the toolbar showing the new position — and Previous/Next's disabled state reflecting it — even
    // when the fetch failed and the tab never actually moved, which is indistinguishable from the
    // "arrow does nothing" bug this control already had to fix once (CLAUDE.md §23). A failure now
    // also raises a notification instead of failing silently, for the same reason.
    async #navigateTo(index) {
        const item = this.#items[index];
        try {
            const { data } = await DocumentService.getDocumentByIdPreviewUrl({
                path: { id: item.key },
                // Default (invariant) culture — CLAUDE.md §5a: a variant page's own culture switcher
                // (Core's `Umb.PreviewApps.Culture`) already sits in this same toolbar independently.
                query: { providerAlias: 'umbDocumentUrlProvider' },
            });
            if (!data?.url) {
                await this.#notifyNavigationFailed();
                return;
            }
            // See the identical note in workspace-action/element-usage-preview.action.ts: `data.url` is
            // a relative path with no leading slash and must be resolved against `/umbraco/` explicitly,
            // not against `location.origin` alone (confirmed live — the latter silently drops the
            // `/umbraco/` prefix and 404s).
            const url = new URL(`/umbraco/${data.url}`, location.origin);
            url.searchParams.set(ELEMENT_USAGE_PREVIEW_QUERY_PARAM, this.#elementKey);
            url.searchParams.set(ELEMENT_USAGE_PREVIEW_SESSION_PARAM, this.#sessionId);
            this._currentIndex = index;
            this.#writeStorage();
            location.href = url.toString();
        }
        catch {
            await this.#notifyNavigationFailed();
        }
    }
    async #notifyNavigationFailed() {
        const notificationContext = await this.getContext(UMB_NOTIFICATION_CONTEXT);
        notificationContext?.peek('warning', {
            data: { headline: 'Preview unavailable', message: 'Failed to open the preview for this page.' },
        });
    }
    #previewablePosition() {
        let count = 0;
        for (let i = 0; i <= this._currentIndex; i++) {
            if (this.#items[i]?.isPreviewable)
                count++;
        }
        return count;
    }
    #previewableLoadedCount() {
        return this.#items.filter((entry) => entry.isPreviewable).length;
    }
    // Only previewable items are ever listed in the popover — a non-previewable dead end has no page
    // to jump to (same reasoning as the Next/Previous skip-over logic above).
    #previewableEntries() {
        return this.#items.reduce((acc, item, index) => {
            if (item.isPreviewable)
                acc.push({ item, index });
            return acc;
        }, []);
    }
    #readStorage() {
        try {
            const raw = sessionStorage.getItem(this.#storageKey);
            return raw ? JSON.parse(raw) : null;
        }
        catch (error) {
            // Corrupt JSON (e.g. hand-edited by an extension, or a future version's shape) or storage
            // access being blocked (a private window, disabled site data) both fall back to a fresh
            // resolve — safe, just slower. Logged so that fallback isn't mistaken for a network issue.
            console.warn('[ElementUsagePreview] Failed to read cached usage session, resolving fresh:', error);
            return null;
        }
    }
    #writeStorage() {
        if (!this.#storageKey)
            return;
        const payload = {
            items: this.#items,
            hasMore: this._hasMore,
            currentIndex: this._currentIndex,
        };
        try {
            sessionStorage.setItem(this.#storageKey, JSON.stringify(payload));
        }
        catch (error) {
            // Losing the cache just means the next load re-resolves from scratch — safe, just slower.
            // Most likely cause in practice: a quota error from an Element with an unusually large
            // number of loaded usages (CLAUDE.md's own load-testing never built content this large).
            console.warn('[ElementUsagePreview] Failed to persist usage session (continuing without cache):', error);
        }
    }
    render() {
        if (!this._active || this._currentIndex < 0)
            return nothing;
        // Referencing `_popoverTick` here (even though its value is never displayed) is what makes
        // "Load more" clicked inside the popover trigger a re-render — see the field's own comment.
        void this._popoverTick;
        const position = this.#previewablePosition();
        const total = this._hasMore ? `${this.#previewableLoadedCount()}+` : `${this.#previewableLoadedCount()}`;
        const prevDisabled = this._isNavigating || this.#prevPreviewableIndex(this._currentIndex - 1) === null;
        const nextDisabled = this._isNavigating || (!this._hasMore && this.#nextPreviewableIndex(this._currentIndex + 1) === null);
        return html `
			<div id="usage-nav" title="Pages referencing this Element">
				<uui-button
					compact
					look="primary"
					color="default"
					label="Previous page"
					@click=${() => this.#goPrevious()}
					?disabled=${prevDisabled}>
					<uui-icon name="icon-arrow-left"></uui-icon>
				</uui-button>

				<uui-button look="primary" color="default" popovertarget="usage-popover" label="Choose a page to preview">
					<div>
						<uui-icon name="icon-documents"></uui-icon>
						<span>${position} / ${total}</span>
					</div>
					<uui-symbol-expand id="expand-symbol" slot="extra" .open=${this._popoverOpen}></uui-symbol-expand>
				</uui-button>
				<uui-popover-container
					id="usage-popover"
					placement="top"
					@toggle=${(event) => {
            this._popoverOpen = event.newState === 'open';
        }}>
					<umb-popover-layout>
						${repeat(this.#previewableEntries(), (entry) => entry.item.key, (entry) => html `
								<uui-menu-item
									label=${entry.item.name ?? entry.item.key}
									?active=${entry.index === this._currentIndex}
									@click=${() => this.#jumpTo(entry.index)}>
									<uui-icon slot="icon" name=${entry.item.contentTypeIcon ?? 'icon-document'}></uui-icon>
								</uui-menu-item>
							`)}
						${this._hasMore
            ? html `
									<uui-menu-item
										label="Load more pages…"
										?loading=${this._isLoadingPopoverMore}
										@click=${() => this.#loadMoreForPopover()}>
										<uui-icon slot="icon" name="icon-refresh"></uui-icon>
									</uui-menu-item>
							  `
            : nothing}
					</umb-popover-layout>
				</uui-popover-container>

				<uui-button
					compact
					look="primary"
					color="default"
					label="Next page"
					@click=${() => this.#goNext()}
					?disabled=${nextDisabled}
					?loading=${this._isNavigating}>
					<uui-icon name="icon-arrow-right"></uui-icon>
				</uui-button>
			</div>
		`;
    }
    static { this.styles = css `
		:host {
			display: flex;
			align-items: center;
			/* Matches Core's own preview-toolbar buttons (Fit browser/Preview website/Exit) exactly —
			   see preview-device.element.js — so this control reads as part of the same toolbar
			   instead of a visually distinct add-on. */
			--uui-button-font-weight: 400;
			--uui-menu-item-flat-structure: 1;
		}
		#usage-nav {
			display: flex;
			align-items: center;
			gap: var(--uui-size-space-2);
			padding: 0 var(--uui-size-space-2);
		}
		#usage-nav uui-button > div {
			display: flex;
			align-items: center;
			gap: var(--uui-size-2, 6px);
		}
		/* Matches Core's own "Fit browser" button (preview-device.element.js's #expand-symbol) — its
		   caret has this same margin-left, which is what keeps it from sitting flush against the
		   label text. Our button never had this rule, so the caret sat right up against "N / M". */
		#expand-symbol {
			margin-left: var(--uui-size-space-3, 9px);
		}
		umb-popover-layout {
			--uui-color-surface: var(--uui-color-header-surface);
			--uui-color-border: var(--uui-color-header-surface);
			color: var(--uui-color-header-contrast);
			/* Cap the list at roughly a batch's worth of rows (CLAUDE.md — the user asked for a scroll
			   here instead of an ever-taller dropdown once there are more than ~10 references) rather
			   than letting the popover grow to fit however many pages have been loaded.
			   'important' is needed here: umb-popover-layout declares its own host-scoped 'overflow:
			   clip' rule, and a component's own host style outranks a plain type-selector reaching in
			   from outside (confirmed live — without 'important', overflow-y computed as 'clip' and
			   max-height as 'none', i.e. this rule was being silently out-specificity'd, not ignored
			   by a typo). */
			display: block !important;
			max-height: 280px !important;
			overflow-y: auto !important;
			overflow-x: hidden !important;
		}
	`; }
};
__decorate([
    state()
], ElementUsagePreviewNavElement.prototype, "_active", void 0);
__decorate([
    state()
], ElementUsagePreviewNavElement.prototype, "_currentIndex", void 0);
__decorate([
    state()
], ElementUsagePreviewNavElement.prototype, "_hasMore", void 0);
__decorate([
    state()
], ElementUsagePreviewNavElement.prototype, "_isNavigating", void 0);
__decorate([
    state()
], ElementUsagePreviewNavElement.prototype, "_popoverOpen", void 0);
__decorate([
    state()
], ElementUsagePreviewNavElement.prototype, "_isLoadingPopoverMore", void 0);
__decorate([
    state()
], ElementUsagePreviewNavElement.prototype, "_popoverTick", void 0);
ElementUsagePreviewNavElement = __decorate([
    customElement('element-usage-preview-nav')
], ElementUsagePreviewNavElement);
export { ElementUsagePreviewNavElement };
export default ElementUsagePreviewNavElement;
