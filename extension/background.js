// Holds no login or keys. It opens your Briefboard site in a new tab and hands the clip
// to the page, where your normal login applies and you choose the board.

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({ id: 'page', title: 'Save page to Briefboard', contexts: ['page'] })
  chrome.contextMenus.create({ id: 'link', title: 'Save link to Briefboard', contexts: ['link'] })
  chrome.contextMenus.create({ id: 'image', title: 'Save image to Briefboard', contexts: ['image'] })
  chrome.contextMenus.create({ id: 'text', title: 'Save selection to Briefboard', contexts: ['selection'] })
  const { siteUrl } = await chrome.storage.sync.get('siteUrl')
  if (!siteUrl) chrome.runtime.openOptionsPage()
})

async function imageAsDataUrl(src) {
  const response = await fetch(src, { credentials: 'omit' })
  if (!response.ok) throw new Error(`Image request failed: ${response.status}`)
  const blob = await response.blob()
  if (blob.size > MAX_IMAGE_BYTES || !blob.type.startsWith('image/')) throw new Error('Not a usable image')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${blob.type};base64,${btoa(binary)}`
}

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (id, change) => {
      if (id === tabId && change.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

// Runs inside the Briefboard tab. Sends now, and again when the page says it's ready,
// because the clip page may only appear after you log in.
function deliverClip(clip) {
  const send = () => window.postMessage({ type: 'briefboard-clip', clip }, window.location.origin)
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'briefboard-clip-ready') send()
  })
  send()
}

async function sendClip(clip) {
  const { siteUrl } = await chrome.storage.sync.get('siteUrl')
  if (!siteUrl) {
    chrome.runtime.openOptionsPage()
    return
  }
  const tab = await chrome.tabs.create({ url: `${siteUrl}#/clip` })
  await waitForLoad(tab.id)
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: deliverClip, args: [clip] })
}

chrome.action.onClicked.addListener((tab) => {
  void sendClip({ kind: 'page', url: tab.url, title: tab.title })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const page = { url: info.pageUrl ?? tab?.url, title: tab?.title }
  if (info.menuItemId === 'page') {
    await sendClip({ kind: 'page', ...page })
  } else if (info.menuItemId === 'link') {
    await sendClip({ kind: 'link', url: info.linkUrl, title: info.selectionText })
  } else if (info.menuItemId === 'text') {
    await sendClip({ kind: 'text', ...page, text: info.selectionText })
  } else if (info.menuItemId === 'image') {
    const clip = { kind: 'image', ...page, imageUrl: info.srcUrl }
    try {
      clip.imageDataUrl = await imageAsDataUrl(info.srcUrl)
    } catch (err) {
      // Saved as a link instead, if the site refuses to hand over the image.
      console.warn('Could not fetch image', err)
    }
    await sendClip(clip)
  }
})
