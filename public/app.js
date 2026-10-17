const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + n.toFixed(2);

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.id);
  toast.id = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---- listing form ---- */
const body = $("#tagBody");
let last = null;

function showResult(r) {
  last = r;
  const p = r.price;
  const engine = r.engine.kind === "model"
    ? `Written by ${esc(r.engine.name)}`
    : `Template draft (${esc(r.engine.name)})`;
  body.innerHTML = `
    <h2>${esc(r.title)}</h2>
    <p class="desc">${esc(r.description)}</p>
    <ul class="tags">${r.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    ${p ? `<div class="pricebar"><div><small>Suggested price on ${esc(r.marketplace)}</small><b>${money(p.low)} to ${money(p.high)}</b></div>
      <small>Leaves you 30 to 45 percent after about ${p.feePct.toFixed(1)}% plus ${money(p.feeFixed)} in fees.</small></div>` : ""}
    <div class="rowbar"><span>${engine}</span><button type="button" id="copy">Copy listing</button></div>`;
  $("#copy").onclick = copyListing;
}

async function copyListing() {
  if (!last) return;
  const text = `${last.title}\n\n${last.description}\n\n${last.tags.join(", ")}`;
  try {
    await navigator.clipboard.writeText(text);
    toast("Listing copied");
  } catch {
    toast("Copy failed. Select the text and copy it by hand.");
  }
}

$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#go");
  const data = Object.fromEntries(new FormData(e.target));
  btn.disabled = true;
  btn.textContent = "Writing...";
  body.innerHTML = `<div class="skel"><i></i><i></i><i></i><i></i><i></i></div>`;
  if (window.matchMedia("(max-width:860px)").matches) $("#tag").scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Something went wrong. Try again.");
    showResult(json);
  } catch (err) {
    body.innerHTML = `<p class="err">${esc(err.message || "Could not reach the server. Check your connection and try again.")}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Write my listing";
  }
});

/* ---- billing toggle ---- */
document.querySelectorAll(".billing button").forEach((b) =>
  b.addEventListener("click", () => {
    const y = b.dataset.period === "y";
    document.querySelectorAll(".billing button").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll("[data-m]").forEach((el) => (el.textContent = y ? el.dataset.y : el.dataset.m));
  })
);

/* ---- waitlist ---- */
document.querySelectorAll("[data-plan]").forEach((b) =>
  b.addEventListener("click", () => {
    $("#wplan").value = b.dataset.plan;
    $("#wait").scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => $("#wemail").focus({ preventScroll: true }), 400);
  })
);

$("#wait").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#wmsg");
  msg.className = "wmsg";
  msg.textContent = "Saving...";
  try {
    const res = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("#wemail").value, plan: $("#wplan").value }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not save your email. Try again.");
    msg.textContent = "You are on the list. Watch your inbox.";
    $("#wemail").value = "";
  } catch (err) {
    msg.className = "wmsg bad";
    msg.textContent = err.message;
  }
});

$("#yr").textContent = new Date().getFullYear();
