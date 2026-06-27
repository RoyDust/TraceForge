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

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div>
          <p className="eyebrow">TraceForge Console</p>
          <h1 id="login-title">登录控制台</h1>
          <p className="muted">查看 TraceRun、Span、Event 和责任域归因。</p>
        </div>
        <form action={loginAction} className="login-form">
          <label>
            邮箱
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            密码
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {failed ? <p className="form-error">邮箱或密码不匹配。</p> : null}
          <button type="submit">进入 Trace 控制台</button>
        </form>
      </section>
    </main>
  );
}
