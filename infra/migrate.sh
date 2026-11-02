#!/usr/bin/env bash
# Run a compiled migration binary against the Neon database. The URL is read
# from a private file so it stays out of shell history and process listings.
# Create a Neon restore branch first, and pause both application Containers
# before incompatible schema changes.
set -euo pipefail
usage="usage: migrate.sh /absolute/path/to/migrate /path/to/database-url"
binary=${1:?$usage}
url_file=${2:?$usage}
[[ $binary == /* && -x $binary ]]
url=$(<"$url_file")
# The migrator sets session state such as lock_timeout, which the
# transaction-mode pooler does not keep between statements.
if [[ $url == *-pooler.* ]]; then
	echo "Use the direct Neon host, without -pooler, for migrations" >&2
	exit 1
fi
DATABASE_URL=$url exec "$binary"
