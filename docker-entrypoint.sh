#!/bin/sh
set -eu

fail() {
    echo "Infisical startup: $1" >&2
    exit 1
}

[ -n "${INFISICAL_PROJECT_ID:-}" ] || fail 'INFISICAL_PROJECT_ID is required'
[ -n "${INFISICAL_ENVIRONMENT:-}" ] || fail 'INFISICAL_ENVIRONMENT is required'
[ -n "${INFISICAL_DOMAIN:-}" ] || fail 'INFISICAL_DOMAIN is required'
[ -r /run/secrets/infisical ] || fail '/run/secrets/infisical must be mounted and readable'

# This is a trusted, shell-compatible credentials file, not an application .env.
. /run/secrets/infisical
[ -n "${INFISICAL_CLIENT_ID:-}" ] || fail 'INFISICAL_CLIENT_ID is missing from the credentials file'
[ -n "${INFISICAL_CLIENT_SECRET:-}" ] || fail 'INFISICAL_CLIENT_SECRET is missing from the credentials file'

export INFISICAL_DOMAIN
if ! INFISICAL_TOKEN=$(infisical login --method=universal-auth \
    --client-id="$INFISICAL_CLIENT_ID" \
    --client-secret="$INFISICAL_CLIENT_SECRET" --silent --plain); then
    fail 'authentication failed; the application was not started'
fi
[ -n "$INFISICAL_TOKEN" ] || fail 'authentication returned an empty token'
export INFISICAL_TOKEN
unset INFISICAL_CLIENT_ID INFISICAL_CLIENT_SECRET

exec infisical run --projectId="$INFISICAL_PROJECT_ID" \
    --env="$INFISICAL_ENVIRONMENT" --path=/MotherMouse -- "$@"
