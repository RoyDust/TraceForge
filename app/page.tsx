import { getAdminSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await getAdminSession();
  redirect(session ? "/traces" : "/login");
}
