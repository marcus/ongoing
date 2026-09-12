import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isToolchain,
  normalizeVersion,
  type DeclaredStack,
  type Toolchain
} from '$lib/domain/stack';
import {
  languageUsage,
  matchDependencies,
  matchMarker,
  mergeDetections,
  signatureManifestFiles,
  signatureMarkerFiles,
  type DetectedTechnology
} from '$lib/domain/technology';

export interface StackCollectionOptions {
  /** Injected for tests; defaults to reading UTF-8 from disk. */
  readFile?: (path: string) => Promise<string>;
  signal?: AbortSignal;
}

/** A declaration before its source file is known. */
type Declaration = Omit<DeclaredStack, 'sourceFile'>;

interface Detector {
  file: string;
  parse: (text: string) => Declaration[];
}

/** Names used by asdf, mise, and Docker images that differ from our toolchain keys. */
const TOOL_ALIASES: Readonly<Record<string, Toolchain>> = {
  golang: 'go',
  nodejs: 'node',
  'dotnet-core': 'dotnet',
  'dotnet-sdk': 'dotnet',
  postgres: 'postgresql'
};

const DOCKER_IMAGES: Readonly<Record<string, Toolchain>> = {
  node: 'node',
  golang: 'go',
  python: 'python',
  ruby: 'ruby',
  rust: 'rust',
  php: 'php',
  elixir: 'elixir',
  swift: 'swift',
  postgres: 'postgresql',
  'denoland/deno': 'deno',
  'oven/bun': 'bun',
  openjdk: 'java',
  'eclipse-temurin': 'java',
  amazoncorretto: 'java',
  'mcr.microsoft.com/dotnet/sdk': 'dotnet',
  'mcr.microsoft.com/dotnet/aspnet': 'dotnet'
};

function toolchainFrom(name: string): Toolchain | null {
  const normalized = name.trim().toLowerCase();
  const aliased = TOOL_ALIASES[normalized] ?? normalized;
  return isToolchain(aliased) ? aliased : null;
}

function declare(toolchain: Toolchain, raw: string): Declaration {
  const trimmed = raw.trim();
  return { toolchain, declared: normalizeVersion(trimmed), raw: trimmed };
}

/** A bare marker file proves the ecosystem is in use even when it pins no version. */
function present(toolchain: Toolchain): Declaration {
  return { toolchain, declared: '', raw: '' };
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

function versionFile(toolchain: Toolchain): Detector['parse'] {
  return (text) => {
    const line = firstLine(text);
    return line && !line.startsWith('#') ? [declare(toolchain, line)] : [];
  };
}

function parseGoMod(text: string): Declaration[] {
  // `toolchain go1.22.5` pins more precisely than the `go` language directive, so it wins.
  const pinned = /^\s*toolchain\s+go([0-9][^\s]*)/m.exec(text);
  const directive = /^\s*go\s+([0-9][^\s]*)/m.exec(text);
  const raw = pinned?.[1] ?? directive?.[1];
  return [raw ? declare('go', raw) : present('go')];
}

function parsePackageJson(text: string): Declaration[] {
  const document = JSON.parse(text) as Record<string, unknown>;
  const declarations: Declaration[] = [];
  const record = (value: unknown, name: string) => {
    const toolchain = toolchainFrom(name);
    if (toolchain && typeof value === 'string' && value.trim())
      declarations.push(declare(toolchain, value));
  };

  const engines = (document.engines ?? {}) as Record<string, unknown>;
  const volta = (document.volta ?? {}) as Record<string, unknown>;
  for (const source of [engines, volta])
    if (source && typeof source === 'object')
      for (const [name, value] of Object.entries(source)) record(value, name);

  if (typeof document.packageManager === 'string') {
    const [name, version] = document.packageManager.split('@');
    if (name && version) record(version, name);
  }

  // A package.json that names no runtime at all is a Node project by default. Only claim that
  // when nothing else was declared, so a Bun or Deno project is not also filed under Node.
  return declarations.length > 0 ? declarations : [present('node')];
}

function parseToolVersions(text: string): Declaration[] {
  const declarations: Declaration[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [name, ...versions] = trimmed.split(/\s+/);
    const toolchain = name ? toolchainFrom(name) : null;
    if (toolchain && versions[0]) declarations.push(declare(toolchain, versions[0]));
  }
  return declarations;
}

function parseMiseToml(text: string): Declaration[] {
  const declarations: Declaration[] = [];
  // `null` outside [tools]; otherwise the tool a `[tools.<name>]` table names, or '' for `[tools]`.
  let section: string | null = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim().replace(/\s+#.*$/, '');
    if (trimmed.startsWith('[')) {
      const header = /^\[([^\]]+)\]/.exec(trimmed)?.[1]?.trim() ?? '';
      section = header === 'tools' ? '' : header.startsWith('tools.') ? header.slice(6) : null;
      continue;
    }
    if (section === null || !trimmed || trimmed.startsWith('#')) continue;
    const match = /^([\w.-]+)\s*=\s*(.+)$/.exec(trimmed);
    if (!match?.[1] || !match[2]) continue;
    // In `[tools]` the key is the tool; in `[tools.node]` the key is `version`.
    const toolchain = toolchainFrom(section || match[1]);
    // Accepts `node = "22"`, `node = ['22']`, and `node = { version = "22" }`.
    const value = /["']([^"']+)["']/.exec(match[2])?.[1];
    if (toolchain && value) declarations.push(declare(toolchain, value));
  }
  return declarations;
}

