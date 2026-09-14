import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iterateElementUsages } from './element-usage-resolver.js';
import type { ElementUsageItemModel, GetReferencedByPage, ReferrerKind } from './element-usage-resolver.js';
import type { IReferenceResponseModel } from '@umbraco-cms/backoffice/external/backend-api';

// Pure-logic tests for the transitive usage-resolution walk (CLAUDE.md §5a/§14/§21) — no live
// Umbraco dependency. `GetReferencedByPage` is faked directly, so these exercise the one part of
// this package that isn't just "call an Umbraco endpoint and hand back the result": deciding when
// to stop at a Document versus keep walking, not looping forever if the graph has a cycle, and
// (§21) not doing more work than the caller actually asked for.
// Run with: node --test repository/element-usage-resolver.test.ts

function document(id: string, name: string, published: boolean | null = true): IReferenceResponseModel {
	return {
		$type: 'DocumentReferenceResponseModel',
		id,
		name,
		published,
		documentType: { id: 'dt', icon: 'icon-document', name: 'Page' },
		variants: [],
	} as IReferenceResponseModel;
}

function elementRef(id: string, name: string): IReferenceResponseModel {
	return { $type: 'ElementReferenceResponseModel', id, name, published: null, documentType: { id: 'et' }, variants: [] } as IReferenceResponseModel;
}

function mediaRef(id: string, name: string): IReferenceResponseModel {
	return { $type: 'MediaReferenceResponseModel', id, name, mediaType: { id: 'mt' } } as IReferenceResponseModel;
}

/** Builds a fake page-fetcher from a fixed map of `kind:id` -> items. Missing keys return an empty page. */
function fakeFetcher(byId: Record<string, Array<IReferenceResponseModel>>, onFetch?: (kind: ReferrerKind, id: string) => void): GetReferencedByPage {
	return async (kind: ReferrerKind, id: string) => {
		onFetch?.(kind, id);
		const items = byId[`${kind}:${id}`] ?? [];
		return { total: items.length, items };
	};
}

/** Pulls up to `count` items from the generator (fewer if it finishes first). */
async function take(gen: AsyncGenerator<ElementUsageItemModel, void, void>, count: number): Promise<Array<ElementUsageItemModel>> {
	const out: Array<ElementUsageItemModel> = [];
	for (let i = 0; i < count; i++) {
		const { value, done } = await gen.next();
		if (done) break;
		out.push(value);
	}
	return out;
}

/** Drains the generator completely — only safe for small, finite test fixtures. */
async function drain(gen: AsyncGenerator<ElementUsageItemModel, void, void>): Promise<Array<ElementUsageItemModel>> {
	return take(gen, Number.MAX_SAFE_INTEGER);
}

test('direct Document referrers are previewable', async () => {
	const pageA = document('page-a', 'Page A', true);
	const pageB = document('page-b', 'Page B', false);
	const fetcher = fakeFetcher({ 'element:el-1': [pageA, pageB] });

	const items = await drain(iterateElementUsages('el-1', fetcher));

	assert.equal(items.length, 2);
	assert.ok(items.every((item) => item.isPreviewable));
	assert.ok(items.some((item) => item.key === 'page-a' && item.isPublished === true));
	assert.ok(items.some((item) => item.key === 'page-b' && item.isPublished === false));
});

test('nested Element referrer resolves through to the page that uses it', async () => {
	const fetcher = fakeFetcher({
		'element:el-1': [elementRef('el-2', 'Nested Element')],
		'element:el-2': [document('page-1', 'Page')],
	});

	const items = await drain(iterateElementUsages('el-1', fetcher));

	assert.equal(items.length, 1);
	assert.equal(items[0]?.key, 'page-1');
	assert.equal(items[0]?.isPreviewable, true);
});

test('referrer with no previewable ancestor is surfaced, not dropped', async () => {
	const fetcher = fakeFetcher({
		'element:el-1': [mediaRef('media-1', 'Orphaned Media')],
		// nothing references the media item — 'media:media-1' has no entry, so the fetcher returns empty.
	});

	const items = await drain(iterateElementUsages('el-1', fetcher));

	assert.equal(items.length, 1);
	assert.equal(items[0]?.isPreviewable, false);
	assert.ok(items[0]?.unresolvedReason);
});

