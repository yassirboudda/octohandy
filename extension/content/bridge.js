const VERSION = chrome.runtime.getManifest().version

function reply(type, extra = {}) {
  window.postMessage({ type, version: VERSION, source: "stockflow-extension", ...extra }, window.location.origin)
}

function markShopConnected(marketplace, shop) {
  try {
    const key = "stockflow.shops"
    const raw = localStorage.getItem(key)
    const shops = raw ? JSON.parse(raw) : []
    const idx = shops.findIndex((s) => s.marketplace === marketplace)
    if (idx >= 0) {
      shops[idx].status = "connected"
      if (shop?.displayName) shops[idx].displayName = shop.displayName
    } else {
      shops.push({
        id: `s-${marketplace}`,
        marketplace,
        displayName: shop?.displayName || marketplace,
        status: "connected",
        listingCount: 0,
      })
    }
    localStorage.setItem(key, JSON.stringify(shops))
  } catch {
    /* ignore */
  }
  reply("STOCKFLOW_SHOP_CONNECTED", { marketplace, shop })
}

window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || typeof e.data !== "object") return
  if (e.data.type === "STOCKFLOW_PING") reply("STOCKFLOW_PONG")
  if (e.data.type === "STOCKFLOW_GET_SESSIONS") {
    chrome.runtime.sendMessage({ type: "SNAPSHOT" }, (res) => {
      reply("STOCKFLOW_SESSIONS", { sessions: res })
    })
  }
})

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "STOCKFLOW_CONNECTED") {
    markShopConnected(msg.marketplace, msg.shop)
  }
})

reply("STOCKFLOW_EXTENSION_READY")
