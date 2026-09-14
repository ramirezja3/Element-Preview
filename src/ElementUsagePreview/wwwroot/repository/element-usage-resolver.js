// Defensive backstop against runaway fan-out or a reference cycle — not a real product limit,
// just a ceiling so one pathological Element can't hang the backoffice. Mirrors the same guard
// the original C# resolver used (CLAUDE.md §13) before this moved client-side.
const MAX_NODES_VISITED = 2000;
const MAX_RECURSION_DEPTH = 25;
// How many raw "referenced by" records to fetch from Core per network round-trip. Deliberately
// independent of however many *resolved* usages a caller actually wants (CLAUDE.md §21) — this is
// cheap relation metadata, not the expensive part. The expensive part (classifying/recursing into
// each one) only happens as the caller actually pulls items out of the generator below.
const PAGE_SIZE = 100;
function describeUnresolved(type) {
    switch (type) {
        case 'ElementContainerReferenceResponseModel':
            return 'This usage is a Library folder, not a page.';
        case 'DocumentTypePropertyTypeReferenceResponseModel':
        case 'MediaTypePropertyTypeReferenceResponseModel':
        case 'MemberTypePropertyTypeReferenceResponseModel':
            return "This Element is referenced from a content type's property configuration, not from a page.";
        default:
            return "This usage isn't on a page that can be previewed.";
    }
}
/**
 * Walks Umbraco's "referenced by" endpoints transitively, starting from an Element, yielding every
 * previewable Document (or non-previewable dead end, surfaced rather than dropped — CLAUDE.md §5a)
 * that directly or indirectly uses it.
 *
 * This is an async generator, not a function that returns a resolved list, and that's deliberate
 * (CLAUDE.md §21): an Element can plausibly be referenced by hundreds of pages, and the old
 * eager-resolve-then-slice design (still in git history) walked the *entire* reference graph before
 * returning anything, even if the caller only wanted the first page's worth. A generator only does
 * the work — including any recursion into non-Document referrers — up to wherever the caller has
 * actually pulled to via `.next()`; nothing beyond that point is fetched or classified. Consumers
 * that want a fixed batch just call `.next()` that many times (see the modal element's prefetch
 * logic) rather than draining the whole thing up front.
 *
 * See CLAUDE.md §5a/§14/§21 for the full design; this is the pure algorithm, independent of which
 * concrete service supplies each page of results, so it's unit-testable without Umbraco's live
 * services — see the `.test.ts` sibling.
 */
export async function* iterateElementUsages(elementKey, getReferencedByPage) {
    const visited = new Set([elementKey]);
    yield* walkRecursive('element', elementKey, 0, getReferencedByPage, visited);
}
async function* walkRecursive(kind, id, depth, getReferencedByPage, visited) {
    if (depth >= MAX_RECURSION_DEPTH || visited.size >= MAX_NODES_VISITED)
        return;
    let currentSkip = 0;
    while (true) {
        const page = await getReferencedByPage(kind, id, currentSkip, PAGE_SIZE);
        if (!page)
            return;
        for (const item of page.items) {
            if (visited.has(item.id))
                continue;
            visited.add(item.id);
            if (visited.size > MAX_NODES_VISITED)
                return;
            yield* resolveOne(item, depth, getReferencedByPage, visited);
        }
        currentSkip += PAGE_SIZE;
        if (currentSkip >= page.total)
            break;
    }
}
async function* resolveOne(item, depth, getReferencedByPage, visited) {
    if (item.$type === 'DocumentReferenceResponseModel') {
        yield {
            key: item.id,
            name: item.name ?? null,
            contentTypeIcon: item.documentType?.icon ?? null,
            contentTypeName: item.documentType?.name ?? null,
            isPublished: item.published ?? null,
            isPreviewable: true,
            unresolvedReason: null,
        };
        return;
    }
    const nestedKind = item.$type === 'ElementReferenceResponseModel'
        ? 'element'
        : item.$type === 'MediaReferenceResponseModel'
            ? 'media'
            : item.$type === 'MemberReferenceResponseModel'
                ? 'member'
                : undefined;
    if (nestedKind) {
        // Not previewable on its own — keep walking to find what references *this*. Only surface
        // this node itself as a dead end if that walk finds nothing previewable through it either
        // (otherwise we'd double-report: once for the real page, once for the intermediate node).
        // Streamed via yield*, so a nested branch with many results doesn't need to be buffered in
        // memory to make this decision — only a single boolean flag does.
        let foundAny = false;
        for await (const nestedUsage of walkRecursive(nestedKind, item.id, depth + 1, getReferencedByPage, visited)) {
            foundAny = true;
            yield nestedUsage;
        }
        if (foundAny)
            return;
    }
    // Either a container/property-type reference, or a nested Element/Media/Member whose own
    // referrer chain never reached a Document. Surface it rather than drop it, so the editor isn't
    // left wondering why this list's count doesn't match the Info view.
    yield {
        key: item.id,
        name: item.name ?? null,
        contentTypeIcon: null,
        contentTypeName: null,
        isPublished: null,
        isPreviewable: false,
        unresolvedReason: describeUnresolved(item.$type),
    };
}
