#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./improvisor-java-env.sh
source "$SCRIPT_DIR/improvisor-java-env.sh"

java -cp "$IMPROVISOR_ORACLE_CLASSPATH" ImprovisorOracle "$@"
