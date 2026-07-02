import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1 MB. The new-stage form bundles several
      // compressed JPEGs (~300-400 KB each) in a single submit, and
      // photo uploads on the stage detail page can also batch
      // multiple files. 25 MB is enough headroom for ~60 photos.
      bodySizeLimit: "25mb",
    },
    // Router Cache lifetimes. `dynamic` defaults to 0, so navigating
    // BACK to a force-dynamic list page (stages/groups, board, calendar,
    // finance, clients…) refetched the whole RSC every time — the heavy
    // 801-stage query + ~800 photo signings — which is exactly why
    // "back after viewing a stage" felt slow. 60s lets that forward
    // navigation reuse the cached page so it's instant. Mutations still
    // call revalidatePath() to bust the cache, so real changes show up.
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
  },
};

export default nextConfig;
