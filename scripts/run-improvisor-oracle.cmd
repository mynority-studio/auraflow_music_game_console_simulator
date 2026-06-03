@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "AURAFLOW_ROOT=%SCRIPT_DIR%.."
if not defined IMPROVISOR_ROOT set "IMPROVISOR_ROOT=Z:\Impro-Visor"
if not defined IMPROVISOR_JAVA_HOME set "IMPROVISOR_JAVA_HOME=%AURAFLOW_ROOT%\.deps\java\temurin8-jdk\jdk8u492-b09"
if not defined IMPROVISOR_ORACLE_BUILD set "IMPROVISOR_ORACLE_BUILD=%AURAFLOW_ROOT%\.oracle-build\improvisor-java"

set "JAVA_HOME=%IMPROVISOR_JAVA_HOME%"
set "PATH=%JAVA_HOME%\bin;%PATH%"
set "IMPROVISOR_ORACLE_CLASSPATH=%IMPROVISOR_ORACLE_BUILD%;%IMPROVISOR_ROOT%\src;%IMPROVISOR_ROOT%\src\builtin.jar;%IMPROVISOR_ROOT%\src\lang.jar;%IMPROVISOR_ROOT%\lib\*"

java -cp "%IMPROVISOR_ORACLE_CLASSPATH%" ImprovisorOracle %*
