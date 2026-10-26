/**
 * The one place a `ProjectDisplayStatus` becomes a glyph — and the one place
 * the two surfaces that list projects (the rail's 最近项目 rows and the project
 * switcher above the chat) get their shared marks from, so they can never tell
 * different stories about the same project.
 *
 * A run that was interrupted is a static badge; a run still moving — or paused
 * on a question the user has to answer — is the same rotating orb in a
 * different colour, so the row reads as one object changing state rather than
 * a handful of unrelated icons. The split is "is it still going", not "did it
 * go well": spinning a stopped run's orb is the one thing this component must
 * never do, because the rotation itself is what says "working".
 *
 * Speed carries no distinction: everything that is live — queued, running
 * and awaiting a reply alike — turns at the same rate, so a colour change
 * never reads as a change of pace (P0-24: queued draws running's spinner).
 *
 * A FINISHED run is not a glyph in the lead slot at all (OPEND-3133): the row
 * keeps the folder every idle project leads with (`ProjectFolderGlyph`) and
 * says "done, unread" with a small dot at its END (`ProjectCompletionDot`),
 * which opening the project spends. `hasRunStatusGlyph` / `hasCompletionNotice`
 * are the two questions a caller asks to pick between the three.
 *
 * Returns `null` for `not_started` and `succeeded`, which draw nothing here.
 * Callers must still reserve the slot so names stay aligned; that is the
 * caller's layout concern, not this component's.
 */
import type { ProjectDisplayStatus } from '@open-design/contracts';
import tagStyles from './ProjectRunStatusIcon.module.css';
import { Icon } from './Icon';
import { SiriOrb } from './SiriOrb';

/**
 * Awaiting a reply: still live, but it is the user's move.
 *
 * A three-step warm ramp, ordered by the role each slot plays rather than by
 * hue: orange is the base, amber the second accent AND the outer bloom, gold
 * the narrow specular glint. Lightness climbs across them — OKLCH L 75.2 →
 * 83.1 → 85.0 — so the brightest slot is the one that draws the highlight,
 * which is what makes the dot read as a sphere at 14px.
 *
 * Gold in `c5` is what buys the glint back: `literal` bans the stock white
 * highlights because screen-blending white raises this accent's mid green
 * channel into yellow, but a lighter tone named outright is a colour the
 * design chose, not one the compositor invented.
 *
 * `literal` is not optional here. Without it the orb edits whatever it is
 * given — three slots still hold green, and the highlight, saturation and
 * texture passes each push a mid-channel accent off its hue. Not theoretical:
 * this palette came out green, then yellow, then red as each was found.
 */
const ATTENTION = { c1: '#FF8D02', c2: '#EDC337', c5: '#FFC400' };

/**
 * P0-24 设计答复(2026-10-26,清单 3.1「以设计稿为准」):失败「用新的红色球,不用红色
 * 感叹号」,有新结果「也改成蓝色球,无标签」。取值逐项照抄设计稿 OD-状态设计-20261015
 * 渲染后的计算值:
 *  · 失败(`.entry-nav-rail__failed-orb`):c1 #F34801 / c2 #FF6038 / c5 #FFE6DF,
 *    底色 #F34801,**不**走 literal(保留默认的高光与饱和度),网格层只做模糊;
 *  · 新结果(`r:icon:p2`):literal,三个槽位都是 #578EFF,即单色蓝球。
 * 两者都是结果,所以是**静止**的球(PRD:失败标记静止),只有执行中、等回答在转。
 */
const FAILURE = { c1: '#F34801', c2: '#FF6038', c5: '#FFE6DF', fill: '#F34801' };
const NEW_RESULT = { c1: '#578EFF' };

/**
 * Whether this status puts a glyph in the row's LEAD slot.
 *
 * Callers need to know BEFORE rendering: when this says no, the slot holds the
 * folder (`ProjectFolderGlyph`) instead, so the column is never empty and
 * names stay on one edge. `succeeded` answers no on purpose — a finished run
 * keeps the folder and reports through {@link hasCompletionNotice} instead.
 */
export function hasRunStatusGlyph(status: ProjectDisplayStatus | undefined): boolean {
  return status !== undefined && status !== 'not_started';
}

/**
 * Whether this status is a finished run the user has not looked at yet: the
 * one case that draws the unread dot at the row's END (`ProjectCompletionDot`)
 * rather than a glyph in its lead slot.
 *
 * The "not looked at yet" half is the store's, not this function's: the shared
 * run-status feed (`useProjectRunStatuses`) drops a `succeeded` the user has
 * acknowledged by opening the project, so a caller never sees it here. One
 * store, one rule, both surfaces.
 */
export function hasCompletionNotice(_status: ProjectDisplayStatus | undefined): boolean {
  // P0-24 设计答复:有新结果改为行首的蓝色球(见 `ProjectRunStatusIcon`),行尾不再出蓝点。
  return false;
}

