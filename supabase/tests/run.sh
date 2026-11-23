#!/usr/bin/env bash
# Teste la sécurité (RLS) sur un Postgres local jetable : bash supabase/tests/run.sh
set -e
B=$(ls -d /usr/lib/postgresql/*/bin | tail -1); D=$(mktemp -d)
$B/initdb -D $D -A trust >/dev/null && $B/pg_ctl -D $D -o "-p 5499 -k $D" -l $D/log start >/dev/null && sleep 2
P="psql -h $D -p 5499 -U $(whoami) -d postgres -q"
$P -v ON_ERROR_STOP=1 -f supabase/tests/00_stub_supabase.sql 2>/dev/null
$P -v ON_ERROR_STOP=1 -f supabase/migrations/*_init.sql 2>&1 | grep -v NOTICE || true
for m in supabase/migrations/*_v*.sql; do $P -v ON_ERROR_STOP=1 -f "$m" 2>&1 | grep -v NOTICE || true; done
for t in supabase/tests/0[1-9]_*.sql; do $P -f "$t" 2>&1 | grep -v "^$\|CONTEXT\|^LINE\|^\s*\^"; done
$B/pg_ctl -D $D stop >/dev/null
