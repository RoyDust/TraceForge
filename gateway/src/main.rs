//! TraceForge Gateway —— Rust 数据面 (axum 常驻服务)。
//!
//! 当前: /healthz /readyz 健康检查 + /v1/chat/completions 非流式代理 (S1)。
//! SSE 流式 / 限流 / 鉴权 / Trace 采集见 PRD Stage 1+。
//! 双 ORM 闸门冒烟测试在 examples/sqlx_smoke.rs。

mod ingest;
mod trace;

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
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::{NaiveDateTime, Utc};
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
    project_id: Uuid,
    rpm_limit: Option<i32>,
    concurrency_limit: Option<i32>,
}

const AUTH_TTL: Duration = Duration::from_secs(30);
const TRACE_RUN_ID_HEADER: &str = "x-traceforge-run-id";

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
        Ok(ConcurrencyGuard {
            counts: self.conc.clone(),
            key_id,
        })
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
    trace_queue_depth: AtomicI64,
    trace_write_failed_total: AtomicU64,
    trace_dropped_total: AtomicU64,
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
             # TYPE traceforge_first_token_latency_ms summary\ntraceforge_first_token_latency_ms_sum {}\ntraceforge_first_token_latency_ms_count {}\n\
             # TYPE traceforge_trace_queue_depth gauge\ntraceforge_trace_queue_depth {}\n\
             # TYPE traceforge_trace_write_failed_total counter\ntraceforge_trace_write_failed_total {}\n\
             # TYPE traceforge_trace_dropped_total counter\ntraceforge_trace_dropped_total {}\n",
            g(&self.request_total),
            self.inflight.load(Relaxed),
            g(&self.rate_limited_total),
            g(&self.upstream_error_total),
            g(&self.stream_error_total),
            g(&self.request_duration_ms_sum),
            g(&self.request_duration_ms_count),
            g(&self.first_token_ms_sum),
            g(&self.first_token_ms_count),
            self.trace_queue_depth.load(Relaxed),
            g(&self.trace_write_failed_total),
            g(&self.trace_dropped_total),
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
    trace: trace::TraceWriter,
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL 未设置")?;
    let master_key =
        std::env::var("MASTER_ENCRYPTION_KEY").context("MASTER_ENCRYPTION_KEY 未设置")?;

    // connect_lazy: 不在启动时强连库, 让 /healthz 在 DB 不可用时仍能存活, 由 /readyz 反映真实就绪。
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect_lazy(&database_url)
        .context("初始化 PG 连接池失败 (URL 格式?)")?;

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .context("构建 HTTP 客户端失败")?;

    let metrics_state = Arc::new(Metrics::default());
    let trace_writer = trace::spawn(pool.clone(), metrics_state.clone());

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/metrics", get(metrics))
        .route("/v1/chat/completions", post(chat_completions))
        .nest(
            "/api/traces",
            Router::new()
                .route("/runs", post(ingest::start_run))
                .route("/runs/{run}", get(ingest::get_run))
                .route("/runs/{run}/end", post(ingest::end_run))
                .route("/runs/{run}/spans", post(ingest::start_span))
                .route("/runs/{run}/spans/{span}/end", post(ingest::end_span))
                .layer(axum::extract::DefaultBodyLimit::max(65536)),
        )
        .with_state(AppState {
            pool,
            http,
            master_key,
            auth_cache: Arc::new(Mutex::new(HashMap::new())),
            limiter: Arc::new(InMemoryLimiter::default()),
            metrics: metrics_state,
            trace: trace_writer,
        });

    let addr: SocketAddr = std::env::var("GATEWAY_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()
        .context("GATEWAY_ADDR 格式应为 host:port")?;
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("绑定 {addr} 失败"))?;
    println!("TraceForge gateway listening on http://{addr}");
    axum::serve(listener, app)
        .await
        .context("server 异常退出")?;
    Ok(())
}

/// 存活探针: 仅表进程在跑, 不查任何依赖。
async fn healthz() -> &'static str {
    "ok"
}

/// 就绪探针: 校验关键配置存在 + PostgreSQL 连通 (无 Redis, 见 PRD §9 决策 9)。
async fn readyz(State(state): State<AppState>) -> (StatusCode, &'static str) {
    if state.master_key.is_empty() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "config missing: MASTER_ENCRYPTION_KEY",
        );
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

fn with_trace_run_id(mut response: Response, run_id: Uuid) -> Response {
    if let Ok(value) = HeaderValue::from_str(&run_id.to_string()) {
        response.headers_mut().insert(TRACE_RUN_ID_HEADER, value);
    }
    response
}

