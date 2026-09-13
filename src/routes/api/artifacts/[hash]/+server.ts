import { error, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ params, request }) => {
  try {
    const { attachmentService } = await import('$lib/server/scanning/runtime');
    const digest = params.hash;
    if (!digest) error(404, 'Artifact not found');
    const bytes = await attachmentService.artifacts.read(digest);
    const etag = `"sha256-${digest}"`;
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers: { etag } });
    const type = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : 'application/json';
    return new Response(new Blob([new Uint8Array(bytes)]), {
      headers: {
        'content-type': type,
        'cache-control': 'public, max-age=31536000, immutable',
        etag
      }
    });
  } catch {
    error(404, 'Artifact not found');
  }
};
