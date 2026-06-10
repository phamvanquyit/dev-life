#!/bin/bash

# Exit on error
set -e

# Export DEV_LIFE_PREVIEW to separate ports and directories
export DEV_LIFE_PREVIEW=true

# Skip code signing for preview builds (we use xattr -cr instead)
export CSC_IDENTITY_AUTO_DISCOVERY=false

# Determine package manager
if command -v bun &> /dev/null; then
  PKG_MANAGER="bun run"
  echo "📦 Detected bun, using bun for build and preview..."
else
  PKG_MANAGER="npm run"
  echo "📦 bun not found, using npm for build and preview..."
fi

echo "🚀 Building and unpacking production package..."
$PKG_MANAGER build:unpack

# Find the built .app package
APP_PATH=""
for app in dist/*/"Dev Life.app"; do
  if [ -d "$app" ]; then
    APP_PATH="$app"
    break
  fi
done

if [ -z "$APP_PATH" ]; then
  echo "❌ Error: Dev Life.app not found in dist directory!"
  exit 1
fi

# Copy to Applications directory as "Dev Life Preview.app" and run xattr
TARGET_APP="/Applications/Dev Life Preview.app"
if [ "$(uname)" == "Darwin" ]; then
  echo "📂 Copying to $TARGET_APP (Overwriting if exists)..."
  rm -rf "$TARGET_APP"
  cp -R "$APP_PATH" "$TARGET_APP"
  
  echo "🔒 Removing macOS quarantine attributes (Gatekeeper Bypass)..."
  xattr -cr "$TARGET_APP"
  
  APP_PATH="$TARGET_APP"
fi

echo "✨ Running application in preview mode (Production build, port 18982, 'Dev Life Preview' data directory)..."
echo "📂 App path: $APP_PATH"

# Run the binary directly in the background so it inherits env variables and detaches
"$APP_PATH/Contents/MacOS/Dev Life" > /dev/null 2>&1 &

echo "🎉 Application launched in background. Terminal is now free!"
