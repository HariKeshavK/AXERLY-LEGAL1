import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    /* config options here */
    reactCompiler: true,
    typescript: {
        // `next build` type-checks this program instead of tsconfig.json. It
        // excludes test files, so the production image (built from an
        // allowlisted Docker context, see Dockerfile) never depends on test
        // fixtures or sibling apps. Tests are type-checked by `npm run
        // typecheck` (tsc over tsconfig.json) in CI instead.
        tsconfigPath: "tsconfig.build.json",
    },
    turbopack: {
        root: __dirname,
    },
    async rewrites() {
        return [
            {
                source: "/sitemap.xml",
                destination: "/api/sitemap/sitemap.xml",
            },
            {
                source: "/sitemap_:slug.xml",
                destination: "/api/sitemap/sitemap_:slug.xml",
            },
        ];
    },
    async redirects() {
        return [
            {
                source: "/account",
                destination: "/settings",
                permanent: true,
            },
            {
                source: "/account/:path*",
                destination: "/settings/:path*",
                permanent: true,
            },
        ];
    },
    skipTrailingSlashRedirect: true,
};

export default nextConfig;
