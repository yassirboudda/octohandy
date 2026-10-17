const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

function showMsg(text, kind = "ok") {
  const el = $("#msg")
  el.textContent = text
  el.className = `msg ${kind}`
  clearTimeout(showMsg.t)
  showMsg.t = setTimeout(() => el.classList.add("hidden"), 5000)
}

function paint(snap) {
  $("#state").textContent = `v${snap.version || "?"}`
  for (const mk of ["vinted", "leboncoin"]) {
    const card = $(`[data-mk="${mk}"]`)
    const info = snap[mk]
    const dot = $("[data-dot]", card)
    const line = $("[data-line]", card)
    const btn = $("[data-connect]", card)
    if (!info) continue
    if (info.loggedIn) {
      dot.className = "dot green"
      line.textContent = `Session détectée · ${info.cookieCount} cookies`
      btn.textContent = "Connecter à Stockflow"
      btn.disabled = false
    } else {
      dot.className = "dot amber"
      line.textContent = `Ouvre ${mk === "vinted" ? "vinted.fr" : "leboncoin.fr"} connecté`
      btn.textContent = "Ouvrir le site"
      btn.dataset.needsOpen = "1"
    }
  }
}

async function refresh() {
  const snap = await chrome.runtime.sendMessage({ type: "SNAPSHOT" })
  paint(snap)
}

$("#openDash").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_DASH" }))

$$("[data-connect]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const card = btn.closest("[data-mk]")
    const marketplace = card?.dataset.mk
    if (!marketplace) return
    if (btn.dataset.needsOpen === "1") {
      const url = marketplace === "vinted" ? "https://www.vinted.fr" : "https://www.leboncoin.fr"
      await chrome.tabs.create({ url })
      return
    }
    btn.disabled = true
    const res = await chrome.runtime.sendMessage({ type: "CONNECT", marketplace })
    btn.disabled = false
    if (!res?.ok) {
      showMsg(res?.error || "Échec", "err")
      return
    }
    showMsg(`${marketplace} connecté. Ouvre Boutique sur Stockflow.`)
    const tabs = await chrome.tabs.query({
      url: ["https://stockflow.amirelay.com/*", "https://stockflow-nine-ashy.vercel.app/*", "http://localhost:3000/*"],
    })
    for (const tab of tabs) {
      if (!tab.id) continue
      chrome.tabs.sendMessage(tab.id, { type: "STOCKFLOW_CONNECTED", marketplace, shop: res.shop }).catch(() => {})
    }
    await refresh()
  })
})

refresh()
