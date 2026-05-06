#!/bin/bash

if [[ "$1" == *"klkiseupptzbecbxwrky"* ]]; then
  echo "🚫 BLOCKED: Direct db push to PROD is not allowed"
  exit 1
fi
