# Build from the repository root: `docker build -f frontend/Dockerfile .`
# (docker-compose.yml does the same). The image needs the frontend plus the
# one sibling directory production code reaches through a tsconfig `paths`
# alias: `@mike/contracts` -> /packages/contracts. Nothing else. `next build`
# type-checks tsconfig.build.json, which leaves test files -- and their
# imports of shared fixtures and add-in sources -- out of the image.
#
# A new outside dependency needs a COPY here and a tsconfig alias that
# resolves to the same path; frontend/src/__tests__/architecture.test.ts
# checks that the two agree, and .github/workflows/docker-images.yml builds
# this file in CI so a miss fails the pull request, not the next fresh install.
FROM node:22-slim

WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
COPY packages/contracts /packages/contracts

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
