#!/bin/zsh
# Installs the Bun release named in .bun-version into Ongoing's own mise data directory and points the
# stable app-scoped executable at it. Idempotent; safe to re-run after a version bump. Everything that
# runs Ongoing in production (both LaunchAgents, the release worker, bin/ongoing) uses the stable path,
# so .bun-version is the only place the version is written down.
set -euo pipefail

readonly checkout=/Users/marcus/code/ongoing
readonly mise=/opt/homebrew/bin/mise
readonly mise_data=/Users/marcus/.local/share/ongoing/mise
readonly bun=/Users/marcus/.local/share/ongoing/bun
readonly required_version="$(tr -d '[:space:]' < "$checkout/.bun-version")"
readonly installed="$mise_data/installs/bun/$required_version/bin/bun"

if [[ ! "$required_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  print -u2 "unsupported pinned Bun version: $required_version"
  exit 1
fi
if [[ ! -x "$mise" ]]; then
  print -u2 "required app runtime provisioner is missing: $mise"
  exit 1
fi

if [[ ! -x "$installed" ]]; then
  MISE_DATA_DIR="$mise_data" "$mise" install "bun@$required_version"
fi
if [[ "$(readlink "$bun" 2>/dev/null)" != "$installed" ]]; then
  ln -sfn "$installed" "$bun"
fi

readonly actual_version="$($bun --version)"
if [[ "$actual_version" != "$required_version" ]]; then
  print -u2 "Ongoing Bun version mismatch: expected $required_version, got $actual_version"
  exit 1
fi
print -- "$bun -> $installed ($actual_version)"
