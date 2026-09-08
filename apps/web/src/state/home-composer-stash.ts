/**
 * Hand-off slot for Home composer attachments across the optimistic project
 * surface.
 *
 * Sending from Home unmounts `HomeView` the moment the optimistic project
 * route takes over, so the staged `File` objects (which cannot live in the
 * persisted prompt draft) would be lost if the create later fails. App
 * stashes them here while rolling back to Home. Two consumers exist because
 * Home may or may not be mounted at that moment:
 *
 * - a `HomeView` that mounts afterwards takes the slot in its state
 *   initializer (the stay-on-pending-until-failure path);
 * - a `HomeView` that is already mounted — the user pressed Back on the
 *   pending frame while the create was still in flight — hears
 *   `HOME_COMPOSER_ATTACHMENTS_EVENT` and takes the slot right away.
 *
 * The slot holds one hand-off at a time and is emptied on read, so whichever
 * consumer runs first wins and the other sees nothing.
 */
export const HOME_COMPOSER_ATTACHMENTS_EVENT = 'open-design:home-composer:attachments';

let stashedAttachments: File[] | null = null;

export function stashHomeComposerAttachments(files: readonly File[]): void {
  stashedAttachments = files.length > 0 ? [...files] : null;
  if (stashedAttachments && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(HOME_COMPOSER_ATTACHMENTS_EVENT));
  }
}

export function takeHomeComposerAttachments(): File[] {
  const files = stashedAttachments ?? [];
  stashedAttachments = null;
  return files;
}
