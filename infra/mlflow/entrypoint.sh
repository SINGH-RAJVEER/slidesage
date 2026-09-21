#!/bin/sh
set -eu

: "${MLFLOW_DATABASE_URL:?MLFLOW_DATABASE_URL is required}"
: "${MLFLOW_ARTIFACTS_DESTINATION:?MLFLOW_ARTIFACTS_DESTINATION is required}"

exec mlflow server \
	--backend-store-uri "$MLFLOW_DATABASE_URL" \
	--artifacts-destination "$MLFLOW_ARTIFACTS_DESTINATION" \
	"$@"
