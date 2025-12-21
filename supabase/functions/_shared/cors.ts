export const corsHeaders = (origin: string | null) => {
  const allowed = new Set<string>([
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    // Add deployed domains (e.g., Netlify, GitHub Pages) to allow production traffic.
  ]);

  const allowOrigin =
    origin && allowed.has(origin) ? origin : "http://127.0.0.1:5500";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
};
