export type Route = "search" | "library" | "settings" | "queue";

export const ROUTES: Route[] = ["search", "library", "settings", "queue"];

export function isRoute(v: string): v is Route {
  return (ROUTES as string[]).includes(v);
}
