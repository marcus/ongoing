import { json } from '@sveltejs/kit';
import { relationKinds } from '$lib/domain/relation';
import { failure, readObject, resolveEntryRef } from '$lib/server/api/support';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  const entry = url.searchParams.get('entry');
  try {
    const entryId = entry ? resolveEntryRef(catalogRepository, entry).id : undefined;
    return json({
      relations: catalogRepository.listRelations({
        entryId,
        kind: url.searchParams.get('kind') ?? undefined
      }),
      kinds: relationKinds
    });
  } catch (error) {
    return failure(error, 'Unable to list relations');
  }
};

/**
 * Declares an edge. `from` and `to` name entries the way the CLI does — an id, `kind/slug`, or an
 * unambiguous slug — and the relation kind decides which entry kinds may sit at each end.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await readObject(request);
  if (body instanceof Response) return body;
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  const allowed = ['from', 'to', 'kind', 'evidence', 'provider', 'note', 'attributes'];
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    return json({ error: `Relations accept only ${allowed.join(', ')}` }, { status: 400 });
  if (typeof body.from !== 'string' || typeof body.to !== 'string' || typeof body.kind !== 'string')
    return json({ error: 'from, to, and kind are required' }, { status: 400 });
  try {
    const from = resolveEntryRef(catalogRepository, body.from);
    const to = resolveEntryRef(catalogRepository, body.to);
    const relation = await catalogRepository.addRelation({
      fromId: from.id,
      toId: to.id,
      kind: body.kind,
      evidence: body.evidence as 'declared' | 'detected' | undefined,
      provider: (body.provider as string | null | undefined) ?? null,
      note: (body.note as string | null | undefined) ?? null,
      attributes: (body.attributes as Record<string, never> | undefined) ?? {}
    });
    return json(relation, { status: 201 });
  } catch (error) {
    return failure(error, 'Unable to declare relation');
  }
};

/** Either `?id=` or the `from`, `to`, and `kind` triple that identifies a declared edge. */
export const DELETE: RequestHandler = async ({ url, request }) => {
  const { catalogRepository } = await import('$lib/server/scanning/runtime');
  let id = url.searchParams.get('id') ?? '';
  try {
    if (!id) {
      const body = await readObject(request);
      if (body instanceof Response) return body;
      if (typeof body.id === 'string') id = body.id;
      else {
        if (
          typeof body.from !== 'string' ||
          typeof body.to !== 'string' ||
          typeof body.kind !== 'string'
        )
          return json({ error: 'Pass id, or from, to, and kind' }, { status: 400 });
        const from = resolveEntryRef(catalogRepository, body.from);
        const to = resolveEntryRef(catalogRepository, body.to);
        const evidence = (body.evidence as string | undefined) ?? 'declared';
        const found = catalogRepository
          .listRelations({ entryId: from.id, kind: body.kind })
          .find(
            (relation) =>
              relation.fromId === from.id &&
              relation.toId === to.id &&
              relation.evidence === evidence
          );
        if (!found)
          return json(
            { error: `Unknown relation ID: ${from.slug} ${body.kind} ${to.slug}` },
            { status: 404 }
          );
        id = found.id;
      }
    }
    await catalogRepository.removeRelation(id);
    return json({ id, removed: true });
  } catch (error) {
    return failure(error, 'Unable to remove relation');
  }
};
