# SpeedNet Technician App (Expo, Android + iOS)

Field app for technicians. Uses the **same backend + same Postgres** as the
office/partner web apps — no separate server or database.

## Backend requirements (already implemented)

- `Technician` role auto-seeded on server boot (`server/utilities/supportInit.js`)
  with `support.ticket.view` + `support.ticket.update` only
- `GET /api/support/tickets?mine=true` — logged-in tech's own tickets
- `PATCH /api/support/tickets/:id` — status/note/resolution (transitions enforced,
  re-assign blocked for techs)
- `POST /api/support/tickets/:id/comments`, `POST .../attachments` (photo)
- `POST /api/support/device-token` — FCM registration; push sent on assign
- Login `POST /api/auth/login` accepts `{ identifier, password }` where
  identifier = employee_id / phone / email, and returns `{ token, user }`

Assign the `Technician` role to technician users from Manage Roles, or:

```sql
UPDATE users SET role_id = (SELECT id FROM roles WHERE LOWER(name)='technician')
WHERE id = <technician_user_id>;
```

## Run (dev)

```bash
cd technician-app
npm install
npx expo install --fix
npx expo start
```

Scan the QR with Expo Go (login works; push needs a dev build, see below).
First screen asks for the office server URL — use `https://` (production).
Plain `http://` is accepted only for loopback/LAN test addresses and shows a
warning; never use HTTP for real work (logins can be overheard on WiFi).

## APK build (no Play Store — direct install)

**Option A — local build (used for v1, no cloud needed):**

```powershell
cd technician-app
npx expo prebuild --platform android
$env:JAVA_HOME = "<path-to-JDK17>"; $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$pass = Get-Content ..\secrets\android-keystore-pass.txt -Raw
.\android\gradlew.bat -p android assembleRelease `
  "-Pandroid.injected.signing.store.file=..\secrets\android-release.keystore" `
  "-Pandroid.injected.signing.store.password=$pass" `
  "-Pandroid.injected.signing.key.alias=technician" `
  "-Pandroid.injected.signing.key.password=$pass"
```

APK: `android/app/build/outputs/apk/release/app-release.apk` (~60 MB).
Keystore `secrets/android-release.keystore` (gitignored) — **backup it**;
সব future APK একই keystore-এ sign করতে হবে, নইলে update-এর সময়
uninstall করে reinstall লাগবে।

**Option B — EAS cloud:** `npx eas login` then
`npx eas build --platform android --profile preview` (note: cloud builds
errored repeatedly on 2026-09-20 with UNKNOWN_ERROR — local build works).

তারপর:

1. APK file technician-দের পাঠান (Drive / WhatsApp / USB)
2. Phone-এ install করার সময় **"Install unknown apps" → Allow** দিতে হবে
3. App open করে office **server URL** দিন (যে URL থেকে backend reachable —
   office network/VPN বা public URL), তারপর employee ID + password-এ login

নতুন version দিলে `app.json`-এ `versionCode` বাড়িয়ে আবার build করুন।

## Update workflow — কোন change-এ কী করতে হবে

Simple rule: **backend change হলে app-এ কিছু করতে হয় না। App-এর JS/UI
change হলে OTA update-ই যথেষ্ট। শুধু native change হলে নতুন APK লাগে।**

| Change type | Example | কী হয় | আপনাকে কী করতে হবে |
|---|---|---|---|
| Backend / API change | ticket API, role, push logic, SMS | Instant — app next open / refresh-এ নতুন data পায় | কিছু না — server deploy-ই শেষ |
| App JS / UI change | text, color, screen, bug fix (JS only) | OTA update — reinstall লাগে না | `npx eas update --branch preview --message '...'` |
| Native change | permission, SDK upgrade, নতুন native module, `app.json` plugin change | নতুন APK লাগবেই | `versionCode` বাড়িয়ে `eas build --profile preview` + APK পাঠান |
| Force-update | পুরনো app আর চালাতে দেবেন না | App open-এ "update করুন" message | Server env `MIN_APP_VERSION` / `LATEST_APP_VERSION` / `APP_APK_URL` / `APP_MESSAGE` set করুন |

### 1) Backend change — কিছু করতে হয় না

Server-এ deploy করলেই শেষ। App same backend URL ব্যবহার করে, তাই
পরের বার list/detail refresh করলেই নতুন behavior পাবে। APK বা OTA
কিছুই লাগে না।

### 2) App JS/UI change — OTA (`eas update`)

Reinstall ছাড়াই technician-দের phone-এ fix পৌঁছে যায়।

One-time setup (first time only — অন্য agent-রা `eas.json`-এ OTA
placeholder `projectId` + preview channel যোগ করছে, তারপর এই command):

```bash
cd technician-app
npx eas login
npx eas init        # first-time only: project link করে, app.json-এ projectId বসায়
```

তারপর প্রতিটা JS/UI fix-এ:

```bash
cd technician-app
npx eas update --branch preview --message 'fix: ticket status text'
```

Note: `app.json`-এ `version` / `versionCode` বাড়ানোর দরকার নেই OTA-তে।
Message-এ ছোট করে কী fix করলেন লিখুন, পরে খুঁজতে সুবিধা হবে।

### 3) Native change — নতুন APK + versionCode bump

এগুলো হলে OTA কাজ করবে না — নতুন APK build করতেই হবে:

- `app.json` → `android.permissions`, `plugins`, `googleServicesFile`
- Expo SDK upgrade
- নতুন native module (`expo-*` যাতে native code আছে)

Steps:

1. `app.json`-এ `android.versionCode` +1 করুন (1 → 2 → 3…)
2. Build করুন:

```bash
cd technician-app
npx eas build --platform android --profile preview
```

3. APK পাঠান (Drive / WhatsApp / USB) — phone-এ install, আগের মতো
   **"Install unknown apps" → Allow**।

`eas.json`-এ `preview` profile-টাই APK profile
(`"distribution": "internal"`, `"buildType": "apk"`) — এটাই ব্যবহার করুন।

### 4) Force-update — পুরনো version block করা

Server env দিয়ে control হয় (code change লাগে না):

- `MIN_APP_VERSION` — এর নিচে হলে app "update করুন" দেখাবে (block)
- `LATEST_APP_VERSION` — newest version number (info only)
- `APP_APK_URL` — নতুন APK-এর download link (Drive link ইত্যাদি)
- `APP_MESSAGE` — user-কে দেখানোর message, e.g. "নতুন APK install করুন"

Example (server-এর env file / hosting panel-এ):

```
MIN_APP_VERSION=1.0.0
LATEST_APP_VERSION=1.1.0
APP_APK_URL=${APK_DOWNLOAD_URL}
APP_MESSAGE=নতুন version এসেছে, APK install করুন
```

Force-update শুধু emergency-তে ব্যবহার করুন (যেমন পুরনো app-এ বড় bug)।

## Push notifications (FCM) — optional, later

Without Firebase config the app still fully works — push is fail-soft
(server logs `[Push] ... disabled`, SMS flow unaffected). Push চালু করতে:

1. Firebase project → Android app (`com.speednet.technician`) add →
   `google-services.json` এই folder-এ রাখুন (gitignored — never commit)
2. `app.json` → `android`-এ যোগ করুন:
   `"googleServicesFile": "./google-services.json"`
3. Server-এ service-account key (Project settings → Service accounts),
   env-এ set করুন: `GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/key.json`
4. আবার preview build করুন (Expo Go / plain APK-তে FCM আসে না —
   Firebase config + real device লাগে)