function tomlValue(text: string, key: string): string | null {
  return new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm').exec(text)?.[1] ?? null;
}

function parsePyproject(text: string): Declaration[] {
  const requires = tomlValue(text, 'requires-python') ?? tomlValue(text, 'python');
  return [requires ? declare('python', requires) : present('python')];
}

function parseCargoToml(text: string): Declaration[] {
  const rustVersion = tomlValue(text, 'rust-version');
  return [rustVersion ? declare('rust', rustVersion) : present('rust')];
}

function parseGemfile(text: string): Declaration[] {
  const ruby = /^\s*ruby\s+["']([^"']+)["']/m.exec(text)?.[1];
  return [ruby ? declare('ruby', ruby) : present('ruby')];
}

function parseComposerJson(text: string): Declaration[] {
  const document = JSON.parse(text) as { require?: Record<string, unknown> };
  const php = document.require?.php;
  return [typeof php === 'string' ? declare('php', php) : present('php')];
}

function parseGlobalJson(text: string): Declaration[] {
  const document = JSON.parse(text) as { sdk?: { version?: unknown } };
  const version = document.sdk?.version;
  return [typeof version === 'string' ? declare('dotnet', version) : present('dotnet')];
}

function parseDenoJson(text: string): Declaration[] {
  JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
  return [present('deno')];
}

/** A tag only names a version when it *starts* with one: `22-alpine` does, `lts-alpine3.20` does not. */
const TAG_VERSION = /^v?\d+(?:\.\d+)*(?=$|[-.+_])/;

function parseDockerfile(text: string): Declaration[] {
  const byToolchain = new Map<Toolchain, Declaration>();
  for (const line of text.split('\n')) {
    const match = /^\s*FROM\s+(.+)$/i.exec(line);
    if (!match?.[1]) continue;
    // Skip `--platform=…` and friends, then take the image reference and drop any `@sha256:` pin.
    const reference = match[1]
      .trim()
      .split(/\s+/)
      .find((token) => !token.startsWith('--'))
      ?.split('@')[0];
    if (!reference) continue;

    const separator = reference.lastIndexOf(':');
    // A colon before the last slash is a registry port, not a tag.
    if (separator <= reference.lastIndexOf('/')) continue;
    const toolchain = DOCKER_IMAGES[reference.slice(0, separator).toLowerCase()];
    const tag = reference.slice(separator + 1);
    const version = TAG_VERSION.exec(tag)?.[0];
    // Later stages win: the final stage is what actually runs, not the build stage.
    if (toolchain && version)
      byToolchain.set(toolchain, { toolchain, declared: normalizeVersion(version), raw: tag });
  }
  return [...byToolchain.values()];
}

/**
 * Manifests read from the repository root, in the order their declarations are reported.
 * Sub-package manifests inside a monorepo are deliberately out of scope.
 */
