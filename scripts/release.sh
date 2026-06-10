#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
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

# 4. Read version from package.json
if [ -f "package.json" ]; then
  VERSION=$(bun -e "console.log(require('./package.json').version)")
  PRODUCT_NAME=$(bun -e "console.log(require('./package.json').build.productName || 'Dev Life')")
  echo -e "Building ${GREEN}${PRODUCT_NAME}${NC} (v${VERSION})"
else
  echo -e "${RED}Error: package.json not found in current directory.${NC}"
  exit 1
fi

# 5. Clean old build folders
echo -e "\n${BLUE}[1/4] Cleaning previous build artifacts...${NC}"
rm -rf out dist
echo -e "${GREEN}Cleaned!${NC}"

# 6. Install dependencies
echo -e "\n${BLUE}[2/4] Installing dependencies...${NC}"
bun install

# 7. Build renderer and main process
echo -e "\n${BLUE}[3/4] Compiling frontend & backend assets...${NC}"
bun run build

# 8. Package Electron App without signing
echo -e "\n${BLUE}[4/4] Packaging application for macOS (No Signing)...${NC}"
# CSC_IDENTITY_AUTO_DISCOVERY=false bypasses macOS keychain code signing search
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
