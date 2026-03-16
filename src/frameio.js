const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ADOBE_IMS_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const ADOBE_AUTH_URL = 'https://ims-na1.adobelogin.com/ims/authorize/v2';
const FRAMEIO_API = 'https://api.frame.io/v4';
const TOKEN_FILE = path.join(__dirname, '..', '.token');
const SCOPES = 'email,profile,additional_info.roles,offline_access,openid';

let cachedToken = null;
let tokenExpiry = null;

// ---- Token file management ----

function readTokenFile() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

function writeTokenFile(data) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function hasRefreshToken() {
  const data = readTokenFile();
  return !!(data && data.refresh_token);
}

// ---- Adobe IMS OAuth ----

function getAuthorizeUrl() {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const params = new URLSearchParams({
    client_id: process.env.ADOBE_CLIENT_ID,
    scope: SCOPES.replace(/,/g, ' '),
    response_type: 'code',
    redirect_uri: `${appUrl}/auth/callback`
  });
  return `${ADOBE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.ADOBE_CLIENT_ID,
    client_secret: process.env.ADOBE_CLIENT_SECRET,
    code,
    redirect_uri: `${appUrl}/auth/callback`
  });

  const response = await axios.post(ADOBE_IMS_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  const { access_token, refresh_token, expires_in } = response.data;

  writeTokenFile({ refresh_token, updated_at: new Date().toISOString() });

  cachedToken = access_token;
  tokenExpiry = Date.now() + (expires_in - 300) * 1000;

  return { access_token, refresh_token };
}

async function getAccessToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const tokenData = readTokenFile();
  if (!tokenData || !tokenData.refresh_token) {
    throw new Error('NO_REFRESH_TOKEN');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ADOBE_CLIENT_ID,
    client_secret: process.env.ADOBE_CLIENT_SECRET,
    refresh_token: tokenData.refresh_token
  });

  const response = await axios.post(ADOBE_IMS_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  cachedToken = response.data.access_token;
  tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;

  if (response.data.refresh_token) {
    writeTokenFile({ refresh_token: response.data.refresh_token, updated_at: new Date().toISOString() });
  }

  return cachedToken;
}

function apiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

// ---- Frame.io API ----

async function listClients() {
  const token = await getAccessToken();
  const accountId = process.env.FRAMEIO_ACCOUNT_ID;
  const res = await axios.get(`${FRAMEIO_API}/accounts/${accountId}/projects`, {
    headers: apiHeaders(token),
    params: { page_size: 50 }
  });
  const items = Array.isArray(res.data) ? res.data : (res.data.results || res.data.data || []);
  return items.map(p => ({ id: p.id, name: p.name }));
}

async function getProjectRootAssetId(projectId) {
  const token = await getAccessToken();
  const res = await axios.get(`${FRAMEIO_API}/projects/${projectId}`, {
    headers: apiHeaders(token)
  });
  return res.data.root_asset_id;
}

const WEEK_REGEX = /^S\d{2}$/i;
const ALLOWED_SPECIAL = ['youtube'];
const IGNORED_FOLDERS = ['archive semaine'];

function isAllowedFolder(name) {
  if (IGNORED_FOLDERS.includes(name.toLowerCase())) return false;
  if (WEEK_REGEX.test(name)) return true;
  if (ALLOWED_SPECIAL.includes(name.toLowerCase())) return true;
  return false;
}

async function listProjectFolders(projectId) {
  const token = await getAccessToken();
  const rootAssetId = await getProjectRootAssetId(projectId);

  const res = await axios.get(`${FRAMEIO_API}/assets/${rootAssetId}/children`, {
    headers: apiHeaders(token),
    params: { type: 'folder', page_size: 100 }
  });

  const items = Array.isArray(res.data) ? res.data : (res.data.results || res.data.data || []);
  return items
    .filter(item => item.type === 'folder' && isAllowedFolder(item.name))
    .map(f => ({ id: f.id, name: f.name }));
}

async function findOrCreate(headers, parentId, name) {
  const listRes = await axios.get(`${FRAMEIO_API}/assets/${parentId}/children`, {
    headers,
    params: { type: 'folder', page_size: 100 }
  });

  const items = Array.isArray(listRes.data) ? listRes.data : (listRes.data.results || listRes.data.data || []);
  const existing = items.find(
    item => item.name.toLowerCase() === name.toLowerCase() && item.type === 'folder'
  );

  if (existing) return existing;

  const createRes = await axios.post(`${FRAMEIO_API}/assets/${parentId}/children`, {
    name,
    type: 'folder'
  }, { headers });

  return createRes.data;
}

async function uploadFile(filePath, fileName, fileSize, mimeType, projectId, weekFolder) {
  const token = await getAccessToken();
  const rootAssetId = await getProjectRootAssetId(projectId);
  const headers = apiHeaders(token);

  const folder = await findOrCreate(headers, rootAssetId, weekFolder);

  const assetRes = await axios.post(`${FRAMEIO_API}/assets/${folder.id}/children`, {
    name: fileName,
    type: 'file',
    filesize: fileSize,
    filetype: mimeType
  }, { headers });

  const asset = assetRes.data;
  const uploadUrls = asset.upload_urls;

  if (!uploadUrls || uploadUrls.length === 0) {
    throw new Error('No upload URLs returned from Frame.io');
  }

  const chunkSize = Math.ceil(fileSize / uploadUrls.length);

  for (let i = 0; i < uploadUrls.length; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, fileSize);
    const chunk = fs.createReadStream(filePath, { start, end: end - 1 });

    await axios.put(uploadUrls[i], chunk, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': end - start
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });
  }

  return {
    id: asset.id,
    name: asset.name,
    link: `https://app.frame.io/reviews/${asset.id}`
  };
}

module.exports = {
  getAccessToken,
  getAuthorizeUrl,
  exchangeCodeForTokens,
  hasRefreshToken,
  listClients,
  listProjectFolders,
  uploadFile
};