const DETECTORS: readonly Detector[] = [
  { file: 'go.mod', parse: parseGoMod },
  { file: 'package.json', parse: parsePackageJson },
  { file: '.nvmrc', parse: versionFile('node') },
  { file: '.node-version', parse: versionFile('node') },
  { file: '.bun-version', parse: versionFile('bun') },
  { file: '.tool-versions', parse: parseToolVersions },
  { file: 'mise.toml', parse: parseMiseToml },
  { file: '.mise.toml', parse: parseMiseToml },
  { file: join('.config', 'mise', 'config.toml'), parse: parseMiseToml },
  { file: '.python-version', parse: versionFile('python') },
  { file: 'pyproject.toml', parse: parsePyproject },
  { file: 'Cargo.toml', parse: parseCargoToml },
  { file: '.ruby-version', parse: versionFile('ruby') },
  { file: 'Gemfile', parse: parseGemfile },
  { file: 'deno.json', parse: parseDenoJson },
  { file: 'deno.jsonc', parse: parseDenoJson },
  { file: 'composer.json', parse: parseComposerJson },
  { file: 'global.json', parse: parseGlobalJson },
  { file: '.swift-version', parse: versionFile('swift') },
  { file: '.elixir-version', parse: versionFile('elixir') },
  { file: 'Dockerfile', parse: parseDockerfile }
];

const ABSENT = new Set(['ENOENT', 'EISDIR', 'ENOTDIR', 'ELOOP', 'ENAMETOOLONG']);

