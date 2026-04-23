#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
OUT="_git_setup_log.txt"
{
  echo "=== $(date) ==="
  git init
  git add -A
  git status
  if ! git rev-parse -q --verify HEAD >/dev/null 2>&1; then
    git commit -m "Initial commit: Jira and Confluence local sync (Python + Node)"
  else
    echo "Already has commits"
  fi
  git branch -M main 2>/dev/null || true
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin git@github.com:dev-kostiuk/jira-confluence-ai-context.git
  else
    git remote add origin git@github.com:dev-kostiuk/jira-confluence-ai-context.git
  fi
  git remote -v
  git push -u origin main
  echo "=== done ==="
} 2>&1 | tee "$OUT"
