"use client";
import { useActionState, type ReactNode, type ComponentProps } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Result = { error: string } | void;
export function ActionForm({
  action,
  children,
  ...props
}: Omit<ComponentProps<"form">, "action"> & {
  action: (data: FormData) => Promise<Result>;
}) {
  const [result, submit, pending] = useActionState(
    async (_previous: Result, data: FormData) => action(data),
    undefined,
  );
  return (
    <form {...props} action={submit}>
      {result?.error ? (
        <p className="form-error" role="alert">
          {result.error}
        </p>
      ) : null}
      <fieldset
        disabled={pending}
        style={{
          border: 0,
          padding: 0,
          margin: 0,
          minWidth: 0,
          display: "contents",
        }}
      >
        {children}
      </fieldset>
      {pending ? <p role="status">正在提交…</p> : null}
    </form>
  );
}

export function CreateActionDialog({
  title,
  trigger,
  description,
  children,
}: {
  title: string;
  trigger: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger render={<Button type="button" />}>
        <Plus size={16} aria-hidden="true" />
        {trigger}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="tf-dialog-backdrop" />
        <Dialog.Popup className="tf-create-dialog">
          <div className="tf-dialog-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close
              render={<Button type="button" variant="ghost" size="icon" />}
              aria-label="关闭创建面板"
            >
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="tf-dialog-body">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
