//! TraceForge Gateway —— Rust 数据面 (axum 常驻服务)。
//!
//! 当前阶段只提供健康检查; 模型代理 / SSE 透传 / 限流 / Trace 采集见 PRD Stage 1+。
//! 双 ORM 闸门冒烟测试在 examples/sqlx_smoke.rs (`cargo run --example sqlx_smoke`)。

use std::net::SocketAddr;

use anyhow::{Context, Result};
use axum::{extract::State, http::StatusCode, routing::get, Router};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

#[derive(Clone)]
struct AppState {
    pool: PgPool,
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL 未设置")?;

    // connect_lazy: 不在启动时强连库, 让 /healthz 在 DB 不可用时仍能存活, 由 /readyz 反映真实就绪。
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_lazy(&database_url)
        .context("初始化 PG 连接池失败 (URL 格式?)")?;

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .with_state(AppState { pool });

    // 监听地址可配 (GATEWAY_ADDR), 默认 0.0.0.0:8080; 端口被占时改它即可。
    let addr: SocketAddr = std::env::var("GATEWAY_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()
        .context("GATEWAY_ADDR 格式应为 host:port")?;
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("绑定 {addr} 失败"))?;
    println!("TraceForge gateway listening on http://{addr}");
    axum::serve(listener, app).await.context("server 异常退出")?;
    Ok(())
}

/// 存活探针: 仅表进程在跑, 不查任何依赖。
async fn healthz() -> &'static str {
    "ok"
}

/// 就绪探针: 检查 PostgreSQL 连通 (Redis 检查留待 Stage 1 限流接入后补)。
async fn readyz(State(state): State<AppState>) -> (StatusCode, &'static str) {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (StatusCode::OK, "ready"),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, "db unavailable"),
    }
}
