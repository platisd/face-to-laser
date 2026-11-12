export function safeFileName(name: string): string {
  return [...name].filter((letter) => /[\p{L}\p{N}_-]/u.test(letter)).join("") || "portrait";
}
