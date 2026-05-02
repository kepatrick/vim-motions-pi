#!/usr/bin/env bash
set -euo pipefail

BUMP="${RELEASE_BUMP:-}"
CONFIRM="${RELEASE_CONFIRM:-false}"

if [[ -z "${BUMP}" ]]; then
  echo "RELEASE_BUMP is required (patch|minor|major)."
  exit 1
fi

if [[ "${CONFIRM}" != "true" ]]; then
  echo "Release not confirmed; set RELEASE_CONFIRM=true to continue."
  exit 1
fi

echo "Running tests..."
npm ci
npm test
npm run test:coverage
npm pack --dry-run

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

echo "Bumping version (${BUMP})..."
npm version "${BUMP}" -m "chore(release): %s"

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

echo "Publishing ${TAG}..."
npm publish --access public

echo "Pushing commit and tag..."
git push origin HEAD:main --follow-tags

echo "Done: ${TAG}"
