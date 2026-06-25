//! TraceForge Gateway —— Rust 数据面 (axum 常驻服务)。
//!
//! 当前: /healthz /readyz 健康检查 + /v1/chat/completions 非流式代理 (S1)。
//! SSE 流式 / 限流 / 鉴权 / Trace 采集见 PRD Stage 1+。
//! 双 ORM 闸门冒烟测试在 examples/sqlx_smoke.rs。

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, Context, Result};
use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Utc;
use futures_util::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use uuid::Uuid;

/// 鉴权通过的 key 上下文。
#[derive(Clone)]
struct AuthedKey {
    id: Uuid,
    rpm_limit: Option<i32>,
    concurrency_limit: Option<i32>,
}

const AUTH_TTL: Duration = Duration::from_secs(30);

// ───────────── 限流 (S5): trait + 内存实现; Redis 留作后续增强 (决策 9) ─────────────

/// 限流器抽象。返回 Err(error_code) 表示拒绝。
trait RateLimiter: Send + Sync {
    /// 分钟固定窗口 RPM。
    fn check_rpm(&self, key_id: Uuid, limit: i32) -> Result<(), &'static str>;
    /// 占用一个并发额度, 返回 RAII guard (drop 时释放); 超限返回 Err。
    fn acquire(&self, key_id: Uuid, limit: i32) -> Result<ConcurrencyGuard, &'static str>;
}

/// 并发额度 RAII guard: drop 时 -1。塞进流式 body 一起 move, 故流结束/断开/出错才释放。
struct ConcurrencyGuard {
    counts: Arc<Mutex<HashMap<Uuid, i32>>>,
    key_id: Uuid,
}
impl Drop for ConcurrencyGuard {
    fn drop(&mut self) {
        if let Ok(mut m) = self.counts.lock() {
            if let Some(c) = m.get_mut(&self.key_id) {
                *c = c.saturating_sub(1);
            }
        }
    }
}

#[derive(Default)]
struct InMemoryLimiter {
    rpm: Mutex<HashMap<Uuid, (i64, i32)>>, // key -> (窗口分钟, 计数)
    conc: Arc<Mutex<HashMap<Uuid, i32>>>,  // key -> 在途并发
}
impl RateLimiter for InMemoryLimiter {
    fn check_rpm(&self, key_id: Uuid, limit: i32) -> Result<(), &'static str> {
        let window = Utc::now().timestamp() / 60;
        let mut m = self.rpm.lock().unwrap();
        let e = m.entry(key_id).or_insert((window, 0));
        if e.0 != window {
            *e = (window, 0); // 跨分钟窗口重置
        }
        if e.1 >= limit {
            return Err("rate_limited");
        }
        e.1 += 1;
        Ok(())
    }
    fn acquire(&self, key_id: Uuid, limit: i32) -> Result<ConcurrencyGuard, &'static str> {
        let mut m = self.conc.lock().unwrap();
        let c = m.entry(key_id).or_insert(0);
        if *c >= limit {
            return Err("concurrency_limited");
        }
        *c += 1;
        Ok(ConcurrencyGuard { counts: self.conc.clone(), key_id })
    }
}

// ───────────── 运行指标 (S7): 原子计数, Prometheus 文本格式 ─────────────

#[derive(Default)]
struct Metrics {
    request_total: AtomicU64,
    inflight: AtomicI64,
    rate_limited_total: AtomicU64,
    upstream_error_total: AtomicU64,
    stream_error_total: AtomicU64,
    request_duration_ms_sum: AtomicU64,
    request_duration_ms_count: AtomicU64,
    first_token_ms_sum: AtomicU64,
    first_token_ms_count: AtomicU64,
}
impl Metrics {
    fn render(&self) -> String {
        let g = |a: &AtomicU64| a.load(Relaxed);
        format!(
            "# TYPE traceforge_request_total counter\ntraceforge_request_total {}\n\
             # TYPE traceforge_inflight_requests gauge\ntraceforge_inflight_requests {}\n\
             # TYPE traceforge_rate_limited_total counter\ntraceforge_rate_limited_total {}\n\
             # TYPE traceforge_upstream_error_total counter\ntraceforge_upstream_error_total {}\n\
             # TYPE traceforge_stream_error_total counter\ntraceforge_stream_error_total {}\n\
             # TYPE traceforge_request_duration_ms summary\ntraceforge_request_duration_ms_sum {}\ntraceforge_request_duration_ms_count {}\n\
             # TYPE traceforge_first_token_latency_ms summary\ntraceforge_first_token_latency_ms_sum {}\ntraceforge_first_token_latency_ms_count {}\n",
            g(&self.request_total),
            self.inflight.load(Relaxed),
            g(&self.rate_limited_total),
            g(&self.upstream_error_total),
            g(&self.stream_error_total),
            g(&self.request_duration_ms_sum),
            g(&self.request_duration_ms_count),
            g(&self.first_token_ms_sum),
            g(&self.first_token_ms_count),
        )
    }
}

