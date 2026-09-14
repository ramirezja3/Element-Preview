import { UmbRepositoryBase } from '@umbraco-cms/backoffice/repository';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { ElementService, MediaService, MemberService } from '@umbraco-cms/backoffice/external/backend-api';
import { iterateElementUsages } from './element-usage-resolver.js';
import type { GetReferencedByPage } from './element-usage-resolver.js';

export type { ElementUsageItemModel } from './element-usage-resolver.js';

type ReferrerKind = 'element' | 'media' | 'member';

/**
 * Wraps Umbraco's own "referenced by" Management API services as the page-fetcher
 * `iterateElementUsages` expects. These generated service methods throw on a non-2xx response
 * (the default `ThrowOnError` behavior — same as how the preview-url call in the modal element is
 * used) rather than returning a {data, error} tuple. A stale/broken relation shouldn't crash the
 * whole resolution, so this degrades gracefully (CLAUDE.md §7): a thrown error just tells the pure
 * resolver "nothing more here" by returning `undefined`, stopping that one branch, not the whole walk.
 */
const getReferencedByPage: GetReferencedByPage = async (kind: ReferrerKind, id: string, skip: number, take: number) => {
	const query = { skip, take };
	try {
		switch (kind) {
			case 'element':
				return (await ElementService.getElementByIdReferencedBy({ path: { id }, query })).data;
			case 'media':
				return (await MediaService.getMediaByIdReferencedBy({ path: { id }, query })).data;
			case 'member':
				return (await MemberService.getMemberByIdReferencedBy({ path: { id }, query })).data;
		}
	} catch (error) {
		// Logged, not swallowed silently: a stale/deleted relation degrading one branch of the walk
		// (CLAUDE.md §7) is expected and fine, but an implementer seeing "usages didn't show up" with
		// zero diagnostic trail is not. No user-facing content here — just the referrer kind/id, which
		// isn't sensitive (an internal Umbraco entity key).
		console.warn(`[ElementUsagePreview] Failed to fetch "referenced by" for ${kind} ${id}:`, error);
		return undefined;
	}
};

/**
 * Resolves every page an Element is used on by walking Umbraco's own, public "referenced by"
 * Management API endpoints (`ElementService.getElementByIdReferencedBy`, and the equivalent on
 * `MediaService`/`MemberService` for non-previewable referrers) — the exact same endpoints and
 * discriminated-union shape that back the Info workspace view's "where used" list.
 *
 * This *replaces* an earlier version of this file that called a custom backend controller wrapping
 * `ITrackedReferencesService` directly (CLAUDE.md §13). That approach worked, but reinvented a
 * type-discrimination step (Document vs. Element vs. Media vs. Member) that Umbraco's own
 * `IReferenceResponseModel` union already provides via its `$type` discriminator — right down to
 * per-culture variant/publish state. Calling Core's existing endpoints instead means: no custom
 * backend controller, no custom auth handling (this reuses the same generated, already-authenticated
 * client every other service call in the backoffice uses), and one less place this package's
 * behavior could drift from Core's own "where used" panel.
 *
 * The actual walk algorithm lives in `element-usage-resolver.ts` as a plain async generator taking
 * a page-fetcher callback, so it's unit-testable without Umbraco's live services (see that file's
 * `.test.ts` sibling) — this class just supplies the real one. It's a generator, not a function
 * returning a resolved array, specifically so a caller can consume just a handful of usages without
 * this repository (or Core) doing the work of resolving hundreds of them — see CLAUDE.md §21.
 */
export class ElementUsagePreviewRepository extends UmbRepositoryBase {
	constructor(host: UmbControllerHost) {
		super(host);
	}

	iterateUsages(elementKey: string) {
		return iterateElementUsages(elementKey, getReferencedByPage);
	}
}

export default ElementUsagePreviewRepository;
