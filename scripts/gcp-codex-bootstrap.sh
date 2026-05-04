#!/usr/bin/env bash

set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-nodal-talon-495310-p0}"
CONFIG_DIR="${CLOUDSDK_CONFIG:-$HOME/.gcloud-config}"

export GOOGLE_CLOUD_PROJECT="$PROJECT_ID"
export GOOGLE_CLOUD_QUOTA_PROJECT="$PROJECT_ID"
export CLOUDSDK_CORE_PROJECT="$PROJECT_ID"
export CLOUDSDK_CONFIG="$CONFIG_DIR"

mkdir -p "$CLOUDSDK_CONFIG"

echo "GCP project pinned to: $PROJECT_ID"
echo "gcloud config dir: $CLOUDSDK_CONFIG"

if ! command -v gcloud >/dev/null 2>&1; then
  echo
  echo "gcloud is not installed on this machine yet."
  echo "Install Google Cloud CLI, then run:"
  echo "  gcloud auth login"
  echo "  gcloud auth application-default login"
  echo "  gcloud config set project $PROJECT_ID"
  echo "  gcloud auth application-default set-quota-project $PROJECT_ID"
  exit 1
fi

gcloud config set project "$PROJECT_ID"

echo
echo "Next commands to finish the Codex <-> GCP connection:"
echo "  gcloud auth login"
echo "  gcloud auth application-default login"
echo "  gcloud auth application-default set-quota-project $PROJECT_ID"
