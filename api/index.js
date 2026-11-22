// Vercel function: every /api/* request is rewritten here (see vercel.json) and handled by the
// Express app, bundled by `npm run bundle -w backend` during the Vercel build.
export { default } from "../backend/dist/app.js";
