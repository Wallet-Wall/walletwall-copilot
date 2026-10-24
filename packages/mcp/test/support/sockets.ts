import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

/**
 * Inet sockets (TCP, UDP, raw; listening or connected) currently owned by a process, read from the operating system and
 * not from inside the process. Only Windows and Linux have a reader. On those platforms a failure to read throws, so a
 * broken reader fails the test instead of silently skipping it or reporting "no sockets".
 *
 * Windows lines look like `TCP 127.0.0.1:50123 0.0.0.0:0 LISTENING 4242`; Linux entries are `<table> <local> <remote> ...`
 * with hex addresses, for example `tcp 0100007F:C3AB 00000000:0000` (127.0.0.1) or `tcp 00000000:C3AB ...` (0.0.0.0).
 */
export function inetSocketsOf(pid: number): string[] {
  if (process.platform === "win32") {
    const r = spawnSync("netstat", ["-ano"], { encoding: "utf8", timeout: 60_000 });
    if (r.status !== 0) throw new Error(`netstat failed: ${r.status}`);
    return r.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^(TCP|UDP)/i.test(l) && l.split(/\s+/).at(-1) === String(pid));
  }
  const fdDir = `/proc/${pid}/fd`;
  const inodes = new Set<string>();
  for (const fd of readdirSync(fdDir)) {
    try {
      const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(`${fdDir}/${fd}`));
      if (m?.[1]) inodes.add(m[1]);
    } catch {
      // a descriptor closed between listing and reading (for example the one readdir itself used)
    }
  }
  const hits: string[] = [];
  let tablesRead = 0;
  for (const table of ["tcp", "tcp6", "udp", "udp6", "raw", "raw6"]) {
    let text: string;
    try {
      text = readFileSync(`/proc/net/${table}`, "utf8");
    } catch {
      continue; // for example no IPv6 on this host
    }
    tablesRead++;
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length > 9 && inodes.has(cols[9] as string)) hits.push(`${table} ${cols[1]} ${cols[2]} ${cols[3]}`);
    }
  }
  if (tablesRead < 2) throw new Error("could not read the kernel socket tables");
  return hits;
}

export const MEASURABLE = process.platform === "win32" || process.platform === "linux";

/**
 * The local `host:port` of every TCP socket in LISTEN state owned by `pid`: dotted IPv4 (for example `127.0.0.1:50123`)
 * or `[ipv6:<hex>]:port` for an IPv6 listener, which no WalletWall listener is ever expected to be.
 */
export function tcpListenersOf(pid: number): string[] {
  const out: string[] = [];
  for (const entry of inetSocketsOf(pid)) {
    if (process.platform === "win32") {
      const cols = entry.split(/\s+/);
      if (/^TCP$/i.test(cols[0] ?? "") && /^LISTENING$/i.test(cols[3] ?? "") && cols[1]) out.push(cols[1]);
    } else {
      const [table, local, , state] = entry.split(" ") as [string, string, string, string];
      if (!table.startsWith("tcp") || state !== "0A") continue; // 0A = TCP_LISTEN
      const [hexAddr, hexPort] = local.split(":") as [string, string];
      const port = Number.parseInt(hexPort, 16);
      if (hexAddr.length === 8) {
        const bytes = (hexAddr.match(/../g) as string[]).map((b) => Number.parseInt(b, 16)).reverse();
        out.push(`${bytes.join(".")}:${port}`);
      } else out.push(`[ipv6:${hexAddr}]:${port}`);
    }
  }
  return out;
}
