#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

echo -e "${BLUE}=======================================${NC}"
echo -e "${BLUE}    Dev Life macOS Build & Release     ${NC}"
echo -e "${BLUE}=======================================${NC}"

# 1. OS check - macOS only
if [[ "$OSTYPE" != "darwin"* ]]; then
  echo -e "${RED}Error: This script is only supported on macOS.${NC}"
  exit 1
fi

# 2. Navigate to project root relative to script location
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."
echo -e "Project directory: ${BLUE}$(pwd)${NC}"

# 3. Check for required commands
if ! command -v bun &> /dev/null; then
  echo -e "${RED}Error: 'bun' package manager is not installed.${NC}"
  echo -e "${YELLOW}Please install Bun first (https://bun.sh)${NC}"
  exit 1
fi

# 4. Read current version from package.json
if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: package.json not found in current directory.${NC}"
  exit 1
fi

CURRENT_VERSION=$(bun -e "console.log(require('./package.json').version)")
PRODUCT_NAME=$(bun -e "console.log(require('./package.json').build.productName || 'Dev Life')")
echo -e "Current version: ${CYAN}v${CURRENT_VERSION}${NC}"

# ─── Version Bump ─────────────────────────────────────────────────────────────

# Parse current version (strip any pre-release suffix for bump calculation)
BASE_VERSION=$(echo "$CURRENT_VERSION" | sed 's/-.*//')
IFS='.' read -r MAJOR MINOR PATCH <<< "$BASE_VERSION"

# Calculate bump options
PATCH_NEXT="${MAJOR}.${MINOR}.$((PATCH + 1))"
MINOR_NEXT="${MAJOR}.$((MINOR + 1)).0"
MAJOR_NEXT="$((MAJOR + 1)).0.0"

echo ""
echo -e "${BOLD}Select release version:${NC}"
echo ""
echo -e "  ${GREEN}1)${NC} Patch  ${DIM}─${NC} ${CYAN}${PATCH_NEXT}${NC}       ${DIM}(bug fixes)${NC}"
echo -e "  ${GREEN}2)${NC} Minor  ${DIM}─${NC} ${CYAN}${MINOR_NEXT}${NC}       ${DIM}(new features)${NC}"
echo -e "  ${GREEN}3)${NC} Major  ${DIM}─${NC} ${CYAN}${MAJOR_NEXT}${NC}       ${DIM}(breaking changes)${NC}"
echo -e "  ${YELLOW}4)${NC} Pre-release ${DIM}─${NC} ${CYAN}${PATCH_NEXT}-beta.1${NC}  ${DIM}(testing)${NC}"
echo -e "  ${DIM}5) Custom version${NC}"
echo ""

read -p "$(echo -e "${BOLD}Choose [1-5]:${NC} ")" VERSION_CHOICE

case "$VERSION_CHOICE" in
  1) NEW_VERSION="$PATCH_NEXT" ;;
  2) NEW_VERSION="$MINOR_NEXT" ;;
  3) NEW_VERSION="$MAJOR_NEXT" ;;
  4)
    PRE_TAG="beta"

    # Check if current version already has beta tag, auto-increment
    if echo "$CURRENT_VERSION" | grep -qE "^[0-9]+\.[0-9]+\.[0-9]+-beta\.[0-9]+$"; then
      CURRENT_PRE_NUM=$(echo "$CURRENT_VERSION" | sed "s/.*-beta\.\([0-9]*\)/\1/")
      NEXT_PRE_NUM=$((CURRENT_PRE_NUM + 1))
      NEW_VERSION="${BASE_VERSION}-beta.${NEXT_PRE_NUM}"
      echo -e "${DIM}  (auto-incremented from beta.${CURRENT_PRE_NUM})${NC}"
    else
      NEW_VERSION="${PATCH_NEXT}-beta.1"
    fi
    ;;
  5)
    read -p "$(echo -e "${BOLD}Enter custom version:${NC} ")" NEW_VERSION
    # Validate semver format (with optional pre-release)
    if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9]+(\.[0-9]+)?)?$'; then
      echo -e "${RED}Error: Invalid semver format. Expected: X.Y.Z or X.Y.Z-tag.N${NC}"
      exit 1
    fi
    ;;
  *)
    echo -e "${RED}Invalid selection.${NC}"
    exit 1
    ;;
esac

# Detect if this is a pre-release
IS_PRERELEASE=false
if echo "$NEW_VERSION" | grep -qE '-'; then
  IS_PRERELEASE=true
fi

