/** @type {import('next').NextConfig} */
const nextConfig = {
  // ffmpeg-static contient un binaire natif : on le charge tel quel (pas de
  // bundling) et on force son inclusion dans la fonction serverless du bot,
  // sinon le traceur Next/Vercel ne le voit pas et il manque en production.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/telegram/webhook": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};
export default nextConfig;
