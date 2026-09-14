import { UMB_WORKSPACE_CONDITION_ALIAS } from '@umbraco-cms/backoffice/workspace';
import { UMB_ENTITY_IS_NOT_TRASHED_CONDITION_ALIAS } from '@umbraco-cms/backoffice/recycle-bin';
import { UMB_ELEMENT_WORKSPACE_ALIAS, UMB_ELEMENT_USER_PERMISSION_CONDITION_ALIAS, UMB_USER_PERMISSION_ELEMENT_UPDATE, } from '@umbraco-cms/backoffice/element';
import { ELEMENT_USAGE_PREVIEW_WORKSPACE_ACTION_ALIAS } from '../constants.js';
const workspaceAction = {
    type: 'workspaceAction',
    kind: 'default',
    alias: ELEMENT_USAGE_PREVIEW_WORKSPACE_ACTION_ALIAS,
    name: 'Save And Preview Element Workspace Action',
    // Sits to the LEFT of Save (CLAUDE.md §5), mirroring the real Document workspace's own
    // left-to-right order: "Save and preview" | "Save" | "Save and publish" — the workspace action
    // bar sorts by DESCENDING weight, so a higher weight renders further left (confirmed against
    // the real 18.1.1 bundle: Document's own three actions declare weights 90/80/70 respectively).
    // Element's own "Save" workspace action declares no explicit weight in its manifest at all, and
    // no "kind" manifest supplies one either — querying the live extension registry
    // (`umbExtensionsRegistry.getAllExtensions()`) confirms its raw manifest has no `weight` key —
    // yet it still renders ahead of any explicit weight below ~2000-10000 in practice, so its
    // *effective* weight is set by something this package's build-time tooling can't introspect
    // (most likely a runtime default baked into Core's submit-workspace-action base class). Rather
    // than guess, this was bisected empirically against the real running backoffice: weight 1000
    // still lost to Save; weight 10000 reliably won. If a future Core release changes that default,
    // re-verify this the same way — load the Element workspace, check DOM order live — rather than
    // trusting this number to still be correct.
    weight: 10000,
    api: () => import('./element-usage-preview.action.js'),
    meta: {
        label: 'Save and preview',
        look: 'secondary',
    },
    conditions: [
        {
            alias: UMB_WORKSPACE_CONDITION_ALIAS,
            match: UMB_ELEMENT_WORKSPACE_ALIAS,
        },
        {
            // Update, matching Core's own real Element Save action exactly (confirmed against source,
            // CLAUDE.md §3a) — this action's `execute()` calls `super.execute()`, which saves the
            // Element via `requestSubmit()`. Gating on Read only (an earlier draft of this manifest did)
            // would let a read-only user see an enabled button that silently fails server-side, instead
            // of the button correctly not appearing for them at all.
            alias: UMB_ELEMENT_USER_PERMISSION_CONDITION_ALIAS,
            allOf: [UMB_USER_PERMISSION_ELEMENT_UPDATE],
        },
        {
            alias: UMB_ENTITY_IS_NOT_TRASHED_CONDITION_ALIAS,
        },
    ],
};
export const manifests = [workspaceAction];
