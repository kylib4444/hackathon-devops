#!/bin/bash

OPENAI_KEY=$(gcloud secrets versions access latest --secret="openai-api-key")
GEMINI_KEY=$(gcloud secrets versions access latest --secret="gemini-api-key")
CLAUDE_KEY=$(gcloud secrets versions access latest --secret="claude-api-key")

kubectl create secret generic llm-secrets -n jobmatch-dev \
  --from-literal=openai-api-key="$OPENAI_KEY" \
  --from-literal=gemini-api-key="$GEMINI_KEY" \
  --from-literal=claude-api-key="$CLAUDE_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -
