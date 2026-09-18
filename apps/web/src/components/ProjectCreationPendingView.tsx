import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { DesignSystemSummary } from '@open-design/contracts';

import { AgentIcon } from './AgentIcon';
import { assistantRoleNameForAgent } from './AssistantMessage';
import { AvatarMenu } from './AvatarMenu';
import { ChatComposer } from './ChatComposer';
import { DesignSystemPicker } from './DesignSystemPicker';
import { Icon } from './Icon';
import { ChatHistoryGlyph } from './chat/ChatHistoryGlyph';
import { chatSeam } from './chat/ChatRoot';
import historyDockStyles from './chat/ConversationHistoryDock.module.css';
import { ExecutionShell } from './chat/ExecutionShell';
import { useWorkspaceTabsDockRef } from './workspaceTabsDock';
import { useI18n } from '../i18n';
import { formatAttachmentSize, splitFileName } from '../runtime/chat/attachment';
import type { ExecutionShell as ExecutionShellData } from '../runtime/chat/contract';
import { looksLikeImageName } from '../runtime/chat/staged-attachment';
import type { AgentInfo, AppConfig } from '../types';
import { agentIconId } from '../utils/agentLabels';
import {
  projectSplitStyle,
  readSavedChatPanelWidth,
  resolveProjectSplitLayout,
  workspacePanelTrackForMinWidth,
  writeProjectSplitLayout,
} from './project-split-layout';
import styles from './ProjectCreationPendingView.module.css';

/**
 * What the frame needs to draw the SAME chrome ProjectView will draw
 * (OPEND-3334): the agent's display name for the role row, and the inputs of
 * the two composer accessories — the agent/model menu and the design-system
 * picker — so the inert composer has the real one's geometry. Everything is
 * optional so a caller that lacks it still gets a frame; it then differs from
 * the real view exactly where the input was missing.
 */
export interface PendingChromeInputs {
  agentName?: string | null;
  config?: AppConfig | null;
  agents?: readonly AgentInfo[];
  daemonLive?: boolean;
  designSystems?: readonly DesignSystemSummary[];
  designSystemId?: string | null;
}

interface Props extends PendingChromeInputs {
  projectName: string;
  prompt: string;
  /** The files the user staged on Home. Still local `File` objects here. */
  files?: readonly File[];
  agentId?: string | null;
}

/**
 * The execution-record shell of a turn that has started and produced nothing
 * yet — exactly what the first real frame draws for the auto-sent first
 * message (`build-turn-blocks` opens a running shell with no items). The frame
 * renders the real `ExecutionShell` on it so the "Working" head, its orb and
 * its geometry are the component's own, not a copy.
 */
const PENDING_SHELL: ExecutionShellData = {
  kind: 'shell',
  id: 'creation-pending',
  status: 'running',
  stopped: false,
  thinking: false,
  elapsedMs: null,
  quietMs: null,
  items: [],
  segments: [],
};

const noop = () => undefined;

/** One staged file, resolved to everything the card needs without a request. */
interface PendingAttachmentCard {
  key: string;
  base: string;
  ext: string;
  size: string | null;
  kind: 'image' | 'file';
}

const ensureNoPendingProject = () => Promise.resolve(null);
const ignorePendingComposerAction = () => undefined;
const makePendingComposerInert = (node: HTMLElement | null) => {
  // React 18's DOM runtime drops the boolean `inert` attribute even though
  // current React typings expose it. Set the standards-based attribute on the
  // node so keyboard focus is blocked as well as pointer interaction.
  node?.setAttribute('inert', '');
};

/** Object URL for an image card, or null where unavailable (e.g. jsdom). */
function createPreviewUrl(file: File): string | null {
  try {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    return URL.createObjectURL(file);
  } catch {
    // Hardened/older contexts: fall back to the doc card's grey plate.
    return null;
  }
}

function revokePreviewUrl(url: string): void {
  try {
    URL.revokeObjectURL?.(url);
  } catch {
    // Already revoked, or unsupported — nothing to clean up.
  }
}

interface ChatProps extends PendingChromeInputs {
  projectName: string;
  prompt: string;
  /** The files the user staged on Home. Still local `File` objects here. */
  files?: readonly File[];
  agentId?: string | null;
}

