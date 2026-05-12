# Discord-Voice (minimal)

Minimal Discord-inspired voice chat prototype.

Quick start (two terminals):

1) Server

```bash
cd server
npm install
npm start
```

2) Client

```bash
cd client
npm install
npm run dev
```

Defaults: server listens on `http://localhost:4000`, client on `http://localhost:5173`.

.env.example provided in `/server` — set `JWT_SECRET` for production use.

Netlify deployment notes
- Build the `client` as a static site and host the `server` on any HTTPS-capable host (Render, Fly, Railway, Heroku, etc.). Socket.io requires a server capable of WebSockets (Netlify Functions do not support persistent WebSocket connections).
- In Netlify, set an environment variable `VITE_SERVER_URL` to your server URL (e.g. `https://my-voice-server.example.com`). The client will use this at runtime to connect to Socket.io and the REST API.
- Ensure the server is served over HTTPS so the browser can establish secure WebRTC and WebSocket connections when the client is served over `https`.

Example Netlify `netlify.toml` (optional):
```toml
[build]
	publish = "dist"
	command = "cd client && npm ci && npm run build"

[dev]
	command = "npm --prefix server start & npm --prefix client run dev"
```

Recommended server hosts: Render, Fly, Railway, or a small VPS; pick one that provides an HTTPS endpoint and supports WebSockets.

Render deployment (server)
- This repo includes `render.yaml` to deploy the `server` to Render as a web service. The service runs `cd server && npm start` and expects `PORT` to be provided by Render.
- In Render Dashboard or via `render.yaml`, set the environment variables `JWT_SECRET` and `INVITE_TOKEN_SECRET`.
- After deployment you'll get a URL like `https://discord-voice-server.onrender.com`. Use that URL as the `VITE_SERVER_URL` value for your Netlify site (see below).

Netlify + Render example
- Build and publish the `client` on Netlify. In Netlify's site settings set an Environment Variable `VITE_SERVER_URL` to your Render URL, for example `https://discord-voice-server.onrender.com`.
- Ensure both client and server are served over HTTPS. Render provides HTTPS by default for web services.

Notes about WebSockets and Render
- Render fully supports WebSockets; Socket.io will use WebSocket transport when available. No additional configuration is required beyond ensuring the service is a web service with the correct start command.

