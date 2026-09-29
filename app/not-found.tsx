import Link from "next/link";
export default function NotFound() {
  return <main className="empty-state"><h1>404 · 资源不存在</h1><p>记录可能已删除，或地址有误。</p><Link href="/traces">返回追踪运行</Link></main>;
}
