/**
 * Minimal SillyTavern HTTP boundary for scripts.
 * Game rules stay in game-core; this module only owns CSRF, cookies, and chat I/O.
 */
export async function createTavernApi(baseUrl) {
  const tavernUrl = new URL(baseUrl);
  const csrfResponse = await fetch(new URL('/csrf-token', tavernUrl));
  if (!csrfResponse.ok) throw new Error(`Failed to request a CSRF token: HTTP ${csrfResponse.status}`);
  const payload = await csrfResponse.json();
  const token = payload?.token;
  if (!token) throw new Error('SillyTavern returned an empty CSRF token');

  const cookieValues =
    typeof csrfResponse.headers.getSetCookie === 'function'
      ? csrfResponse.headers.getSetCookie()
      : (csrfResponse.headers.get('set-cookie') || '').split(/,(?=[^;]+=)/g).filter(Boolean);
  const cookies = cookieValues.map(value => value.split(';', 1)[0]).join('; ');

  async function request(path, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set('X-CSRF-Token', token);
    if (cookies) headers.set('Cookie', cookies);
    return fetch(new URL(path, tavernUrl), { ...init, headers });
  }

  return { tavernUrl, token, cookies, request };
}

export async function getChat(api, avatarUrl, fileName) {
  const response = await api.request('/api/chats/get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatar_url: avatarUrl, file_name: fileName }),
  });
  if (!response.ok) throw new Error(`Failed to read chat: HTTP ${response.status}`);
  return response.json();
}

export async function saveChat(api, payload) {
  const response = await api.request('/api/chats/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Failed to save chat: HTTP ${response.status} ${await response.text()}`);
  return response;
}

export async function getCharacter(api, avatarUrl) {
  const response = await api.request('/api/characters/get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatar_url: avatarUrl }),
  });
  if (!response.ok) throw new Error(`Failed to read character: HTTP ${response.status}`);
  return response.json();
}

export async function editCharacterAttribute(api, payload) {
  const response = await api.request('/api/characters/edit-attribute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Failed to edit character attribute: HTTP ${response.status} ${await response.text()}`);
  }
  return response;
}

export async function getSettings(api) {
  const response = await api.request('/api/settings/get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error(`Failed to read SillyTavern settings: HTTP ${response.status}`);
  const envelope = await response.json();
  return JSON.parse(envelope.settings || '{}');
}

export async function saveSettings(api, settings) {
  const response = await api.request('/api/settings/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error(`Failed to save SillyTavern settings: HTTP ${response.status}`);
  return response;
}

export async function saveAndActivateCharacterChat(api, payload) {
  const { avatarUrl, characterName, chatFile, chat } = payload;
  await saveChat(api, {
    ch_name: characterName,
    avatar_url: avatarUrl,
    file_name: chatFile,
    chat,
    force: true,
  });
  await editCharacterAttribute(api, {
    ch_name: characterName,
    avatar_url: avatarUrl,
    field: 'chat',
    value: chatFile,
  });
  const settings = await getSettings(api);
  settings.active_character = avatarUrl;
  settings.active_group = null;
  await saveSettings(api, settings);
}

export function createInitializedMvuLayer(statData, worldbookName) {
  if (!worldbookName) throw new Error('worldbookName is required for an initialized MVU fixture');
  return {
    stat_data: statData,
    display_data: structuredClone(statData),
    delta_data: {},
    initialized_lorebooks: { [worldbookName]: [] },
    schema: {},
  };
}
