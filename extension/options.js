const input = document.getElementById('site')
const status = document.getElementById('status')

chrome.storage.sync.get('siteUrl').then(({ siteUrl }) => {
  if (siteUrl) input.value = siteUrl
})

document.getElementById('form').addEventListener('submit', async (event) => {
  event.preventDefault()
  let url
  try {
    url = new URL(input.value.trim())
  } catch {
    status.textContent = 'That is not a valid address. It should start with https://'
    return
  }
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !isLocal) {
    status.textContent = 'The address needs to start with https://'
    return
  }
  url.hash = ''
  url.search = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  await chrome.storage.sync.set({ siteUrl: url.href })
  input.value = url.href
  status.textContent = 'Saved. Right-click any page, link or image to clip it.'
})