fn parse_trace_run_id(headers: &HeaderMap) -> Result<Option<Uuid>, Response> {
    let Some(value) = headers.get(TRACE_RUN_ID_HEADER) else {
        return Ok(None);
    };
    let raw = value.to_str().map_err(|_| {
        err(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            "trace_run_id_invalid",
            "X-TraceForge-Run-Id 必须是合法 UUID",
        )
    })?;
    Uuid::parse_str(raw.trim()).map(Some).map_err(|_| {
        err(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            "trace_run_id_invalid",
            "X-TraceForge-Run-Id 必须是合法 UUID",
        )
    })
}

async fn ensure_trace_run_id_available(st: &AppState, run_id: Uuid) -> Result<(), Response> {
    match trace::run_exists(&st.pool, run_id).await {
        Ok(false) => Ok(()),
        Ok(true) => Err(err(
            StatusCode::CONFLICT,
            "invalid_request_error",
            "trace_run_id_conflict",
            "X-TraceForge-Run-Id 已存在",
        )),
        Err(_) => Err(err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "api_error",
            "internal_error",
            "TraceRun id 检查失败",
        )),
    }
}

struct AuthError {
    status: StatusCode,
    typ: &'static str,
    code: &'static str,
    message: &'static str,
    project_id: Option<Uuid>,
}

impl AuthError {
    fn response(self) -> Response {
        err(self.status, self.typ, self.code, self.message)
    }
}

fn submit_rejected_trace(
    trace: &trace::TraceWriter,
    project_id: Uuid,
    run_id: Uuid,
    error_code: &'static str,
    input_text: Option<String>,
    started_at: NaiveDateTime,
) {
    trace.submit(trace::TraceJob {
        project_id,
        run_id,
        span_id: Uuid::new_v4(),
        agent_run: false,
        model: "gateway_rejected".to_string(),
        provider: "gateway".to_string(),
        status: "failed",
        error_code: Some(error_code.to_string()),
        error: None,
        input_text,
        output_text: None,
        prompt_tokens: None,
        completion_tokens: None,
        usage_source: None,
        started_at,
        ended_at: Utc::now().naive_utc(),
        has_span: false,
        events: Vec::new(),
    });
}

fn ensure_stream_usage(body: &mut Value) {
    if !body.get("stream_options").is_some_and(Value::is_object) {
        body["stream_options"] = json!({});
    }
    if let Some(options) = body
        .get_mut("stream_options")
        .and_then(Value::as_object_mut)
    {
        options.insert("include_usage".to_string(), Value::Bool(true));
    }
}

fn provider_error_code(status: StatusCode) -> &'static str {
    match status.as_u16() {
        401 | 403 => "provider_auth_failed",
        429 => "provider_rate_limited",
        _ => "upstream_error",
    }
}

fn safe_error_summary(resp: &Value) -> String {
    let message: String = resp
        .get("error")
        .and_then(|e| e.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("upstream error")
        .chars()
        .take(500)
        .collect();
    trace::sanitize_text(&message)
}

fn event(typ: &'static str, payload: Value) -> trace::EventRec {
    trace::EventRec {
        typ,
        payload: Some(payload),
        at: Utc::now().naive_utc(),
    }
}

/// AES-256-GCM 解密 provider key。存储格式: base64( nonce(12B) ‖ ciphertext ‖ tag(16B) )。
fn decrypt(b64_ciphertext: &str, master_key_b64: &str) -> Result<String> {
    let key = BASE64
        .decode(master_key_b64)
        .context("master key 非法 base64")?;
    let data = BASE64.decode(b64_ciphertext).context("密文非法 base64")?;
    if data.len() < 12 + 16 {
        return Err(anyhow!("密文过短"));
    }
    let (nonce, ct_and_tag) = data.split_at(12);
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| anyhow!("master key 长度应为 32 字节"))?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce), ct_and_tag)
        .map_err(|_| anyhow!("AES-GCM 解密失败"))?;
    String::from_utf8(plaintext).context("解密结果非 UTF-8")
}

