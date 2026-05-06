#!/bin/bash

# Match the prod project ref anywhere in the argument list, not just $1.
# (npm run db:push -- --project-ref klkiseupptzbecbxwrky passes args as
#  $1=--project-ref, $2=klkiseupptzbecbxwrky; checking only $1 would miss it.)
if [[ "$*" == *"klkiseupptzbecbxwrky"* ]]; then
  echo "🚫 BLOCKED: Direct db push to PROD is not allowed"
  exit 1
fi
