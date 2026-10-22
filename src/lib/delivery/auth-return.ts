/** Only customer destinations are allowed; never navigate to an untrusted URL. */
export function customerReturnPath(value: string | null): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return "/home";
  try {
    const url = new URL(value, "https://oern.invalid");
    const allowed = [
      "/home",
      "/orders",
      "/profile",
      "/notifications",
      "/track",
      "/pickup",
      "/pickup/details",
      "/pickup/review",
    ];
    return url.origin === "https://oern.invalid" &&
      allowed.includes(url.pathname)
      ? `${url.pathname}${url.search}`
      : "/home";
  } catch {
    return "/home";
  }
}
