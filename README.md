# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Local development

1. Install dependencies once with `npm install`.
2. Copy `.env.example` to `.env.local` if it exists (or create `.env.local` manually) and add the environment variables listed below.
3. Start the dev server with `npm run dev` and visit the URL that Vite prints (by default [http://localhost:5173](http://localhost:5173)).
4. Build for production with `npm run build` and preview with `npm run preview`.

## Environment variables

Pivot currently expects four Vite env vars – Google Maps, Google Identity Services, and the Supabase project the login flow syncs against:

```
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key
VITE_GOOGLE_CLIENT_ID=your_google_oauth_client_id.apps.googleusercontent.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=public-anon-key
```

Store them in `.env.local` so `vite` can expose them during development. Re-run `npm run dev` after changing the file.

## Google login setup

1. Visit [https://console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) and select (or create) the project that owns your Maps key.
2. Click **Create Credentials → OAuth client ID**. Choose **Web application**.
3. Add `http://localhost:5173` (or whatever host/port you use locally) to **Authorized JavaScript origins**. If you plan to deploy elsewhere, add that origin too.
4. Copy the generated **Client ID** and set it as `VITE_GOOGLE_CLIENT_ID` in `.env.local`.
5. Restart `npm run dev`. The header now shows the Google Sign-In button when the script loads. Signing in stores a lightweight profile (name, email, avatar) locally so you can gate future features behind the Gmail login.

## Login behavior

- Everyone can open shared/view-only links, but editing controls (start location, vibes, plan builder, comments, etc.) stay disabled until you sign in with Google.
- Signing in unlocks the entire editor and automatically syncs your profile into Supabase’s `users` table via an upsert keyed by the Google `sub` (or email).
- If you share a `?view=1` link, even signed-in editors stay read-only; remove the query or sign in from the regular URL to edit again.
