#!/bin/sh
exec "$(dirname "$0")/../cli/ds" regen-index "$@"
