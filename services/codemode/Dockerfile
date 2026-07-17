FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY services/codemode/package.json services/codemode/package.json
COPY services/runtime/package.json services/runtime/package.json
COPY packages/react/package.json packages/react/package.json
COPY examples/request-cycle-demo/package.json examples/request-cycle-demo/package.json
RUN npm ci --workspace @lemy/codemode --include-workspace-root=false

COPY services/codemode services/codemode
WORKDIR /app/services/codemode

EXPOSE 8787
CMD ["npm", "run", "start"]
