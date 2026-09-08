import { useCallback } from 'react';
import type { WorkspaceCollabContext } from '@open-design/contracts';
import type { TrackingProjectCollectionPage } from '@open-design/contracts/analytics';

import { useAnalytics } from '../../analytics/provider';
import { trackWorkspaceProjectActionResult } from '../../analytics/events';
import { workspaceAnalyticsDimensions } from '../../analytics/workspace';
import type { Project } from '../../types';

export type ProjectDuplicateHandler = (id: string) => Promise<void> | void;

/**
 * 复制项目 from a card or a rail row: hands the id to the shell's duplicate
 * handler (which POSTs `/api/projects/:id/duplicate`, the same call
 * `od project duplicate` makes) and reports the outcome once, so both
 * surfaces tell one analytics story.
 */
export function useProjectDuplicateFlow(input: {
  onDuplicate?: ProjectDuplicateHandler;
  analyticsPage: TrackingProjectCollectionPage;
  workspaceContext: WorkspaceCollabContext | null | undefined;
}) {
  const { onDuplicate, analyticsPage, workspaceContext } = input;
  const analytics = useAnalytics();
  const duplicate = useCallback(async (project: Project): Promise<void> => {
    if (!onDuplicate) return;
    const startedAt = performance.now();
    const workspaceDimensions = workspaceAnalyticsDimensions(workspaceContext);
    try {
      await onDuplicate(project.id);
      trackWorkspaceProjectActionResult(analytics.track, {
        page_name: analyticsPage,
        area: 'project_collection',
        action: 'duplicate',
        result: 'success',
        requested_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        duration_ms: Math.round(performance.now() - startedAt),
        ...workspaceDimensions,
      });
    } catch (err) {
      console.warn('[useProjectDuplicateFlow] duplicate project failed:', err);
      trackWorkspaceProjectActionResult(analytics.track, {
        page_name: analyticsPage,
        area: 'project_collection',
        action: 'duplicate',
        result: 'failed',
        requested_count: 1,
        succeeded_count: 0,
        failed_count: 1,
        duration_ms: Math.round(performance.now() - startedAt),
        error_code: 'request_failed',
        ...workspaceDimensions,
      });
    }
  }, [analytics.track, analyticsPage, onDuplicate, workspaceContext]);
  return { duplicate };
}
