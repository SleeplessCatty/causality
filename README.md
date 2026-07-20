# Causality

金融因果知识库。当前开发步骤为 P1-01，仅验证 React、Fastify 与 PostgreSQL 的基础链路。

## 本地要求

- Node.js 24.18.0
- pnpm 11.15.1
- Docker（包含 Compose）

## 启动

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
docker compose up -d --wait postgres
pnpm dev
```

浏览器打开 <http://127.0.0.1:5173>。API 默认监听 <http://127.0.0.1:3000>。

## 数据库

```bash
pnpm db:migrate
pnpm db:seed
pnpm db:verify
pnpm db:simulate -- --events=1000 --relations=3000 --cases=10000 --seed=42
```

迁移可重复执行。固定种子采用稳定标识并且不会覆盖已修改的数据；模拟数据只用于开发和性能测试。

## 质量检查

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```
