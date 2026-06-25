//! mock OpenAI 兼容上游 —— 测试夹具 (S0)。
//! 用来造真实 API 造不出的场景, 供 S2/S3/S6 做确定性验证。
//! 运行: `cargo run --bin mock_upstream` (默认 0.0.0.0:8799, 可用 MOCK_ADDR 覆盖)。
//!
//! 行为由 query `?scenario=` 控制:
//!   ok(默认)   非流式返回 JSON; 流式返回若干内容 chunk (+可选 usage) + [DONE]
//!   fail_before 首 chunk 前返回 500 (模拟连接/上游失败 → 网关应 fallback)
//!   mid_error   流式发 1 个 chunk 后中断 (无 [DONE], 模拟首 chunk 后中断)
//!   slow        延迟 70s 才响应 (超过网关 60s 超时)

use std::net::SocketAddr;
use std::time::Duration;

use axum::extract::Query;
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{body::Bytes, http::StatusCode, Json, Router};
use futures_util::stream::{self, Stream};
use serde_json::{json, Value};
use std::convert::Infallible;

#[tokio::main]
async fn main() {
    let app = Router::new().route("/v1/chat/completions", post(chat));
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
    let scenario = q.scenario.unwrap_or_else(|| "ok".to_string());
    let parsed: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let is_stream = parsed.get("stream").and_then(Value::as_bool).unwrap_or(false);
    let want_usage = parsed
        .get("stream_options")
        .and_then(|o| o.get("include_usage"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    match scenario.as_str() {
        "fail_before" => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":{"message":"mock upstream down","type":"server_error"}})),
        )
            .into_response(),
        "slow" => {
            tokio::time::sleep(Duration::from_secs(70)).await;
            Json(json!({"object":"chat.completion"})).into_response()
        }
        _ if is_stream => sse(scenario == "mid_error", want_usage).into_response(),
        _ => Json(json!({
            "id":"mock-1","object":"chat.completion","model":"mock",
            "choices":[{"index":0,"message":{"role":"assistant","content":"hello from mock"},"finish_reason":"stop"}],
            "usage":{"prompt_tokens":3,"completion_tokens":3,"total_tokens":6}
        }))
        .into_response(),
    }
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
