#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./improvisor-java-env.sh
source "$SCRIPT_DIR/improvisor-java-env.sh"

mkdir -p "$IMPROVISOR_ORACLE_BUILD"
cd "$IMPROVISOR_ROOT"

javac \
  -cp "$IMPROVISOR_ORACLE_CLASSPATH" \
  -d "$IMPROVISOR_ORACLE_BUILD" \
  $(find src/polya src/jm src/imp src/mikera src/oscP5 src/netP5 -name '*.java')

javac \
  -cp "$IMPROVISOR_ORACLE_CLASSPATH" \
  -d "$IMPROVISOR_ORACLE_BUILD" \
  "$SCRIPT_DIR/java/ImprovisorOracle.java"

java -version
echo "Compiled Impro-Visor oracle classes into $IMPROVISOR_ORACLE_BUILD"
