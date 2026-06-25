//! TraceForge Gateway —— Rust 数据面 (axum 常驻服务)。
//!
//! 当前: /healthz /readyz 健康检查 + /v1/chat/completions 非流式代理 (S1)。
//! SSE 流式 / 限流 / 鉴权 / Trace 采集见 PRD Stage 1+。
//! 双 ORM 闸门冒烟测试在 examples/sqlx_smoke.rs。

use std::net::SocketAddr;
use std::time::Duration;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, Context, Result};
use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    http: reqwest::Client,
    master_key: String, // base64(32B); 解密 provider key 用
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL 未设置")?;
    let master_key = std::env::var("MASTER_ENCRYPTION_KEY").context("MASTER_ENCRYPTION_KEY 未设置")?;

    // connect_lazy: 不在启动时强连库, 让 /healthz 在 DB 不可用时仍能存活, 由 /readyz 反映真实就绪。
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_lazy(&database_url)
        .context("初始化 PG 连接池失败 (URL 格式?)")?;

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .context("构建 HTTP 客户端失败")?;

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/v1/chat/completions", post(chat_completions))
        .with_state(AppState { pool, http, master_key });

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

/// 就绪探针: 检查 PostgreSQL 连通 (Redis 已弃用, 见 PRD §9 决策 9; 配置校验留后续步骤)。
async fn readyz(State(state): State<AppState>) -> (StatusCode, &'static str) {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (StatusCode::OK, "ready"),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, "db unavailable"),
    }
}

/// OpenAI 兼容错误信封 (对外不泄露上游原始细节)。
fn err(status: StatusCode, typ: &str, code: &str, message: &str) -> Response {
    (
        status,
        Json(json!({ "error": { "message": message, "type": typ, "code": code } })),
    )
        .into_response()
}

/// AES-256-GCM 解密 provider key。存储格式: base64( nonce(12B) ‖ ciphertext ‖ tag(16B) )。
fn decrypt(b64_ciphertext: &str, master_key_b64: &str) -> Result<String> {
    let key = BASE64.decode(master_key_b64).context("master key 非法 base64")?;
    let data = BASE64.decode(b64_ciphertext).context("密文非法 base64")?;
    if data.len() < 12 + 16 {
        return Err(anyhow!("密文过短"));
    }
    let (nonce, ct_and_tag) = data.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| anyhow!("master key 长度应为 32 字节"))?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce), ct_and_tag)
        .map_err(|_| anyhow!("AES-GCM 解密失败"))?;
    String::from_utf8(plaintext).context("解密结果非 UTF-8")
}

