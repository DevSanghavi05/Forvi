// Vercel serverless entry. Vercel serves the built frontend (dist/) as static
// files and routes every /api/* request to this function (see vercel.json).
// The Express app handles the API + Google OAuth. No browser/Playwright, so it
// runs fine inside a serverless function.
import app from '../server/index.js';

export default app;