/**
 * The hand-off's chat card: the project title, the prompt the user just
 * typed (with its staged files), the assistant row the real view draws first
 * (role + a running execution record, "Working"), and the real ChatComposer
 * made inert. `ProjectCreationPendingView` draws it as
 * the chat column of the whole pending frame; ProjectView draws the very same
 * card on top of its chat column while the first transcript settles
 * (`creationHandoff`, OPEND-2170), so the column never switches to another
 * loading form between the create answering and the auto-sent turn painting.
 *
 * Read-free like the frame around it: everything here is already in this tab.
 */
export function ProjectCreationPendingChat({
  projectName,
  prompt,
  files,
  agentId,
  agentName: agentNameInput,
  config,
  agents,
  daemonLive = false,
  designSystems,
  designSystemId,
}: ChatProps) {
  const { t } = useI18n();
  // Same resolution the real role row uses (`assistantRoleName`), fed the
  // agent's catalogue name, so "Mock Agent" is "Mock Agent" on both sides.
  const agentName = assistantRoleNameForAgent(agentNameInput, agentId) ?? t('assistant.role');
  const iconId = agentIconId(agentId, agentNameInput ?? undefined);

  const cards = useMemo<PendingAttachmentCard[]>(() => {
    const staged = files ?? [];
    return staged.map((file, index) => {
      const { base, ext } = splitFileName(file.name);
      return {
        key: `${index}:${file.name}`,
        base,
        ext,
        size: formatAttachmentSize(file.size),
        kind: looksLikeImageName(file.name, file.type) ? 'image' as const : 'file' as const,
      };
    });
  }, [files]);

  // Image cards preview the staged file itself; the upload has not happened
  // yet, so there is no project raw URL to point at. Creation and revocation
  // are paired inside one `files`-keyed effect (the StrictMode-safe shape from
  // DesignSystemAssetDropzone): the cleanup revokes exactly the URLs its own
  // setup created, so StrictMode's simulated unmount cannot leave a memoized
  // list of dead blob: links for the remount to hand to <img>.
  const [previewUrls, setPreviewUrls] = useState<ReadonlyArray<string | null>>([]);
  useEffect(() => {
    const next = (files ?? []).map((file) =>
      looksLikeImageName(file.name, file.type) ? createPreviewUrl(file) : null,
    );
    setPreviewUrls(next);
    return () => {
      for (const url of next) if (url) revokePreviewUrl(url);
    };
  }, [files]);

  return (
    <div
      className={`pane ${styles.chatPane}`}
      data-testid="project-creation-pending-chat"
      data-creation-handoff=""
    >
      {/* No project-name header: the name is shown once, in the switcher
          docked above this card, exactly as the real chat card it hands off
          to (OPEND-3128). */}
      <div className="chat-log-wrap">
        <div className="chat-log" aria-busy="true">
          {prompt || cards.length > 0 ? (
            <div className="msg user">
              {/* Attachments above, bubble below, right edges aligned —
                  the same `.msg-stack` the transcript uses. */}
              <div className="msg-stack">
                {cards.length > 0 ? (
                  <div className="msg-att-wrap">
                    <div
                      className="user-attachments msg-att"
                      data-testid="pending-attachment-row"
                    >
                      {cards.map((card, index) => (card.kind === 'image' && previewUrls[index] ? (
                        <span key={card.key} className="msg-att-img">
                          <span className="msg-att-ph">
                            <img className="msg-att-mini" src={previewUrls[index] ?? undefined} alt="" />
                          </span>
                        </span>
                      ) : (
                        <span key={card.key} className="msg-att-doc">
                          <Icon name="file" size={15} className="msg-att-fi" />
                          <span className="msg-att-tx">
                            <span className="msg-att-nm">
                              <span className="msg-att-base">{card.base}</span>
                              {card.ext ? (
                                <span className="msg-att-ext">{card.ext}</span>
                              ) : null}
                            </span>
                            <span className="msg-att-meta">{card.size ?? ''}</span>
                          </span>
                        </span>
                      )))}
                    </div>
                  </div>
                ) : null}
                {prompt ? (
                  <div className="user-text-wrap">
                    <div className="user-text user-bubble">{prompt}</div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="msg assistant" data-continuation="false">
            <div className="role" data-testid="assistant-role">
              <AgentIcon id={iconId} size={20} className="role-agent-icon" />
              <span className="role-name">{agentName}</span>
            </div>
            <div className="assistant-flow" data-testid="assistant-flow">
              {/* The real view's first frame: an execution record that is
                  running and has nothing to show yet. Same component, so the
                  hand-off swaps like for like (OPEND-3334). */}
              <ExecutionShell shell={PENDING_SHELL} />
            </div>
          </div>
        </div>
      </div>
      <div
        className={`chat-composer-slot ${styles.pendingComposer}`}
        data-testid="pending-chat-composer-shell"
        ref={makePendingComposerInert}
        aria-disabled="true"
      >
        <ChatComposer
          projectId={null}
          projectFiles={[]}
          streaming={false}
          sendDisabled
          inputDisabled
          composerPlaceholder={t('chat.composerPlaceholder')}
          onEnsureProject={ensureNoPendingProject}
          onSend={ignorePendingComposerAction}
          onStop={ignorePendingComposerAction}
          /* The two accessories ProjectView hands its composer: the palette
             (design-system picker) and the agent/model menu. Rendered with
             the same components so the row has the real geometry; the whole
             slot is inert, so none of them can act. */
          designSystemPicker={designSystems ? (
            <DesignSystemPicker
              variant="home"
              designSystems={designSystems as DesignSystemSummary[]}
              selectedId={designSystemId ?? null}
              disabled
              onChange={noop}
            />
          ) : undefined}
          footerAccessory={config && agents ? (
            <AvatarMenu
              config={config}
              agents={agents as AgentInfo[]}
              daemonLive={daemonLive}
              onModeChange={noop}
              onAgentChange={noop}
              onAgentModelChange={noop}
              onOpenSettings={noop}
              onRefreshAgents={() => agents as AgentInfo[]}
            />
          ) : undefined}
        />
      </div>
    </div>
  );
}

/**
 * Immediate, read-free handoff shown while POST /api/projects is still
 * settling. It deliberately mirrors the first ProjectView frame without
 * mounting ProjectView itself: an optimistic project has not been authorized
 * or persisted yet, so no project-owned API, SSE, file, or presence reads may
 * start from this surface.
 *
 * "Read-free" is about the network, not about the screen. Everything this
 * frame draws is already in this tab: the project name and prompt the user
 * just typed, the workspace tab strip App already renders, and the staged
 * files — which are `File` objects the picker handed us, so their thumbnails
 * come from `URL.createObjectURL`, not from `/api/projects/:id/raw`.
 *
 * The layout is copied from the frame that replaces it (ProjectView's split,
 * ChatPane's header and user message, DesignFilesPanel's empty state) so the
 * hand-off does not re-flow the page. Where a control cannot work yet it is
 * rendered disabled rather than omitted — an omitted control moves everything
 * next to it, which is exactly the jump this frame is here to avoid.
 *
 * The composer at the bottom is the real ChatComposer made inert: the frame
 * already looks like the project the user is about to land in, and
 * ProjectView's own composer takes over in place once the id is confirmed.
 */
export function ProjectCreationPendingView({
  projectName,
  prompt,
  files,
  agentId,
  ...chrome
}: Props) {
  const { t } = useI18n();
  // Same registry ProjectView uses, so WorkspaceTabsBar portals the real strip
  // above the chat card here too and the chrome row stays collapsed across the
  // hand-off instead of rising for one frame.
  const tabsDockRef = useWorkspaceTabsDockRef();

  // OPEND-3207 · this frame and the ProjectView that replaces it must show
  // the chat column at the same width, or the column moves at the hand-off.
  // Both resolve it through `resolveProjectSplitLayout`: the saved width
  // first (already in the inline style below, so even the pre-measure paint
  // is right), else the equal split of the measured container.
  const splitRef = useRef<HTMLDivElement | null>(null);
  const savedChatPanelWidth = useMemo(readSavedChatPanelWidth, []);
  useLayoutEffect(() => {
    const split = splitRef.current;
    if (!split) return undefined;
    const apply = (options: { animate?: boolean } = {}) => {
      const layout = resolveProjectSplitLayout(split.clientWidth, savedChatPanelWidth);
      writeProjectSplitLayout(split, layout.chatPanelWidth, layout.workspacePanelTrack, options);
    };
    // Settle the first write without the `.split` transition; the
    // `clientWidth` read has already committed the provisional inline width.
    apply({ animate: false });
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => apply());
      observer.observe(split);
      return () => observer.disconnect();
    }
    const onWindowResize = () => apply();
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [savedChatPanelWidth]);

  // The `.app` shell belongs to App.tsx, which wraps this view and ProjectView
  // in the same element so React reconciles one `div.app` across the hand-off
  // instead of mounting a second one and replaying its entrance animation.
  return (
    <>
      <div
        ref={splitRef}
        className={`split ${styles.split}`}
        style={projectSplitStyle(
          false,
          savedChatPanelWidth.width,
          workspacePanelTrackForMinWidth(
            resolveProjectSplitLayout(0, savedChatPanelWidth).workspacePanelMinWidth,
          ),
        )}
        data-testid="project-creation-pending-view"
      >
        <div className="split-chat-slot">
          {/* Workspace tab-strip dock, identical to ProjectView's. */}
          <div
            className="split-chat-tabs-dock"
            data-testid="workspace-tabs-dock"
            ref={tabsDockRef}
          >
            {/* The conversation-history control ChatPane portals here once it
                mounts; the frame draws its footprint so the row does not gain a
                button at the hand-off. */}
            <div className={historyDockStyles.dock} data-testid="pending-chat-history-dock">
              <div {...chatSeam()}>
                <div className="chat-history-wrap chat-session-switcher">
                  <button
                    type="button"
                    className="chat-session-trigger icon-only"
                    disabled
                    tabIndex={-1}
                    aria-hidden="true"
                  >
                    <ChatHistoryGlyph />
                  </button>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="split-chat-collapse"
              disabled
              tabIndex={-1}
              aria-hidden="true"
            >
              <Icon name="panel-left" size={16} />
            </button>
          </div>
          <ProjectCreationPendingChat
            projectName={projectName}
            prompt={prompt}
            files={files}
            agentId={agentId}
            {...chrome}
          />
        </div>
        <div className="split-resize-handle" aria-hidden="true" />
        {/* Inert, not disabled: DesignFilesPanel draws these pills live, and a
            disabled look would flip to live at the hand-off (OPEND-3334). */}
        <section
          className={`workspace ${styles.workspace}`}
          aria-label={t('designFiles.title')}
          ref={makePendingComposerInert}
        >
          <div className="ws-tabs-shell">
            <div className="ws-tabs-bar" role="tablist" aria-label={t('designFiles.title')}>
              <div
                className="ws-tab design-files-tab active"
                role="tab"
                aria-selected="true"
              >
                <span className="tab-icon" aria-hidden="true">
                  <Icon name="grid" size={14} />
                </span>
                <span className="ws-tab-label">{t('designFiles.title')}</span>
              </div>
            </div>
            <span className={styles.addIcon} aria-hidden="true">
              <Icon name="plus" size={16} />
            </span>
          </div>
          {/* DesignFilesPanel's own shell and empty pill, so the sentence sits
              in the same place before and after the hand-off. */}
          <div className="df-panel">
            <div className="df-main">
              <div className="df-topbar">
                <div className="df-topbar-left">
                  <nav className="df-breadcrumbs" aria-label={t('designFiles.crumbs')}>
                    <span className="df-breadcrumb-current">{t('designFiles.crumbs')}</span>
                  </nav>
                </div>
                <div className="df-topbar-right" />
              </div>
              <div className="df-body">
                <div className="df-empty" data-testid="pending-design-files-empty">
                  <div className="df-empty-pill">
                    <span className="df-empty-title">{t('designFiles.empty')}</span>
                    <div className="df-empty-actions">
                      <button type="button" className="df-empty-cta df-empty-cta-primary" tabIndex={-1}>
                        <Icon name="pencil" size={13} />
                        <span>{t('designFiles.newSketch')}</span>
                      </button>
                      <button type="button" className="df-empty-cta df-empty-cta-doc" tabIndex={-1}>
                        <Icon name="file" size={13} />
                        <span>{t('designFiles.newDocument')}</span>
                      </button>
                      <button type="button" className="df-empty-cta df-empty-cta-upload" tabIndex={-1}>
                        <Icon name="upload" size={13} />
                        <span>{t('designFiles.upload.label')}</span>
                      </button>
                      <button type="button" className="df-empty-cta df-empty-cta-secondary" tabIndex={-1}>
                        <Icon name="globe" size={13} />
                        <span>{t('workspace.newBrowser')}</span>
                      </button>
                      <button type="button" className="df-empty-cta df-empty-cta-tertiary" tabIndex={-1}>
                        <Icon name="blocks" size={14} />
                        <span>{t('dsManager.createTitle')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
