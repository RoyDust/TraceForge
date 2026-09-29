export const dynamic = "force-dynamic";
import { adminConfig, demoMode } from "@/lib/env";
import { getAdminSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { loginAction } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getAdminSession();
  if (session) redirect("/traces");

  const params = await searchParams;
  const failed = params.error === "1";
  const demo = demoMode();
  const config = adminConfig();
  const email = demo ? config.email : "";
  const password = demo && config.passwordHash.startsWith("plain:") ? config.passwordHash.slice(6) : "";

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div>
          <p className="eyebrow">TraceForge 控制台</p>
          {demo ? <p data-testid="demo-mode">演示模式 · 预置凭据仅供演示</p> : null}
          <h1 id="login-title">登录控制台</h1>
          <p className="muted">查看追踪运行、调用跨度、事件和责任域归因。</p>
        </div>
        <form action={loginAction} className="login-form">
          <label>
            邮箱
            <input name="email" type="email" autoComplete="username" required defaultValue={email} />
          </label>
          <label>
            密码
            <input name="password" type="password" autoComplete="current-password" required defaultValue={password} />
          </label>
          {failed ? <p className="form-error">邮箱或密码不匹配。</p> : null}
          <button type="submit">进入追踪控制台</button>
        </form>
      </section>
    </main>
  );
}
