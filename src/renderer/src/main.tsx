import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import TrayPanel from './components/tray/TrayPanel'
import './assets/index.css'

// Detect if this is the tray panel window
const params = new URLSearchParams(window.location.search)
const isTrayPanel = params.get('panel') === 'tray'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isTrayPanel ? (
      <TrayPanel />
    ) : (
      <HashRouter>
        <App />
      </HashRouter>
    )}
  </React.StrictMode>,
)
