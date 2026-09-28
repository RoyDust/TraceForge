TraceForge 由 Next.js 控制面、Rust 数据面网关、PostgreSQL 单一数据契约和 OpenAI-compatible 模型上游组成。核心闭环是调用经网关治理后形成 TraceRun、TraceSpan、TraceEvent，再由控制台用于失败定位、成本分析和回归评测。
