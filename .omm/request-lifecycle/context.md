Console dispatch route 先返回 202，随后后台调用网关，避免浏览器等待完整模型响应；runId 在控制面和网关之间显式透传。
