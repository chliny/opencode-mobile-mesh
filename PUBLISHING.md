# Publishing Releases

This repository distributes Android builds as signed APKs through GitHub Releases:
`https://github.com/chliny/opencode-mobile-mesh/releases`.

Google Play, F-Droid, and iOS publishing are not maintained here.

## Required GitHub Secrets

Configure these in **Settings > Secrets and variables > Actions**:

| Secret | Description |
|--------|-------------|
| `KEYSTORE_BASE64` | Base64-encoded release keystore (`base64 -w0 release.keystore`) |
| `KEYSTORE_PASSWORD` | Keystore password |
| `KEY_ALIAS` | Key alias in the keystore |
| `KEY_PASSWORD` | Key password |

## Create a Release Keystore

```bash
keytool -genkeypair -v -storetype PKCS12 \
  -keystore release.keystore -alias release \
  -keyalg RSA -keysize 2048 -validity 10000
```

Encode the keystore for the `KEYSTORE_BASE64` secret:

```bash
base64 -w0 release.keystore
```

## Releasing

1. Bump `package.json` `version`, `app.json` `expo.version`, `android/app/build.gradle` `versionName`, and `versionCode` in both `app.json` and `build.gradle`.
2. Run `npm run check:versions` and add `distribution/changelogs/<versionCode>.txt`.
3. Merge the release commit to `main`.
4. Tag it with `git tag -a vX.Y.Z <sha> -m "..." && git push origin vX.Y.Z`.
5. Verify the `build.yml` run is green and that the GitHub Release includes its signed APK.

The app's update check polls this repository's latest GitHub Release.
