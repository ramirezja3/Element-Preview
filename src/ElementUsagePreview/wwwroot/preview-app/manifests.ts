import { ELEMENT_USAGE_PREVIEW_PREVIEW_APP_ALIAS } from '../constants.js';

/**
 * Minimal local shape for Core's `previewApp` extension type — see the note in the root
 * `manifests.ts` for why this isn't imported from `@umbraco-cms/backoffice` directly. Confirmed
 * against a live entry in `umbExtensionsRegistry` (`Umb.PreviewApps.Device`, the "Fit browser"
 * control), which returned exactly `{ type, alias, name, element, weight }` with no `meta` or
 * `elementName` — this scaffold's control needs nothing beyond that either.
 */
export interface ManifestPreviewAppProvider {
	type: 'previewApp';
	alias: string;
	name: string;
	element: () => Promise<{ default: CustomElementConstructor } | { element: CustomElementConstructor }>;
	weight: number;
}

/**
 * Weight 500 — one step above Core's own "Fit browser" device-switcher control
 * (`Umb.PreviewApps.Device`, weight 400, confirmed by reading Core's compiled
 * `preview-apps/manifests.js`). Preview-toolbar controls render in descending-weight order
 * (confirmed empirically elsewhere in this package, CLAUDE.md §18/§20), so this renders
 * immediately to its left — exactly where the user asked for the Next/Previous control to sit.
 */
export const manifests: Array<ManifestPreviewAppProvider> = [
	{
		type: 'previewApp',
		alias: ELEMENT_USAGE_PREVIEW_PREVIEW_APP_ALIAS,
		name: 'Element Preview Nav',
		element: () => import('./element-usage-preview-nav.element.js'),
		weight: 500,
	},
];