async function read(
  path: string,
  file: string,
  reader: (path: string) => Promise<string>
): Promise<string | null> {
  try {
    return await reader(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (ABSENT.has(code)) return null;
    throw new Error(
      `Stack collector could not read ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

/* ------------------------------------------------------------ tech signatures */

/** Dependency names to their declared version or range, as one manifest states them. */
type Dependencies = Record<string, string>;

function jsonDependencies(text: string, sections: readonly string[]): Dependencies {
  const document = JSON.parse(text) as Record<string, unknown>;
  const dependencies: Dependencies = {};
  for (const section of sections) {
    const block = document[section];
    if (!block || typeof block !== 'object') continue;
    for (const [name, value] of Object.entries(block as Record<string, unknown>))
      if (typeof value === 'string') dependencies[name] ??= value;
  }
  return dependencies;
}

/** `require (…)` blocks and single-line requires; `// indirect` modules count as dependencies. */
function goModDependencies(text: string): Dependencies {
  const dependencies: Dependencies = {};
  let inBlock = false;
  for (const line of text.split('\n')) {
    const trimmed = line
      .trim()
      .replace(/\/\/.*$/, '')
      .trim();
    if (!trimmed) continue;
    if (inBlock) {
      if (trimmed === ')') inBlock = false;
      else {
        const [module, version] = trimmed.split(/\s+/);
        if (module) dependencies[module] ??= version ?? '';
      }
      continue;
    }
    if (/^require\s*\($/.test(trimmed)) inBlock = true;
    else {
      const match = /^require\s+(\S+)(?:\s+(\S+))?/.exec(trimmed);
      if (match?.[1]) dependencies[match[1]] ??= match[2] ?? '';
    }
  }
  return dependencies;
}

/** `gem "name", "~> 1.2"` — the first quoted argument is the gem, the second its constraint. */
function gemfileDependencies(text: string): Dependencies {
  const dependencies: Dependencies = {};
  for (const line of text.split('\n')) {
    const match = /^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/.exec(line);
    if (match?.[1]) dependencies[match[1]] ??= match[2] ?? '';
  }
  return dependencies;
}

/** `[dependencies]` tables, with both `name = "1.0"` and `name = { version = "1.0" }`. */
function cargoDependencies(text: string): Dependencies {
  const dependencies: Dependencies = {};
  let inSection = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inSection = /^\[(?:\w+\.)?(?:dev-|build-)?dependencies\]$/.test(line);
      continue;
    }
    if (!inSection || !line || line.startsWith('#')) continue;
    const match = /^([\w-]+)\s*=\s*(.+)$/.exec(line);
    if (!match?.[1]) continue;
    const inline = /version\s*=\s*["']([^"']+)["']/.exec(match[2]);
    const literal = /^["']([^"']+)["']/.exec(match[2]);
    dependencies[match[1]] ??= inline?.[1] ?? literal?.[1] ?? '';
  }
  return dependencies;
}

/**
 * One parser per manifest the signature table names. A signature for a file with no parser would
 * silently never match, so `stack.test.ts` asserts this map covers `signatureManifestFiles`.
 */
export const DEPENDENCY_PARSERS: Readonly<Record<string, (text: string) => Dependencies>> = {
  'package.json': (text) =>
    jsonDependencies(text, [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies'
    ]),
  'go.mod': goModDependencies,
  Gemfile: gemfileDependencies,
  'Cargo.toml': cargoDependencies,
  'composer.json': (text) => jsonDependencies(text, ['require', 'require-dev'])
};

/** What one pass over a project's manifests yields: its toolchains and its technology edges. */
export interface StackCollection {
  stacks: DeclaredStack[];
  /** Detected `uses` edges, already merged to one per technology. */
  technologies: DetectedTechnology[];
}

/**
 * Read every toolchain a project declares at its root, and the technologies its manifests give it
 * away as using.
 *
 * Both halves are one pass: the same files answer "which Go version" and "which dependencies", and
 * reading them twice would double the cost of the cheapest collector for nothing. A manifest that
 * cannot be parsed is skipped rather than failed — a half-written `package.json` says nothing about
 * the project's stack and should not mark the whole project as broken. Errors are reserved for
 * files that exist but cannot be read at all.
 */
export async function collectStack(
  projectPath: string,
  options: StackCollectionOptions = {}
): Promise<StackCollection> {
  const reader = options.readFile ?? ((path: string) => readFile(path, 'utf8'));
  const texts = new Map<string, Promise<string | null>>();
  const readOnce = (file: string): Promise<string | null> => {
    const cached = texts.get(file);
    if (cached) return cached;
    const pending = read(join(projectPath, file), file, reader);
    texts.set(file, pending);
    return pending;
  };
  const abortIfCancelled = () => {
    if (options.signal?.aborted)
      throw options.signal.reason ?? new Error('Stack collector aborted');
  };

  const stacks = await collectDeclarations(readOnce, abortIfCancelled);
  const detections: DetectedTechnology[] = [];
  for (const file of signatureManifestFiles) {
    abortIfCancelled();
    const text = await readOnce(file);
    const parse = DEPENDENCY_PARSERS[file];
    if (text === null || !parse) continue;
    try {
      detections.push(...matchDependencies(file, parse(text)));
    } catch {
      continue;
    }
  }
  for (const file of signatureMarkerFiles) {
    abortIfCancelled();
    if ((await readOnce(file)) !== null) detections.push(...matchMarker(file));
  }

  return {
    stacks,
    // Languages come for free from the declarations rather than from a second parse of the same
    // manifests, which is what the radar means by "languages read from project_stacks".
    technologies: mergeDetections([...detections, ...languageUsage(stacks)])
  };
}

/** The toolchain half, kept as its own function so the two passes read independently. */
async function collectDeclarations(
  readOnce: (file: string) => Promise<string | null>,
  abortIfCancelled: () => void
): Promise<DeclaredStack[]> {
  const stacks: DeclaredStack[] = [];
  const seen = new Set<string>();

  for (const detector of DETECTORS) {
    abortIfCancelled();
    const text = await readOnce(detector.file);
    if (text === null) continue;

    let declarations: Declaration[];
    try {
      declarations = detector.parse(text);
    } catch {
      continue;
    }

    for (const declaration of declarations) {
      const key = `${declaration.toolchain}\n${detector.file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stacks.push({ ...declaration, sourceFile: detector.file });
    }
  }

  // An unversioned marker only says "this ecosystem is in use". Once any manifest pins a version
  // for that toolchain the marker is noise, and would otherwise show up as a second `node unpinned`
  // row beside the real one.
  const versioned = new Set(
    stacks.filter(({ declared }) => declared).map(({ toolchain }) => toolchain)
  );
  return stacks.filter(({ toolchain, declared }) => declared || !versioned.has(toolchain));
}

/** The toolchain half on its own, for callers that want the stack and not the radar. */
export async function collectStackDeclarations(
  projectPath: string,
  options: StackCollectionOptions = {}
): Promise<DeclaredStack[]> {
  return (await collectStack(projectPath, options)).stacks;
}
