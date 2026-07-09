import { getAdminSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { loginAction } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

function defaultEmail() {
  return process.env.ADMIN_EMAIL?.trim() ?? "";
}

function defaultPassword() {
  const configured = process.env.ADMIN_PASSWORD_HASH?.trim() ?? "";
  return configured.startsWith("plain:") ? configured.slice("plain:".length) : "";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getAdminSession();
  if (session) redirect("/traces");

  const params = await searchParams;
  const failed = params.error === "1";
  const email = defaultEmail();
  const password = defaultPassword();

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div>
          <p className="eyebrow">TraceForge 控制台</p>
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
