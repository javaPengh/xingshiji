#!/usr/bin/env bash
# Package this project's own Capacitor device application for personal signing.
# Run on a Mac with Xcode after npm run build and npx cap sync ios.
set -euo pipefail

APP_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_ROOT"
BUILD_ROOT="$APP_ROOT/build/ios"
SCHEME="${IOS_SCHEME:-App}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'iOS compilation requires macOS and Xcode. This script must run on the configured Mac build machine.' >&2
  exit 1
fi
command -v xcodebuild >/dev/null || { printf '%s\n' 'Xcode command-line tools are missing.' >&2; exit 1; }
mkdir -p "$BUILD_ROOT"
# Read all output before parsing: closing xcodebuild's stdout early (head) can
# raise NSFileHandleOperationException / SIGABRT on macOS.
XCODE_VERSION_OUTPUT="$(xcodebuild -version)"
XCODE_VERSION="$(printf '%s\n' "$XCODE_VERSION_OUTPUT" | awk 'NR == 1 {print $2}')"
if (( ${XCODE_VERSION%%.*} < 26 )); then
  printf '%s\n' 'Capacitor 8 requires Xcode 26 or newer.' >&2
  exit 1
fi

if [[ -d "$APP_ROOT/ios/App/App.xcworkspace" ]]; then
  PROJECT_ARGS=(-workspace "$APP_ROOT/ios/App/App.xcworkspace")
elif [[ -d "$APP_ROOT/ios/App/App.xcodeproj" ]]; then
  PROJECT_ARGS=(-project "$APP_ROOT/ios/App/App.xcodeproj")
else
  printf '%s\n' 'Missing ios/App project. Run npx cap add ios, npm run build, and npx cap sync ios first.' >&2
  exit 1
fi

xcodebuild \
  "${PROJECT_ARGS[@]}" \
  -scheme "$SCHEME" \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$BUILD_ROOT/DerivedData" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= \
  build 2>&1 | tee "$BUILD_ROOT/xcodebuild-release.log"

BUILT_APP="$BUILD_ROOT/DerivedData/Build/Products/Release-iphoneos/App.app"
if [[ ! -d "$BUILT_APP" ]]; then
  printf '%s\n' "The build did not produce $BUILT_APP; inspect xcodebuild-release.log." >&2
  exit 1
fi
EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$BUILT_APP/Info.plist")"
ARCHITECTURES="$(xcrun lipo -archs "$BUILT_APP/$EXECUTABLE")"
if [[ " $ARCHITECTURES " != *' arm64 '* ]]; then
  printf '%s\n' "Expected an arm64 iPhone device build, got: $ARCHITECTURES" >&2
  exit 1
fi

# A fresh staging directory belongs to this run and stays inside the project.
STAGING_DIR="$(mktemp -d "$BUILD_ROOT/.ipa-stage.XXXXXX")"
mkdir -p "$STAGING_DIR/Payload"
ditto "$BUILT_APP" "$STAGING_DIR/Payload/App.app"
IPA_PATH="$BUILD_ROOT/xingshiji-unsigned.ipa"
ditto -c -k --keepParent "$STAGING_DIR/Payload" "$IPA_PATH"
shasum -a 256 "$IPA_PATH" > "$IPA_PATH.sha256"
node --input-type=module - "$BUILD_ROOT/build-info.json" "$ARCHITECTURES" "$XCODE_VERSION" <<'NODE'
import fs from 'node:fs';
import {APP_VERSION} from './shared/version.mjs';
fs.writeFileSync(process.argv[2],JSON.stringify({format:'xiaoka-ios-build',createdAt:new Date().toISOString(),version:APP_VERSION,architectures:process.argv[3],xcode:process.argv[4],apiBase:process.env.VITE_API_BASE_URL||null,authMode:process.env.VITE_AUTH_MODE||null,signed:false,installReady:false,deviceTested:false},null,2));
NODE

printf '\n%s\n' "Prepared unsigned IPA: $IPA_PATH" \
  'This file is not signed or install-ready. Sign this self-built app using the chosen personal-device installation workflow.'