/// 请求级 RAII: drop 时 inflight-- 并记录总耗时。move 进响应流, 故流结束才结算。
struct ReqGuard {
    metrics: Arc<Metrics>,
    start: Instant,
}
impl Drop for ReqGuard {
    fn drop(&mut self) {
        self.metrics.inflight.fetch_sub(1, Relaxed);
        let ms = self.start.elapsed().as_millis() as u64;
        self.metrics.request_duration_ms_sum.fetch_add(ms, Relaxed);
        self.metrics.request_duration_ms_count.fetch_add(1, Relaxed);
    }
}

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    http: reqwest::Client,
    master_key: String, // base64(32B); 解密 provider key 用
    // key_hash -> (鉴权结果, 缓存时刻); 内存 TTL 缓存, 撤销随 TTL 失效。
    auth_cache: Arc<Mutex<HashMap<String, (AuthedKey, Instant)>>>,
    limiter: Arc<dyn RateLimiter>,
    metrics: Arc<Metrics>,
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
        .route("/metrics", get(metrics))
        .route("/v1/chat/completions", post(chat_completions))
        .with_state(AppState {
            pool,
            http,
            master_key,
            auth_cache: Arc::new(Mutex::new(HashMap::new())),
            limiter: Arc::new(InMemoryLimiter::default()),
            metrics: Arc::new(Metrics::default()),
        });

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

/// 就绪探针: 校验关键配置存在 + PostgreSQL 连通 (无 Redis, 见 PRD §9 决策 9)。
async fn readyz(State(state): State<AppState>) -> (StatusCode, &'static str) {
    if state.master_key.is_empty() {
        return (StatusCode::SERVICE_UNAVAILABLE, "config missing: MASTER_ENCRYPTION_KEY");
    }
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (StatusCode::OK, "ready"),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, "db unavailable"),
    }
}

/// 运行指标 (Prometheus 文本格式)。
async fn metrics(State(state): State<AppState>) -> Response {
    (
        [(header::CONTENT_TYPE, "text/plain; version=0.0.4")],
        state.metrics.render(),
    )
        .into_response()
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

/// 校验 project API Key (S4): Bearer -> sha256 -> 内存缓存/查 PG -> 校验 scope/状态/过期。
async fn authenticate(st: &AppState, headers: &HeaderMap) -> Result<AuthedKey, Response> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|t| !t.is_empty());
    let token = match token {
        Some(t) => t,
        None => return Err(err(StatusCode::UNAUTHORIZED, "invalid_request_error", "invalid_api_key", "缺少或非法 Authorization")),
    };
    let key_hash = hex::encode(Sha256::digest(token.as_bytes()));

    // 命中内存缓存且未过期则直接返回 (撤销随 TTL 失效)。
    if let Some((ak, at)) = st.auth_cache.lock().unwrap().get(&key_hash) {
        if at.elapsed() < AUTH_TTL {
            return Ok(ak.clone());
        }
    }

    let row = sqlx::query!(
        r#"SELECT id, scope::text[] as "scope!", status, expires_at, revoked_at, rpm_limit, concurrency_limit
           FROM api_key WHERE key_hash = $1 LIMIT 1"#,
        key_hash
    )
    .fetch_optional(&st.pool)
    .await
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "api_error", "internal_error", "鉴权查询失败"))?;

    let row = match row {
        Some(r) => r,
        None => return Err(err(StatusCode::UNAUTHORIZED, "invalid_request_error", "invalid_api_key", "API key 无效")),
    };
    if row.revoked_at.is_some() || row.status == "revoked" {
        return Err(err(StatusCode::UNAUTHORIZED, "invalid_request_error", "revoked_api_key", "API key 已撤销"));
    }
    if row.status != "active" {
        return Err(err(StatusCode::UNAUTHORIZED, "invalid_request_error", "invalid_api_key", "API key 不可用"));
    }
    if let Some(exp) = row.expires_at {
        if exp < Utc::now().naive_utc() {
            return Err(err(StatusCode::UNAUTHORIZED, "invalid_request_error", "invalid_api_key", "API key 已过期"));
        }
    }
    if !row.scope.iter().any(|s| s == "gateway") {
        return Err(err(StatusCode::UNAUTHORIZED, "invalid_request_error", "invalid_api_key", "API key 无 gateway 权限"));
    }

    let ak = AuthedKey { id: row.id, rpm_limit: row.rpm_limit, concurrency_limit: row.concurrency_limit };
    st.auth_cache.lock().unwrap().insert(key_hash, (ak.clone(), Instant::now()));
    Ok(ak)
}

