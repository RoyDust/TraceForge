有界队列接收 TraceJob，后台 worker 重试写入 TraceRun、TraceSpan、TraceEvent，并查询生效价格计算成本；队列满时整条丢弃并计数。
