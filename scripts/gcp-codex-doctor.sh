#!/usr/bin/env bash

set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-nodal-talon-495310-p0}"
CONFIG_DIR="${CLOUDSDK_CONFIG:-$HOME/.gcloud-config}"

export CLOUDSDK_CONFIG="$CONFIG_DIR"

echo "Expected project: $PROJECT_ID"
echo "gcloud config dir: $CLOUDSDK_CONFIG"
echo

if command -v gcloud >/dev/null 2>&1; then
  echo "gcloud: installed"
  ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
  ADC_QUOTA_PROJECT="$(gcloud auth application-default print-access-token >/dev/null 2>&1 && gcloud auth application-default set-quota-project --help >/dev/null 2>&1 && echo "available" || true)"
  echo "gcloud active project: ${ACTIVE_PROJECT:-<unset>}"
  if gcloud auth list --filter=status:ACTIVE --format="value(account)" >/dev/null 2>&1; then
    ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n 1)"
    echo "gcloud active account: ${ACTIVE_ACCOUNT:-<unset>}"
  else
    echo "gcloud active account: <unknown>"
  fi
  if gcloud auth application-default print-access-token >/dev/null 2>&1; then
    echo "application default credentials: configured"
  else
    echo "application default credentials: missing"
  fi
  if [[ -n "${ADC_QUOTA_PROJECT:-}" ]]; then
    echo "adc quota-project tooling: available"
  fi
else
  echo "gcloud: missing"
fi

echo
echo "Environment:"
echo "GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT:-<unset>}"
echo "GOOGLE_CLOUD_QUOTA_PROJECT=${GOOGLE_CLOUD_QUOTA_PROJECT:-<unset>}"
echo "CLOUDSDK_CORE_PROJECT=${CLOUDSDK_CORE_PROJECT:-<unset>}"
echo "CLOUDSDK_CONFIG=${CLOUDSDK_CONFIG:-<unset>}"
