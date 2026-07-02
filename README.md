# Kick Hot Words App

Railway-ready Node.js app that tracks hot words/phrases in Kick chat and shows a dashboard plus OBS overlay.

## Features

- Connects to a Kick channel chat
- Counts any configured hot words/phrases
- Live dashboard at `/`
- OBS overlay at `/overlay`
- Reset counts
- Change hot words from the dashboard
- Test-message button for checking the UI

## Railway setup

1. Upload this folder to GitHub.
2. In Railway, create a new project from that GitHub repo.
3. Add Variables:

```env
KICK_CHANNEL=yourkickname
HOT_WORDS=maxwin,bonus,retrigger,scam,juice
ADMIN_PIN=1234
```

Do not manually set `PORT`; Railway provides it.

4. Deploy.
5. Open your Railway domain:

- Dashboard: `https://your-app.up.railway.app/`
- OBS overlay: `https://your-app.up.railway.app/overlay`

## Local setup

```bash
npm install
copy .env.example .env
npm start
```

Then open:

- http://localhost:3000/
- http://localhost:3000/overlay

## Notes

This app uses the community `@retconned/kick-js` package for Kick chat. If Kick changes chat internals, the package may need an update.
