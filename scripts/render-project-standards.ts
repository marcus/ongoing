/**
 * Regenerate the `project-standards` skill's language and tool tables from the radar.
 *
 * The skill used to hand-maintain both. They are now views of the catalog: the language table is
 * every `kind = language` technology in ring order, and the tool table is every technology that
 * carries a `tool_surface`. The generator only ever rewrites what is between the markers, so the
 * prose around them stays exactly as written.
 *
 *   bun run scripts/render-project-standards.ts              # rewrite the skill in place
 *   bun run scripts/render-project-standards.ts --check      # fail if it would change anything
 *   ongoing tech export | bun run scripts/render-project-standards.ts --input -
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TechnologyExport, TechnologyExportEntry } from '../src/lib/domain/technology';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_TARGET = join(homedir(), '.claude/skills/project-standards/SKILL.md');

interface Block {
  name: string;
  render: (technologies: readonly TechnologyExportEntry[]) => string[];
}

const BLOCKS: readonly Block[] = [
  {
    name: 'languages',
    render: (technologies) => [
      '| Language | Ring | When |',
      '|---|---|---|',
      ...technologies
        .filter((technology) => technology.kind === 'language')
        .map(
          (technology) =>
            `| **${technology.name}** | ${technology.ring ?? '–'} | ${technology.note || '–'} |`
        )
    ]
  },
  {
    name: 'tools',
    render: (technologies) => [
      '| Tool | Use it for |',
      '|---|---|',
      ...technologies
        .filter((technology) => technology.toolSurface)
        .map((technology) => `| \`${technology.slug}\` | ${technology.toolSurface} |`)
    ]
  }
];

function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(path);
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index !== -1 && argv[index + 1]) return argv[index + 1];
  const inline = argv.find((argument) => argument.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

/** The export, from a file, from stdin, or straight out of the CLI against the running service. */
function readExport(source: string | undefined): TechnologyExport {
  if (source === '-') return JSON.parse(readFileSync(0, 'utf8')) as TechnologyExport;
  if (source) return JSON.parse(readFileSync(expandHome(source), 'utf8')) as TechnologyExport;
  const result = spawnSync(join(REPO, 'bin/ongoing'), ['tech', 'export'], {
    encoding: 'utf8',
    env: process.env
  });
  if (result.status !== 0)
    throw new Error(`ongoing tech export failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout) as TechnologyExport;
}

/** Replaces one marked block, and refuses rather than guessing when a marker is missing. */
function replaceBlock(document: string, name: string, lines: readonly string[]): string {
  const start = `<!-- ongoing:${name}:start -->`;
  const end = `<!-- ongoing:${name}:end -->`;
  const from = document.indexOf(start);
  const to = document.indexOf(end);
  if (from === -1 || to === -1 || to < from)
    throw new Error(
      `The target is missing the ${start} … ${end} markers. Add them around the table the catalog owns.`
    );
  return `${document.slice(0, from + start.length)}\n${lines.join('\n')}\n${document.slice(to)}`;
}

const argv = process.argv.slice(2);
const target = expandHome(option(argv, 'target') ?? DEFAULT_TARGET);
const check = argv.includes('--check');

const document = readFileSync(target, 'utf8');
const { technologies } = readExport(option(argv, 'input'));
let rendered = document;
for (const block of BLOCKS)
  rendered = replaceBlock(rendered, block.name, block.render(technologies));

if (rendered === document) {
  process.stdout.write(`${target} is already current (${technologies.length} technologies)\n`);
  process.exit(0);
}
if (check) {
  process.stderr.write(`${target} is out of date — run without --check to regenerate it\n`);
  process.exit(1);
}
writeFileSync(target, rendered);
process.stdout.write(`Rewrote the generated tables in ${target}\n`);
