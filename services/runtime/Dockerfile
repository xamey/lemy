FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY services/codemode/package.json services/codemode/package.json
COPY services/runtime/package.json services/runtime/package.json
COPY packages/react/package.json packages/react/package.json
COPY examples/request-cycle-demo/package.json examples/request-cycle-demo/package.json
RUN npm ci --workspace @lemy/runtime --include-workspace-root=false

COPY services/runtime services/runtime
RUN npm run build --workspace @lemy/runtime

EXPOSE 4000
CMD ["npm", "run", "start", "--workspace", "@lemy/runtime"]
