export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // 古い WebView 向けのフォールバック
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}
