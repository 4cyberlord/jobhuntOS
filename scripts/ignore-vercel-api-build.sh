#!/usr/bin/env bash

# Vercel Ignored Build Step
# Rule:
#   Exit code 1 -> PROCEED with build
#   Exit code 0 -> SKIP / CANCEL build

# 1. Skip all branches other than main
if [ "$VERCEL_GIT_COMMIT_REF" != "main" ]; then
  echo "🛑 Branch '$VERCEL_GIT_COMMIT_REF' is not main. Skipping build."
  exit 0
fi

# 2. Get baseline commit to compare
BASE_SHA="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"

echo "🔍 Comparing $BASE_SHA to HEAD for API workspace changes..."

# 3. Check if any API-related directories or root package configs changed
# git diff --quiet returns:
#   0 = NO changes detected (skip)
#   1 = changes detected (proceed)
git diff --quiet "$BASE_SHA" HEAD -- apps/api packages/contracts deploy/vercel-api package.json package-lock.json

DIFF_EXIT_CODE=$?

if [ $DIFF_EXIT_CODE -eq 0 ]; then
  echo "✅ No changes in API workspaces or dependencies. Skipping build."
  exit 0
else
  echo "🚀 API changes detected. Proceeding with deployment build."
  exit 1
fi
