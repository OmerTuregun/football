#!/bin/sh
set -e

mkdir -p /app/data /app/src/raw-cache
npm run migrate
exec "$@"