echo ""
if [ "$IS_PRERELEASE" = true ]; then
  echo -e "Release: ${YELLOW}v${NEW_VERSION}${NC} ${DIM}(pre-release)${NC}"
else
  echo -e "Release: ${GREEN}v${NEW_VERSION}${NC} ${DIM}(stable)${NC}"
fi


# ─── Phase 1: Trial Build (verify no errors before bumping version) ───────────

echo -e "\n${BLUE}[1/8] Installing dependencies...${NC}"
bun install

echo -e "\n${BLUE}[2/8] Trial build (checking for errors)...${NC}"
rm -rf out dist
bun run build 2>&1
if [ $? -ne 0 ]; then
  echo -e "\n${RED}❌ Trial build failed! Version was NOT bumped.${NC}"
  echo -e "${DIM}Fix the errors above and try again.${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Trial build passed — no errors${NC}"

# ─── Phase 2: Bump Version ───────────────────────────────────────────────────

echo -e "\n${BLUE}[3/8] Updating version to ${NEW_VERSION}...${NC}"
bun -e "
  const pkg = require('./package.json');
  pkg.version = '${NEW_VERSION}';
  require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo -e "${GREEN}Updated package.json → v${NEW_VERSION}${NC}"

# ─── Phase 3: Production Build (with new version) ────────────────────────────

echo -e "\n${BLUE}[4/8] Rebuilding with v${NEW_VERSION}...${NC}"
rm -rf out dist
bun run build

echo -e "\n${BLUE}[5/8] Packaging application for macOS...${NC}"
export CSC_IDENTITY_AUTO_DISCOVERY=false
bun run build:mac

echo -e "\n${GREEN}=======================================${NC}"
echo -e "${GREEN}    Build Completed Successfully!      ${NC}"
echo -e "${GREEN}=======================================${NC}"

# Show built files details
if [ -d "dist" ]; then
  echo -e "\nOutput packages:"
  ls -lh dist/ | grep -E '\.(dmg|zip)$' | while read -r line; do
    echo -e " - ${BLUE}${line}${NC}"
  done
else
  echo -e "${RED}Error: Build finished but output folder 'dist' was not found.${NC}"
  exit 1
fi

# ─── Phase 4: Git Commit, Tag & Push ─────────────────────────────────────────

echo -e "\n${BLUE}[6/8] Committing changes...${NC}"
git add -A
git commit -m "chore: release v${NEW_VERSION}"
echo -e "${GREEN}Committed changes${NC}"

echo -e "\n${BLUE}[7/8] Creating git tag...${NC}"
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
echo -e "${GREEN}Tagged v${NEW_VERSION}${NC}"

echo -e "\n${BLUE}[8/8] Pushing to origin...${NC}"
git push origin main --follow-tags
echo -e "${GREEN}Pushed commit + tag to origin${NC}"

# ─── GitHub Release ─────────────────────────────────────────────────────────

# Collect built artifacts using shell globbing (safe for spaces)
ARTIFACTS=()
for file in dist/*.dmg dist/*.zip; do
  [ -f "$file" ] && ARTIFACTS+=("$file")
done

if command -v gh &> /dev/null && [ ${#ARTIFACTS[@]} -gt 0 ]; then
  echo -e "\n${BLUE}Creating GitHub Release...${NC}"
  if [ "$IS_PRERELEASE" = true ]; then
    gh release create "v${NEW_VERSION}" "${ARTIFACTS[@]}" --title "v${NEW_VERSION}" --generate-notes --prerelease
  else
    gh release create "v${NEW_VERSION}" "${ARTIFACTS[@]}" --title "v${NEW_VERSION}" --generate-notes
  fi
  echo -e "${GREEN}GitHub Release created!${NC}"
else
  if ! command -v gh &> /dev/null; then
    echo -e "\n${DIM}Tip: Install GitHub CLI (gh) to auto-create releases${NC}"
  fi
fi

# Summary
echo ""
echo -e "${BOLD}Release Summary${NC}"
echo -e "  Version:      ${CYAN}v${NEW_VERSION}${NC}"
if [ "$IS_PRERELEASE" = true ]; then
  echo -e "  Type:         ${YELLOW}Pre-release${NC}"
  echo -e "  Auto-update:  ${DIM}Users will NOT be auto-notified${NC}"
else
  echo -e "  Type:         ${GREEN}Stable${NC}"
  echo -e "  Auto-update:  ${GREEN}Users will be notified automatically${NC}"
fi
echo -e "  Git:          ${GREEN}Committed, tagged, pushed ✓${NC}"
echo ""
echo -e "${GREEN}Done! 🎉${NC}"
