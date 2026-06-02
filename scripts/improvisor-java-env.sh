#!/usr/bin/env bash
set -euo pipefail

export IMPROVISOR_ROOT="${IMPROVISOR_ROOT:-/Users/mynority/vibe_coding/Impro-Visor}"
export AURAFLOW_ROOT="${AURAFLOW_ROOT:-/Users/mynority/vibe_coding/auraflow_music_game_console_simulator}"
export IMPROVISOR_JAVA_HOME="${IMPROVISOR_JAVA_HOME:-/Users/mynority/.local/jdks/corretto8/amazon-corretto-8.jdk/Contents/Home}"
export JAVA_HOME="$IMPROVISOR_JAVA_HOME"
export PATH="$JAVA_HOME/bin:$PATH"
export IMPROVISOR_ORACLE_BUILD="${IMPROVISOR_ORACLE_BUILD:-$AURAFLOW_ROOT/.oracle-build/improvisor-java}"
export IMPROVISOR_ORACLE_CLASSPATH="$IMPROVISOR_ORACLE_BUILD:$IMPROVISOR_ROOT/src:$IMPROVISOR_ROOT/src/builtin.jar:$IMPROVISOR_ROOT/src/lang.jar:$IMPROVISOR_ROOT/lib/*"
