#!/usr/bin/env bash
# Runs W3C EPUBCheck on every EPUB under a folder (default dist/web/downloads)
# and fails on any fatal, error or warning. Needs Java; downloads EPUBCheck
# once into out/ unless EPUBCHECK_JAR points at a copy.
set -euo pipefail
dir="${1:-dist/web/downloads}"
version="5.2.1"
jar="${EPUBCHECK_JAR:-out/epubcheck-$version/epubcheck.jar}"
if [ ! -f "$jar" ]; then
  mkdir -p out
  curl -sSL -o "out/epubcheck.zip" "https://github.com/w3c/epubcheck/releases/download/v$version/epubcheck-$version.zip"
  (cd out && unzip -qo epubcheck.zip)
fi
status=0
while IFS= read -r -d '' f; do
  if java -jar "$jar" --failonwarnings "$f" >"out/epubcheck.log" 2>&1; then
    echo "EPUBCheck $version: $f passed with no messages"
  else
    echo "EPUBCheck $version: $f FAILED"
    grep -E "^(FATAL|ERROR|WARNING)" "out/epubcheck.log" || tail -5 "out/epubcheck.log"
    status=1
  fi
done < <(find "$dir" -name '*.epub' -print0)
exit $status