/// 校验 project API Key (S4): Bearer -> sha256 -> 内存缓存/查 PG -> 校验 scope/状态/过期。
async fn authenticate(
    st: &AppState,
    headers: &HeaderMap,
    required_scope: &str,
) -> Result<AuthedKey, AuthError> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|t| !t.is_empty());
    let token = match token {
        Some(t) => t,
        None => {
            return Err(AuthError {
                status: StatusCode::UNAUTHORIZED,
                typ: "invalid_request_error",
                code: "invalid_api_key",
                message: "缺少或非法 Authorization",
                project_id: None,
            });
        }
    };
    let key_hash = hex::encode(Sha256::digest(token.as_bytes()));

    // 命中内存缓存且未过期则直接返回 (撤销随 TTL 失效)。
    if let Some((ak, at)) = st
        .auth_cache
        .lock()
        .unwrap()
        .get(&format!("{required_scope}:{key_hash}"))
    {
        if at.elapsed() < AUTH_TTL {
            return Ok(ak.clone());
        }
    }

    let row = sqlx::query!(
        r#"SELECT id, project_id, scope::text[] as "scope!", status, expires_at, revoked_at, rpm_limit, concurrency_limit
           FROM api_key WHERE key_hash = $1 LIMIT 1"#,
        key_hash
    )
    .fetch_optional(&st.pool)
    .await
    .map_err(|_| AuthError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        typ: "api_error",
        code: "internal_error",
        message: "鉴权查询失败",
        project_id: None,
    })?;

    let row = match row {
        Some(r) => r,
        None => {
            return Err(AuthError {
                status: StatusCode::UNAUTHORIZED,
                typ: "invalid_request_error",
                code: "invalid_api_key",
                message: "API key 无效",
                project_id: None,
            });
        }
    };
    if row.revoked_at.is_some() || row.status == "revoked" {
        return Err(AuthError {
            status: StatusCode::UNAUTHORIZED,
            typ: "invalid_request_error",
            code: "revoked_api_key",
            message: "API key 已撤销",
            project_id: Some(row.project_id),
        });
    }
    if row.status != "active" {
        return Err(AuthError {
            status: StatusCode::UNAUTHORIZED,
            typ: "invalid_request_error",
            code: "invalid_api_key",
            message: "API key 不可用",
            project_id: Some(row.project_id),
        });
    }
    if let Some(exp) = row.expires_at {
        if exp < Utc::now().naive_utc() {
            return Err(AuthError {
                status: StatusCode::UNAUTHORIZED,
                typ: "invalid_request_error",
                code: "invalid_api_key",
                message: "API key 已过期",
                project_id: Some(row.project_id),
            });
        }
    }
    if !row.scope.iter().any(|s| s == required_scope) {
        return Err(AuthError {
            status: StatusCode::UNAUTHORIZED,
            typ: "invalid_request_error",
            code: "invalid_api_key",
            message: "API key 权限不足",
            project_id: Some(row.project_id),
        });
    }

    let ak = AuthedKey {
        id: row.id,
        project_id: row.project_id,
        rpm_limit: row.rpm_limit,
        concurrency_limit: row.concurrency_limit,
    };
    st.auth_cache.lock().unwrap().insert(
        format!("{required_scope}:{key_hash}"),
        (ak.clone(), Instant::now()),
    );
    Ok(ak)
}

