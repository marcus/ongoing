import { json } from '@sveltejs/kit';
import {
  createPageModel,
  parseDashboardQuery,
  readDashboardCatalog,
  readHiddenCatalog
} from '$lib/dashboard/catalog';
import { entryKinds, type AttributeValue } from '$lib/domain/entry';
import { runExportProfile } from '$lib/domain/export';
import { describeField, fieldAppliesTo } from '$lib/domain/fields';
import { relationKinds } from '$lib/domain/relation';
import { QueryError } from '$lib/domain/query';
import { websiteEligibility } from '$lib/domain/website';
import { CatalogDatabase } from '$lib/server/catalog/database';
import { readEntryView } from '$lib/server/catalog/entries';
import { readExportSource } from '$lib/server/catalog/export';
import { PruneBlockedError, pruneMissingProjects } from '$lib/server/catalog/prune';
import { CatalogRepository } from '$lib/server/catalog/repository';
import { localProjectActions, runProjectAction } from '$lib/server/projects/actions';
import { loadRuntimeConfig, type AppConfig } from '$lib/server/config';
import { activeProviderNames, describeProviders } from '$lib/server/providers/registry';
import { createScannerDependencies } from '$lib/server/scanning/dependencies';
import { ScanInProgressError, Scanner, type RefreshPolicy } from '$lib/server/scanning/scanner';
import { isEntriesPageError, readEntriesPage } from './entries';
import { failure, resolveEntryRef } from './support';

/**
 * The CLI's in-process transport (Decision 1).
 *
 * `ongoing` speaks HTTP when a service is answering and links the core library when nothing is, so
 * `ongoing scan` and `ongoing list` work on a machine with no daemon. Both paths go through the
 * same functions — `readEntriesPage`, the repository, the domain validators — so the two transports
 * cannot drift into disagreeing about what a request means.
 */
export interface LocalRequestInit {
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
}

export interface LocalApi {
  readonly config: AppConfig;
  request(path: string, init?: LocalRequestInit): Promise<Response>;
  close(): void;
}

type Handler = (context: {
  repository: CatalogRepository;
  config: AppConfig;
  parameter: (name: string) => string | null;
  params: string[];
  body: Record<string, unknown>;
  scan: () => Scanner;
}) => Promise<Response> | Response;

function notFound(path: string, method: string): Response {
  return json(
    {
      error: `${method} ${path} is not available without a running Ongoing service — start one, or pass --url.`
    },
    { status: 501 }
  );
}

