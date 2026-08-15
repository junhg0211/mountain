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

After saving the mapping, open a server text channel, choose Mountain from the App Launcher, and
confirm that Basecamp opens without showing the normal browser OAuth page.

## Basecamp permissions and first setup

The bot needs **Manage Channels** and **Manage Roles** in every server that uses Basecamp. Its bot
role must sit above the chosen Basecamp access role. A server manager then opens `/world`, chooses
the category for Basecamp voice channels and a non-managed access role. Mountain
creates a `월드 광장` lobby voice channel immediately. Rooms drawn and confirmed inside the world
create their own voice channels in that same category.

Mountain owns the lobby and room channel overrides. The configured Basecamp access role can connect
to `월드 광장` but cannot speak there. Room channels deny Connect to members while allowing Speak,
so members can enter them only when Mountain moves an already-connected member from the lobby.
Mountain receives an explicit Connect override on both channel types. Existing Discord restrictions
such as timeouts still apply.

Basecamp interactions run through the authenticated `/ws/basecamp` WebSocket served by `server.ts`.
Configuration and room creation never submit or reload the page. Every successful mutation
broadcasts the latest guild-scoped world state to connected clients; disconnected clients obtain a
new single-use ticket and resynchronize automatically without refreshing the Activity.
Connected members move with the arrow keys or WASD. Their server-validated positions, Discord
display names, and avatars are broadcast to the guild world, and the client detects when its avatar
crosses into an active room without reloading the page.
The configured access role is granted while a member has an active Basecamp WebSocket and removed
ten seconds after their final connection closes, allowing brief automatic reconnects. Room and
lobby panels open the `월드 광장` voice-channel URL for the user's initial join. After that, a
per-guild toggle lets the bot move the already-connected member between the lobby and room voice
channels whenever the avatar crosses a room boundary. This requires the bot's **Move Members** and
**Connect** permissions; Discord does not allow a bot to connect a user who is not already in voice.
Voice moves wait until the avatar has remained on the new side of a boundary for 300 milliseconds;
crossing back during that interval cancels the pending move and prevents channel churn.
Managers can select active rooms in construction mode, drag to reposition them, resize from the
corner handle, rename the linked room and voice channel together, or delete both after confirmation.
They can also draw horizontal or vertical walls along the boundaries between grid cells and remove
a wall by selecting it while the wall tool is active. Walls are guild-scoped, synchronized through
the Basecamp WebSocket, and enforced as line-crossing barriers by both client and server movement
collision checks. All edit coordinates and overlap rules are revalidated on the server.

## Authentication flow

1. `ActivityAuth.svelte` detects Discord's Activity frame parameters and initializes `DiscordSDK`.
2. The SDK requests `identify` and `guilds` and returns a one-time authorization code.
3. `/api/activity/login` exchanges that code using `CLIENT_SECRET` on the server, fetches the user
   and mutual guilds, then creates a seven-day HTTP-only Activity session.
4. The access token is returned only long enough for `commands.authenticate` and is never stored in
   the database or browser storage.
5. A guild Activity redirects to that guild's `/world` Basecamp after authentication.
   Discord's `frame_id` and `instance_id` query parameters are preserved across this redirect and
   guild switching so later Embedded App SDK commands can reuse the Activity frame context.

Normal browser sessions remain `SameSite=Lax`. Activity sessions are `Secure`, `SameSite=None`, and
`Partitioned` so they work in Discord's sandboxed iframe without becoming general third-party
cookies.

## Verification checklist

- Opening the public site directly still uses `/api/login` and the browser OAuth callback.
- Opening from Discord authenticates without navigating away from the Activity.
- The selected dashboard guild is one shared by the user and the bot.
- Reloading commands leaves the type-4 Entry Point command present.
- Logging out invalidates the server-side session.
