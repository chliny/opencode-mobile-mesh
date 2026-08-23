# OpenCode Mobile (ZeroTier Edition)

**The open-source Android client for the [opencode](https://github.com/sst/opencode) AI coding agent.**
AI-assisted coding from your phone — Android, via a direct APK or a build from source.

> **This edition** is a feature fork of [dzianisv/opencode-mobile](https://github.com/dzianisv/opencode-mobile)
> that embeds **ZeroTier mesh networking** directly in the app (no VPN slot, no tunnel service), adds a
> **session file browser with fullscreen diff review**, **subagent session navigation**, and a long list of
> reliability and performance fixes. See [Features](#features) and [ZeroTier Networking](#zerotier-networking).
> Based on upstream **v0.4.15**.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Download APK](https://img.shields.io/badge/Download-APK-green?logo=android)](https://github.com/chliny/opencode-mobile-zerotier/releases/latest)

> **Not affiliated with opencode.** OpenCode Mobile is an independent, community-built client and is
> not made by, endorsed by, or affiliated with the opencode / Anomaly team. It talks to an opencode
> server you run yourself, using opencode's open HTTP API.

---

**New: tap "Try a Demo" in the app to see the agent fix a real bug — reasoning, a grep, a diff, a permission prompt — in about 30 seconds, no server needed.**

**Also new: embedded ZeroTier networking — reach your self-hosted server over a ZeroTier mesh from anywhere, with automatic LAN ↔ ZeroTier failover and zero tunnel setup.**

---

## Install (Android)

There are **two ways** to install OpenCode Mobile today, both for Android:

1. **Direct signed APK** — download the latest release and install it manually:
   **https://github.com/chliny/opencode-mobile-zerotier/releases/latest**

2. **Build from source** — follow the instructions in [Contributing](#contributing).

> Google Play and F-Droid publishing are not maintained by this fork. iOS is not available (see [Roadmap](#roadmap)).

---

OpenCode Mobile is a React Native / Expo app that brings the power of the [opencode](https://github.com/sst/opencode) AI coding agent to your phone. Connect to your own self-hosted opencode server over your local network, a Cloudflare Tunnel, ngrok, Tailscale, or an embedded ZeroTier mesh network — and write, review, and ship code from anywhere. The mobile client is **free and open-source** under the MIT license. There is no feature gate, no telemetry you did not opt into, and no ad network.

---

<p align="center">
  <img src="distribution/demo.gif" width="240" alt="OpenCode Mobile demo — connect to your server, browse sessions, and watch the AI agent stream a reply" />
</p>

<sub>Real on-device capture: add a connection, browse sessions, and watch the agent stream a response. Verified end-to-end on an Android emulator against a live opencode server (build cc.agentlabs.opencode).</sub>

---

## Features

### Networking & connections

- **Embedded ZeroTier networking** — join a ZeroTier mesh network from inside the app (userspace `libzt`, no Android VPN slot) and reach your server from anywhere; the app probes LAN first and switches to ZeroTier only when needed, then switches back automatically ([details](#zerotier-networking))
- **Custom planet files** — point the embedded ZeroTier node at your own controller root via the document picker (content-addressed, SHA-256 verified)
- **Multi-connection** — manage multiple opencode servers (local network, Cloudflare Tunnel, ngrok, Tailscale, or ZeroTier)

### Coding sessions

- **Streaming chat** — token-by-token streaming responses directly from your opencode server
- **Session management** — browse, create, and resume coding sessions; per-session chat drafts survive switching between conversations
- **Subagent navigation** — jump straight into a subagent's session from its task tool card, and back out
- **Tool call approval** — review and approve (or reject) tool calls before the agent executes them
- **Model clarity** — proper catalog display names and actionable model errors surfaced in chat

### Code review

- **Fullscreen diff review** — every file change rendered as a colored, syntax-highlighted diff in a dedicated review screen at task end
- **Session file browser** — explore the workspace tree, open files, and inspect repository (VCS) status without leaving the session
- **Inline diffs** — apply-patch tool output rendered inline as readable diffs on message cards

### Reliability & performance

- **Resilient live updates** — SSE streams self-heal after network loss and reconnects; sessions reconcile automatically without restarting the screen (including over ZeroTier relays)
- **Faster startup** — reduced connection/session cold-start latency, cached recent-session lists, deferred diff prefetching
- **Fast file browsing** — cached workspace file trees for snappy directory navigation

### Privacy & security

- **Biometric unlock** — Face ID, Touch ID, or Android fingerprint protects the app and individual message sends
- **Secure credential storage** — server credentials stored in the Android Keystore via `expo-secure-store`
- **Notification privacy** — server content is kept off the lock screen
- **Explicit telemetry only** — crash reporting is opt-in and requires an explicit destination; connection failures are never auto-reported

### Extras

- **Offline demo mode** — tap "Try a Demo" to see a full bug-fix walkthrough (reasoning → grep → diff → permission prompt) with zero setup, right from the empty state
- **Comfortable input** — keyboard-overlap handling on Android, assistant text copy & selection, forgiving gestures for wide content, improved dark-mode contrast

---

## Quick Start

**Don't have a server yet?** Install the app and tap **Try a Demo** on the Sessions screen first — no setup required. It plays back a scripted bug-fix session through the app's real chat, diff, and permission-approval UI, offline, in about 30 seconds.

**Step 1 — Start opencode on your machine**

```bash
# Install opencode (if you haven't already)
npm install -g opencode-ai

# Run opencode in server mode
OPENCODE_SERVER_PASSWORD=yourpassword opencode serve --hostname 0.0.0.0 --port 4096
```

**Step 2 — Install OpenCode Mobile** via the [latest direct APK](#install-android) (or build from source — see [CONTRIBUTING.md](CONTRIBUTING.md)).

**Step 3 — Add a connection in the app**

Open the app, tap **Add Connection**, and choose your connection type:

- **Local network** — your machine's LAN IP, e.g. `http://192.168.1.100:4096`
- **Tunnel** — a Cloudflare Tunnel or ngrok URL, e.g. `https://my-opencode.trycloudflare.com`
- **Tailscale** — your machine's Tailscale IP, e.g. `http://100.x.x.x:4096`
- **ZeroTier** — your machine's ZeroTier-managed IP, e.g. `http://10.147.x.x:4096` — with this edition the app can join the ZeroTier network itself, no system VPN required ([details](#zerotier-networking))

Enter the password you set in Step 1, tap **Connect**, and you're in.

---

## How It Works

OpenCode Mobile is a thin client. It speaks the opencode HTTP + SSE API: listing sessions, sending messages, streaming responses, and subscribing to file-change events. All AI model calls are handled by your opencode server — you bring your own API keys (OpenAI, Anthropic, etc.) and the app never touches them. The app never proxies your code or conversation through our servers.

```
┌─────────────────────────────────────┐
│         OpenCode Mobile             │
│  (React Native / Expo, this repo)   │
└──────────────┬──────────────────────┘
                │  HTTP + SSE
                │  (LAN / tunnel / Tailscale / ZeroTier)
               ▼
┌─────────────────────────────────────┐
│       opencode server               │
│  (github.com/sst/opencode, MIT)     │
│  Running on your laptop / VPS       │
└──────────────┬──────────────────────┘
               │  API calls
               ▼
┌─────────────────────────────────────┐
│   Your AI provider                  │
│  (OpenAI / Anthropic / Gemini / …)  │
│  Your keys, your bill               │
└─────────────────────────────────────┘
```

---

## ZeroTier Networking

This edition embeds the official [`zerotier/libzt`](https://github.com/zerotier/libzt) userspace socket
library, compiled from source into the Android app. It does **not** declare an Android `VpnService`,
create a TUN interface, change routes, or occupy Android's single VPN slot — a separate system VPN can
still run alongside it.

How it works:

1. **LAN first** — the app probes the connection's normal LAN URL and uses it directly when reachable.
2. **ZeroTier fallback** — if the probe fails, the app starts the embedded ZeroTier node, joins the
   configured network, and relays HTTP + SSE traffic to your server's ZeroTier IP over a localhost listener.
3. **Automatic failback** — while active, LAN is re-probed every 30 seconds; a successful probe switches
   back to LAN and stops the node.
4. **Approvable joins** — if the network requires authorization, the connection error shows the stable
   ZeroTier node ID to approve in your network controller.

Constraints: the opencode endpoint must be a numeric IPv4/IPv6 address over `http://` (HTTPS is rejected
rather than silently weakening certificate validation). Full technical documentation, including custom
planet files and build requirements: [docs/embedded-zerotier.md](docs/embedded-zerotier.md).

---

## Project Status

**Current version: v0.4.15 (ZeroTier Edition)**

| Feature | Status |
|---|---|
| Embedded ZeroTier networking | Stable |
| Session file browser + fullscreen diff review | Stable |
| Subagent session navigation | Stable |
| Offline demo mode | Stable |
| First-run onboarding clarity | Stable |
| Multi-connection management | Stable |
| Session list + creation + per-session drafts | Stable |
| Streaming chat | Stable |
| Diff viewer (inline + fullscreen) | Stable |
| Biometric unlock | Stable |
| Tool call approval UI | Stable |
| SSE auto-recovery / resilient live updates | Stable |
| Sentry crash reporting (opt-in) | Stable |
| Custom ZeroTier planet files | Stable |
| Cloudflare / ngrok tunnel wizard | Beta |
| iPad / tablet layout | Planned |
| Offline session history | Planned |

---

## Roadmap

Tracked on the [GitHub Projects board](https://github.com/chliny/opencode-mobile-zerotier/projects) and in the [open milestones](https://github.com/chliny/opencode-mobile-zerotier/milestones).

Near-term priorities:
- opencode Cloud one-tap connect + managed hosting
- Tunnel setup wizard (Cloudflare / ngrok / Tailscale)
- iPad / tablet layout
- Offline session history cache

---

## Contributing

We welcome bug reports, feature requests, and pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up a dev environment and the contribution process.

**Building from source** (required for the ZeroTier Edition): the app compiles `libzt` from source via a
pinned git submodule, so clone recursively first:

```sh
git submodule update --init --recursive
```

Toolchain requirements (JDK 17, NDK 27, CMake 3.30.5, …) and step-by-step build instructions are in
[docs/embedded-zerotier.md](docs/embedded-zerotier.md).

---

## Privacy

OpenCode Mobile does not collect personal data. Optional Sentry crash reporting (opt-in, off by default) sends anonymised crash traces to Sentry. No analytics SDKs are bundled. Credentials are stored exclusively on-device in the OS keystore.

Full privacy policy: [dzianisv.github.io/opencode-mobile/privacy](https://dzianisv.github.io/opencode-mobile/privacy/)

---

## License

MIT — see [LICENSE](LICENSE).

Copyright (c) 2026 VIBE TECHNOLOGIES, LLC

---

## Acknowledgments

- [sst/opencode](https://github.com/sst/opencode) — the AI coding agent this app connects to (MIT)
- [Expo](https://expo.dev) — the React Native toolchain powering the app
- Every contributor who filed a bug, opened a PR, or starred the repo
