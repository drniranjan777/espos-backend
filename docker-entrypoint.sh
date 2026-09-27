#!/bin/sh
# Applies pending migrations and idempotent reference data, then starts the API.
set -e

echo "Running database migrations..."
npx knex migrate:latest

echo "Ensuring reference data (roles, permissions, GST rates, admin user)..."
npx knex seed:run --specific=01_reference_data.js

exec node src/server.js
