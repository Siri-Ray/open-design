// The hover preview card the rail's 最近项目 rows float beside themselves —
// the cover plate over the wrapped project name — and the cover pipeline that
// feeds it.
//
// Both halves are exported so the chat project switcher (WorkspaceTabsBar's
// dock dropdown) can show the SAME card for the same project (OPEND-2694:
// 顶部项目列表应与 Home 侧栏一致): one markup, one stylesheet block
// (`.entry-nav-rail__recent-preview*` in home/entry-layout.css), one cover
// decision. A second implementation would have drifted the moment either
// surface was tuned.
//
// The cover reuses the decision the projects grid renders
// (`lib/project-cover-cache`): the grid resolves a cover per (workspace,
// project, version) and stores it in a process-wide LRU, so a row usually has
// one already and paints instantly. When the cache misses — the user landed on
// a surface that never rendered the grid — the row resolves it once on hover
// with the cheap half of the grid's pipeline (files read +
// `selectProjectFileCover`) and writes the result back through the same key,
// so the grid inherits it too. Deliberately NOT ported: the grid's HEAD probe,
// deck-document preload and design-system special cases. Those exist to avoid
// a broken <img> in a large visible card; here a cover that fails to load
// simply falls back to the tinted glyph the same component already draws.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { WorkspaceCollabContext } from '@open-design/contracts';

import { fetchProjectFiles } from '../../providers/registry';
import { workspaceIdentityCacheKey } from '../../collab/workspace-identity';
import {
  getProjectCoverSnapshot,
  projectCoverSnapshotKey,
  setProjectCoverSnapshot,
} from '../../lib/project-cover-cache';
import {
  projectCoverUrl,
  selectProjectFileCover,
  type ProjectCoverOverride,
} from '../project-cover';
import type { Project } from '../../types';

/** `undefined` = not resolved yet; `null` = resolved, this project has none. */
type CoverState = ProjectCoverOverride | null | undefined;

export interface ProjectHoverCover {
  /** Resolve the cover once (cache-first); safe to call on every hover. */
  resolveCover: () => Promise<void>;
  coverSrc: string | null;
  showsImage: boolean;
  showsVideo: boolean;
}

/**
 * The cover behind one project's hover preview. The async resolve checks it is
 * still mounted before it sets state, so a row that leaves (the list re-sorts,
 * the rail closes) mid-read is simply dropped.
 */
export function useProjectHoverCover(
  project: Project,
  workspaceContext: WorkspaceCollabContext | null | undefined,
): ProjectHoverCover {
  const snapshotKey = projectCoverSnapshotKey(
    workspaceIdentityCacheKey(workspaceContext),
    project.id,
    project.updatedAt,
  );
  const [cover, setCover] = useState<CoverState>(
    () => getProjectCoverSnapshot(snapshotKey)?.cover,
  );
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  // A newer version of the project (rename, new content) misses the old key, so
  // the row drops back to unresolved and re-reads on the next hover.
  useEffect(() => {
    setCover(getProjectCoverSnapshot(snapshotKey)?.cover);
  }, [snapshotKey]);

  const resolveCover = useCallback(async () => {
    if (getProjectCoverSnapshot(snapshotKey) !== undefined) return;
    // An imported-folder project has no artifact of its own to show.
    if (project.metadata?.entryFile) {
      setProjectCoverSnapshot(snapshotKey, null);
      if (activeRef.current) setCover(null);
      return;
    }
    try {
      const files = await fetchProjectFiles(project.id, { workspaceContext });
      const next = selectProjectFileCover(files);
      setProjectCoverSnapshot(snapshotKey, next);
      if (activeRef.current) setCover(next);
    } catch {
      // Leave it unresolved: a failed read is not an authoritative "no cover",
      // and the next hover should be allowed to try again.
    }
  }, [project.id, project.metadata?.entryFile, snapshotKey, workspaceContext]);

  const coverSrc = cover
    ? projectCoverUrl(project.id, cover.name, cover.mtime, workspaceContext)
    : null;
  // `html` covers are documents, not pictures: the grid mounts a sandboxed frame
  // for those. A floating preview is not worth a second iframe per hover, so
  // only real media paints here and everything else takes the glyph.
  const showsImage = Boolean(coverSrc && (cover?.kind === 'image' || cover?.kind === 'logo'));
  const showsVideo = Boolean(coverSrc && cover?.kind === 'video');

  return { resolveCover, coverSrc, showsImage, showsVideo };
}

/**
 * The card itself: cover plate + the full name given room to wrap. Purely
 * informational — `aria-hidden`, no pointer events (the stylesheet) — so it can
 * never sit between the pointer and the row that spawned it. The caller owns
 * WHERE it goes (`style` carries the fixed top/left the row measured) and
 * portals it to <body>: inside the rail or the chat column it would stay behind
 * the content beside it whatever its z-index.
 */
export function ProjectHoverPreviewCard({
  project,
  cover,
  style,
  testId,
}: {
  project: Project;
  cover: Pick<ProjectHoverCover, 'coverSrc' | 'showsImage' | 'showsVideo'>;
  style: CSSProperties;
  testId?: string;
}) {
  const { coverSrc, showsImage, showsVideo } = cover;
  return (
    <div
      className="entry-nav-rail__recent-preview"
      style={style}
      aria-hidden
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <div className="entry-nav-rail__recent-preview-plate">
        {showsImage ? (
          <img src={coverSrc ?? ''} alt="" draggable={false} decoding="async" />
        ) : showsVideo ? (
          <video src={coverSrc ?? ''} muted playsInline preload="metadata" />
        ) : (
          <span className="entry-nav-rail__recent-preview-glyph" aria-hidden>
            {(Array.from(project.name.trim())[0] ?? '?').toUpperCase()}
          </span>
        )}
      </div>
      {/* The name the row had to ellipsize, given room to wrap — that is the
          whole job of this card. No timestamp line (per product: 时间去掉，最多
          两行名称): a hover preview answers "which project is this". */}
      <p className="entry-nav-rail__recent-preview-name">{project.name}</p>
    </div>
  );
}
