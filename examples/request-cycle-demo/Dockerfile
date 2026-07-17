FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY services/codemode/package.json services/codemode/package.json
COPY services/runtime/package.json services/runtime/package.json
COPY packages/react/package.json packages/react/package.json
COPY examples/request-cycle-demo/package.json examples/request-cycle-demo/package.json
RUN npm ci --workspace @lemy/request-cycle-demo --include-workspace-root=false

COPY examples/request-cycle-demo examples/request-cycle-demo
COPY logo.png logo.png
RUN npm run build --workspace @lemy/request-cycle-demo

FROM nginx:1.29-alpine
COPY examples/request-cycle-demo/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/examples/request-cycle-demo/dist /usr/share/nginx/html
EXPOSE 80
