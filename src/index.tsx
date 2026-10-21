import { GlobalStyles } from '@contentful/f36-components'
import { SDKProvider } from '@contentful/react-apps-toolkit'
import { createRoot } from 'react-dom/client'

import App from './App.js'
import { renderCallback } from './callback.js'
import { CALLBACK_PARAM } from './connect.js'
import LocalhostWarning from './components/LocalhostWarning.js'

const root = document.getElementById('root')!
const inContentful = window.self !== window.top

if (!inContentful && new URLSearchParams(window.location.search).has(CALLBACK_PARAM)) {
  // The one-click connect tab, back from the VocalStack dashboard.
  renderCallback(root)
} else if (!inContentful && import.meta.env.DEV) {
  createRoot(root).render(<LocalhostWarning />)
} else {
  createRoot(root).render(
    <SDKProvider>
      <GlobalStyles />
      <App />
    </SDKProvider>,
  )
}
