const https = require('node:https')
const Database = require('better-sqlite3')
const path = require('node:path')
const os = require('node:os')

function loadCredentials() {
  const devLifeDbPath = path.join(os.homedir(), '.gemini/antigravity-ide/db.sqlite')
  try {
    const db = new Database(devLifeDbPath, { readonly: true })
    const row = db
      .prepare("SELECT value FROM configurations WHERE key = 'antigravity_credentials'")
      .get()
    db.close()
    if (row?.value) {
      return JSON.parse(row.value)
    }
  } catch (err) {
    console.error('Failed to load credentials from DB:', err)
  }
  return null
}

function apiRequest(method, url, body, accessToken, userAgent) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const headers = {
      accept: '*/*',
      authorization: `Bearer ${accessToken}`,
      'user-agent': userAgent || 'antigravity/2.0.4 darwin/arm64',
      'x-goog-api-client': 'gl-node/22.21.1',
      host: urlObj.hostname,
      connection: 'close',
    }

    if (body) {
      headers['content-type'] = 'application/json'
    }

    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method,
        headers,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve({
              statusCode: res.statusCode,
              body: JSON.parse(data),
            })
          } catch {
            resolve({
              statusCode: res.statusCode,
              body: data,
            })
          }
        })
      },
    )

    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function main() {
  const creds = await loadCredentials()
  if (!creds) {
    console.error('No credentials found in configurations!')
    return
  }

  const endpoint = creds.endpoint || 'https://daily-cloudcode-pa.googleapis.com'
  console.log('Using endpoint:', endpoint)

  // Call retrieveUserQuota
  try {
    console.log('--- Calling retrieveUserQuota ---')
    const res = await apiRequest(
      'POST',
      `${endpoint}/v1internal:retrieveUserQuota`,
      {},
      creds.access_token,
      creds.user_agent,
    )
    console.log('Status Code:', res.statusCode)
    console.log('Response Body:', JSON.stringify(res.body, null, 2))
  } catch (err) {
    console.error('retrieveUserQuota failed:', err)
  }

  // Call fetchUserInfo
  try {
    console.log('--- Calling fetchUserInfo ---')
    const res = await apiRequest(
      'POST',
      `${endpoint}/v1internal:fetchUserInfo`,
      {},
      creds.access_token,
      creds.user_agent,
    )
    console.log('Status Code:', res.statusCode)
    console.log('Response Body:', JSON.stringify(res.body, null, 2))
  } catch (err) {
    console.error('fetchUserInfo failed:', err)
  }
}

main()