/// 代理: 鉴权 -> 解析 model -> fallback 链 -> 解密 key -> 不缓冲透传上游。
async fn chat_completions(State(st): State<AppState>, headers: HeaderMap, body: Bytes) -> Response {
    let started_at = Utc::now().naive_utc(); // Trace 落库用墙钟时间
    st.metrics.request_total.fetch_add(1, Relaxed);
    st.metrics.inflight.fetch_add(1, Relaxed);
    // req_guard: drop 时 inflight-- 并记总耗时。成功则 move 进响应流 (流结束才结算), 否则随早退 drop。
    let req_guard = ReqGuard {
        metrics: st.metrics.clone(),
        start: Instant::now(),
    };

    let authed = match authenticate(&st, &headers, "gateway").await {
        Ok(a) => a,
        Err(auth_err) => {
            if let Some(project_id) = auth_err.project_id {
                submit_rejected_trace(
                    &st.trace,
                    project_id,
                    Uuid::new_v4(),
                    auth_err.code,
                    None,
                    started_at,
                );
            }
            return auth_err.response();
        }
    };

    let parse_context = |name: &str| -> Result<Option<Uuid>, Response> {
        headers
            .get(name)
            .map(|v| {
                v.to_str()
                    .ok()
                    .and_then(|s| Uuid::parse_str(s).ok())
                    .ok_or_else(|| {
                        err(
                            StatusCode::BAD_REQUEST,
                            "invalid_request_error",
                            "invalid_trace_context",
                            "Trace 上下文必须是 UUID",
                        )
                    })
            })
            .transpose()
    };
    let agent_run_id = match parse_context("x-traceforge-agent-run-id") {
        Ok(id) => id,
        Err(e) => return e,
    };
    let parent_id = match parse_context("x-traceforge-parent-span-id") {
        Ok(id) => id,
        Err(e) => return e,
    };
    if (parent_id.is_some() && agent_run_id.is_none())
        || (agent_run_id.is_some() && headers.contains_key(TRACE_RUN_ID_HEADER))
    {
        return err(
            StatusCode::BAD_REQUEST,
            "invalid_request_error",
            "invalid_trace_context",
            "Agent Run 头与预声明 Run 头互斥；父 Span 需要 Agent Run",
        );
    }
    if agent_run_id.is_some() {
        if let Err(error) = authenticate(&st, &headers, "trace_ingest").await {
            return error.response();
        }
    }
    let predeclared_run_id = match parse_trace_run_id(&headers) {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Some(run_id) = predeclared_run_id {
        if let Err(response) = ensure_trace_run_id_available(&st, run_id).await {
            return response;
        }
    }
    let run_id = agent_run_id
        .or(predeclared_run_id)
        .unwrap_or_else(Uuid::new_v4);
    let span_id = Uuid::new_v4();

    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return err(
                StatusCode::BAD_REQUEST,
                "invalid_request_error",
                "invalid_json",
                "请求体不是合法 JSON",
            )
        }
    };
    let model = match parsed.get("model").and_then(Value::as_str) {
        Some(m) => m,
        None => {
            return err(
                StatusCode::BAD_REQUEST,
                "invalid_request_error",
                "model_required",
                "缺少 model 字段",
            )
        }
    };
    let is_stream = parsed
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let client_requested_usage = parsed
        .get("stream_options")
        .and_then(|o| o.get("include_usage"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let input_text = trace::extract_input(&parsed);

    let reject = |code: &'static str, message: &'static str| {
        if agent_run_id.is_none() {
            submit_rejected_trace(
                &st.trace,
                authed.project_id,
                run_id,
                code,
                input_text.clone(),
                started_at,
            );
        }
        with_trace_run_id(
            err(
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limit_error",
                code,
                message,
            ),
            run_id,
        )
    };

    // 限流 (S5): RPM 固定窗口 + 并发占用。limit 为 None 表示不限。
    if let Some(limit) = authed.rpm_limit {
        if st.limiter.check_rpm(authed.id, limit).is_err() {
            st.metrics.rate_limited_total.fetch_add(1, Relaxed);
            return reject("rate_limited", "超过 RPM 限制");
        }
    }
    // 并发 guard 持有到流结束 (move 进 body); 超限拒绝。
    let conc_guard = match authed.concurrency_limit {
        Some(limit) => match st.limiter.acquire(authed.id, limit) {
            Ok(g) => Some(g),
            Err(_) => {
                st.metrics.rate_limited_total.fetch_add(1, Relaxed);
                return reject("concurrency_limited", "超过并发限制");
            }
        },
        None => None,
    };

    // 解析 fallback 链: 主 model + 顺着 fallback_model_id 串起来 (S6)。
    let chain = match resolve_chain(&st.pool, model).await {
        Ok(c) if !c.is_empty() => c,
        Ok(_) => {
            return err(
                StatusCode::NOT_FOUND,
                "invalid_request_error",
                "model_not_found",
                &format!("未知 model: {model}"),
            )
        }
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "api_error",
                "internal_error",
                "解析 provider 失败",
            )
        }
    };
    let has_fallback = chain.len() > 1;

    if agent_run_id.is_some() {
        if let Err(response) =
            ingest::reserve_llm(&st, authed.project_id, run_id, span_id, parent_id, model).await
        {
            return response;
        }
    } else {
        match trace::begin_run(
            &st.pool,
            &trace::TraceBegin {
                project_id: authed.project_id,
                run_id,
                name: model.to_string(),
                input_text: input_text.clone(),
                started_at,
            },
        )
        .await
        {
            Ok(()) => {}
            Err(trace::BeginRunError::Conflict) => {
                return err(
                    StatusCode::CONFLICT,
                    "invalid_request_error",
                    "trace_run_id_conflict",
                    "X-TraceForge-Run-Id 已存在",
                )
            }
            Err(trace::BeginRunError::Sql(error)) => {
                eprintln!("[trace] 创建 running TraceRun 失败 run_id={run_id} err={error}");
                return err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "api_error",
                    "internal_error",
                    "创建 TraceRun 失败",
                );
            }
        }
    }
    let mut last_status = StatusCode::BAD_GATEWAY;
    let mut last_code = "upstream_error";
    let mut last_error_summary: Option<String> = None;
    let mut attempt_events: Vec<trace::EventRec> = Vec::new();
    for (idx, hop) in chain.iter().enumerate() {
        let can_fallback = idx + 1 < chain.len();
        let encrypted = match &hop.api_key_encrypted {
            Some(e) => e,
            None => {
                last_status = StatusCode::INTERNAL_SERVER_ERROR;
                last_code = "provider_not_configured";
                continue;
            }
        };
        let key = match decrypt(encrypted, &st.master_key) {
            Ok(k) => k,
            Err(_) => {
                last_status = StatusCode::INTERNAL_SERVER_ERROR;
                last_code = "internal_error";
                continue;
            }
        };
        // 用该 hop 的 model_name 重写 body 的 model 字段 (其余字段不动); 仅注入 Authorization。
        let mut b = parsed.clone();
        b["model"] = Value::String(hop.model_name.clone());
        if is_stream {
            ensure_stream_usage(&mut b);
        }
        let body_bytes = serde_json::to_vec(&b).unwrap_or_default();
        let url = format!("{}/chat/completions", hop.base_url.trim_end_matches('/'));

        match st
            .http
            .post(&url)
            .bearer_auth(key)
            .header(header::CONTENT_TYPE, "application/json")
            .body(body_bytes)
            .send()
            .await
        {
            // 2xx/4xx: 提交并透传 (4xx 是请求问题, fallback 无济于事); 首 chunk 前不再切。
            Ok(resp) if !resp.status().is_server_error() => {
                // 流式: 不缓冲透传, 边流边解析 tee 采集 Trace; conc_guard/req_guard move 进响应流, 流结束/断开才释放与结算。
                if is_stream {
                    let ctx = StreamCtx {
                        trace: st.trace.clone(),
                        project_id: authed.project_id,
                        run_id,
                        span_id,
                        agent_run: agent_run_id.is_some(),
                        model: hop.model_name.clone(),
                        provider: hop.provider_name.clone(),
                        input_text: input_text.clone(),
                        started_at,
                        forward_usage: client_requested_usage,
                        events: attempt_events,
                    };
                    return proxy_response(resp, conc_guard, req_guard, ctx);
                }
                // 非流式: 缓冲整体 (单条 completion 体积小, 不增加客户端等待), 解析输出落 Trace, 原样回传。
                let status =
                    StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
                let content_type = resp
                    .headers()
                    .get(header::CONTENT_TYPE)
                    .cloned()
                    .unwrap_or_else(|| header::HeaderValue::from_static("application/json"));
                let resp_body = match resp.bytes().await {
                    Ok(b) => b,
                    // 已提交后上游读取失败: 无法再 fallback, 记 upstream_error。
                    Err(_) => {
                        st.metrics.upstream_error_total.fetch_add(1, Relaxed);
                        last_status = StatusCode::BAD_GATEWAY;
                        last_code = "upstream_error";
                        break;
                    }
                };
                let resp_json: Value = serde_json::from_slice(&resp_body).unwrap_or(Value::Null);
                let (prompt_tokens, completion_tokens) = trace::extract_usage(&resp_json);
                let usage_source = if prompt_tokens.is_some() || completion_tokens.is_some() {
                    Some("provider")
                } else {
                    None
                };
                let (job_status, error_code, error) = if status.is_success() {
                    ("success", None, None)
                } else {
                    let code = provider_error_code(status);
                    (
                        "failed",
                        Some(code.to_string()),
                        Some(safe_error_summary(&resp_json)),
                    )
                };
                st.trace.submit(trace::TraceJob {
                    project_id: authed.project_id,
                    run_id,
                    span_id,
                    agent_run: agent_run_id.is_some(),
                    model: hop.model_name.clone(),
                    provider: hop.provider_name.clone(),
                    status: job_status,
                    error_code,
                    error,
                    input_text: input_text.clone(),
                    output_text: trace::extract_output_nonstream(&resp_json),
                    prompt_tokens,
                    completion_tokens,
                    usage_source,
                    started_at,
                    ended_at: Utc::now().naive_utc(),
                    has_span: true,
                    events: attempt_events,
                });
                // conc_guard / req_guard 随函数返回 drop: 释放并发 (S5)、结算耗时 (S7)。
                return Response::builder()
                    .status(status)
                    .header(header::CONTENT_TYPE, content_type)
                    .header(TRACE_RUN_ID_HEADER, run_id.to_string())
                    .header("x-traceforge-model-config-id", hop.id.to_string())
                    .body(Body::from(resp_body))
                    .unwrap();
            }
            // 5xx: 首 chunk 前的上游错误, 尝试下一个 fallback。
            Ok(resp) => {
                st.metrics.upstream_error_total.fetch_add(1, Relaxed);
                last_status = StatusCode::BAD_GATEWAY;
                last_code = "upstream_error";
                last_error_summary = Some(format!("upstream status {}", resp.status()));
                if can_fallback {
                    attempt_events.push(event(
                        "fallback_triggered",
                        json!({"from": hop.model_name, "to": chain[idx + 1].model_name, "reason": last_code}),
                    ));
                }
            }
            Err(e) if e.is_timeout() => {
                st.metrics.upstream_error_total.fetch_add(1, Relaxed);
                last_status = StatusCode::GATEWAY_TIMEOUT;
                last_code = "upstream_timeout";
                last_error_summary = Some("upstream timeout".to_string());
                if can_fallback {
                    attempt_events.push(event(
                        "fallback_triggered",
                        json!({"from": hop.model_name, "to": chain[idx + 1].model_name, "reason": last_code}),
                    ));
                }
            }
            Err(e) => {
                st.metrics.upstream_error_total.fetch_add(1, Relaxed);
                last_status = StatusCode::BAD_GATEWAY;
                last_code = "upstream_error";
                last_error_summary = Some(e.to_string());
                if can_fallback {
                    attempt_events.push(event(
                        "fallback_triggered",
                        json!({"from": hop.model_name, "to": chain[idx + 1].model_name, "reason": last_code}),
                    ));
                }
            }
        }
    }

    // 链路耗尽: 有 fallback 报 fallback_failed, 否则报最后一次错误。
    let final_code = if has_fallback {
        "fallback_failed"
    } else {
        last_code
    };
    if has_fallback {
        attempt_events.push(event("fallback_failed", json!({"reason": last_code})));
    }
    let failed_hop = chain.last().expect("chain checked non-empty");
    st.trace.submit(trace::TraceJob {
        project_id: authed.project_id,
        run_id,
        span_id,
        agent_run: agent_run_id.is_some(),
        model: failed_hop.model_name.clone(),
        provider: failed_hop.provider_name.clone(),
        status: "failed",
        error_code: Some(final_code.to_string()),
        error: last_error_summary,
        input_text,
        output_text: None,
        prompt_tokens: None,
        completion_tokens: None,
        usage_source: None,
        started_at,
        ended_at: Utc::now().naive_utc(),
        has_span: true,
        events: attempt_events,
    });
    if has_fallback {
        with_trace_run_id(
            err(
                StatusCode::BAD_GATEWAY,
                "api_error",
                "fallback_failed",
                "全部 fallback 失败",
            ),
            run_id,
        )
    } else {
        with_trace_run_id(
            err(last_status, "api_error", last_code, "上游请求失败"),
            run_id,
        )
    }
}