/**
 * Whether the row shows the visible 「需要你回复」 tag after the project name
 * (P0-24 display rule ①; assumption A-09 for its look). The orb in the lead
 * slot stays; the tag is what says it in words, not only to assistive tech.
 */
export function hasAwaitingReplyTag(status: ProjectDisplayStatus | undefined): boolean {
  return status === 'awaiting_input';
}

/**
 * The visible 「需要你回复」 tag (P0-24, test case X21 / OPEND-4216). The shape
 * is shared; each surface adds its own spacing class and test id, as with
 * {@link ProjectCompletionDot}.
 */
export function ProjectAwaitingReplyTag({
  className,
  label,
  testId,
}: {
  className?: string;
  /** Localized status name, shown as the tag's text. */
  label: string;
  testId: string;
}) {
  return (
    <span
      className={className ? `${tagStyles.replyTag} ${className}` : tagStyles.replyTag}
      data-testid={testId}
    >
      {label}
    </span>
  );
}

interface Props {
  status: ProjectDisplayStatus;
  size?: number;
  /** Localized status name, announced to assistive tech. */
  label?: string;
}

/**
 * The glyph a project leads with when it has nothing live to report
 * (OPEND-3129): the folder — the same mark the workspace tab strip and the
 * switcher trigger already draw for a project tab.
 *
 * ONE component for both surfaces that list projects — the rail's 最近项目
 * rows and the project switcher above the chat — for the same reason those two
 * share `ProjectRunStatusIcon`: an idle project must look like one and the same
 * thing wherever the user finds it. The first pass at this unified the two on
 * a chat-bubble mark; product and design settled on the folder instead, so
 * both slots now draw this. Pairs with `hasRunStatusGlyph`: callers draw this
 * exactly when that says there is no live status to draw — a finished, unread
 * run included, which keeps the folder and adds `ProjectCompletionDot`.
 *
 * `currentColor` through `Icon`, so each slot keeps its own ink — the rail
 * row's, hover included, and the switcher's muted text. `size` likewise: each
 * slot keeps the box it always had.
 */
export function ProjectFolderGlyph({ size = 14 }: { size?: number }) {
  return <Icon name="folder" size={size} data-testid="project-folder-glyph" />;
}

/**
 * "Finished, and you have not looked yet" (OPEND-3133): a 6px disc in the
 * design's blue at the END of the row — `margin-left: auto` in the caller's
 * stylesheet, so it sits on the row's right edge whatever the name's length.
 * The folder stays in the lead slot; this is a notice beside the name, not a
 * replacement for the glyph, which is why it is not a `ProjectRunStatusIcon`
 * case.
 *
 * Announced as the finished status it stands for (`role="img"` + the
 * localized label), the way the lead-slot glyphs are, so a screen reader
 * hears "Completed" here exactly as it did when this was a ✓. The caller
 * names the class and test id because each surface's stylesheet and specs
 * address it by their own convention; the shape and the semantics are shared.
 */
export function ProjectCompletionDot({
  className,
  label,
  testId,
}: {
  className: string;
  /** Localized status name, announced to assistive tech. */
  label: string;
  testId: string;
}) {
  return (
    <span
      className={className}
      role="img"
      aria-label={label}
      title={label}
      data-testid={testId}
    />
  );
}

export function ProjectRunStatusIcon({ status, size = 14, label }: Props) {
  switch (status) {
    case 'succeeded':
      // A finished run the user has not opened yet: the static blue ball in the
      // lead slot (P0-24 design reply). The store drops it once acknowledged.
      return <SiriOrb size={size} state="still" colors={NEW_RESULT} literal label={label} />;
    case 'failed':
    case 'canceled':
    case 'incomplete':
      // P0-24 design reply: the red ball, still — not the red exclamation mark.
      return <SiriOrb size={size} state="still" colors={FAILURE} filterMode="blur" label={label} />;
    case 'running':
      return <SiriOrb size={size} state="thinking" label={label} />;
    case 'queued':
      // P0-24 (PRD scenario A2, product answer P4): a queued run draws the same
      // spinner as a running one — the sidebar says "not finished yet", and
      // whether it has started is not a distinction the row makes. The label
      // still names it (排队中) for the tooltip and assistive tech.
      return <SiriOrb size={size} state="thinking" label={label} />;
    case 'awaiting_input':
      // Running's speed, deliberately (per product). A pending question is not
      // a paused run — the agent is live and the work is mid-flight, so the
      // orb keeps working; colour alone carries "your move". Slowing it here
      // would say "stalled", which is what `queued` means.
      return <SiriOrb size={size} state="thinking" colors={ATTENTION} literal label={label} />;
    case 'not_started':
      return null;
    default:
      return null;
  }
}
