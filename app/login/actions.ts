"use server";

import { signIn } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const ok = await signIn(email, password);
  if (!ok) {
    redirect("/login?error=1");
  }
  redirect("/traces");
}