/// fallback 链上的一跳: 一个 model + 其 provider 信息。
struct Hop {
    id: Uuid,
    model_name: String,
    provider_name: String,
    base_url: String,
    api_key_encrypted: Option<String>,
    fallback_model_id: Option<Uuid>,
}

/// 解析 model 名并顺着 fallback_model_id 串成有序链 (深度上限 5, 防环)。
async fn resolve_chain(pool: &PgPool, model: &str) -> Result<Vec<Hop>, sqlx::Error> {
    let row = sqlx::query!(
        r#"SELECT mc.id as "id!", mc.model_name as "model_name!", mc.fallback_model_id as "fallback_model_id?",
                  p.name as "provider_name!", p.base_url as "base_url!", p.api_key_encrypted as "api_key_encrypted?"
           FROM model_config mc JOIN model_provider p ON p.id = mc.provider_id
           WHERE mc.model_name = $1 AND mc.status = 'active' LIMIT 1"#,
        model
    )
    .fetch_optional(pool)
    .await?;

    let mut chain: Vec<Hop> = Vec::new();
    match row {
        Some(r) => chain.push(Hop {
            id: r.id,
            model_name: r.model_name,
            provider_name: r.provider_name,
            base_url: r.base_url,
            api_key_encrypted: r.api_key_encrypted,
            fallback_model_id: r.fallback_model_id,
        }),
        None => return Ok(chain),
    }

    while let Some(fid) = chain.last().unwrap().fallback_model_id {
        if chain.len() >= 5 || chain.iter().any(|h| h.id == fid) {
            break; // 深度上限 / 防环
        }
        let next = sqlx::query!(
            r#"SELECT mc.id as "id!", mc.model_name as "model_name!", mc.fallback_model_id as "fallback_model_id?",
                      p.name as "provider_name!", p.base_url as "base_url!", p.api_key_encrypted as "api_key_encrypted?"
               FROM model_config mc JOIN model_provider p ON p.id = mc.provider_id
               WHERE mc.id = $1 AND mc.status = 'active' LIMIT 1"#,
            fid
        )
        .fetch_optional(pool)
        .await?;
        match next {
            Some(r) => chain.push(Hop {
                id: r.id,
                model_name: r.model_name,
                provider_name: r.provider_name,
                base_url: r.base_url,
                api_key_encrypted: r.api_key_encrypted,
                fallback_model_id: r.fallback_model_id,
            }),
            None => break,
        }
    }
    Ok(chain)
}

