#!/bin/sh
# Exit 0 only for the highest stable vMAJOR.MINOR.PATCH tag on the remote.
set -eu
tag=${1:?tag required}
remote=${2:?remote required}
case "$tag" in v*) ;; *) exit 1 ;; esac
printf '%s\n' "$tag" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || exit 1
refs=$(git ls-remote --tags --refs "$remote") || exit 2
latest=$(printf '%s\n' "$refs" | awk '{sub("refs/tags/", "", $2); print $2}' | grep -E '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' | sort -V | tail -1)
[ "$tag" = "$latest" ]
