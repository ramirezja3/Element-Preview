import { ELEMENT_USAGE_PREVIEW_PREVIEW_APP_ALIAS } from '../constants.js';
/**
 * Weight 500 — one step above Core's own "Fit browser" device-switcher control
 * (`Umb.PreviewApps.Device`, weight 400, confirmed by reading Core's compiled
 * `preview-apps/manifests.js`). Preview-toolbar controls render in descending-weight order
 * (confirmed empirically elsewhere in this package, CLAUDE.md §18/§20), so this renders
 * immediately to its left — exactly where the user asked for the Next/Previous control to sit.
 */
export const manifests = [
    {
        type: 'previewApp',
        alias: ELEMENT_USAGE_PREVIEW_PREVIEW_APP_ALIAS,
        name: 'Element Preview Nav',
        element: () => import('./element-usage-preview-nav.element.js'),
        weight: 500,
    },
];
