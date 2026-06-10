#!/bin/bash

# Ensure common executable paths (including bun) are in PATH
export PATH="$HOME/.bun/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

# Load NVM if present
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
  nvm use default >/dev/null 2>&1
fi

# Locate paths relative to script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LOG_FILE="$SCRIPT_DIR/stop-hook.log"
WORKSPACE_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$WORKSPACE_ROOT" || exit 0

echo "=== Stop Hook Started at $(date) ===" > "$LOG_FILE"

# 1. Run Biome Check on the entire project
echo "Running biome check on all files:" >> "$LOG_FILE"
npx @biomejs/biome check --error-on-warnings . >> "$LOG_FILE" 2>&1
BIOME_EXIT_CODE=$?

TSC_EXIT_CODE=0
BUILD_EXIT_CODE=0

# 2. Run TypeScript Typechecking if Biome check passed
if [ $BIOME_EXIT_CODE -eq 0 ]; then
  echo "=== Running TypeScript Type Check ===" >> "$LOG_FILE"
  bun x tsc --build --noEmit >> "$LOG_FILE" 2>&1
  TSC_EXIT_CODE=$?
else
  echo "Skipped TypeScript check because Biome check failed." >> "$LOG_FILE"
fi

# 3. Run Build Check if TypeScript check passed
if [ $BIOME_EXIT_CODE -eq 0 ] && [ $TSC_EXIT_CODE -eq 0 ]; then
  echo "=== Running Build Check ===" >> "$LOG_FILE"
  bun run build >> "$LOG_FILE" 2>&1
  BUILD_EXIT_CODE=$?
else
  echo "Skipped build check because pre-requisite check failed." >> "$LOG_FILE"
fi

echo "=== Biome, TypeScript & Build Hook Finished at $(date) ===" >> "$LOG_FILE"

# Output the expected JSON decision to stdout for the agent platform
if [ $BIOME_EXIT_CODE -ne 0 ]; then
  echo '{"decision": "block", "reason": "Biome check found errors or warnings. Please check .agents/stop-hook.log and fix them."}'
elif [ $TSC_EXIT_CODE -ne 0 ]; then
  echo '{"decision": "block", "reason": "TypeScript type checking failed. Please check .agents/stop-hook.log for errors and run '\''bun x tsc --build --noEmit'\'' to fix them."}'
elif [ $BUILD_EXIT_CODE -ne 0 ]; then
  echo '{"decision": "block", "reason": "Build failed. Please check .agents/stop-hook.log for errors and run '\''bun run build'\'' to fix them."}'
else
  echo '{"decision": "stop"}'
fi

# Always exit 0 so the agent stop hook does not block stopping
exit 0
