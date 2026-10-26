# The agent (Express and the AI SDK). Built from the repo root, as Railway does with
# RAILWAY_DOCKERFILE_PATH=services/agent/Dockerfile: it needs the workspace, the prompts and
# policy.yaml, which it reads from the repo's layout at startup.
FROM node:22-slim
RUN npm install -g pnpm@10.30.3
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY services/agent/package.json services/agent/
RUN pnpm install --frozen-lockfile --filter buddha-gpt-agent...
COPY packages/shared packages/shared
COPY services/agent services/agent
COPY prompts prompts
COPY policy.yaml ./
WORKDIR /app/services/agent
EXPOSE 7891
CMD ["pnpm", "start"]