/// 非流式代理: 解析 model -> 查 provider -> 解密 key -> 原样透传上游 -> 回传 (S1)。
async fn chat_completions(State(st): State<AppState>, body: Bytes) -> Response {
    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return err(StatusCode::BAD_REQUEST, "invalid_request_error", "invalid_json", "请求体不是合法 JSON"),
    };
    let model = match parsed.get("model").and_then(Value::as_str) {
        Some(m) => m,
        None => return err(StatusCode::BAD_REQUEST, "invalid_request_error", "model_required", "缺少 model 字段"),
    };

    // 解析 fallback 链: 主 model + 顺着 fallback_model_id 串起来 (S6)。
    let chain = match resolve_chain(&st.pool, model).await {
        Ok(c) if !c.is_empty() => c,
        Ok(_) => return err(StatusCode::NOT_FOUND, "invalid_request_error", "model_not_found", &format!("未知 model: {model}")),
        Err(_) => return err(StatusCode::INTERNAL_SERVER_ERROR, "api_error", "internal_error", "解析 provider 失败"),
    };
    let has_fallback = chain.len() > 1;

    let mut last_status = StatusCode::BAD_GATEWAY;
    let mut last_code = "upstream_error";
    for hop in &chain {
        let encrypted = match &hop.api_key_encrypted {
            Some(e) => e,
            None => { last_status = StatusCode::INTERNAL_SERVER_ERROR; last_code = "provider_not_configured"; continue; }
        };
        let key = match decrypt(encrypted, &st.master_key) {
            Ok(k) => k,
            Err(_) => { last_status = StatusCode::INTERNAL_SERVER_ERROR; last_code = "internal_error"; continue; }
        };
        // 用该 hop 的 model_name 重写 body 的 model 字段 (其余字段不动); 仅注入 Authorization。
        let mut b = parsed.clone();
        b["model"] = Value::String(hop.model_name.clone());
        let body_bytes = serde_json::to_vec(&b).unwrap_or_default();
        let url = format!("{}/chat/completions", hop.base_url.trim_end_matches('/'));

        match st.http.post(&url).bearer_auth(key).header(header::CONTENT_TYPE, "application/json").body(body_bytes).send().await {
            // 2xx/4xx: 提交并透传 (4xx 是请求问题, fallback 无济于事); 首 chunk 前不再切。
            Ok(resp) if !resp.status().is_server_error() => return proxy_response(resp),
            // 5xx: 首 chunk 前的上游错误, 尝试下一个 fallback。
            Ok(_) => { last_status = StatusCode::BAD_GATEWAY; last_code = "upstream_error"; }
            Err(e) if e.is_timeout() => { last_status = StatusCode::GATEWAY_TIMEOUT; last_code = "upstream_timeout"; }
            Err(_) => { last_status = StatusCode::BAD_GATEWAY; last_code = "upstream_error"; }
        }
    }

    // 链路耗尽: 有 fallback 报 fallback_failed, 否则报最后一次错误。
    if has_fallback {
        err(StatusCode::BAD_GATEWAY, "api_error", "fallback_failed", "全部 fallback 失败")
    } else {
        err(last_status, "api_error", last_code, "上游请求失败")
    }
}

/// fallback 链上的一跳: 一个 model + 其 provider 信息。
struct Hop {
    id: Uuid,
    model_name: String,
    base_url: String,
    api_key_encrypted: Option<String>,
    fallback_model_id: Option<Uuid>,
}

/// 解析 model 名并顺着 fallback_model_id 串成有序链 (深度上限 5, 防环)。
async fn resolve_chain(pool: &PgPool, model: &str) -> Result<Vec<Hop>, sqlx::Error> {
    let row = sqlx::query!(
        r#"SELECT mc.id as "id!", mc.model_name as "model_name!", mc.fallback_model_id as "fallback_model_id?",
                  p.base_url as "base_url!", p.api_key_encrypted as "api_key_encrypted?"
           FROM model_config mc JOIN model_provider p ON p.id = mc.provider_id
           WHERE mc.model_name = $1 AND mc.status = 'active' LIMIT 1"#,
        model
    )
    .fetch_optional(pool)
    .await?;

    let mut chain: Vec<Hop> = Vec::new();
    match row {
        Some(r) => chain.push(Hop { id: r.id, model_name: r.model_name, base_url: r.base_url, api_key_encrypted: r.api_key_encrypted, fallback_model_id: r.fallback_model_id }),
        None => return Ok(chain),
    }

    while let Some(fid) = chain.last().unwrap().fallback_model_id {
        if chain.len() >= 5 || chain.iter().any(|h| h.id == fid) {
            break; // 深度上限 / 防环
        }
        let next = sqlx::query!(
            r#"SELECT mc.id as "id!", mc.model_name as "model_name!", mc.fallback_model_id as "fallback_model_id?",
                      p.base_url as "base_url!", p.api_key_encrypted as "api_key_encrypted?"
               FROM model_config mc JOIN model_provider p ON p.id = mc.provider_id
               WHERE mc.id = $1 AND mc.status = 'active' LIMIT 1"#,
            fid
        )
        .fetch_optional(pool)
        .await?;
        match next {
            Some(r) => chain.push(Hop { id: r.id, model_name: r.model_name, base_url: r.base_url, api_key_encrypted: r.api_key_encrypted, fallback_model_id: r.fallback_model_id }),
            None => break,
        }
    }
    Ok(chain)
}

/// 把上游响应包成不缓冲的流式 Response (S2): 透传 status + content-type, 边收边转。
fn proxy_response(resp: reqwest::Response) -> Response {
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| header::HeaderValue::from_static("application/json"));
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from_stream(resp.bytes_stream()))
        .unwrap()
}