struct StreamCtx {
    trace: trace::TraceWriter,
    project_id: Uuid,
    run_id: Uuid,
    span_id: Uuid,
    agent_run: bool,
    model: String,
    provider: String,
    input_text: Option<String>,
    started_at: NaiveDateTime,
    forward_usage: bool,
    events: Vec<trace::EventRec>,
}

struct StreamTrace {
    ctx: StreamCtx,
    buffer: String,
    output: String,
    chunk_count: usize,
    first_token_seen: bool,
    saw_done: bool,
    prompt_tokens: Option<i32>,
    completion_tokens: Option<i32>,
    usage_source: Option<&'static str>,
    submitted: bool,
}

impl StreamTrace {
    fn new(mut ctx: StreamCtx) -> Self {
        ctx.events.push(trace::EventRec {
            typ: "stream_start",
            payload: None,
            at: Utc::now().naive_utc(),
        });
        Self {
            ctx,
            buffer: String::new(),
            output: String::new(),
            chunk_count: 0,
            first_token_seen: false,
            saw_done: false,
            prompt_tokens: None,
            completion_tokens: None,
            usage_source: None,
            submitted: false,
        }
    }

    fn process_chunk(&mut self, bytes: Bytes, req: &ReqGuard) -> Option<Bytes> {
        self.buffer.push_str(&String::from_utf8_lossy(&bytes));
        let mut forward = String::new();

        while let Some(idx) = self.buffer.find("\n\n") {
            let frame = self.buffer[..idx + 2].to_string();
            self.buffer.drain(..idx + 2);
            if self.observe_frame(&frame, req) {
                forward.push_str(&frame);
            }
        }

        if forward.is_empty() {
            None
        } else {
            Some(Bytes::from(forward))
        }
    }

