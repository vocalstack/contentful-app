import { LOGO_LIGHT } from './components/brandAssets.js'
import { CONNECT_MESSAGE, readCallback } from './connect.js'

/**
 * The tab the dashboard sends back to (this app's own page, outside Contentful).
 * It hands the code to the configuration screen that opened it, which redeems it and
 * answers with the outcome; then the tab closes.
 */
export function renderCallback(root: HTMLElement) {
  root.innerHTML = `<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fafafa;color:#131326}
main{text-align:center;padding:0 16px}main .logo{display:inline-flex;height:28px}main .logo svg{height:100%;width:auto}p{max-width:28rem;margin:24px auto 0}
code{display:block;margin-top:12px;padding:8px;background:#fff;border:1px solid #ddd;border-radius:4px;word-break:break-all;font-size:12px;text-align:left}</style>
<main><span class="logo" role="img" aria-label="VocalStack">${LOGO_LIGHT}</span><p id="vs-message">Connecting…</p></main>`
  const message = root.querySelector<HTMLElement>('#vs-message')!
  const say = (text: string) => (message.textContent = text)

  const opener = window.opener as null | Window
  if (!opener) {
    say('Go back to the VocalStack app configuration in Contentful and paste this address there:')
    const code = document.createElement('code')
    code.textContent = window.location.href
    message.after(code)
    return
  }

  const timeout = setTimeout(() => say('No answer from Contentful. Go back to the app configuration and try again.'), 20000)
  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin || e.data?.type !== `${CONNECT_MESSAGE}:done`) return
    clearTimeout(timeout)
    say(String(e.data.message ?? ''))
    if (e.data.ok) {
      message.append(document.createElement('br'), document.createElement('br'), 'You can close this tab.')
      setTimeout(() => window.close(), 1200)
    }
  })
  // The configuration screen is this app too, so only its own origin may read the code.
  opener.postMessage({ type: CONNECT_MESSAGE, ...readCallback(window.location.search) }, window.location.origin)
}
