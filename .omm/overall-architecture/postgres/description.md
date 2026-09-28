系统持久化单一事实源。Prisma 负责 schema 与 migration，Rust sqlx 按同一 snake_case 契约读写 Project、API Key、模型配置、Trace、Prompt、Eval 和 UsageDaily。