test('a content-type property reference is surfaced with its own reason, not recursed into', async () => {
	const propertyRef: IReferenceResponseModel = {
		$type: 'DocumentTypePropertyTypeReferenceResponseModel',
		id: 'dt-1',
		name: 'Some Document Type',
		documentType: { id: 'dt-1' },
	} as IReferenceResponseModel;
	const fetcher = fakeFetcher({ 'element:el-1': [propertyRef] });

	const items = await drain(iterateElementUsages('el-1', fetcher));

	assert.equal(items.length, 1);
	assert.equal(items[0]?.isPreviewable, false);
	assert.match(items[0]?.unresolvedReason ?? '', /property configuration/);
});

test('reference cycle does not loop forever', async () => {
	// el-1 references el-2, el-2 references el-1 right back.
	const fetcher = fakeFetcher({
		'element:el-1': [elementRef('el-2', 'Other Element')],
		'element:el-2': [elementRef('el-1', 'Back to the original')],
	});

	const items = await drain(iterateElementUsages('el-1', fetcher));

	// Nothing previewable is reachable through the cycle, so the other Element in it is surfaced
	// as a non-previewable dead end (not dropped) — the important assertion is that this returns
	// at all, rather than recursing back into el-1 forever.
	assert.equal(items.length, 1);
	assert.equal(items[0]?.isPreviewable, false);
});

test('a failed page fetch degrades gracefully instead of throwing', async () => {
	const fetcher: GetReferencedByPage = async () => undefined;

	const items = await drain(iterateElementUsages('el-1', fetcher));

	assert.deepEqual(items, []);
});

test('pulling fewer items than exist does not fetch or recurse into referrers beyond what was asked for', async () => {
	// 3 real Document referrers, plus a 4th referrer that would recurse into a "poisoned" branch —
	// one whose own fetch would throw if ever queried. Pulling only the first 3 items must never
	// reach it: proof this is genuinely incremental (CLAUDE.md §21), not eager-resolve-then-slice
	// with the poison branch just placed conveniently last.
	const poisonedFetcher: GetReferencedByPage = async (kind, id) => {
		if (id === 'poison') {
			throw new Error('should never be queried — pulled fewer items than this branch would require');
		}
		const byId: Record<string, Array<IReferenceResponseModel>> = {
			'element:el-1': [document('page-0', 'Page 0'), document('page-1', 'Page 1'), document('page-2', 'Page 2'), elementRef('poison', 'Never touched')],
		};
		return { total: (byId[`${kind}:${id}`] ?? []).length, items: byId[`${kind}:${id}`] ?? [] };
	};

	const items = await take(iterateElementUsages('el-1', poisonedFetcher), 3);

	assert.equal(items.length, 3);
	assert.deepEqual(items.map((i) => i.key), ['page-0', 'page-1', 'page-2']);
	// No assertion needed beyond reaching here without throwing — the poisoned branch would have
	// thrown synchronously the moment it was queried, failing this test.
});

test('resuming a partially-drained generator continues from where it left off, not from the start', async () => {
	const fetchedIds: Array<string> = [];
	const fetcher = fakeFetcher(
		{ 'element:el-1': Array.from({ length: 5 }, (_, i) => document(`page-${i}`, `Page ${i}`)) },
		(_kind, id) => fetchedIds.push(id),
	);

	const gen = iterateElementUsages('el-1', fetcher);
	const firstBatch = await take(gen, 2);
	const secondBatch = await take(gen, 2);

	assert.deepEqual(firstBatch.map((i) => i.key), ['page-0', 'page-1']);
	assert.deepEqual(secondBatch.map((i) => i.key), ['page-2', 'page-3']);
	// The underlying "referenced by" endpoint was only ever asked about the root Element once —
	// resuming the generator replays no work, it just picks the loop back up mid-iteration.
	assert.deepEqual(fetchedIds, ['el-1']);
});
