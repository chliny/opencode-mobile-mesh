# Embedded ZeroTier transport (Android)

OpenCode embeds the official `zerotier/libzt` userspace socket library. It does
not declare an Android `VpnService`, create a TUN interface, change routes, or
occupy Android's single VPN slot.

## Traffic path

- At home, the app probes the connection's normal LAN URL and uses it directly.
- If that health check fails, the app starts libzt, joins the configured network,
  and opens a random TCP listener bound only to `127.0.0.1`.
- If a private network still needs authorization, the connection error includes
  the stable ZeroTier node ID to approve in the network controller.
- The existing HTTP and SSE SDK connects to that listener. Each accepted stream
  is relayed to the configured ZeroTier IP with `ZeroTierSocket`.
- On foreground and every 30 seconds while active, the app probes LAN again. A
  successful probe switches HTTP/SSE back to LAN and stops libzt.

Only OpenCode requests pointed at the private relay use libzt. Other apps and
Android system traffic are never routed by this feature. A separately enabled
system VPN remains possible; if that VPN captures OpenCode itself, libzt's
underlying UDP packets may also traverse it, so exclude `cc.agentlabs.opencode`
in that VPN when direct ZeroTier underlay traffic is desired.

## Custom planet files

The document picker hands a temporary content URI to the native module. The
module validates libzt's 4096-byte state limit, computes SHA-256, and stores a
content-addressed copy under the app's no-backup private directory. Before node
startup the selected binary is copied to libzt's `<node-storage>/roots` state
file and automatic roots caching is disabled so the custom planet remains
authoritative. Removing the selection restores libzt's compiled-in default.

## Current constraints

- The ZeroTier OpenCode endpoint must be a numeric IPv4/IPv6 address.
- It must use `http://`. HTTPS terminates against the localhost relay and would
  require a certificate/hostname-aware native HTTP transport; the UI rejects it
  instead of silently weakening certificate validation.
- The node runs with the app process. This implementation intentionally does not
  add a persistent foreground Android service.

## Source and build

`third_party/libzt` is a git submodule pinned to a reviewed commit; its own
ZeroTierOne and lwIP dependencies are recursive submodules. Clone with:

```sh
git submodule update --init --recursive
```

The Expo local module compiles libzt from source through CMake for Android ABIs.
No prebuilt ZeroTier AAR is downloaded. See the upstream license files inside
the submodule; their stated change dates have converted the pinned libzt and
ZeroTierOne works to Apache License 2.0.

The Android toolchain requires JDK 17, Node.js and npm, CMake and Ninja,
Android SDK Platform 36, Build Tools 36.0.0, NDK 27.1.12297006, and CMake
3.30.5.

The simplest setup is Android Studio's SDK Manager ("SDK Platforms" and "SDK
Tools" tabs cover everything above). To set up from the command line instead,
install the [Android SDK command-line tools](https://developer.android.com/studio#command-line-tools-only)
and run (adjust `ANDROID_HOME` and `JAVA_HOME` for your platform):

```sh
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
# Point JAVA_HOME at any JDK 17 installation, e.g.:
#   macOS:      "$(/usr/libexec/java_home -v 17)"
#   Linux:      /usr/lib/jvm/java-17-openjdk
sdkmanager --sdk_root="$ANDROID_HOME" --licenses
sdkmanager --sdk_root="$ANDROID_HOME" \
  "platform-tools" \
  "platforms;android-36" \
  "build-tools;36.0.0" \
  "ndk;27.1.12297006" \
  "cmake;3.30.5"
```

On Linux, connecting a physical Android device over ADB additionally requires
udev rules for your device vendor (most distributions ship these in an
`android-udev`-style package or via plugdev membership).

Initialize the recursive submodules and build a local release APK with Sentry
upload disabled when no release token is configured:

```sh
git submodule update --init --recursive
npm ci
npx expo prebuild --platform android --no-install
cd android
NODE_ENV=production SENTRY_DISABLE_AUTO_UPLOAD=true ./gradlew assembleRelease
```
