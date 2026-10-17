/**
 * Sanitize package description that may contain HTML or markdown.
 * Some npm packages incorrectly put README content in the description field.
 */
export function sanitizeDescription(description: string | null | undefined): string {
  if (!description || typeof description !== 'string') {
    return '';
  }

  let text = description.trim();
  if (!text) return '';

  // Strip HTML tags
  text = text.replace(/<[^>]*>/g, ' ');

  // Strip markdown images ![alt](url)
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  // Collapse multiple spaces/newlines and trim
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}
