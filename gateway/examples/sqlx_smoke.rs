//! 双 ORM 闸门冒烟测试 —— 证明 Rust 数据面与 Prisma 管理的 schema 对得上。
//! 运行: `cargo run --example sqlx_smoke` (需可连的 DATABASE_URL, 见 gateway/.env)。
//!
//! `sqlx::query!` 宏在编译期连库校验列名 / 类型, 因此构建需要：
//!   - 可连的 DATABASE_URL (schema 已由 `prisma db push` / migrate 建好), 或
//!   - 提交的离线缓存 `cargo sqlx prepare` 生成的 .sqlx/。
//!
//! schema 漂移会直接让本文件编译失败 —— 这正是双 ORM 的同步闸门 (CI 用 --examples 编译它)。

use anyhow::{Context, Result};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL 未设置")?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    // 数据面只写 Trace 表; project / api_key 等由控制面 (Prisma) 创建。取 seed 出来的 project。
    let project = sqlx::query!("SELECT id FROM project LIMIT 1")
        .fetch_optional(&pool)
        .await?
        .context("没有 project, 先跑 `npm run db:seed`")?;

    // 写: TraceRun -> TraceSpan。id 由 Rust 生成; status / started_at 走 DB 默认。
    let run_id = Uuid::new_v4();
    sqlx::query!(
        "INSERT INTO trace_run (id, project_id, name) VALUES ($1, $2, $3)",
        run_id,
        project.id,
        "demo run (from rust sqlx)"
    )
    .execute(&pool)
    .await?;

    // 枚举列: 绑字符串再 ::text::span_type 转换, 避免在最小示例里定义 Rust 枚举。
    // 需要强类型时给 Rust 枚举加 #[derive(sqlx::Type)] #[sqlx(type_name = "span_type", rename_all = "snake_case")]。
    let span_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO trace_span (id, run_id, "type", name) VALUES ($1, $2, $3::text::span_type, $4)"#,
        span_id,
        run_id,
        "llm",
        "chat.completions"
    )
    .execute(&pool)
    .await?;

    // 读: 回查 run + span 数。enum 用 ::text 取出; AS "x!" 断言非空。
    let run = sqlx::query!(
        r#"SELECT name, status::text AS "status!", started_at FROM trace_run WHERE id = $1"#,
        run_id
    )
    .fetch_one(&pool)
    .await?;
    let span_count = sqlx::query_scalar!("SELECT count(*) FROM trace_span WHERE run_id = $1", run_id)
        .fetch_one(&pool)
        .await?
        .unwrap_or(0);

    println!(
        "trace_run {run_id}: name={:?} status={} spans={} at={}",
        run.name, run.status, span_count, run.started_at
    );
    Ok(())
}
