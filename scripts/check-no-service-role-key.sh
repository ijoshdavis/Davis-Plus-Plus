#!/usr/bin/env bash
# M5 (docs/build-plan.md §6): "The service role key must not appear anywhere
# in request-handling code paths - grep for it in CI and fail the build if
# found." Scoped to api/ and web/ (the request-handling layer) - ingest/,
# rules/, export/, core/ are trusted backend jobs run by the owner, not
# request handlers, and legitimately need elevated DB access.
set -euo pipefail

if [ ! -d api ] && [ ! -d web ]; then
    echo "No api/ or web/ code yet - nothing to check."
    exit 0
fi

if grep -rIn --exclude-dir=node_modules --exclude-dir=.next -E \
    'SUPABASE_SERVICE_ROLE_KEY|service_role' \
    api/ web/ 2>/dev/null; then
    echo ""
    echo "FAIL: service_role key reference found in request-handling code (api/, web/)."
    echo "The service role bypasses RLS entirely - it must never be reachable from a request handler."
    exit 1
fi

echo "OK: no service_role key reference in api/ or web/."
