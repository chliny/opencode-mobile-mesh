# Data Reporting and Environment Configuration

This document is the source of truth for outbound data paths and the
environment variables that enable them.

The app is a client for a user-selected OpenCode server. Requests to that
server are expected product traffic and are not included in the optional
telemetry paths below.

## Current Status

The current code restores consent-gated crash reporting and analytics:

- `app/_layout.tsx` initializes Sentry only after persisted consent is granted
  and wraps the root layout for native/React crash coverage.
- `src/components/ErrorBoundary.tsx` reports React render failures after the
  consent-gated Sentry initialization.
- `src/lib/telemetry.ts` starts and stops Sentry and PostHog together.
- Missing Sentry, PostHog, or Chatwoot environment variables disable only the
  corresponding integration; there are no default telemetry destinations.

The `@sentry/react-native` package, `src/lib/sentry.ts`, and the Android
`sentry.gradle` integration remain in the project. They do not send runtime
events unless the application code initializes Sentry.

The Sentry Expo config plugin was removed from `app.json`. The native Sentry
dependency and Android Gradle integration remain available, while the runtime
destination is still controlled by `EXPO_PUBLIC_SENTRY_DSN`.

## Optional Reporting Channels

### Sentry crash reporting

| Item | Details |
|---|---|
| Purpose | Crash, uncaught exception, unhandled rejection, and selected diagnostic reporting |
| Code | `src/lib/sentry.ts`, `src/lib/telemetry.ts`, `src/components/ErrorBoundary.tsx`, `app/_layout.tsx` |
| Runtime destination | The Sentry DSN supplied by `EXPO_PUBLIC_SENTRY_DSN` |
| Consent | Enabled only after telemetry consent; the Settings toggle can revoke it |
| Missing DSN | `initSentry()` is a no-op |
| Data handling | `sendDefaultPii: false`; URL, host, credentials, token, password, authorization, and similar fields are redacted; console breadcrumbs are dropped |
| Important limit | Scrubbing reduces exposure but cannot guarantee that every third-party error string is free of user data |

Sentry can receive:

- React render crashes
- Global JavaScript exceptions
- Unhandled Promise rejections
- Native Android/iOS crashes when native Sentry initialization is active
- Selected connection diagnostics through `captureDiagnostic()`

The Sentry noise gate drops known client-side transport noise and repeated
errors, but genuine crashes are designed to pass through.

If Sentry is intentionally re-enabled, the code must initialize it and the
build must provide a DSN belonging to the intended Sentry project. The Expo
plugin is not required for the JavaScript wrapper, but native/source-map
behavior should be validated for the target platform after re-enabling it.

### PostHog product analytics

| Item | Details |
|---|---|
| Purpose | Explicit activation-funnel events such as app open, connection attempt, connection result, message sent, and response received |
| Code | `src/lib/analytics.ts`, `src/lib/telemetry.ts` |
| Required variables | `EXPO_PUBLIC_POSTHOG_KEY` and `EXPO_PUBLIC_POSTHOG_HOST` |
| Consent | Requires the app telemetry consent state to be granted |
| Missing variable | If either variable is missing, analytics is a strict no-op |
| Autocapture | Disabled; events are sent only through explicit `track()` calls |
| PII policy | Events use coarse typed properties and must not include server URLs, tokens, prompts, or file contents |

There is no hardcoded PostHog host. `EXPO_PUBLIC_POSTHOG_HOST` must contain
the complete destination URL, for example:

```text
EXPO_PUBLIC_POSTHOG_HOST=https://posthog.example.com
EXPO_PUBLIC_POSTHOG_KEY=your-project-key
```

When consent is revoked, the client blocks its transport and drops buffered
events instead of flushing them to the network.

### Chatwoot support reports

| Item | Details |
|---|---|
| Purpose | Deliver a diagnostic report to a support inbox after the user chooses to share a report |
| Code | `src/lib/diagnostics.ts`, `src/lib/chatwoot.ts` |
| Required variables | `EXPO_PUBLIC_CHATWOOT_INBOX_IDENTIFIER` and `EXPO_PUBLIC_CHATWOOT_BASE_URL` |
| Consent | `src/lib/diagnostics.ts` requires telemetry consent before sending |
| User action | Sending is initiated by the share-report flow; it is not an automatic crash upload |
| Missing variable | If either variable is missing, Chatwoot is disabled and no request is made |
| Data handling | The report is passed through URL/host redaction before support delivery |

There is no hardcoded Chatwoot base URL. The base URL must be supplied by the
build environment, for example:

```text
EXPO_PUBLIC_CHATWOOT_BASE_URL=https://chatwoot.example.com
EXPO_PUBLIC_CHATWOOT_INBOX_IDENTIFIER=public-inbox-identifier
```

The inbox identifier is a public client-side value, not an account-level
Chatwoot API token. Never ship an account-level Chatwoot token in the app.

## Other Outbound Requests

These paths are not optional telemetry, but they do send data outside the
device under their respective user action or runtime condition.

### User-selected OpenCode server

The SDK and SSE client send prompts, authentication headers, session data,
files, and other application traffic to the OpenCode server configured by the
user. This is the core function of the app and the destination is user
controlled.

Relevant code includes `src/lib/sdk.ts`, `src/stores/events.ts`, and the
connection stores/screens.

### Connection diagnostics

When a connection is tested or fails, the app probes:

- The user-configured OpenCode server health endpoint
- The user-configured OpenCode server root endpoint
- `https://www.gstatic.com/generate_204` as an internet reachability check

