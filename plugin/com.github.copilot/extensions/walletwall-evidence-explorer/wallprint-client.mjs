// The browser-side script of the WallPrint disclosure view, served inline under the page's CSP nonce beside client.mjs.
//
// It keeps two pieces of presentation state, both in the DOM: which version of a lineage is in view (every version is
// rendered by the server; this script only toggles `hidden` and `aria-current`), and the copy control for exact values
// (identifiers, digests, the canonical payload), which copies exactly the printed text. It talks to no origin, stores
// nothing, computes no state, and leaves the canvas's own selection model (client.mjs) untouched: a WallPrint version
// is a local view choice, never an assertion selection.
export const WALLPRINT_JS = `(() => {
  const app = document.getElementById("app");
  const status = document.getElementById("copy-status");
  const announcer = document.getElementById("view-status");
  let statusTimer;
  const all = (sel) => (app.querySelectorAll ? Array.from(app.querySelectorAll(sel)) : []);
  const one = (sel) => (app.querySelector ? app.querySelector(sel) : null);
  function announce(text) { if (announcer) announcer.textContent = text; }

  // Shows one version of the lineage and keeps every other version addressable: nothing is removed from the page.
  function showVersion(id) {
    const root = one(".wp");
    if (!root) return;
    let target = null;
    // The reveal played when the document was rendered; a version choice shows the chosen record at once.
    if (root.dataset) root.dataset.wpRevealed = "true";
    for (const a of all(".wp-record")) { const on = a.dataset.recordId === id; a.hidden = !on; if (on) target = a; }
    if (!target) return;
    if (root.dataset) root.dataset.wpFocus = id;
    for (const b of all("[data-wp-version]")) { if (b.dataset.wpVersion === id) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); }
    const h = target.querySelector ? target.querySelector("h2") : null;
    if (h && h.focus) { h.setAttribute("tabindex", "-1"); h.focus(); }
    announce("Showing " + (target.dataset.version || "record") + " of this lineage: " + id + ". The other versions stay available.");
  }

  // Copies exactly the printed text of the exact value beside the control; never a shortened or reformatted value.
  async function copyExact(button) {
    const holder = button.closest(".wp-copyable");
    const node = holder ? holder.querySelector("code") : null;
    if (!node) return;
    const text = node.textContent;
    const label = (button.getAttribute("aria-label") || "Copy the full value").replace(/^Copy the full /, "");
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) { ok = false; }
    if (!ok) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
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
    const version = e.target.closest("[data-wp-version]");
    if (version) showVersion(version.dataset.wpVersion);
  });
})();`;
