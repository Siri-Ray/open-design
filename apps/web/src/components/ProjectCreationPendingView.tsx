import { useEffect, useState } from 'react';

import { AgentIcon } from './AgentIcon';
import { ChatComposer } from './ChatComposer';
import { Icon } from './Icon';
import { useI18n } from '../i18n';
import { agentDisplayName, agentIconId } from '../utils/agentLabels';
import styles from './ProjectCreationPendingView.module.css';

interface Props {
  projectName: string;
  prompt: string;
  /** Home composer attachments that will upload once the project exists. */
  attachments?: readonly File[];
  agentId?: string | null;
  onBack: () => void;
}

const EMPTY_ATTACHMENTS: readonly File[] = [];
const ensureNoPendingProject = () => Promise.resolve(null);
const ignorePendingComposerAction = () => undefined;
const makePendingComposerInert = (node: HTMLDivElement | null) => {
  // React 18's DOM runtime drops the boolean `inert` attribute even though
  // current React typings expose it. Set the standards-based attribute on the
  // node so keyboard focus is blocked as well as pointer interaction.
  node?.setAttribute('inert', '');
};

function attachmentKind(file: File): 'image' | 'file' {
  return file.type.startsWith('image/') ? 'image' : 'file';
}

/** Object URL for an image chip, or null where unavailable (e.g. jsdom). */
function createPreviewUrl(file: File): string | null {
  try {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

function revokePreviewUrl(url: string): void {
  try {
    URL.revokeObjectURL?.(url);
  } catch {
    /* no-op */
  }
}

/**
 * Immediate, read-free handoff shown while POST /api/projects is still
 * settling. It deliberately mirrors the first ProjectView frame without
 * mounting ProjectView itself: an optimistic project has not been authorized
 * or persisted yet, so no project-owned API, SSE, file, or presence reads may
 * start from this surface.
 *
 * Everything it shows comes from the creation record itself (name, prompt,
 * staged attachments), so the surface renders on the very tick the request is
 * sent and does not depend on the optimistic row surviving a project-list
 * refresh. The composer at the bottom is the real ChatComposer made inert:
 * the frame already looks like the project the user is about to land in, and
 * ProjectView's own composer takes over in place once the id is confirmed.
 */
export function ProjectCreationPendingView({
  projectName,
  prompt,
  attachments = EMPTY_ATTACHMENTS,
  agentId,
  onBack,
}: Props) {
  const { t } = useI18n();
  const agentName = agentDisplayName(agentId) ?? t('assistant.role');
  const iconId = agentIconId(agentId);
  // Image chips preview the staged file itself; the upload has not happened
  // yet, so there is no project raw URL to point at. Creation and revocation
  // are paired inside one `attachments`-keyed effect (the StrictMode-safe
  // shape from DesignSystemAssetDropzone): the cleanup revokes exactly the
  // URLs its own setup created, so StrictMode's simulated unmount cannot leave
  // a memoized list of dead blob: links for the remount to hand to <img>.
  const [previewUrls, setPreviewUrls] = useState<ReadonlyArray<string | null>>([]);
  useEffect(() => {
    const next = attachments.map((file) =>
      attachmentKind(file) === 'image' ? createPreviewUrl(file) : null,
    );
    setPreviewUrls(next);
    return () => {
      for (const url of next) if (url) revokePreviewUrl(url);
    };
  }, [attachments]);

  // The `.app` shell belongs to App.tsx, which wraps this view and ProjectView
  // in the same element so React reconciles one `div.app` across the hand-off
  // instead of mounting a second one and replaying its entrance animation.
  return (
    <>
      <div className={`split ${styles.split}`} data-testid="project-creation-pending-view">
        <div className="split-chat-slot">
          <div className={`pane ${styles.chatPane}`}>
            <div className="chat-project-header">
              <button
                type="button"
                className="chat-project-back"
                onClick={onBack}
                title={t('project.backToProjects')}
                aria-label={t('project.backToProjects')}
              >
                <Icon name="arrow-left" size={16} />
              </button>
              <span className="chat-project-header-title">
                <span className="chat-project-title-line">
                  <span className="title" data-testid="pending-project-title">
                    {projectName}
                  </span>
                </span>
              </span>
            </div>
            <div className="chat-log-wrap">
              <div className="chat-log" aria-busy="true">
                {prompt || attachments.length > 0 ? (
                  <div className="msg user">
                    {attachments.length > 0 ? (
                      <div
                        className="user-attachments"
                        data-testid="pending-user-attachments"
                      >
                        {attachments.map((file, index) => {
                          const kind = attachmentKind(file);
                          const previewUrl = previewUrls[index] ?? null;
                          return (
                            <button
                              type="button"
                              key={`${file.name}:${file.size}:${index}`}
                              className={`user-attachment staged-${kind}`}
                              disabled
                              title={file.name}
                            >
                              <span
                                className="staged-order"
                                aria-label={`Attachment ${index + 1}`}
                              >
                                {index + 1}
                              </span>
                              {previewUrl ? (
                                <img src={previewUrl} alt={file.name} />
                              ) : (
                                <Icon name="file" size={14} />
                              )}
                              <span className="staged-name">{file.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {prompt ? (
                      <div className="user-text-wrap">
                        <div className="user-text user-bubble">{prompt}</div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="msg assistant">
                  <div className="role">
                    <AgentIcon id={iconId} size={20} className="role-agent-icon" />
                    <span className="role-name">{agentName}</span>
                  </div>
                  <div className="assistant-flow">
                    <div
                      className="assistant-footer"
                      data-streaming="true"
                      data-last="true"
                    >
                      <span className="dot" data-active="true" />
                      <span className="assistant-label shimmer-text shimmer-prepare">
                        {t('assistant.statusPreparing')}
                      </span>
                    </div>
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
              />
            </div>
          </div>
        </div>
        <div className="split-resize-handle" aria-hidden="true" />
        <section className={`workspace ${styles.workspace}`} aria-label={t('designFiles.title')}>
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
          <div className={styles.workspaceBody}>
            <span className={styles.workspaceTitle}>{t('designFiles.crumbs')}</span>
            <span className={styles.workspaceEmpty}>{t('designFiles.empty')}</span>
          </div>
        </section>
      </div>
    </>
  );
}
