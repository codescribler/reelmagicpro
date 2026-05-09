// Pure helpers for pulling the source video URL and a sensible filename
// out of a Veo match page. Kept dependency-free so they can be unit-tested
// without spinning up Electron.

// Veo embeds the source URL in JSON inside <script> tags, where forward
// slashes are escaped (`https:\/\/c.veo.co\/...`). Normalising upfront lets
// a single regex match both raw HTML and JSON-encoded forms.
function unescape(html: string): string {
  return html.replace(/\\\//g, '/');
}

// First URL whose path ends in `video.mp4`. Anchored on `/video.mp4` (with
// optional query) so we don't accidentally pick up segment manifests.
export function extractVeoVideoUrl(html: string): string | null {
  const m = unescape(html).match(/https?:\/\/[^\s"'<>\\]+?\/video\.mp4(?:\?[^\s"'<>\\]*)?/);
  return m ? m[0] : null;
}

export function extractPageTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  return decodeHtmlEntities(m[1]!.trim());
}

// Strip trailing " | Veo" / " - Veo" / em-dash variants so the filename
// reads as the match name rather than the page title.
export function stripSiteSuffix(title: string): string {
  return title.replace(/\s*[|–—\-]\s*Veo(?:\s+Football)?\s*$/i, '').trim();
}

// Windows is the strictest filesystem we ship to (`< > : " / \ | ? *` plus
// control chars), so we sanitise to that. Cap length so paths stay within
// MAX_PATH limits even when the Downloads folder is deeply nested.
export function sanitizeFilename(s: string): string {
  return s
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