    fn observe_frame(&mut self, frame: &str, req: &ReqGuard) -> bool {
        let data = frame
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim_start)
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() {
            return true;
        }
        if data.trim() == "[DONE]" {
            self.saw_done = true;
            return true;
        }

        let parsed: Value = match serde_json::from_str(&data) {
            Ok(v) => v,
            Err(_) => return true,
        };

        let (prompt, completion) = trace::extract_usage(&parsed);
        if prompt.is_some() || completion.is_some() {
            self.prompt_tokens = prompt;
            self.completion_tokens = completion;
            self.usage_source = Some("provider");
            return self.ctx.forward_usage;
        }

        let mut saw_content = false;
        if let Some(choices) = parsed.get("choices").and_then(Value::as_array) {
            for choice in choices {
                if let Some(content) = choice
                    .get("delta")
                    .and_then(|d| d.get("content"))
                    .and_then(Value::as_str)
                {
                    if !content.is_empty() {
                        saw_content = true;
                        self.output.push_str(content);
                    }
                }
            }
        }

        if saw_content {
            self.chunk_count += 1;
            if !self.first_token_seen {
                self.first_token_seen = true;
                let ms = req.start.elapsed().as_millis() as u64;
                req.metrics.first_token_ms_sum.fetch_add(ms, Relaxed);
                req.metrics.first_token_ms_count.fetch_add(1, Relaxed);
                self.ctx.events.push(trace::EventRec {
                    typ: "first_token",
                    payload: Some(json!({ "ms": ms })),
                    at: Utc::now().naive_utc(),
                });
            }
        }

