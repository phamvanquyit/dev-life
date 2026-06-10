import { execFile } from 'node:child_process'

interface BrowserInfo {
  url: string
  domain: string
  browser: string
}

// AppleScript to get the active tab URL from various browsers
const BROWSER_SCRIPTS: Record<string, string> = {
  'Google Chrome': `
    tell application "Google Chrome"
      if (count of windows) > 0 then
        return URL of active tab of front window
      end if
    end tell
  `,
  'Google Chrome Canary': `
    tell application "Google Chrome Canary"
      if (count of windows) > 0 then
        return URL of active tab of front window
      end if
    end tell
  `,
  Arc: `
    tell application "Arc"
      if (count of windows) > 0 then
        return URL of active tab of front window
      end if
    end tell
  `,
  'Brave Browser': `
    tell application "Brave Browser"
      if (count of windows) > 0 then
        return URL of active tab of front window
      end if
    end tell
  `,
  'Microsoft Edge': `
    tell application "Microsoft Edge"
      if (count of windows) > 0 then
        return URL of active tab of front window
      end if
    end tell
  `,
  Opera: `
    tell application "Opera"
      if (count of windows) > 0 then
        return URL of active tab of front window
      end if
    end tell
  `,
  Safari: `
    tell application "Safari"
      if (count of windows) > 0 then
        return URL of current tab of front window
      end if
    end tell
  `,
  Firefox: `
    tell application "System Events"
      tell process "Firefox"
        -- Firefox doesn't expose URL via AppleScript directly
        -- Try to get the window title which usually contains the URL/domain
        if (count of windows) > 0 then
          return name of front window
        end if
      end tell
    end tell
  `,
}

// Get the frontmost application name
const FRONTMOST_APP_SCRIPT = `
  tell application "System Events"
    return name of first application process whose frontmost is true
  end tell
`

function runAppleScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 3000 }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout.trim())
    })
  })
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.replace(/^www\./, '')
    // Keep port for localhost so we can distinguish dev servers
    if (hostname === 'localhost' && parsed.port) {
      return `${hostname}:${parsed.port}`
    }
    return hostname
  } catch {
    return ''
  }
}

export async function getActiveBrowserURL(): Promise<BrowserInfo | null> {
  try {
    // 1. Find the frontmost app
    const frontApp = await runAppleScript(FRONTMOST_APP_SCRIPT)

    // 2. Check if the frontmost app is a known browser
    const script = BROWSER_SCRIPTS[frontApp]
    if (!script) {
      return null // Not a browser
    }

    // 3. Get the URL from that browser
    const rawResult = await runAppleScript(script)
    if (!rawResult) {
      return null
    }

    // Firefox returns window title, not URL — try to extract if it looks like a URL
    if (frontApp === 'Firefox') {
      // Firefox window title format: "Page Title — Mozilla Firefox"
      // We can't reliably get the URL from Firefox via AppleScript
      // Return what we can
      const title = rawResult.replace(/\s*[—–-]\s*Mozilla Firefox\s*$/i, '').trim()
      return {
        url: '',
        domain: title, // Best effort — will be the page title
        browser: 'Firefox',
      }
    }

    const domain = extractDomain(rawResult)
    if (!domain) {
      return null
    }

    return {
      url: rawResult,
      domain,
      browser: frontApp,
    }
  } catch {
    return null
  }
}
