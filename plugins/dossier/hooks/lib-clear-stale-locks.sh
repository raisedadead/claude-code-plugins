#!/bin/sh
exec "$(dirname "$0")/../cli/ds" clear-locks "$@"
