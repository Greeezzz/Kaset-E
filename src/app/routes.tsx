export type Route = "search" | "library" | "settings" | "queue" | "stats";

export const ROUTES: Route[] = ["search", "library", "settings", "queue", "stats"];

export function isRoute(v: string): v is Route {
  return (ROUTES as string[]).includes(v);
}
