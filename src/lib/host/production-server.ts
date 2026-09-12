/**
 * The production HTTP boundary in front of adapter-node, and what every host adapter starts.
 *
 * It counts raw fixed-length and chunked mutation bytes before SvelteKit actions, then forwards
 * bounded requests to a private ephemeral loopback adapter listener. `scripts/production-server.ts`
 * is a shim onto this module, because the installed LaunchAgents name that path.
 */
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type RequestListener,
  type ServerResponse
} from 'node:http';

const CLIENT_ADDRESS_HEADER = 'x-ongoing-client-address';

export function productionBodyLimit(value = process.env.BODY_SIZE_LIMIT): number {
  const limit = Number(value ?? '16384');
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('BODY_SIZE_LIMIT must be a positive integer');
  return limit;
}

export async function readBoundedBody(
  request: AsyncIterable<Uint8Array | string>,
  headers: IncomingMessage['headers'],
  limit: number
): Promise<Buffer | null> {
  const declared = headers['content-length'];
  if (Array.isArray(declared)) return null;
  if (declared !== undefined) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > limit) return null;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  let exceeded = false;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.byteLength;
    if (total > limit) {
      exceeded = true;
      chunks.length = 0;
    } else if (!exceeded) chunks.push(chunk);
  }
  if (exceeded) return null;
  return Buffer.concat(chunks, total);
}

function rejectTooLarge(request: IncomingMessage, response: ServerResponse): void {
  request.resume();
  response.writeHead(413, {
    'content-type': 'application/json',
    'x-content-type-options': 'nosniff',
    connection: 'close'
  });
  response.end('{"error":"Request body is too large"}');
}

function forward(
  incoming: IncomingMessage,
  response: ServerResponse,
  internalPort: number,
  body?: Buffer
): void {
  const headers = { ...incoming.headers };
  headers[CLIENT_ADDRESS_HEADER] = incoming.socket.remoteAddress ?? '127.0.0.1';
  if (body) {
    delete headers['transfer-encoding'];
    headers['content-length'] = String(body.byteLength);
  }
  const upstream = httpRequest(
    {
      hostname: '127.0.0.1',
      port: internalPort,
      method: incoming.method,
      path: incoming.url,
      headers
    },
    (upstreamResponse) => {
      const status = upstreamResponse.statusCode ?? 502;
      if (upstreamResponse.statusMessage)
        response.writeHead(status, upstreamResponse.statusMessage, upstreamResponse.headers);
      else response.writeHead(status, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    }
  );
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end('Bad Gateway');
  });
  response.on('close', () => upstream.destroy());
  if (body) upstream.end(body);
  else incoming.pipe(upstream);
}

export async function startProductionServer(): Promise<void> {
  const limit = productionBodyLimit();
  // The adapter trusts this header only on its private ephemeral loopback listener. The public
  // listener always overwrites it from the actual socket, preserving login rate limiting.
  process.env.ADDRESS_HEADER = CLIENT_ADDRESS_HEADER;
  const builtHandler = new URL('../../../build/handler.js', import.meta.url).href;
  const { handler } = (await import(builtHandler)) as { handler: RequestListener };
  const internal = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    internal.once('error', reject);
    internal.listen(0, '127.0.0.1', resolve);
  });
  const address = internal.address();
  if (!address || typeof address === 'string') throw new Error('internal adapter listener failed');

  const external = createServer(async (request, response) => {
    try {
      if (['GET', 'HEAD'].includes(request.method ?? 'GET')) {
        forward(request, response, address.port);
        return;
      }
      const body = await readBoundedBody(request, request.headers, limit);
      if (body === null) {
        rejectTooLarge(request, response);
        return;
      }
      forward(request, response, address.port, body);
    } catch {
      if (!response.headersSent) response.writeHead(400);
      response.end('Bad Request');
    }
  });
  external.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));

  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT || '3000');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error('PORT must be a valid TCP port');
  await new Promise<void>((resolve, reject) => {
    external.once('error', reject);
    external.listen(port, host, resolve);
  });
  console.log(`Listening on http://${host}:${port}`);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    external.close(() => internal.close(() => process.exit(0)));
    external.closeAllConnections();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (import.meta.main) await startProductionServer();
