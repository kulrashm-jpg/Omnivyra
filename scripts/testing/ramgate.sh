#!/usr/bin/env bash
# RAM gate for heavy local runs (jest suites, tsc, real-schema replays): exits 0 only when at least MIN_GB of
# physical memory is free, and says so either way.
#
#   bash scripts/testing/ramgate.sh && <heavy command>
#
# Never run the heavy command NEXT to the gate - a printed free-RAM number is not a check (two runs went ahead at
# 0.4 / 0.5 GB on 2026-11-13 because the number was only printed). MIN_GB defaults to 2 (the programme floor).
# Exit 3 = refused (below the floor); exit 4 = free memory could not be measured (also refused - never assume).
# Control: `MIN_GB=99 bash scripts/testing/ramgate.sh` must refuse.
set -u
MIN_GB="${MIN_GB:-2}"

free_gb() {
  if command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,2)" 2>/dev/null | tr -d '\r'
  elif [ -r /proc/meminfo ]; then
    awk '/^MemAvailable:/ { printf "%.2f", $2 / 1048576; exit }' /proc/meminfo
  fi
}

FREE="$(free_gb)"
if [ -z "$FREE" ] || ! awk -v f="$FREE" 'BEGIN { exit !(f + 0 == f) }' 2>/dev/null; then
  echo "RAM gate REFUSED: free memory could not be measured - not starting"
  exit 4
fi
if awk -v f="$FREE" -v m="$MIN_GB" 'BEGIN { exit !(f >= m) }'; then
  echo "RAM gate OK: ${FREE} GB free (>= ${MIN_GB})"
  exit 0
fi
echo "RAM gate REFUSED: ${FREE} GB free (< ${MIN_GB}) - not starting"
exit 3
