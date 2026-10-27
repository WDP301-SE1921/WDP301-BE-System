#!/bin/sh
set -e

# Target MinIO server configuration
MINIO_HOST="${MINIO_HOST:-minio}"
MINIO_PORT="${MINIO_PORT:-9000}"
ROOT_USER="${MINIO_ROOT_USER:-minioadmin123}"
ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin123}"

BUCKET_NAME="${STORAGE_BUCKET:-edugrade}"
APP_ACCESS_KEY="${STORAGE_ACCESS_KEY:-edugrade_app}"
APP_SECRET_KEY="${STORAGE_SECRET_KEY:-edugrade_app_secret123}"

echo "Waiting for MinIO server at http://${MINIO_HOST}:${MINIO_PORT}..."
until curl -s -f "http://${MINIO_HOST}:${MINIO_PORT}/minio/health/live" >/dev/null 2>&1; do
  echo "MinIO is not ready yet, retrying in 2 seconds..."
  sleep 2
done

echo "MinIO server is online. Configuring alias..."
mc alias set local "http://${MINIO_HOST}:${MINIO_PORT}" "${ROOT_USER}" "${ROOT_PASSWORD}"

# Create bucket if it doesn't already exist
if ! mc ls "local/${BUCKET_NAME}" >/dev/null 2>&1; then
  echo "Creating bucket: ${BUCKET_NAME}..."
  mc mb "local/${BUCKET_NAME}"
else
  echo "Bucket ${BUCKET_NAME} already exists. Skipping creation."
fi

# Disable anonymous access (make bucket private)
echo "Disabling anonymous access on local/${BUCKET_NAME}..."
mc anonymous set none "local/${BUCKET_NAME}" || mc anonymous set private "local/${BUCKET_NAME}" || true

# Provision application user credentials
echo "Configuring application service account / user: ${APP_ACCESS_KEY}..."
# mc admin user add will update secret if user exists or create if not
mc admin user add local "${APP_ACCESS_KEY}" "${APP_SECRET_KEY}" || true

# Attach readwrite policy to the application user
echo "Granting readwrite policy to user: ${APP_ACCESS_KEY}..."
mc admin policy attach local readwrite --user="${APP_ACCESS_KEY}" 2>/dev/null || \
mc admin policy set local readwrite user="${APP_ACCESS_KEY}" 2>/dev/null || true

echo "MinIO initialization completed successfully."
exit 0
