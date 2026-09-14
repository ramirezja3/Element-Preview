// `UmbExtensionManifest` (the type Core's own manifests.ts files use) is a global ambient type,
// not something to import — importing it from '@umbraco-cms/backoffice/extension-api' doesn't
// exist and fails typechecking (confirmed against the real 18.1.1 package). A precise union of
// this package's own manifest kinds is both correct and self-contained.
//
// `ManifestPreviewAppProvider` itself has no importable path either — it's declared in
// `dist-cms/packages/core/extension-registry/extensions/preview-app.extension.d.ts`, which isn't
// re-exported by any of the package's public subpath exports (confirmed: not in `./extension-api`,
// not in `./extension-registry`, not in `./preview`), and `moduleResolution: "Bundler"` enforces
// the package's `exports` map, so a deep relative import into that file isn't resolvable either.
// The shape is confirmed instead by reading Core's own compiled
// `packages/preview/preview-apps/manifests.js` (`{ type, alias, name, element, weight }`) and by
// inspecting a live entry in `umbExtensionsRegistry` at runtime — see
// `preview-app/manifests.ts` for that verification. Declared locally here for the same reason
// `ManifestModal`'s union member was previously kept self-contained.
import type { ManifestWorkspaceAction } from '@umbraco-cms/backoffice/workspace';
import { manifests as workspaceActionManifests } from './workspace-action/manifests.js';
import { manifests as previewAppManifests } from './preview-app/manifests.js';
import type { ManifestPreviewAppProvider } from './preview-app/manifests.js';

export const manifests: Array<ManifestWorkspaceAction | ManifestPreviewAppProvider> = [
	...workspaceActionManifests,
	...previewAppManifests,
];
