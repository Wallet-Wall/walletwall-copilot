/* global document, navigator, window, MutationObserver */
// The browser-side script of the WallPrint disclosure view, served inline under the page's CSP nonce beside client.mjs.
//
// It keeps three pieces of presentation state, all in the DOM: which version of a lineage is in view (every version is
// rendered by the server; this script only toggles `hidden` and `aria-current`), which section of that version has
// focus (a local jump to a server-rendered target, never a URL or a fragment), and the copy control for exact values
// (identifiers, digests, the canonical payload), which copies exactly the printed text. It talks to no origin, stores
// nothing, computes no state, and leaves the canvas's own selection model (client.mjs) untouched: a WallPrint version
// or section is a local view choice, never an assertion selection.
//
// The same function serves the public resolver page, which imports it as a module and calls it after rendering (its CSP
// admits no inline script); the canvas serves it inline as `WALLPRINT_JS`, the function's own source text, unchanged.
export function wallPrintClient() {
  const app = document.getElementById("app");
  const status = document.getElementById("copy-status");
  const announcer = document.getElementById("view-status");
  let statusTimer;
  const all = (sel) => (app.querySelectorAll ? Array.from(app.querySelectorAll(sel)) : []);
  const one = (sel) => (app.querySelector ? app.querySelector(sel) : null);
  function announce(text) { if (announcer) announcer.textContent = text; }

  // The sections a jump or a portable reference may name, with the words a reader hears. A key outside this table is
  // refused and never echoed; "record" is the record itself (its heading), the target a reference without a section opens.
  const SECTIONS = { record: "Record", receipt: "Receipt", replay: "Replay", history: "History", assessments: "Assessments", provenance: "Provenance" };
  const known = (key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(SECTIONS, key);

  // Finds the server-rendered target of one section inside one record, brings it into view and focuses its heading.
  // Returns false when the record does not carry that section; nothing is created in its place. The key is only ever one
  // of the fixed table's own words, so it is never used to build a selector from input.
  function reachSection(record, key) {
    const target = key === "record" ? record : record && record.querySelector ? record.querySelector('[data-wp-target="' + key + '"]') : null;
    if (!target) return false;
    const h = (target.querySelector ? target.querySelector(key === "record" ? "h2" : "h3, h4") : null) || target;
    if (h.setAttribute) h.setAttribute("tabindex", "-1");
    if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
    if (h.focus) h.focus();
    return true;
  }

  function focusSection(record, key) {
    if (!record || !known(key)) { announce("That section is not part of this record."); return; }
    if (!reachSection(record, key)) { announce("The " + SECTIONS[key] + " section is not in this record."); return; }
    const d = record.dataset || {};
    announce(SECTIONS[key] + " of " + (d.version || "this record") + ": " + (d.recordId || "") + ".");
  }

  // Shows one version of the lineage and keeps every other version addressable: nothing is removed from the page. With
  // a section key, focus lands on that section of the chosen version instead of its heading.
  function showVersion(id, then) {
    const root = one(".wp");
    if (!root) return;
    let target = null;
    // The reveal played when the document was rendered; a version choice shows the chosen record at once.
    if (root.dataset) root.dataset.wpRevealed = "true";
    for (const a of all(".wp-record")) { const on = a.dataset.recordId === id; a.hidden = !on; if (on) target = a; }
    if (!target) return;
    if (root.dataset) root.dataset.wpFocus = id;
    for (const b of all("[data-wp-version]")) { if (b.dataset.wpVersion === id) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); }
    // The lifecycle the server recorded on the article is announced with the version, so a predecessor is never heard as current.
    const shown = "Showing " + (target.dataset.version || "record") + " of this lineage: " + id + "." + (target.dataset.lifecycle ? " Lifecycle " + target.dataset.lifecycle + "." : "");
    if (known(then) && reachSection(target, then)) { announce(shown + " " + SECTIONS[then] + " section. The other versions stay available."); return; }
    const h = target.querySelector ? target.querySelector("h2") : null;
    if (h && h.focus) { h.setAttribute("tabindex", "-1"); h.focus(); }
    announce(shown + " The other versions stay available.");
  }

  // Copies exactly the printed text of the exact value beside the control; never a shortened or reformatted value.
  async function copyExact(button) {
    const holder = button.closest(".wp-copyable");
    const node = holder ? holder.querySelector("code") : null;
    if (!node) return;
    const text = node.textContent;
    const label = (button.getAttribute("aria-label") || "Copy the full value").replace(/^Copy the full /, "");
    let ok;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = false; }
    if (!ok) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      try { ok = document.execCommand("copy"); } catch { ok = false; }
    }
    if (status) status.textContent = ok ? "Copied the full " + label + " (" + text.length + " characters)." : "Copy was not permitted here. The full " + label + " is selected: press Ctrl+C.";
    if (ok && typeof button.textContent === "string") {
      const was = button.textContent;
      if (button.dataset) button.dataset.copied = "true";
      if (button.style && button.offsetWidth) button.style.minWidth = button.offsetWidth + "px";
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = was; if (button.dataset) delete button.dataset.copied; }, 1500);
    }
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { if (status) status.textContent = ""; }, 4000);
  }

  app.addEventListener("click", (e) => {
    if (!e.target || !e.target.closest) return;
    const copy = e.target.closest("[data-wp-copy]");
    if (copy) { copyExact(copy); return; }
    const jump = e.target.closest("[data-wp-jump]");
    if (jump) { focusSection(jump.closest ? jump.closest(".wp-record") : null, jump.dataset ? jump.dataset.wpJump : undefined); return; }
    const version = e.target.closest("[data-wp-version]");
    if (version) showVersion(version.dataset.wpVersion, version.dataset.wpThen);
  });

  // A document opened from a portable reference names, on its root, the record the reference resolved to and the section
  // it asked for (data-wp-open, only ever one of the fixed table's keys, written by the server after a successful
  // resolution and a digest match). Once per rendered document, focus moves there and the move is announced. The server
  // renders the record; this only moves focus, exactly as a jump control does.
  function openReference() {
    const root = one(".wp[data-wp-open]");
    if (!root || !root.dataset || root.dataset.wpOpened === "true") return;
    root.dataset.wpOpened = "true";
    const key = root.dataset.wpOpen;
    if (!known(key)) return;
    // Focus must land on a visible section: the document opened from a reference shows at once, as a version choice does.
    root.dataset.wpRevealed = "true";
    const record = all(".wp-record").find((a) => a.dataset && a.dataset.recordId === root.dataset.wpFocus) || null;
    if (!record || !reachSection(record, key)) { announce("The referenced section is not in this record."); return; }
    announce("Opened from a portable reference: " + SECTIONS[key] + " of " + (record.dataset.version || "this record") + ": " + (record.dataset.recordId || "") + "." + (record.dataset.lifecycle ? " Lifecycle " + record.dataset.lifecycle + "." : ""));
  }
  if (typeof MutationObserver === "function" && app.nodeType) new MutationObserver(openReference).observe(app, { childList: true });
  openReference();
}

/** The same function as inline script text for the canvas page (served under its CSP nonce beside client.mjs). */
export const WALLPRINT_JS = `(${wallPrintClient.toString()})();`;
