import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectStackDeclarations } from './stack';

const directories: string[] = [];

async function project(files: Record<string, string>): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'ongoing-stack-'));
  directories.push(path);
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(dirname(join(path, name)), { recursive: true });
    await writeFile(join(path, name), contents);
  }
  return path;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe('manifest detection', () => {
  it('prefers the go.mod toolchain pin over the language directive', async () => {
    const path = await project({ 'go.mod': 'module x\n\ngo 1.22\n\ntoolchain go1.24.5\n' });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'go', declared: '1.24.5', raw: '1.24.5', sourceFile: 'go.mod' }
    ]);
  });

  it('falls back to the go directive and records a version-less module', async () => {
    expect(
      await collectStackDeclarations(await project({ 'go.mod': 'module x\n\ngo 1.22\n' }))
    ).toEqual([{ toolchain: 'go', declared: '1.22', raw: '1.22', sourceFile: 'go.mod' }]);
    expect(await collectStackDeclarations(await project({ 'go.mod': 'module x\n' }))).toEqual([
      { toolchain: 'go', declared: '', raw: '', sourceFile: 'go.mod' }
    ]);
  });

  it('reads engines, volta, and packageManager out of package.json', async () => {
    const path = await project({
      'package.json': JSON.stringify({
        engines: { node: '>=20', pnpm: '9' },
        volta: { node: '22.4.0' },
        packageManager: 'bun@1.3.9'
      })
    });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'node', declared: '20', raw: '>=20', sourceFile: 'package.json' },
      { toolchain: 'bun', declared: '1.3.9', raw: '1.3.9', sourceFile: 'package.json' }
    ]);
  });

  it('treats a package.json that names no runtime as an unversioned Node project', async () => {
    const path = await project({ 'package.json': JSON.stringify({ name: 'x' }) });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'node', declared: '', raw: '', sourceFile: 'package.json' }
    ]);
  });

  it('does not file a Deno project under Node', async () => {
    const path = await project({
      'package.json': JSON.stringify({ engines: { deno: '2.1.0' } }),
      'deno.json': JSON.stringify({ tasks: {} })
    });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'deno', declared: '2.1.0', raw: '2.1.0', sourceFile: 'package.json' }
    ]);
  });

  it('keeps a bare marker when nothing pins the toolchain', async () => {
    const path = await project({ 'deno.json': JSON.stringify({ tasks: {} }) });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'deno', declared: '', raw: '', sourceFile: 'deno.json' }
    ]);
  });

  it('reads asdf and mise tool tables, aliasing upstream tool names', async () => {
    const path = await project({
      '.tool-versions': '# comment\nnodejs 22.4.0\nruby 3.3.1\nunknown-tool 1.0\n',
      '.mise.toml': '[env]\nFOO = "1"\n\n[tools]\ngolang = "1.24"\npython = ["3.12", "3.11"]\n'
    });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'node', declared: '22.4.0', raw: '22.4.0', sourceFile: '.tool-versions' },
      { toolchain: 'ruby', declared: '3.3.1', raw: '3.3.1', sourceFile: '.tool-versions' },
      { toolchain: 'go', declared: '1.24', raw: '1.24', sourceFile: '.mise.toml' },
      { toolchain: 'python', declared: '3.12', raw: '3.12', sourceFile: '.mise.toml' }
    ]);
  });

  it('reads the nested mise config path', async () => {
    const path = await project({ '.config/mise/config.toml': '[tools]\nbun = "1.3.9"\n' });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'bun', declared: '1.3.9', raw: '1.3.9', sourceFile: '.config/mise/config.toml' }
    ]);
  });

  it.each([
    ['.nvmrc', 'v20.11.1\n', 'node', '20.11.1'],
    ['.bun-version', '1.3.9\n', 'bun', '1.3.9'],
    ['.python-version', '3.12.4\n', 'python', '3.12.4'],
    ['.ruby-version', 'ruby-3.3.1\n', 'ruby', '3.3.1'],
    ['.swift-version', '6.0\n', 'swift', '6.0']
  ])('reads %s', async (file, contents, toolchain, declared) => {
    const path = await project({ [file]: contents });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain, declared, raw: contents.trim(), sourceFile: file }
    ]);
  });

  it('reads language manifests that carry a version constraint', async () => {
    const path = await project({
      'pyproject.toml': '[project]\nname = "x"\nrequires-python = ">=3.12"\n',
      'Cargo.toml': '[package]\nname = "x"\nrust-version = "1.79"\n',
      Gemfile: "source 'https://rubygems.org'\nruby '3.3.1'\n",
      'composer.json': JSON.stringify({ require: { php: '^8.3' } }),
      'global.json': JSON.stringify({ sdk: { version: '8.0.400' } })
    });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'python', declared: '3.12', raw: '>=3.12', sourceFile: 'pyproject.toml' },
      { toolchain: 'rust', declared: '1.79', raw: '1.79', sourceFile: 'Cargo.toml' },
      { toolchain: 'ruby', declared: '3.3.1', raw: '3.3.1', sourceFile: 'Gemfile' },
      { toolchain: 'php', declared: '8.3', raw: '^8.3', sourceFile: 'composer.json' },
      { toolchain: 'dotnet', declared: '8.0.400', raw: '8.0.400', sourceFile: 'global.json' }
    ]);
  });

  it('maps Dockerfile base images to toolchains and ignores untagged or unversioned images', async () => {
    const path = await project({
      Dockerfile: [
        'FROM node:22-alpine AS build',
        'FROM registry.local:5000/internal',
        'FROM alpine:3.20',
        'FROM golang:latest',
        'FROM oven/bun:1.3.9',
        'RUN echo hi'
      ].join('\n')
    });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'node', declared: '22', raw: '22-alpine', sourceFile: 'Dockerfile' },
      { toolchain: 'bun', declared: '1.3.9', raw: '1.3.9', sourceFile: 'Dockerfile' }
    ]);
  });

  it('only reads a Dockerfile tag when the version starts it', async () => {
    // `lts-alpine3.20` names Alpine 3.20, not Node 3.20 — reading it would claim a dead Node line.
    const path = await project({
      Dockerfile: ['FROM node:lts-alpine3.20', 'FROM python:3.12-slim'].join('\n')
    });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'python', declared: '3.12', raw: '3.12-slim', sourceFile: 'Dockerfile' }
    ]);
  });

  it('reads past build flags and digest pins, and lets the final stage win', async () => {
    const path = await project({
      Dockerfile: [
        'FROM --platform=$BUILDPLATFORM node:18 AS build',
        'FROM golang:1.24@sha256:abc123 AS tools',
        'FROM node:24-slim'
      ].join('\n')
    });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'node', declared: '24', raw: '24-slim', sourceFile: 'Dockerfile' },
      { toolchain: 'go', declared: '1.24', raw: '1.24', sourceFile: 'Dockerfile' }
      // `node:18` from the build stage is replaced by the final `node:24-slim`.
    ]);
  });

  it('reads mise table sections and headers with trailing comments', async () => {
    const path = await project({
      'mise.toml': '[tools] # pinned\nnode = "22"\n\n[tools.python]\nversion = "3.12"\n'
    });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'node', declared: '22', raw: '22', sourceFile: 'mise.toml' },
      { toolchain: 'python', declared: '3.12', raw: '3.12', sourceFile: 'mise.toml' }
    ]);
  });

  it('drops an unversioned marker once another manifest pins that toolchain', async () => {
    const path = await project({ 'package.json': JSON.stringify({ name: 'x' }), '.nvmrc': '20\n' });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'node', declared: '20', raw: '20', sourceFile: '.nvmrc' }
    ]);
  });
});

describe('failure handling', () => {
  it('reports nothing for a project with no manifests', async () => {
    expect(await collectStackDeclarations(await project({ 'README.md': '# x' }))).toEqual([]);
  });

  it('skips a malformed manifest instead of failing the project', async () => {
    const path = await project({ 'package.json': '{ not json', 'go.mod': 'module x\n\ngo 1.24\n' });
    expect(await collectStackDeclarations(path)).toEqual([
      { toolchain: 'go', declared: '1.24', raw: '1.24', sourceFile: 'go.mod' }
    ]);
  });

  it('raises when a manifest exists but cannot be read', async () => {
    const path = await project({ 'go.mod': 'module x\n' });
    const reader = async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    };
    await expect(collectStackDeclarations(path, { readFile: reader })).rejects.toThrow(
      /Stack collector could not read go\.mod: permission denied/
    );
  });

  it('honours an abort signal', async () => {
    const path = await project({ 'go.mod': 'module x\n' });
    const controller = new AbortController();
    controller.abort(new Error('scan cancelled'));
    await expect(collectStackDeclarations(path, { signal: controller.signal })).rejects.toThrow(
      /scan cancelled/
    );
  });
});
