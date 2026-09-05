# r/selfhosted — copy-paste ready

> **Subreddit:** r/selfhosted (~400k+ members)
> **Flair:** `Release` (use Release for an app launch; if not available, use `Product Announcement`).
> **Rules that matter here:** Self-promotion is allowed for your own project but must be genuinely self-hostable and you must be present to answer questions. Lead with the self-hosting angle, not the AI hype. No URL shorteners. Do NOT post the same title/body to multiple subreddits the same day (looks like spam and r/selfhosted mods notice).
> **Best time:** Weekday mornings US Eastern (8–11am ET). This community skews US/EU.

---

**Title:**

```
OpenCode Mobile – Android client for your self-hosted opencode AI coding agent (MIT, no backend, your keys)
```

**Body:**

I run [opencode](https://github.com/sst/opencode) on my home server for AI-assisted coding. Great at the desk — away from the desk, I had nothing. So I built a mobile client.

**What it is**

OpenCode Mobile connects to your *own* opencode server over whatever you already use to reach home — local Wi-Fi, Tailscale, Cloudflare Tunnel, or ngrok. You type the server URL into the app and that's your entire infrastructure footprint. No cloud service of mine ever touches your traffic.

- Token-by-token streaming chat from your server
- Inline diff viewer for every file change the agent proposes
- Tool-call approval — you explicitly approve file writes and shell commands before they execute
- Multiple saved connections (home server, VPS, work box)
- Biometric unlock; connection secrets in the Android Keystore
- MIT licensed, source on GitHub

**What it is not**

Not a standalone AI model. You need opencode running:

```
npm install -g opencode-ai
OPENCODE_SERVER_PASSWORD=yourpassword opencode serve --hostname 0.0.0.0 --port 4096
```

Your API keys stay on your server. No accounts, no analytics, no proprietary backend. Sentry crash reporting is opt-in and off by default.

**Install**

- Direct APK: https://github.com/chliny/opencode-mobile-mesh/releases/latest
- Source: https://github.com/chliny/opencode-mobile-mesh

Happy to answer anything about the tunnel setup or the API. Feedback welcome, especially from anyone already self-hosting opencode.
