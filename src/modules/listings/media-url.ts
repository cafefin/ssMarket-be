/** `listings/a/b.webp` -> `listings/a/b_thumb.webp` */
export function thumbnailKey(storageKey: string): string {
  return storageKey.replace(/\.webp$/, '_thumb.webp');
}

/**
 * The path the browser uses for a stored file. It goes through the
 * frontend's /api proxy like every other request.
 */
export function mediaUrl(storageKey: string): string {
  return `/api/media/${storageKey}`;
}
