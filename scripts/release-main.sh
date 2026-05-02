#!/usr/bin/env bash
set -euo pipefail

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "Tag ${TAG} already exists; skipping release."
  exit 0
fi

echo "Running tests..."
npm ci
npm test
npm run test:coverage
npm pack --dry-run

echo "Publishing ${TAG}..."
npm publish --access public

echo "Creating tag ${TAG}..."
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git tag -a "${TAG}" -m "Release ${TAG}"
git push origin "${TAG}"

echo "Done: ${TAG}"
