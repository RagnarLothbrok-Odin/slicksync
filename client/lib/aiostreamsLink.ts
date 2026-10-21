// "Open in AIOStreams": AIOStreams' apps (2.37+, desktop and Android) open
// aiostreams://item/<id>?server=<address> links to a title's page. The id is
// AIOStreams' own item id, which it builds from the title's id rather than
// storing (the same layout as server/providers/jellyfin.js encodePackedId):
// 16 bytes - 0xa1, kind and id type, media type, a 48-bit number, season and
// episode (0xffff for none), version. The address is the server's API base,
// the one the app saved and SlickSync signs in to.

const KIND = { movie: 1, series: 2 } as const;
const ID_TYPES = ['', 'tt', 'tmdb:', 'tvdb:', 'kitsu:', 'mal:', 'anilist:', 'anidb:'];

export function aioStreamsItemId(titleId: string, type: 'movie' | 'series'): string | null {
  const m = /^(tt|tmdb:|tvdb:|kitsu:|mal:|anilist:|anidb:)(\d+)$/.exec(String(titleId || ''));
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isSafeInteger(n) || n > 2 ** 48 - 1) return null;
  const bytes = new Uint8Array(16);
  bytes[0] = 0xa1;
  bytes[1] = (KIND[type] << 4) | ID_TYPES.indexOf(m[1]);
  bytes[2] = type === 'movie' ? 1 : 2;
  let rest = n;
  for (let i = 8; i >= 3; i--) { bytes[i] = rest % 256; rest = Math.floor(rest / 256); }
  bytes[9] = 0xff; bytes[10] = 0xff; bytes[11] = 0xff; bytes[12] = 0xff;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildAioStreamsAppUrl(server: string, titleId: string, type: 'movie' | 'series'): string | null {
  const id = aioStreamsItemId(titleId, type);
  return id ? `aiostreams://item/${id}?server=${encodeURIComponent(server)}` : null;
}
