#!/bin/sh

./node_modules/@sentry/cli/bin/sentry-cli "$@"
status=$?

if [ "$status" -ne 0 ]; then
  echo "warning: Sentry source-map upload failed (exit $status); continuing Android build." >&2
fi

exit 0
