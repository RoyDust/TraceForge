export class InputError extends Error {}
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function field(form: FormData, key: string, max = 200, required = true) {
  const raw = form.get(key);
  if (raw !== null && typeof raw !== "string") throw new InputError(key + " 必须为文本。");
  const value = (raw ?? "").trim();
  if (required && !value) throw new InputError(key + " 不能为空。");
  if (value.length > max) throw new InputError(key + " 不能超过 " + max + " 字符。");
  return value;
}
export function idField(form: FormData, key: string) {
  const value = field(form, key, 36);
  if (!isUuid(value)) throw new InputError(key + " 不是合法 ID。");
  return value;
}
export function enumField<T extends string>(form: FormData, key: string, values: readonly T[]): T {
  const value = field(form, key);
  if (!values.includes(value as T)) throw new InputError(key + " 不是有效选项。");
  return value as T;
}
export function jsonField(form: FormData, key: string) {
  const text = field(form, key, 16_000, false);
  if (!text) return undefined;
  let value;
  try { value = JSON.parse(text); } catch { throw new InputError(key + " 必须为合法 JSON。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError(key + " 必须为 JSON 对象。");
  return value;
}
export function formError(error: unknown): { error: string } {
  if (error instanceof InputError) return { error: error.message };
  if (error && typeof error === "object" && "code" in error && ["P2002", "P2003", "P2025"].includes(String(error.code))) return { error: "记录不存在、关联无效或提交冲突，请刷新后重试。" };
  throw error;
}
