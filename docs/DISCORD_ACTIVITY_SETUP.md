# Discord Activity setup

Mountain serves its existing dashboard both as a normal website and as a Discord Activity. The
Activity uses Discord's Embedded App SDK for login; it does not replace browser OAuth.

## Developer Portal

1. Open the Mountain application in the Discord Developer Portal.
2. Under **Activities → Settings**, enable Activities.
3. Add a URL Mapping with prefix `/` and the production dashboard host as its target. Enter only
   the host (for example, `mountain.example.com`), not `https://`.
4. Keep the automatically-created global **Launch** Entry Point command. Mountain preserves this
   command when `REGISTER_COMMANDS=true` reloads the slash commands.
5. In installation settings, keep the `applications.commands` scope enabled so users can launch
   the Activity from Discord's App Launcher.
6. Confirm the production server exposes HTTPS. Discord proxies the mapped host through
   `{CLIENT_ID}.discordsays.com`; the Activity session cookie depends on that secure origin.

After saving the mapping, open a server text or voice channel, choose Mountain from the App
Launcher, and confirm that the dashboard opens without showing the normal browser OAuth page.

## Authentication flow

1. `ActivityAuth.svelte` detects Discord's Activity frame parameters and initializes `DiscordSDK`.
2. The SDK requests `identify` and `guilds` and returns a one-time authorization code.
3. `/api/activity/login` exchanges that code using `CLIENT_SECRET` on the server, fetches the user
   and mutual guilds, then creates a seven-day HTTP-only Activity session.
4. The access token is returned only long enough for `commands.authenticate` and is never stored in
   the database or browser storage.

Normal browser sessions remain `SameSite=Lax`. Activity sessions are `Secure`, `SameSite=None`, and
`Partitioned` so they work in Discord's sandboxed iframe without becoming general third-party
cookies.

## Verification checklist

- Opening the public site directly still uses `/api/login` and the browser OAuth callback.
- Opening from Discord authenticates without navigating away from the Activity.
- The selected dashboard guild is one shared by the user and the bot.
- Reloading commands leaves the type-4 Entry Point command present.
- Logging out invalidates the server-side session.
