const DASHBOARD = "https://stockflow.amirelay.com/dashboard"
const VERSION = chrome.runtime.getManifest().version

async function cookiesFor(domain) {
  const bare = String(domain || "").replace(/^\./, "")
  const lists = await Promise.all([
    chrome.cookies.getAll({ domain: bare }),
    chrome.cookies.getAll({ domain: `.${bare}` }),
    chrome.cookies.getAll({ url: `https://${bare}/` }),
    chrome.cookies.getAll({ url: `https://www.${bare}/` }),
  ])
  const seen = new Map()
  for (const list of lists) {
    for (const c of list) {
      const prev = seen.get(c.name)
      if (!prev || (!c.domain.startsWith(".") && prev.domain.startsWith("."))) seen.set(c.name, c)
    }
  }
  return [...seen.values()]
}

async function detectVinted() {
  const cookies = await cookiesFor("vinted.fr")
  const loggedIn = cookies.some((c) => c.name === "access_token_web" || c.name === "v_uid" || c.name === "_vinted_fr_session")
  return {
    marketplace: "vinted",
    loggedIn,
    cookieNames: cookies.map((c) => c.name),
    cookieCount: cookies.length,
    displayName: cookies.find((c) => c.name === "v_uid")?.value?.slice(0, 12) || "Vinted",
  }
}

async function detectLeboncoin() {
  const cookies = await cookiesFor("leboncoin.fr")
  const loggedIn = cookies.some((c) => /session|auth|token|datadome/i.test(c.name))
  return {
    marketplace: "leboncoin",
    loggedIn,
    cookieNames: cookies.map((c) => c.name),
    cookieCount: cookies.length,
    displayName: "Leboncoin",
  }
}

async function snapshot() {
  const [vinted, leboncoin] = await Promise.all([detectVinted(), detectLeboncoin()])
  return { vinted, leboncoin, version: VERSION, at: Date.now() }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    if (msg?.type === "PING") {
      sendResponse({ ok: true, version: VERSION })
      return
    }
    if (msg?.type === "SNAPSHOT") {
      sendResponse({ ok: true, ...(await snapshot()) })
      return
    }
    if (msg?.type === "CONNECT") {
      const snap = await snapshot()
      const mk = msg.marketplace === "leboncoin" ? snap.leboncoin : snap.vinted
      if (!mk.loggedIn) {
        sendResponse({
          ok: false,
          error: `Connecte-toi d'abord sur ${msg.marketplace === "leboncoin" ? "leboncoin.fr" : "vinted.fr"} puis réessaie.`,
        })
        return
      }
      await chrome.storage.local.set({
        [`session_${msg.marketplace}`]: {
          ...mk,
          connectedAt: Date.now(),
          // cookie values stay in browser only; we store names + status for the dashboard bridge
        },
      })
      sendResponse({ ok: true, shop: mk })
      return
    }
    if (msg?.type === "OPEN_DASH") {
      await chrome.tabs.create({ url: `${DASHBOARD}/shops` })
      sendResponse({ ok: true })
      return
    }
    sendResponse({ ok: false, error: "unknown" })
  })().catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }))
  return true
})

// Capture CSRF / bearer hints (no raw secrets persisted beyond chrome.storage local)
chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    if (details.tabId < 0) return
    const url = new URL(details.url)
    const headers = {}
    for (const h of details.requestHeaders || []) headers[h.name.toLowerCase()] = h.value || ""
    if (url.hostname === "api.leboncoin.fr" && /^Bearer\s+eyJ/.test(headers.authorization || "")) {
      void chrome.storage.local.set({ lbc_has_bearer: true, lbc_bearer_at: Date.now() })
    }
    if (/(^|\.)vinted\./.test(url.hostname) && headers["x-csrf-token"]) {
      void chrome.storage.local.set({ vinted_has_csrf: true, vinted_csrf_at: Date.now() })
    }
  },
  {
    urls: ["https://api.leboncoin.fr/*", "https://*.vinted.fr/*", "https://*.vinted.com/*"],
  },
  ["requestHeaders", "extraHeaders"]
)
