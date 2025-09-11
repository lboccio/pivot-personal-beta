export async function verifyGoogleIdToken(idToken) {
  if (!idToken) return null;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!r.ok) return null;
    const data = await r.json();
    const aud = data.aud;
    const allowed = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (allowed && aud !== allowed) return null;
    return {
      sub: data.sub,
      email: data.email,
      name: data.name || data.email,
      picture: data.picture,
      iss: data.iss,
    };
  } catch {
    return null;
  }
}

