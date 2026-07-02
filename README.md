# Kick Hot Words Pro

Railway-ready app for tracking hot words in Kick chat.

## What it does
- Watches public Kick chat through Kick/Pusher WebSocket.
- Counts hot words like `left`, `right`, `bonus`, `maxwin`.
- Dashboard at `/`.
- OBS overlay at `/overlay`.
- Admin PIN for reset/edit/test.
- CSV export at `/api/export.csv`.
- Top users per word.

## Railway variables
Add these in Railway > Variables:

```env
KICK_CHANNEL=yourkickname
HOT_WORDS=left,right,bonus,maxwin,retrigger,juice
ADMIN_PIN=1234
```

Do not include `@` or `kick.com/` in `KICK_CHANNEL`.

## If Kick blocks channel lookup
The app needs your numeric Kick chatroom ID. It tries to find this automatically.
If the dashboard shows an error saying it cannot find the chatroom ID, add this Railway variable:

```env
KICK_CHATROOM_ID=12345678
```

How to get it:
1. Open `https://kick.com/YOURNAME` in Chrome.
2. Right-click > Inspect > Network.
3. Refresh the page.
4. Search Network responses for `chatroom` or `chatroom_id`.
5. Copy the numeric `id` under `chatroom`.

## Deploy
1. Upload this folder to GitHub.
2. Create a Railway project from the GitHub repo.
3. Add the variables above.
4. Deploy.
5. Open:
   - Dashboard: `https://your-app.up.railway.app/`
   - OBS overlay: `https://your-app.up.railway.app/overlay`

## Local test
```bash
npm install
KICK_CHANNEL=yourkickname HOT_WORDS=left,right ADMIN_PIN=1234 npm start
```

Open `http://localhost:3000`.