        true
    }

    fn submit_success(&mut self) {
        self.ctx.events.push(trace::EventRec {
            typ: "chunk_count",
            payload: Some(json!({ "count": self.chunk_count })),
            at: Utc::now().naive_utc(),
        });
        self.ctx.events.push(trace::EventRec {
            typ: "stream_end",
            payload: None,
            at: Utc::now().naive_utc(),
        });
        self.submit("success", None, None);
    }

    fn submit_failed(&mut self, code: &'static str, summary: Option<String>) {
        self.ctx.events.push(trace::EventRec {
            typ: "chunk_count",
            payload: Some(json!({ "count": self.chunk_count })),
            at: Utc::now().naive_utc(),
        });
        self.ctx.events.push(trace::EventRec {
            typ: "stream_error",
            payload: Some(json!({ "code": code })),
            at: Utc::now().naive_utc(),
        });
        self.submit("failed", Some(code.to_string()), summary);
    }

    fn submit_cancelled(&mut self) {
        self.ctx.events.push(trace::EventRec {
            typ: "stream_cancelled",
            payload: None,
            at: Utc::now().naive_utc(),
        });
        self.submit("cancelled", Some("client_cancelled".to_string()), None);
    }

    fn submit(&mut self, status: &'static str, error_code: Option<String>, error: Option<String>) {
        if self.submitted {
            return;
        }
        self.submitted = true;
        let output_text = if self.output.is_empty() {
            None
        } else {
            Some(self.output.clone())
        };
        let events = std::mem::take(&mut self.ctx.events);
        self.ctx.trace.submit(trace::TraceJob {
            project_id: self.ctx.project_id,
            run_id: self.ctx.run_id,
            span_id: self.ctx.span_id,
            agent_run: self.ctx.agent_run,
            model: self.ctx.model.clone(),
            provider: self.ctx.provider.clone(),
            status,
            error_code,
            error,
            input_text: self.ctx.input_text.clone(),
            output_text,
            prompt_tokens: self.prompt_tokens,
            completion_tokens: self.completion_tokens,
            usage_source: self.usage_source,
            started_at: self.ctx.started_at,
            ended_at: Utc::now().naive_utc(),
            has_span: true,
            events,
        });
    }
}

impl Drop for StreamTrace {
    fn drop(&mut self) {
        if !self.submitted {
            self.submit_cancelled();
        }
    }
}

/// 把上游响应包成不缓冲整条内容的流式 Response: 透传 status + content-type, 按 SSE frame tee 采集。
/// conc_guard + req_guard 随流 move, 流结束/断开/出错时一并 drop (释放并发 S5、结算耗时 S7)。
fn proxy_response(
    resp: reqwest::Response,
    conc: Option<ConcurrencyGuard>,
    req: ReqGuard,
    ctx: StreamCtx,
) -> Response {
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| header::HeaderValue::from_static("application/json"));
    let run_id = ctx.run_id;
    let upstream = Box::pin(resp.bytes_stream());
    // 状态携带 conc + req guard + trace accumulator; 流 drop 时释放并补 cancelled Trace。
    let guarded = futures_util::stream::unfold(
        (upstream, conc, req, StreamTrace::new(ctx)),
        |(mut s, conc, req, mut trace)| async move {
            loop {
                if trace.submitted {
                    return None;
                }
                match s.next().await {
                    Some(Ok(bytes)) => {
                        if let Some(out) = trace.process_chunk(bytes, &req) {
                            return Some((Ok(out), (s, conc, req, trace)));
                        }
                    }
                    Some(Err(e)) => {
                        req.metrics.stream_error_total.fetch_add(1, Relaxed);
                        let code = if e.is_timeout() {
                            "stream_timeout"
                        } else {
                            "stream_interrupted"
                        };
                        let summary = Some(trace::sanitize_text(&e.to_string()));
                        trace.submit_failed(code, summary);
                        return Some((Err(e), (s, conc, req, trace)));
                    }
                    None => {
                        if trace.saw_done {
                            trace.submit_success();
                        } else {
                            req.metrics.stream_error_total.fetch_add(1, Relaxed);
                            trace.submit_failed(
                                "stream_interrupted",
                                Some("stream ended before [DONE]".to_string()),
                            );
                        }
                        return None;
                    }
                };
            }
        },
    );
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(TRACE_RUN_ID_HEADER, run_id.to_string())
        .body(Body::from_stream(guarded))
        .unwrap()
}
