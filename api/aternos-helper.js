// Aternos API Helper Functions
// Full automation with web scraping

export class AternosAPI {
  constructor(username, password, serverId) {
    this.username = username;
    this.password = password;
    this.serverId = serverId;
    this.cookies = null;
    this.token = null;
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
  }

  async login() {
    try {
      // Get login page and token
      const pageResponse = await fetch('https://aternos.org/go/', {
        headers: { 'User-Agent': this.userAgent }
      });
      const html = await pageResponse.text();
      
      // Extract CSRF token
      const tokenMatch = html.match(/name="token" value="([^"]+)"/);
      if (!tokenMatch) {
        throw new Error('Could not find CSRF token');
      }
      this.token = tokenMatch[1];

      // Perform login
      const loginResponse = await fetch('https://aternos.org/go/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.userAgent,
          'Referer': 'https://aternos.org/go/'
        },
        body: new URLSearchParams({
          'user': this.username,
          'password': this.password,
          'token': this.token,
          'remember': 'true'
        }),
        redirect: 'manual'
      });

      // Extract cookies from response
      const cookies = this.extractCookies(loginResponse.headers);
      this.cookies = cookies;

      return true;
    } catch (error) {
      console.error('Aternos login error:', error);
      return false;
    }
  }

  extractCookies(headers) {
    const cookies = {};
    const setCookieHeader = headers.get('set-cookie');
    if (setCookieHeader) {
      setCookieHeader.split(',').forEach(cookie => {
        const [nameValue] = cookie.split(';');
        const [name, value] = nameValue.split('=');
        if (name && value) {
          cookies[name.trim()] = value.trim();
        }
      });
    }
    return cookies;
  }

  formatCookies() {
    return Object.entries(this.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  async uploadFile(fileBuffer, filename) {
    try {
      // Get file upload page
      const filesPage = await fetch(`https://aternos.org/panel/servers/${this.serverId}/files`, {
        headers: {
          'Cookie': this.formatCookies(),
          'User-Agent': this.userAgent
        }
      });

      if (!filesPage.ok) {
        throw new Error('Could not access files page');
      }

      // Create form data for file upload
      const formData = new FormData();
      formData.append('file', new Blob([fileBuffer]), filename);
      
      // Upload file
      const uploadResponse = await fetch(`https://aternos.org/panel/servers/${this.serverId}/files/upload`, {
        method: 'POST',
        headers: {
          'Cookie': this.formatCookies(),
          'User-Agent': this.userAgent,
          'Referer': `https://aternos.org/panel/servers/${this.serverId}/files`
        },
        body: formData
      });

      return uploadResponse.ok || uploadResponse.status === 302;
    } catch (error) {
      console.error('Upload error:', error);
      return false;
    }
  }

  async updateServerProperties(properties) {
    try {
      // Get server properties page
      const propsPage = await fetch(`https://aternos.org/panel/servers/${this.serverId}/properties`, {
        headers: {
          'Cookie': this.formatCookies(),
          'User-Agent': this.userAgent
        }
      });

      if (!propsPage.ok) {
        throw new Error('Could not access properties page');
      }

      const html = await propsPage.text();
      
      // Extract form token
      const tokenMatch = html.match(/name="token" value="([^"]+)"/);
      const formToken = tokenMatch ? tokenMatch[1] : this.token;

      // Update properties
      const formData = new FormData();
      Object.entries(properties).forEach(([key, value]) => {
        formData.append(key, value);
      });
      formData.append('token', formToken);
      formData.append('save', 'Save');

      const updateResponse = await fetch(`https://aternos.org/panel/servers/${this.serverId}/properties`, {
        method: 'POST',
        headers: {
          'Cookie': this.formatCookies(),
          'User-Agent': this.userAgent,
          'Referer': `https://aternos.org/panel/servers/${this.serverId}/properties`
        },
        body: formData
      });

      return updateResponse.ok || updateResponse.status === 302;
    } catch (error) {
      console.error('Properties update error:', error);
      return false;
    }
  }

  async restartServer() {
    try {
      // Get server page
      const serverPage = await fetch(`https://aternos.org/panel/servers/${this.serverId}`, {
        headers: {
          'Cookie': this.formatCookies(),
          'User-Agent': this.userAgent
        }
      });

      if (!serverPage.ok) {
        throw new Error('Could not access server page');
      }

      const html = await serverPage.text();
      
      // Extract restart token
      const tokenMatch = html.match(/data-token="([^"]+)"/);
      const restartToken = tokenMatch ? tokenMatch[1] : this.token;

      // Restart server
      const restartResponse = await fetch(`https://aternos.org/panel/servers/${this.serverId}/ajax/restart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this.formatCookies(),
          'User-Agent': this.userAgent,
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `https://aternos.org/panel/servers/${this.serverId}`
        },
        body: new URLSearchParams({
          'token': restartToken
        })
      });

      return restartResponse.ok;
    } catch (error) {
      console.error('Restart error:', error);
      return false;
    }
  }

  async getServerStatus() {
    try {
      const statusResponse = await fetch(`https://aternos.org/panel/servers/${this.serverId}/ajax/status`, {
        headers: {
          'Cookie': this.formatCookies(),
          'User-Agent': this.userAgent,
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      if (statusResponse.ok) {
        const status = await statusResponse.json();
        return status;
      }
      return null;
    } catch (error) {
      console.error('Status check error:', error);
      return null;
    }
  }
}

// Manual upload instructions for Aternos
export function getAternosManualInstructions(packUrl) {
  return `
📋 Aternos Manual Upload Instructions:

1️⃣ Download Resource Pack:
   ${packUrl}

2️⃣ Upload to Aternos:
   - Go to your Aternos server dashboard
   - Click "Files" or "FTP/File Access"
   - Upload the downloaded resourcepack.zip to the root folder

3️⃣ Configure Server:
   - Go to "Server Properties"
   - Set "resource-pack" to: resourcepack.zip
   - Set "require-resource-pack" to: true

4️⃣ Restart Server:
   - Click "Restart" in your Aternos dashboard

5️⃣ Test in Minecraft:
   - Join your server
   - Accept the resource pack prompt
   - Place invisible item frames with renamed items

🎮 Your custom models should now appear in-game!
  `;
}
