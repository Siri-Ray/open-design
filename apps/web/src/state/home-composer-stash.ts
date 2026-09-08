/**
 * Hand-off slot for Home composer attachments across the optimistic project
 * surface.
 *
 * Sending from Home unmounts `HomeView` the moment the optimistic project
 * route takes over, so the staged `File` objects (which cannot live in the
 * persisted prompt draft) would be lost if the create later fails. App
 * stashes them here while rolling back to Home; the next `HomeView` mount
 * takes them back into its staged-file band so the user can retry with the
 * same payload. The slot holds one hand-off at a time and is emptied on read.
 */
let stashedAttachments: File[] | null = null;

export function stashHomeComposerAttachments(files: readonly File[]): void {
  stashedAttachments = files.length > 0 ? [...files] : null;
}

export function takeHomeComposerAttachments(): File[] {
  const files = stashedAttachments ?? [];
  stashedAttachments = null;
  return files;
}