The diagnostics stay on-device unless the user shares a report. A shared
report can be delivered to Chatwoot only when Chatwoot is fully configured and
telemetry consent is granted.

### Update checks

On Android, the app checks GitHub Releases at:

```text
https://api.github.com/repos/dzianisv/opencode-mobile/releases/latest
```

The check is unauthenticated, throttled to once per 24 hours, and does not
send app identifiers or analytics properties. GitHub still observes the
request IP and standard HTTP metadata.

### User-opened links

Settings and onboarding contain links to documentation, the privacy policy,
and project pages. Opening these links sends normal browser traffic to the
selected website, but the app does not post telemetry payloads to those links.

## Environment Variables

### Runtime variables embedded in the app

Variables with the `EXPO_PUBLIC_` prefix are available to the JavaScript
bundle and must be treated as public. They can be extracted from an APK or
IPA. Do not put private API tokens in them.

| Variable | Required with | Effect when complete | Effect when missing |
|---|---|---|---|
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry initialization | Selects the Sentry event destination | Sentry wrapper is a no-op |
| `EXPO_PUBLIC_POSTHOG_KEY` | `EXPO_PUBLIC_POSTHOG_HOST` | Authenticates PostHog analytics | PostHog disabled |
| `EXPO_PUBLIC_POSTHOG_HOST` | `EXPO_PUBLIC_POSTHOG_KEY` | Selects the PostHog destination | PostHog disabled |
| `EXPO_PUBLIC_CHATWOOT_INBOX_IDENTIFIER` | `EXPO_PUBLIC_CHATWOOT_BASE_URL` | Selects the public Chatwoot inbox | Chatwoot disabled |
| `EXPO_PUBLIC_CHATWOOT_BASE_URL` | `EXPO_PUBLIC_CHATWOOT_INBOX_IDENTIFIER` | Selects the Chatwoot server | Chatwoot disabled |

### Build-only variables

These variables are used by Sentry's Gradle/source-map tooling and must not be
embedded in the app or exposed to client code:

| Variable | Purpose |
|---|---|
| `SENTRY_AUTH_TOKEN` | Source-map and release upload authentication |
| `SENTRY_ORG` | Sentry organization for build tooling |
| `SENTRY_PROJECT` | Sentry project for build tooling |
| `SENTRY_RELEASE` | Optional explicit release identifier; CI derives it from the app version |
| `SENTRY_DIST` | Optional distribution identifier; CI derives it from the app version |
| `SENTRY_DISABLE_AUTO_UPLOAD` | Disables automatic Sentry artifact upload in local/test builds |

`SENTRY_AUTH_TOKEN` is a private credential. It must never be placed in an
`EXPO_PUBLIC_*` variable, committed file, APK, or IPA.

## CI and Release Configuration

The following workflows pass optional public variables into the full-featured
builds:

- `.github/workflows/build.yml`
- `.github/workflows/publish-play-store.yml`
- `.github/workflows/publish-fdroid.yml`
- `.github/workflows/publish-app-store.yml` documents the EAS variables used by remote iOS builds

The main build and Play Store workflow currently map these GitHub Secrets:

```text
EXPO_PUBLIC_SENTRY_DSN
EXPO_PUBLIC_POSTHOG_KEY
EXPO_PUBLIC_POSTHOG_HOST
EXPO_PUBLIC_CHATWOOT_INBOX_IDENTIFIER
EXPO_PUBLIC_CHATWOOT_BASE_URL
SENTRY_AUTH_TOKEN
SENTRY_ORG
SENTRY_PROJECT
```

The F-Droid workflow maps Sentry and PostHog variables but intentionally does
not receive Chatwoot configuration. Its isolated build job in `build.yml`
also receives none of the telemetry secrets.

An unset GitHub Secret becomes an empty environment variable. Based on the
runtime guards above, that disables the corresponding optional integration;
it does not select a fallback upstream service.

## Deployment Profiles

### No optional reporting

Leave all of these unset:

```text
EXPO_PUBLIC_SENTRY_DSN
EXPO_PUBLIC_POSTHOG_KEY
EXPO_PUBLIC_POSTHOG_HOST
EXPO_PUBLIC_CHATWOOT_INBOX_IDENTIFIER
EXPO_PUBLIC_CHATWOOT_BASE_URL
```

The app still performs normal OpenCode server traffic, update checks, and
diagnostic probes.

### Crash reporting to a private Sentry project

Set:

```text
EXPO_PUBLIC_SENTRY_DSN=<your Sentry DSN>
SENTRY_AUTH_TOKEN=<private build token>
SENTRY_ORG=<your organization>
SENTRY_PROJECT=<your project>
```

Then ensure the application code explicitly initializes Sentry. Do not set
PostHog or Chatwoot variables unless those channels are also intended.

### Analytics to a private PostHog instance

Set both:

```text
EXPO_PUBLIC_POSTHOG_KEY=<your PostHog project key>
EXPO_PUBLIC_POSTHOG_HOST=https://<your PostHog host>
```

The user must still grant telemetry consent before events are sent.

## Verification Checklist

Before releasing a build, verify:

- No unintended hardcoded telemetry host remains in the source bundle.
- `EXPO_PUBLIC_*` values point to the intended projects.
- Private `SENTRY_AUTH_TOKEN` is present only in the build environment.
- Optional integrations are tested once with variables unset and once with the intended variables set.
- A release artifact is inspected, not just the build logs.
- Privacy policy and consent copy match the enabled integrations.