const routes: { method: string; pattern: RegExp; handle: Handler }[] = [
  {
    method: 'GET',
    pattern: /^\/api\/health$/,
    handle: () => json({ ok: true })
  },
  {
    method: 'GET',
    pattern: /^\/api\/entries$/,
    handle: ({ repository, parameter }) => {
      try {
        const page = readEntriesPage(repository, parameter);
        return isEntriesPageError(page)
          ? json({ error: page.error }, { status: page.status })
          : json(page);
      } catch (error) {
        if (error instanceof QueryError) return json({ error: error.message }, { status: 400 });
        throw error;
      }
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/entries$/,
    handle: async ({ repository, body }) => {
      const kind = typeof body.kind === 'string' ? body.kind : '';
      if (!entryKinds.includes(kind as (typeof entryKinds)[number]))
        return json({ error: `kind must be one of ${entryKinds.join(', ')}` }, { status: 400 });
      if (kind === 'project')
        return json(
          { error: 'Projects are discovered, not created — run a scan over their directory' },
          { status: 400 }
        );
      if (typeof body.name !== 'string' || !body.name.trim())
        return json({ error: 'name is required' }, { status: 400 });
      const reserved = new Set(['kind', 'name', 'slug']);
      try {
        const entry = await repository.createEntry({
          kind,
          name: body.name,
          slug: typeof body.slug === 'string' ? body.slug : undefined,
          attributes: Object.fromEntries(
            Object.entries(body).filter(([key]) => !reserved.has(key))
          ) as Record<string, AttributeValue>
        });
        return json(readEntryView(repository, entry), { status: 201 });
      } catch (error) {
        return failure(error, 'Unable to create entry');
      }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/entries\/([^/]+)\/([^/]+)$/,
    handle: ({ repository, params }) => {
      const entry = repository.getEntryBySlug(params[0], params[1]);
      return entry
        ? json(readEntryView(repository, entry))
        : json({ error: `Unknown entry: ${params[0]}/${params[1]}` }, { status: 404 });
    }
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/entries\/([^/]+)\/([^/]+)$/,
    handle: async ({ repository, params, body }) => {
      const entry = repository.getEntryBySlug(params[0], params[1]);
      if (!entry)
        return json({ error: `Unknown entry: ${params[0]}/${params[1]}` }, { status: 404 });
      try {
        return json(readEntryView(repository, await repository.patchEntry(entry.id, body)));
      } catch (error) {
        return failure(error, 'Unable to update entry');
      }
    }
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/entries\/([^/]+)\/([^/]+)$/,
    handle: async ({ repository, params }) => {
      const entry = repository.getEntryBySlug(params[0], params[1]);
      if (!entry)
        return json({ error: `Unknown entry: ${params[0]}/${params[1]}` }, { status: 404 });
      if (entry.kind === 'project')
        return json(
          { error: 'Projects are forgotten through /api/projects, which guards a running scan' },
          { status: 400 }
        );
      try {
        await repository.deleteEntry(entry.id);
        return json({ entry: `${entry.kind}/${entry.slug}`, removed: true });
      } catch (error) {
        return failure(error, 'Unable to remove entry');
      }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/fields$/,
    handle: ({ repository, parameter }) => {
      const kind = parameter('kind');
      return json({
        fields: repository
          .registry()
          .fields.filter((field) => !kind || fieldAppliesTo(field, kind))
          .map(describeField)
      });
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/fields$/,
    handle: async ({ repository, body }) => {
      try {
        return json(describeField(await repository.addUserField(body)), { status: 201 });
      } catch (error) {
        return failure(error, 'Unable to register field');
      }
    }
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/fields$/,
    handle: async ({ repository, parameter, body }) => {
      const key = parameter('key') ?? (typeof body.key === 'string' ? body.key : '');
      if (!key) return json({ error: 'A field key is required' }, { status: 400 });
      try {
        await repository.removeUserField(key);
        return json({ key, removed: true });
      } catch (error) {
        return failure(error, 'Unable to remove field');
      }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/views$/,
    handle: ({ repository }) => json({ views: repository.listSavedViews() })
  },
  {
    method: 'POST',
    pattern: /^\/api\/views$/,
    handle: async ({ repository, body }) => {
      try {
        return json(await repository.saveView(body as never), { status: 201 });
      } catch (error) {
        return failure(error, 'Unable to save view');
      }
    }
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/views$/,
    handle: async ({ repository, parameter, body }) => {
      const name =
        parameter('view') ??
        (body.name as string | undefined) ??
        (body.id as string | undefined) ??
        '';
      if (!name) return json({ error: 'A view name is required' }, { status: 400 });
      try {
        await repository.deleteSavedView(name);
        return json({ view: name, removed: true });
      } catch (error) {
        return failure(error, 'Unable to delete view');
      }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/relations$/,
    handle: ({ repository, parameter }) => {
      const entry = parameter('entry');
      try {
        return json({
          relations: repository.listRelations({
            entryId: entry ? resolveEntryRef(repository, entry).id : undefined,
            kind: parameter('kind') ?? undefined
          }),
          kinds: relationKinds
        });
      } catch (error) {
        return failure(error, 'Unable to list relations');
      }
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/relations$/,
    handle: async ({ repository, body }) => {
      if (
        typeof body.from !== 'string' ||
        typeof body.to !== 'string' ||
        typeof body.kind !== 'string'
      )
        return json({ error: 'from, to, and kind are required' }, { status: 400 });
      try {
        return json(
          await repository.addRelation({
            fromId: resolveEntryRef(repository, body.from).id,
            toId: resolveEntryRef(repository, body.to).id,
            kind: body.kind,
            evidence: body.evidence as 'declared' | 'detected' | undefined,
            provider: (body.provider as string | null | undefined) ?? null,
            note: (body.note as string | null | undefined) ?? null,
            attributes: (body.attributes as Record<string, never> | undefined) ?? {}
          }),
          { status: 201 }
        );
      } catch (error) {
        return failure(error, 'Unable to declare relation');
      }
    }
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/relations$/,
    handle: async ({ repository, parameter, body }) => {
      let id = parameter('id') ?? (typeof body.id === 'string' ? body.id : '');
      try {
        if (!id) {
          if (
            typeof body.from !== 'string' ||
            typeof body.to !== 'string' ||
            typeof body.kind !== 'string'
          )
            return json({ error: 'Pass id, or from, to, and kind' }, { status: 400 });
          const from = resolveEntryRef(repository, body.from);
          const to = resolveEntryRef(repository, body.to);
          const evidence = (body.evidence as string | undefined) ?? 'declared';
          const found = repository
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
        await repository.removeRelation(id);
        return json({ id, removed: true });
      } catch (error) {
        return failure(error, 'Unable to remove relation');
      }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/providers$/,
    handle: ({ repository, config }) =>
      json({
        providers: describeProviders(repository, config),
        host: config.hostAdapter,
        configPath: config.configPath,
        generatedAt: new Date().toISOString()
      })
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects$/,
    handle: ({ repository, parameter }) => {
      const read = parameter('hidden') === 'true' ? readHiddenCatalog : readDashboardCatalog;
      const search = new URLSearchParams();
      for (const name of ['sort', 'dir', 'filter', 'view', 'stack', 'q']) {
        const value = parameter(name);
        if (value !== null) search.set(name, value);
      }
      return json(createPageModel(read(repository), parseDashboardQuery(search)));
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/projects\/prune$/,
    handle: async ({ repository, config, body }) => {
      try {
        return json(
          await pruneMissingProjects(repository, config, {
            dryRun: body.dryRun as boolean | undefined,
            graceDays: body.graceDays as number | undefined
          })
        );
      } catch (error) {
        if (error instanceof PruneBlockedError)
          return json({ error: error.message }, { status: 409 });
        return failure(error, 'Unable to prune projects');
      }
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/projects\/([^/]+)$/,
    handle: async ({ repository, params, body }) => {
      if (
        typeof body.action !== 'string' ||
        !localProjectActions.includes(body.action as (typeof localProjectActions)[number])
      )
        return json({ error: 'action must be finder or terminal' }, { status: 400 });
      try {
        await runProjectAction(
          repository,
          params[0],
          body.action as (typeof localProjectActions)[number]
        );
        return json({ id: params[0], action: body.action });
      } catch (error) {
        return failure(error, 'Unable to open project');
      }
    }
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/projects\/([^/]+)$/,
    handle: async ({ repository, params, body }) => {
      try {
        if (typeof body.note === 'string') await repository.updateNote(params[0], body.note);
        const decision = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'note'));
        if (Object.keys(decision).length)
          await repository.updateDecision(params[0], decision as never);
        return json({ id: params[0], ...body });
      } catch (error) {
        return failure(error, 'Unable to update project');
      }
    }
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/projects\/([^/]+)$/,
    handle: async ({ repository, params }) => {
      if (repository.getActiveScanRun())
        return json(
          { error: 'A catalog scan is running — try again once it finishes' },
          { status: 409 }
        );
      try {
        await repository.forgetProject(params[0]);
        return json({ id: params[0], forgotten: true });
      } catch (error) {
        return failure(error, 'Unable to forget project');
      }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/projects\/([^/]+)\/website$/,
    handle: ({ repository, params }) => {
      const project = repository.getProject(params[0]);
      return project
        ? json({ id: project.id, website: project.website })
        : json({ error: `Unknown project ID: ${params[0]}` }, { status: 404 });
    }
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/projects\/([^/]+)\/website$/,
    handle: async ({ repository, params, body }) => {
      try {
        return json({ id: params[0], website: await repository.updateWebsite(params[0], body) });
      } catch (error) {
        return failure(error, 'Unable to update website metadata');
      }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/website$/,
    handle: ({ repository, parameter }) =>
      json(
        runExportProfile('opentangle', readExportSource(repository), {
          drafts: parameter('drafts') === 'true'
        })
      )
  },
  {
    method: 'GET',
    pattern: /^\/api\/website\/pages$/,
    handle: ({ repository }) =>
      json(
        repository.listWebsitePages().map((website) => ({
          website,
          repositoryVisibility: null,
          ...websiteEligibility(website, null)
        }))
      )
  },
  {
    method: 'GET',
    pattern: /^\/api\/website\/pages\/([^/]+)$/,
    handle: ({ repository, params }) => {
      const website = repository.getWebsitePage(params[0]);
      return json({ website, repositoryVisibility: null, ...websiteEligibility(website, null) });
    }
  },
  {
    method: 'PATCH',
    pattern: /^\/api\/website\/pages\/([^/]+)$/,
    handle: async ({ repository, params, body }) => {
      try {
        const website = await repository.updateWebsitePage(params[0], body);
        return json({ website, repositoryVisibility: null, ...websiteEligibility(website, null) });
      } catch (error) {
        return failure(error, 'Unable to update website page');
      }
    }
  },
  {
    method: 'GET',
    pattern: /^\/api\/export$/,
    handle: ({ repository, parameter }) => {
      try {
        return json(
          runExportProfile(parameter('profile') ?? 'json', readExportSource(repository), {
            drafts: parameter('drafts') === 'true',
            kind: parameter('kind') ?? undefined
          })
        );
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : 'Export failed' },
          { status: 400 }
        );
      }
    }
  },
  {
    method: 'POST',
    pattern: /^\/api\/scan$/,
    handle: async ({ body, scan }) => {
      const projectId = body.projectId as string | undefined;
      const refresh = body.refresh as RefreshPolicy | undefined;
      try {
        // No daemon means nobody would finish the run, so the local transport waits for it.
        const result = await scan().scan({
          reason: projectId ? 'project' : 'manual',
          projectId,
          refresh
        });
        return json(result, { status: 202 });
      } catch (error) {
        if (error instanceof ScanInProgressError)
          return json({ error: error.message, runId: error.runId }, { status: 409 });
        return failure(error, 'Unable to start scan');
      }
    }
  }
];

/**
 * Opens the catalog in this process and answers the same requests the HTTP API answers. The caller
 * closes it; nothing here starts a scheduler, a listener, or a background timer.
 */
export function createLocalApi(env: Record<string, string | undefined> = process.env): LocalApi {
  const config = loadRuntimeConfig(env);
  const database = new CatalogDatabase(config.databasePath);
  const repository = new CatalogRepository(database, undefined, {
    providers: activeProviderNames(config)
  });
  let scanner: Scanner | null = null;

  return {
    config,
    async request(path, init = {}) {
      const method = (init.method ?? 'GET').toUpperCase();
      const [pathname] = path.split('?', 1);
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(init.query ?? {}))
        if (value !== undefined) search.set(key, value);
      const body =
        init.body && typeof init.body === 'object' && !Array.isArray(init.body)
          ? (init.body as Record<string, unknown>)
          : {};

      for (const route of routes) {
        if (route.method !== method) continue;
        const match = route.pattern.exec(pathname);
        if (!match) continue;
        try {
          return await route.handle({
            repository,
            config,
            parameter: (name) => search.get(name),
            params: match.slice(1).map((value) => decodeURIComponent(value)),
            body,
            scan: () =>
              (scanner ??= new Scanner(repository, config, createScannerDependencies(config)))
          });
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : 'The catalog could not be read' },
            { status: 500 }
          );
        }
      }
      return notFound(pathname, method);
    },
    close() {
      database.close();
    }
  };
}
