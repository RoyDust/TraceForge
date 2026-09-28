//! mock OpenAI 兼容上游 —— 测试夹具 (S0)。
//! 用来造真实 API 造不出的场景, 供 S2/S3/S6 做确定性验证。
//! 运行: `cargo run --bin mock_upstream` (默认 0.0.0.0:8799, 可用 MOCK_ADDR 覆盖)。
//!
//! 行为由 query `?scenario=` 控制; 网关只转发 body 不带 query, 故也按 body 的 model 名推断:
//!   ok(默认)      非流式返回 JSON; 流式返回若干内容 chunk (+可选 usage) + [DONE]
//!   fail_before   首 chunk 前返回 500 (模拟连接/上游失败 → 网关应 fallback)。model 名含 "fail"
//!   mid_error     流式发 1 个 chunk 后中断 (无 [DONE], 模拟首 chunk 后中断)。model 名含 "mid"
//!   slow_stream   流式但 chunk 间有延迟, 流被 drop 时打印日志 (供 S3 观测取消)。model 名含 "slow"
//!   timeout       延迟 70s 才响应 (超过网关 60s 超时)。model 名含 "timeout"

use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::Query;
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{body::Bytes, http::StatusCode, Json, Router};
use futures_util::stream::{self, Stream};
use serde_json::{json, Value};
use std::convert::Infallible;

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/v1/chat/completions", post(chat));
    let addr: SocketAddr = std::env::var("MOCK_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8799".to_string())
        .parse()
        .expect("MOCK_ADDR");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    println!("mock upstream on http://{addr}");
    axum::serve(listener, app).await.unwrap();
}

#[derive(serde::Deserialize)]
struct Q {
    scenario: Option<String>,
}

async fn chat(Query(q): Query<Q>, body: Bytes) -> Response {
    let parsed: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let is_stream = parsed
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let want_usage = parsed
        .get("stream_options")
        .and_then(|o| o.get("include_usage"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let model = parsed.get("model").and_then(Value::as_str).unwrap_or("");

    // query 优先; 否则按 model 名推断 (网关只转发 body)。
    let scenario = q.scenario.unwrap_or_else(|| {
        if model.contains("fail") {
            "fail_before"
        } else if model.contains("mid") {
            "mid_error"
        } else if model.contains("timeout") {
            "timeout"
        } else if model.contains("slow") {
            "slow_stream"
        } else {
            "ok"
        }
        .to_string()
    });

    match scenario.as_str() {
        "fail_before" => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":{"message":"mock upstream down","type":"server_error"}})),
        )
            .into_response(),
        "timeout" => {
            tokio::time::sleep(Duration::from_secs(70)).await;
            Json(json!({"object":"chat.completion"})).into_response()
        }
        "slow_stream" => slow_sse().into_response(),
        _ if is_stream => sse(scenario == "mid_error", want_usage).into_response(),
        _ => Json(json!({
            "id":"mock-1","object":"chat.completion","model":"mock",
            "choices":[{"index":0,"message":{"role":"assistant","content":"hello from mock"},"finish_reason":"stop"}],
            "usage":{"prompt_tokens":3,"completion_tokens":3,"total_tokens":6}
        }))
        .into_response(),
    }
}

/// 流被 drop 时打印 —— 客户端/网关断开会 drop SSE 流, 借此观测「上游被中止」(S3)。
struct DropLog;
impl Drop for DropLog {
    fn drop(&mut self) {
        eprintln!("[mock] SSE 流被 drop —— 客户端断开, 上游请求已中止");
    }
}

/// 慢速 SSE: chunk 间隔 400ms, 最多 30 个; 供 S3 在中途断开客户端来观测取消。
fn slow_sse() -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let s = stream::unfold((0usize, DropLog), |(i, guard)| async move {
        if i >= 30 {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
        let ev = Event::default()
            .data(json!({"choices":[{"index":0,"delta":{"content":format!("chunk{i} ")},"finish_reason":null}]}).to_string());
        Some((Ok(ev), (i + 1, guard)))
    });
    Sse::new(s)
}

/// 构造 SSE 流。mid_error=true 时发 1 个 chunk 就提前结束 (无 [DONE])。
fn sse(mid_error: bool, want_usage: bool) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let chunk = |c: &str| {
        Event::default().data(
            json!({"choices":[{"index":0,"delta":{"content":c},"finish_reason":null}]}).to_string(),
        )
    };
    let mut events: Vec<Event> = vec![chunk("hello"), chunk(" from"), chunk(" mock")];
    if mid_error {
        events.truncate(1); // 首 chunk 后中断: 只发 1 个, 不发 [DONE]
    } else {
        if want_usage {
            events.push(Event::default().data(
                json!({"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":3,"total_tokens":6}})
                    .to_string(),
            ));
        }
        events.push(Event::default().data("[DONE]"));
    }
    Sse::new(stream::iter(events.into_iter().map(Ok)))
}