/// 代理: 鉴权 -> 解析 model -> fallback 链 -> 解密 key -> 不缓冲透传上游。
async fn chat_completions(State(st): State<AppState>, headers: HeaderMap, body: Bytes) -> Response {
    st.metrics.request_total.fetch_add(1, Relaxed);
    st.metrics.inflight.fetch_add(1, Relaxed);
    // req_guard: drop 时 inflight-- 并记总耗时。成功则 move 进响应流 (流结束才结算), 否则随早退 drop。
    let req_guard = ReqGuard { metrics: st.metrics.clone(), start: Instant::now() };

    let authed = match authenticate(&st, &headers).await {
        Ok(a) => a,
        Err(resp) => return resp,
    };

    // 限流 (S5): RPM 固定窗口 + 并发占用。limit 为 None 表示不限。
    if let Some(limit) = authed.rpm_limit {
        if st.limiter.check_rpm(authed.id, limit).is_err() {
            st.metrics.rate_limited_total.fetch_add(1, Relaxed);
            return err(StatusCode::TOO_MANY_REQUESTS, "rate_limit_error", "rate_limited", "超过 RPM 限制");
        }
    }
    // 并发 guard 持有到流结束 (move 进 body); 超限拒绝。
    let conc_guard = match authed.concurrency_limit {
        Some(limit) => match st.limiter.acquire(authed.id, limit) {
            Ok(g) => Some(g),
            Err(_) => {
                st.metrics.rate_limited_total.fetch_add(1, Relaxed);
                return err(StatusCode::TOO_MANY_REQUESTS, "rate_limit_error", "concurrency_limited", "超过并发限制");
            }
        },
        None => None,
    };

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
            // conc_guard / req_guard move 进响应流, 流结束/断开才释放与结算。
            Ok(resp) if !resp.status().is_server_error() => return proxy_response(resp, conc_guard, req_guard),
            // 5xx: 首 chunk 前的上游错误, 尝试下一个 fallback。
            Ok(_) => { st.metrics.upstream_error_total.fetch_add(1, Relaxed); last_status = StatusCode::BAD_GATEWAY; last_code = "upstream_error"; }
            Err(e) if e.is_timeout() => { st.metrics.upstream_error_total.fetch_add(1, Relaxed); last_status = StatusCode::GATEWAY_TIMEOUT; last_code = "upstream_timeout"; }
            Err(_) => { st.metrics.upstream_error_total.fetch_add(1, Relaxed); last_status = StatusCode::BAD_GATEWAY; last_code = "upstream_error"; }
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
/// conc_guard + req_guard 随流 move, 流结束/断开/出错时一并 drop (释放并发 S5、结算耗时 S7)。
/// 首块到达时记 first_token_latency, 上游流出错时累加 stream_error_total (S7)。
fn proxy_response(resp: reqwest::Response, conc: Option<ConcurrencyGuard>, req: ReqGuard) -> Response {
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| header::HeaderValue::from_static("application/json"));
    let upstream = Box::pin(resp.bytes_stream());
    // 状态携带 conc + req guard (流 drop 时释放) + first 标记。
    let guarded = futures_util::stream::unfold(
        (upstream, conc, req, false),
        |(mut s, conc, req, mut first)| async move {
            match s.next().await {
                Some(item) => {
                    if !first {
                        first = true;
                        let ms = req.start.elapsed().as_millis() as u64;
                        req.metrics.first_token_ms_sum.fetch_add(ms, Relaxed);
                        req.metrics.first_token_ms_count.fetch_add(1, Relaxed);
                    }
                    if item.is_err() {
                        req.metrics.stream_error_total.fetch_add(1, Relaxed);
                    }
                    Some((item, (s, conc, req, first)))
                }
                None => None,
            }
        },
    );
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from_stream(guarded))
        .unwrap()
}
