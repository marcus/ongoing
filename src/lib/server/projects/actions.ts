import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { CatalogRepository } from '$lib/server/catalog/repository';
import { isPathWithinRoots } from '$lib/server/collectors/discover';

export const localProjectActions = ['finder', 'terminal'] as const;
export type LocalProjectAction = (typeof localProjectActions)[number];

export interface ProjectActionRunner {
  (command: readonly string[]): Promise<void>;
}

const systemRunner: ProjectActionRunner = async (command) => {
  const process = Bun.spawn([...command], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    const message = await new Response(process.stderr).text();
    throw new Error(message.trim() || `Project action exited with status ${exitCode}`);
  }
};

export async function runProjectAction(
  repository: CatalogRepository,
  projectId: string,
  action: LocalProjectAction,
  options: { platform?: NodeJS.Platform; runner?: ProjectActionRunner } = {}
): Promise<void> {
  const project = repository.getProject(projectId);
  if (!project) throw new Error(`Unknown project ID: ${projectId}`);

  const canonicalPath = await realpath(project.canonicalPath);
  const info = await stat(canonicalPath);
  if (!info.isDirectory() || !isAbsolute(canonicalPath))
    throw new Error('Project path is not an available directory');
  if (!isPathWithinRoots(canonicalPath, [project.scanRoot]))
    throw new Error('Project path is outside its validated scan root');

  const platform = options.platform ?? process.platform;
  const command =
    platform === 'darwin'
      ? action === 'finder'
        ? ['open', canonicalPath]
        : ['open', '-a', 'Terminal', canonicalPath]
      : action === 'finder'
        ? ['xdg-open', canonicalPath]
        : ['x-terminal-emulator', '--working-directory', canonicalPath];
  await (options.runner ?? systemRunner)(command);
}
