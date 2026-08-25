#!/usr/bin/env bash
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
module="$root/modules/opencode-tailscale"
ndk="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"

if [[ -z "$ndk" ]]; then
  printf '%s\n' 'ANDROID_NDK_HOME or ANDROID_NDK_ROOT must point to an Android NDK.' >&2
  exit 1
fi

host_tag="linux-x86_64"
if [[ ! -d "$ndk/toolchains/llvm/prebuilt/$host_tag/bin" ]]; then
  host_tag="linux-x86_64"
fi
toolchain="$ndk/toolchains/llvm/prebuilt/$host_tag/bin"
if [[ ! -x "$toolchain/aarch64-linux-android24-clang" ]]; then
  printf 'Android NDK toolchain is unavailable at %s\n' "$toolchain" >&2
  exit 1
fi

declare -A targets=(
  [arm64-v8a]='arm64:aarch64-linux-android24-clang'
  [armeabi-v7a]='arm:armv7a-linux-androideabi24-clang'
  [x86]='386:i686-linux-android24-clang'
  [x86_64]='amd64:x86_64-linux-android24-clang'
)

for abi in arm64-v8a armeabi-v7a x86 x86_64; do
  IFS=: read -r goarch compiler <<< "${targets[$abi]}"
  output="$module/android/src/main/jniLibs/$abi"
  mkdir -p "$output"
  (
    cd "$module/go"
    CGO_ENABLED=1 GOOS=android GOARCH="$goarch" CC="$toolchain/$compiler" \
      go build -trimpath -buildvcs=false -buildmode=c-shared \
      -o "$output/libopencode_tsnet.so" .
  )
  rm -f "$output/libopencode_tsnet.h"
done
