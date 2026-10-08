import type { DefaultSession } from "next-auth";
import type { Role } from "../../domain/roles";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      agencyId: string | null;
    } & DefaultSession["user"];
  }
}
