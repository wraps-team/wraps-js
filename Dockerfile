# @wraps.dev/mcp, built from source. The other packages in this repo are
# libraries; this image only runs the MCP server (stdio).
#
#   docker build -t wraps-mcp .
#   docker run -i --rm -e AWS_REGION -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
#     -e AWS_SESSION_TOKEN wraps-mcp
#
# The server starts and lists its tools without AWS credentials; tools that
# need them return a configuration error instead.

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/client/package.json packages/client/
COPY packages/email/package.json packages/email/
COPY packages/mcp/package.json packages/mcp/
COPY packages/sms/package.json packages/sms/
RUN pnpm install --frozen-lockfile --filter "@wraps.dev/mcp..."

COPY packages/email packages/email
COPY packages/mcp packages/mcp
RUN pnpm --filter "@wraps.dev/mcp..." build \
  && pnpm --filter @wraps.dev/mcp deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER node
ENTRYPOINT ["node", "dist/index.js"]
