import { manifests as workspaceActionManifests } from './workspace-action/manifests.js';
import { manifests as previewAppManifests } from './preview-app/manifests.js';
export const manifests = [
    ...workspaceActionManifests,
    ...previewAppManifests,
];
