# The web app (Next.js). Built from the repo root, as Railway does with
# RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile. AGENT_URL and NEXT_PUBLIC_API_URL go into the build:
# the page calls the agent under this app's own origin, /agent (next.config.ts).
FROM node:22-slim
RUN npm install -g pnpm@10.30.3
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY services/agent/package.json services/agent/
RUN pnpm install --frozen-lockfile --filter buddha-gpt-web...
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG AGENT_URL
ARG NEXT_PUBLIC_API_URL
ENV AGENT_URL=$AGENT_URL NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/web
RUN pnpm build
EXPOSE 5005
CMD ["pnpm", "start"]
