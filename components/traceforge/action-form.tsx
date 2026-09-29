"use client";
import { useActionState, type ComponentProps } from "react";
type Result = { error: string } | void;
export function ActionForm({ action, children, ...props }: Omit<ComponentProps<"form">, "action"> & { action: (data: FormData) => Promise<Result> }) {
  const [result, submit, pending] = useActionState(async (_previous: Result, data: FormData) => action(data), undefined);
  return <form {...props} action={submit}>
    {result?.error ? <p className="form-error" role="alert">{result.error}</p> : null}
    <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "contents" }}>{children}</fieldset>
    {pending ? <p role="status">正在提交…</p> : null}
  </form>;
}
