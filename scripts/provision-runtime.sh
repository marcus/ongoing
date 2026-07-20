#!/bin/zsh
set -euo pipefail

readonly checkout=/Users/marcusvorwaller/code/ongoing
readonly mise=/opt/homebrew/bin/mise
readonly mise_data=/Users/marcusvorwaller/.local/share/ongoing/mise
readonly bun=/Users/marcusvorwaller/.local/share/ongoing/mise/installs/bun/1.3.1/bin/bun
readonly required_version="$(tr -d '[:space:]' < "$checkout/.bun-version")"

if [[ "$required_version" != 1.3.1 ]]; then
  print -u2 "unsupported pinned Bun version: $required_version"
  exit 1
fi
if [[ ! -x "$mise" ]]; then
  print -u2 "required app runtime provisioner is missing: $mise"
  exit 1
fi

if [[ ! -x "$bun" ]]; then
  MISE_DATA_DIR="$mise_data" "$mise" install "bun@$required_version"
fi

readonly actual_version="$($bun --version)"
if [[ "$actual_version" != "$required_version" ]]; then
  print -u2 "Ongoing Bun version mismatch: expected $required_version, got $actual_version"
  exit 1
fi
print -- "$bun ($actual_version)"
