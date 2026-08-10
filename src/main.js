const PLAYLIST_IDS = [
  'OLAK5uy_nrsol77KIGNjXoQrCTMw0tU1E2FjTeZ4I',
  'OLAK5uy_m-2Xq7-sAnzgR4iE6_jFcQRU6-1ODCbd4',
  'RDCLAK5uy_lPzT2bIPNJ_6II2vlgcE_-Mw1fMTfPheA',
  'RDCLAK5uy_nlKphX00YtBNjlGZcmPifGNAPXUSjezNM',
]

function sharedListeningState() {
  const match = location.pathname.match(/^\/listen\/([A-Za-z0-9_-]{11})\/?$/)
  if (!match) return null
  const params = new URLSearchParams(location.search)
  const rainMap = { drizzle: 'Drizzle', rain: 'Rain', heavy: 'Heavy', cloudburst: 'Cloudburst' }
  const seconds = Math.max(0, Math.min(86400, Number.parseInt(params.get('t') || '0', 10) || 0))
  return { videoId: match[1], seconds, rain: rainMap[params.get('rain')] || 'Rain' }
}

const sharedMoment = sharedListeningState()

const FALLBACK_ART = '/covers/monsoon-fallback.svg'
const RAIN_AUDIO = {
  Drizzle: '/audio/rain-drizzle.mp3',
  Rain: '/audio/rain.mp3',
  Heavy: '/audio/rain-heavy.mp3',
  Cloudburst: '/audio/rain-cloudburst.mp3',
}
const THUNDER_AUDIO = '/audio/distant-thunder.mp3'
const rainLevels = {
  Drizzle: { count: 55, speed: .5, length: .65 },
  Rain: { count: 105, speed: .9, length: .9 },
  Heavy: { count: 175, speed: 1.35, length: 1.1 },
  Cloudburst: { count: 255, speed: 1.9, length: 1.35 },
}
const atmospherePresets = {
  'window-seat': { rain: 'Rain', musicVolume: 70, rainVolume: 30 },
  midnight: { rain: 'Heavy', musicVolume: 55, rainVolume: 42 },
  'chai-rain': { rain: 'Drizzle', musicVolume: 75, rainVolume: 24 },
  'cloud-burst': { rain: 'Cloudburst', musicVolume: 60, rainVolume: 52 },
}
const todaysRainLines = [
  'Some nights sound better in the rain.',
  'The city softens when the windows begin to sing.',
  'Let the weather choose what the heart remembers.',
  'A little rain makes room for an older feeling.',
  'Tonight, the road home can wait one more song.',
  'The quietest hours carry the farthest melodies.',
  'Every wet street keeps a light of its own.',
  'Stay by the window until the song finds you.',
]

const storage = {
  get(key, fallback = null) {
    try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
  },
  set(key, value) {
    try { localStorage.setItem(key, value) } catch { /* Preferences remain session-only. */ }
  },
}

if (storage.get('monsoon-shuffle-songs-v3') !== 'ready') {
  storage.set('monsoon-shuffle', 'true')
  storage.set('monsoon-shuffle-songs-v3', 'ready')
}

function storedVolume(key, fallback) {
  const value = Number(storage.get(key, String(fallback)))
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback
}

const state = {
  player: null,
  ready: false,
  playing: false,
  pendingPlay: false,
  apiRequested: false,
  playlistFailures: 0,
  shuffle: storage.get('monsoon-shuffle') !== 'false',
  playlistIndex: Math.floor(Math.random() * PLAYLIST_IDS.length),
  playlistPrepared: false,
  rain: sharedMoment?.rain || storage.get('monsoon-rain', 'Rain'),
  rainEnabled: storage.get('monsoon-rain-enabled') === 'true',
  thunderEnabled: storage.get('monsoon-thunder-enabled') === 'true',
  musicVolume: storedVolume('monsoon-music-volume', 65),
  rainVolume: storedVolume('monsoon-rain-volume', 30),
  atmospherePreset: storage.get('monsoon-atmosphere-preset'),
  musicMuted: false,
  todaySessionActive: false,
  sharedVideoId: sharedMoment?.videoId || '',
  sharedTime: sharedMoment?.seconds || 0,
  sharedTrackLoaded: false,
  sharedSeekApplied: false,
}
if (!RAIN_AUDIO[state.rain]) state.rain = 'Rain'
if (!atmospherePresets[state.atmospherePreset]) state.atmospherePreset = null

const $ = (selector) => document.querySelector(selector)
const playerElement = $('#music-player')
const playButton = $('#play')
const playIcon = $('#play-icon')
const seek = $('#seek')
const albumArt = $('#album-art')
const artist = $('#track-artist')
const previousButton = $('#previous')
const nextButton = $('#next')
const rainAudio = new Audio()
const thunderAudio = new Audio()
rainAudio.loop = true
rainAudio.preload = 'none'
thunderAudio.preload = 'none'

function updateClock() {
  const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date())
  $('#clock-hours').textContent = parts.find((part) => part.type === 'hour')?.value || '12'
  $('#clock-minutes').textContent = parts.find((part) => part.type === 'minute')?.value || '00'
  $('#clock-period').textContent = (parts.find((part) => part.type === 'dayPeriod')?.value || '').toLowerCase()
  setTimeout(updateClock, 60050 - (Date.now() % 60000))
}
updateClock()

const presenceCount = $('#presence-count')
const presenceLabel = $('#presence-label')
const presenceElement = presenceCount.closest('.presence')
let presenceAvailable = false
let presenceRequestActive = false
let presenceFallbackTimer = 0

function getFallbackPresenceCount() {
  try {
    const stored = Number.parseInt(sessionStorage.getItem('monsoon-demo-presence') || '', 10)
    if (Number.isInteger(stored) && stored >= 70 && stored <= 250) return stored
  } catch {
    // A fresh believable count is fine when session storage is unavailable.
  }
  return Math.floor(78 + Math.random() * 151)
}

let fallbackPresenceCount = getFallbackPresenceCount()

function getPresenceClientId() {
  try {
    const existing = sessionStorage.getItem('monsoon-presence-id')
    if (/^[a-f0-9]{24,64}$/.test(existing || '')) return existing
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const created = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    sessionStorage.setItem('monsoon-presence-id', created)
    return created
  } catch {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  }
}

const presenceClientId = getPresenceClientId()

function renderPresence(count, isLive = true) {
  if (isLive) presenceAvailable = true
  presenceElement.classList.add('is-updating')
  presenceCount.textContent = new Intl.NumberFormat().format(count)
  presenceLabel.textContent = count === 1 ? 'listener online' : 'listeners online'
  presenceElement.setAttribute('aria-label', `${count} ${count === 1 ? 'listener' : 'listeners'} online`)
  setTimeout(() => presenceElement.classList.remove('is-updating'), 220)
}

function updateFallbackPresence() {
  if (!presenceAvailable) {
    const movement = [-2, -1, 1, 2][Math.floor(Math.random() * 4)]
    fallbackPresenceCount = Math.min(250, Math.max(70, fallbackPresenceCount + movement))
    try { sessionStorage.setItem('monsoon-demo-presence', String(fallbackPresenceCount)) } catch { /* optional */ }
    renderPresence(fallbackPresenceCount, false)
  }
  presenceFallbackTimer = window.setTimeout(updateFallbackPresence, 9000 + Math.random() * 9000)
}

renderPresence(fallbackPresenceCount, false)
presenceFallbackTimer = window.setTimeout(updateFallbackPresence, 9000 + Math.random() * 9000)

async function heartbeatPresence() {
  if (presenceRequestActive || document.hidden) return
  presenceRequestActive = true
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch('/api/presence.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: presenceClientId }),
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('Presence unavailable')
    const result = await response.json()
    if (!Number.isInteger(result.count) || result.count < 0) throw new Error('Invalid presence count')
    renderPresence(result.count)
  } catch {
    if (!presenceAvailable) renderPresence(fallbackPresenceCount, false)
  } finally {
    clearTimeout(timeout)
    presenceRequestActive = false
  }
}

heartbeatPresence()
let presenceHeartbeat = setInterval(heartbeatPresence, 25000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) heartbeatPresence()
})
addEventListener('pagehide', () => {
  clearInterval(presenceHeartbeat)
  clearTimeout(presenceFallbackTimer)
  navigator.sendBeacon?.('/api/presence.php?action=leave', JSON.stringify({ clientId: presenceClientId }))
})
addEventListener('pageshow', (event) => {
  if (!event.persisted) return
  clearInterval(presenceHeartbeat)
  heartbeatPresence()
  presenceHeartbeat = setInterval(heartbeatPresence, 25000)
  clearTimeout(presenceFallbackTimer)
  presenceFallbackTimer = window.setTimeout(updateFallbackPresence, 9000 + Math.random() * 9000)
})

const portraitScene = matchMedia('(max-width: 900px) and (orientation: portrait)')
const sceneLayers = { day: $('.scene__photo--day'), night: $('.scene__photo--night') }

function scenePath(theme) {
  const layout = portraitScene.matches ? 'mobile' : 'desktop'
  const time = theme === 'day' ? 'light' : 'dark'
  return `/backgrounds/${layout}-banner-${time}.jpg`
}

function loadScene(theme) {
  const layer = sceneLayers[theme]
  const source = scenePath(theme)
  if (layer.dataset.source === source) return Promise.resolve()

  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      layer.style.backgroundImage = `url('${source}')`
      layer.dataset.source = source
      resolve()
    }
    image.onerror = () => resolve()
    image.src = source
  })
}

const initialTheme = document.documentElement.dataset.theme === 'day' ? 'day' : 'night'
function updateThemeChrome(theme) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'day' ? '#d2dfe0' : '#071319')
}

updateThemeChrome(initialTheme)
loadScene(initialTheme)
addEventListener('load', () => {
  const loadAlternate = () => loadScene(initialTheme === 'day' ? 'night' : 'day')
  if ('requestIdleCallback' in window) window.requestIdleCallback(loadAlternate, { timeout: 2500 })
  else setTimeout(loadAlternate, 1200)
}, { once: true })

const themeSwitch = $('#theme-switch')
themeSwitch.checked = initialTheme === 'night'
themeSwitch.setAttribute('aria-label', initialTheme === 'night' ? 'Switch to day mode' : 'Switch to night mode')
themeSwitch.addEventListener('change', async () => {
  const theme = themeSwitch.checked ? 'night' : 'day'
  themeSwitch.disabled = true
  await loadScene(theme)
  document.documentElement.dataset.theme = theme
  updateThemeChrome(theme)
  themeSwitch.setAttribute('aria-label', theme === 'night' ? 'Switch to day mode' : 'Switch to night mode')
  storage.set('monsoon-theme', theme)
  themeSwitch.disabled = false
})

portraitScene.addEventListener('change', async () => {
  sceneLayers.day.dataset.source = ''
  sceneLayers.night.dataset.source = ''
  const theme = document.documentElement.dataset.theme === 'day' ? 'day' : 'night'
  await loadScene(theme)
  loadScene(theme === 'day' ? 'night' : 'day')
})

function formatTime(value) {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`
}

function setPlayerStatus(message, busy = false) {
  artist.textContent = message
  playerElement.setAttribute('aria-busy', String(busy))
}

function updateMediaMetadata(data) {
  if (!('mediaSession' in navigator) || !('MediaMetadata' in window) || !data.title) return
  const artwork = data.video_id ? [{ src: `https://i.ytimg.com/vi/${data.video_id}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' }] : []
  navigator.mediaSession.metadata = new window.MediaMetadata({
    title: data.title,
    artist: data.author || 'Monsoon Radio',
    album: 'Monsoon Radio · बरसात',
    artwork,
  })
}

function setPlaying(playing) {
  state.playing = playing
  playerElement.classList.toggle('is-playing', playing)
  playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play')
  playIcon.setAttribute('d', playing ? 'M7 5h3v14H7zM14 5h3v14h-3z' : 'm8 5 11 7-11 7V5Z')
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
}

let currentVideoId = ''
let trackAnimationToken = 0

function syncTrack() {
  if (!state.player) return
  const data = state.player.getVideoData?.() || {}
  const applyMetadata = () => {
    if (data.title) $('#track-title').textContent = data.title
    if (data.author) artist.textContent = data.author
    if (data.video_id) albumArt.src = `https://i.ytimg.com/vi/${data.video_id}/hqdefault.jpg`
    if (data.video_id) $('#share').disabled = false
    updateMediaMetadata(data)
    if (state.todaySessionActive) {
      if (data.title) $('#todays-rain-title').textContent = data.title
      if (data.author) $('#todays-rain-artist').textContent = data.author
    }
  }

  if (!data.video_id || data.video_id === currentVideoId) {
    applyMetadata()
    return
  }

  currentVideoId = data.video_id
  const token = ++trackAnimationToken
  const artwork = new Image()
  artwork.src = `https://i.ytimg.com/vi/${data.video_id}/hqdefault.jpg`

  if (reducedMotion) {
    applyMetadata()
    return
  }

  playerElement.classList.remove('is-track-entering')
  playerElement.classList.add('is-track-changing')
  setTimeout(() => {
    if (token !== trackAnimationToken) return
    applyMetadata()
    playerElement.classList.remove('is-track-changing')
    playerElement.classList.add('is-track-entering')
    playerElement.getBoundingClientRect()
    requestAnimationFrame(() => playerElement.classList.remove('is-track-entering'))
  }, 230)
}

function activePlaylist() {
  return PLAYLIST_IDS[state.playlistIndex]
}

function preparePlaylist(player) {
  const playlist = player.getPlaylist?.() || []
  if (state.playlistPrepared || playlist.length < 2) return false
  state.playlistPrepared = true
  const choices = playlist
    .map((videoId, index) => ({ videoId, index }))
    .filter(({ videoId }) => videoId !== currentVideoId)
  const selected = choices[Math.floor(Math.random() * choices.length)] || { index: 0 }
  player.cuePlaylist({ listType: 'playlist', list: activePlaylist(), index: selected.index })
  setTimeout(() => player.setShuffle(state.shuffle), 100)
  return true
}

function playNextPlaylist() {
  state.playlistIndex = (state.playlistIndex + 1) % PLAYLIST_IDS.length
  state.playlistPrepared = true
  state.player.loadPlaylist({ listType: 'playlist', list: activePlaylist(), index: 0 })
  setTimeout(() => state.player.setShuffle(state.shuffle), 100)
}

function cueRandomTrack() {
  if (!state.ready || !state.player) return
  state.playlistIndex = Math.floor(Math.random() * PLAYLIST_IDS.length)
  state.playlistPrepared = false
  state.playlistFailures = 0
  state.pendingPlay = true
  state.sharedVideoId = ''
  state.sharedTrackLoaded = false
  state.sharedSeekApplied = true
  setPlayerStatus('Choosing another song from the rain…', true)
  state.player.cuePlaylist({ listType: 'playlist', list: activePlaylist(), index: 0 })
}

function handlePlayerError() {
  state.playlistFailures += 1
  if (state.playlistFailures < PLAYLIST_IDS.length) {
    state.playlistIndex = (state.playlistIndex + 1) % PLAYLIST_IDS.length
    state.playlistPrepared = false
    state.player.cuePlaylist({ listType: 'playlist', list: activePlaylist(), index: 0 })
    setPlayerStatus('Trying the next collection…', true)
    return
  }
  state.pendingPlay = false
  setPlaying(false)
  setPlayerStatus('Playback is temporarily unavailable')
  playerElement.setAttribute('aria-busy', 'false')
}

window.onYouTubeIframeAPIReady = () => {
  state.player = new window.YT.Player('yt-player', {
    width: 200,
    height: 200,
    host: 'https://www.youtube-nocookie.com',
    playerVars: { listType: 'playlist', list: activePlaylist(), controls: 0, autoplay: 0, playsinline: 1, origin: window.location.origin },
    events: {
      onReady(event) {
        state.ready = true
        previousButton.disabled = false
        nextButton.disabled = false
        event.target.setVolume(state.musicVolume)
        if (state.musicMuted) event.target.mute()
        if (state.sharedVideoId) {
          state.sharedTrackLoaded = true
          event.target.cueVideoById({ videoId: state.sharedVideoId })
        } else {
          event.target.cuePlaylist({ listType: 'playlist', list: activePlaylist(), index: 0 })
        }
        setTimeout(() => event.target.setShuffle(state.shuffle), 100)
      },
      onStateChange(event) {
        setPlaying(event.data === window.YT.PlayerState.PLAYING)
        if (event.data === window.YT.PlayerState.CUED) {
          const sharedCue = state.sharedTrackLoaded && !state.sharedSeekApplied
          const recued = sharedCue ? false : preparePlaylist(event.target)
          if (!recued && state.pendingPlay) {
            state.pendingPlay = false
            if (sharedCue) {
              state.sharedSeekApplied = true
              if (state.sharedTime > 0) event.target.seekTo(state.sharedTime, true)
            }
            event.target.playVideo()
          }
          playerElement.setAttribute('aria-busy', 'false')
        }
        if (event.data === window.YT.PlayerState.ENDED) {
          const playlist = event.target.getPlaylist?.() || []
          if (state.shuffle) cueRandomTrack()
          else if (!playlist.length || event.target.getPlaylistIndex() >= playlist.length - 1) playNextPlaylist()
        }
        if ([window.YT.PlayerState.PLAYING, window.YT.PlayerState.CUED, window.YT.PlayerState.ENDED].includes(event.data)) syncTrack()
      },
      onAutoplayBlocked() {
        state.pendingPlay = false
        setPlaying(false)
        setPlayerStatus('Ready — tap play once more')
      },
      onError: handlePlayerError,
    },
  })
}

function loadYouTubeApi() {
  if (state.apiRequested) return
  state.apiRequested = true
  playerElement.setAttribute('aria-busy', 'true')
  setPlayerStatus('Opening the listening room…', true)
  const script = document.createElement('script')
  script.src = 'https://www.youtube.com/iframe_api'
  script.async = true
  script.onerror = () => {
    state.pendingPlay = false
    state.apiRequested = false
    setPlayerStatus('Could not reach YouTube — try again')
    playerElement.setAttribute('aria-busy', 'false')
  }
  document.head.appendChild(script)
}

previousButton.disabled = true
nextButton.disabled = true
playButton.addEventListener('click', () => {
  if (state.rainEnabled && rainAudio.paused) playRainAmbience()
  if (state.thunderEnabled && !thunderTimer) scheduleThunder(true)
  if (!state.apiRequested) {
    state.pendingPlay = true
    loadYouTubeApi()
    return
  }
  if (!state.ready) {
    state.pendingPlay = true
    setPlayerStatus('Still gathering the songs…', true)
    return
  }
  if (state.playing) state.player.pauseVideo()
  else state.player.playVideo()
})
previousButton.addEventListener('click', () => state.player?.previousVideo())
nextButton.addEventListener('click', () => {
  if (state.shuffle) cueRandomTrack()
  else state.player?.nextVideo()
})

if ('mediaSession' in navigator) {
  const mediaActions = {
    play: () => {
      if (state.ready) state.player.playVideo()
      else {
        state.pendingPlay = true
        loadYouTubeApi()
      }
    },
    pause: () => state.player?.pauseVideo(),
    previoustrack: () => state.player?.previousVideo(),
    nexttrack: () => {
      if (state.shuffle) cueRandomTrack()
      else state.player?.nextVideo()
    },
    seekbackward: (details) => state.player?.seekTo(Math.max(0, state.player.getCurrentTime() - (details.seekOffset || 10)), true),
    seekforward: (details) => state.player?.seekTo(Math.min(state.player.getDuration(), state.player.getCurrentTime() + (details.seekOffset || 10)), true),
    seekto: (details) => {
      if (Number.isFinite(details.seekTime)) state.player?.seekTo(details.seekTime, true)
    },
    stop: () => state.player?.pauseVideo(),
  }
  Object.entries(mediaActions).forEach(([action, handler]) => {
    try { navigator.mediaSession.setActionHandler(action, handler) } catch { /* This media action is not supported. */ }
  })
}

const shuffleButton = $('#shuffle')
shuffleButton.classList.toggle('is-selected', state.shuffle)
shuffleButton.setAttribute('aria-pressed', String(state.shuffle))
shuffleButton.addEventListener('click', (event) => {
  state.shuffle = !state.shuffle
  storage.set('monsoon-shuffle', String(state.shuffle))
  event.currentTarget.classList.toggle('is-selected', state.shuffle)
  event.currentTarget.setAttribute('aria-pressed', String(state.shuffle))
  state.player?.setShuffle(state.shuffle)
})

seek.addEventListener('input', () => {
  if (state.ready) state.player.seekTo(Number(seek.value), true)
})
albumArt.addEventListener('error', () => {
  if (!albumArt.src.endsWith(FALLBACK_ART)) albumArt.src = FALLBACK_ART
})

let lastMediaPositionSecond = -1
setInterval(() => {
  if (!state.ready) return
  const current = state.player.getCurrentTime() || 0
  const duration = state.player.getDuration() || 0
  seek.max = String(duration)
  seek.value = String(Math.min(current, duration))
  seek.style.setProperty('--progress', `${duration ? current / duration * 100 : 0}%`)
  $('#current-time').textContent = formatTime(current)
  $('#duration').textContent = formatTime(duration)
  const mediaSecond = Math.floor(current)
  if ('mediaSession' in navigator && duration > 0 && mediaSecond !== lastMediaPositionSecond) {
    lastMediaPositionSecond = mediaSecond
    try {
      navigator.mediaSession.setPositionState({ duration, position: Math.min(current, duration), playbackRate: state.player.getPlaybackRate?.() || 1 })
    } catch { /* Position state is unavailable on this browser. */ }
  }
}, 250)

const rainMixer = $('#rain-mixer')
const rainMixerTrigger = $('#rain-mixer-trigger')
const rainMixerPanel = $('#rain-mixer-panel')
const rainAmbienceToggle = $('#rain-ambience-toggle')
const thunderToggle = $('#thunder-toggle')
const rainMixerNote = $('#rain-mixer-note')
const musicVolume = $('#music-volume')
const rainVolume = $('#rain-volume')
const keyboardHelp = $('.keyboard-help')
const keyboardHelpTrigger = $('#keyboard-help-trigger')
const keyboardHelpPanel = $('#keyboard-help-panel')
const todaysRainTrigger = $('#todays-rain-trigger')
const todaysRainCard = $('#todays-rain-card')
const shareButton = $('#share')
const sharePopover = $('#share-popover')
const shareCopy = $('#share-copy')
const shareNative = $('#share-native')
const mobileShare = matchMedia('(max-width: 700px)')
const desktopShortcuts = matchMedia('(min-width: 701px) and (pointer: fine)')
let thunderTimer = 0
let shareCopyResetTimer = 0

function rainLabel(level) {
  return level === 'Heavy' ? 'Heavy rain' : level
}

function updateMixer() {
  $('#rain-mixer-summary').textContent = `${rainLabel(state.rain)} · ${state.rainVolume}%`
  rainAmbienceToggle.setAttribute('aria-pressed', String(state.rainEnabled))
  rainAmbienceToggle.querySelector('b').textContent = state.rainEnabled ? 'ON' : 'OFF'
  thunderToggle.setAttribute('aria-pressed', String(state.thunderEnabled))
  thunderToggle.querySelector('b').textContent = state.thunderEnabled ? 'ON' : 'OFF'
  document.querySelectorAll('[data-rain-level]').forEach((button) => {
    const selected = button.dataset.rainLevel === state.rain
    button.classList.toggle('is-selected', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
  document.querySelectorAll('[data-atmosphere-preset]').forEach((button) => {
    const selected = button.dataset.atmospherePreset === state.atmospherePreset
    button.classList.toggle('is-selected', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
  musicVolume.value = String(state.musicVolume)
  rainVolume.value = String(state.rainVolume)
  $('#music-volume-output').textContent = `${state.musicVolume}%`
  $('#rain-volume-output').textContent = `${state.rainVolume}%`
}

function clearAtmospherePreset() {
  state.atmospherePreset = null
  storage.set('monsoon-atmosphere-preset', '')
}

function applyAtmospherePreset(presetKey) {
  const preset = atmospherePresets[presetKey]
  if (!preset) return false

  state.atmospherePreset = presetKey
  state.rain = preset.rain
  state.musicVolume = preset.musicVolume
  state.rainVolume = preset.rainVolume
  state.rainEnabled = true
  storage.set('monsoon-atmosphere-preset', presetKey)
  storage.set('monsoon-rain', state.rain)
  storage.set('monsoon-rain-enabled', 'true')
  storage.set('monsoon-music-volume', String(state.musicVolume))
  storage.set('monsoon-rain-volume', String(state.rainVolume))
  drops = []
  state.player?.setVolume(state.musicVolume)
  playRainAmbience()
  updateMixer()
  return true
}

function setMixerNote(message) {
  rainMixerNote.textContent = message
}

async function playRainAmbience() {
  const source = RAIN_AUDIO[state.rain]
  if (rainAudio.dataset.source !== source) {
    rainAudio.src = source
    rainAudio.dataset.source = source
  }
  rainAudio.volume = state.rainVolume / 100
  try {
    await rainAudio.play()
    setMixerNote(`${rainLabel(state.rain)} ambience is playing.`)
  } catch {
    setMixerNote(`Add ${source} to enable this ambience.`)
  }
}

function stopRainAmbience() {
  rainAudio.pause()
  setMixerNote('Rain ambience is off.')
}

function scheduleThunder(shortDelay = false) {
  clearTimeout(thunderTimer)
  if (!state.thunderEnabled) return
  const delay = shortDelay ? 7000 + Math.random() * 9000 : 30000 + Math.random() * 45000
  thunderTimer = setTimeout(async () => {
    thunderTimer = 0
    if (!state.thunderEnabled) return
    if (!thunderAudio.src) thunderAudio.src = THUNDER_AUDIO
    thunderAudio.volume = Math.min(.45, (state.rainVolume / 100) * .55)
    thunderAudio.currentTime = 0
    try {
      await thunderAudio.play()
    } catch {
      setMixerNote(`Add ${THUNDER_AUDIO} to enable distant thunder.`)
      clearTimeout(thunderTimer)
    }
  }, delay)
}

thunderAudio.addEventListener('ended', () => scheduleThunder())

function setShortcutStatus(message) {
  $('#keyboard-help-status').textContent = message
  $('#keyboard-shortcut-live').textContent = message
}

function setKeyboardHelp(open, restoreFocus = false) {
  keyboardHelpPanel.hidden = !open
  keyboardHelpTrigger.setAttribute('aria-expanded', String(open))
  if (restoreFocus) keyboardHelpTrigger.focus()
}

function currentShareMoment() {
  const data = state.player?.getVideoData?.() || {}
  if (!data.video_id || !data.title) return null
  return {
    title: `${data.title} — बरसात Monsoon Radio`,
    text: `Listening to “${data.title}” by ${data.author || 'Monsoon Radio'} on बरसात — Monsoon Radio 🌧️`,
    url: 'https://barsaat.in/',
  }
}

function closeSharePopover(restoreFocus = false) {
  sharePopover.hidden = true
  shareButton.setAttribute('aria-expanded', 'false')
  if (restoreFocus) shareButton.focus()
}

function populateSharePopover(moment) {
  const message = encodeURIComponent(`${moment.text}\n${moment.url}`)
  $('#share-whatsapp').href = `https://wa.me/?text=${message}`
  $('#share-x').href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(moment.text)}&url=${encodeURIComponent(moment.url)}`
  $('#share-facebook').href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(moment.url)}`
  $('#share-telegram').href = `https://t.me/share/url?url=${encodeURIComponent(moment.url)}&text=${encodeURIComponent(moment.text)}`
  sharePopover.hidden = false
  shareButton.setAttribute('aria-expanded', 'true')
  shareNative.disabled = typeof navigator.share !== 'function'
}

async function openNativeShare(moment) {
  if (typeof navigator.share !== 'function') return false
  try {
    await navigator.share(moment)
    return true
  } catch (error) {
    return error?.name === 'AbortError'
  }
}

async function copyShareLink(url) {
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url)
  else {
    const field = document.createElement('textarea')
    field.value = url
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    if (!copied) throw new Error('Copy failed')
  }
}

shareButton.setAttribute('aria-expanded', 'false')
shareButton.addEventListener('click', async () => {
  const moment = currentShareMoment()
  if (!moment) return
  if (mobileShare.matches && typeof navigator.share === 'function') {
    const handled = await openNativeShare(moment)
    if (handled) return
  }
  if (!todaysRainCard.hidden) {
    todaysRainCard.hidden = true
    todaysRainTrigger.setAttribute('aria-expanded', 'false')
  }
  populateSharePopover(moment)
})

$('#share-close').addEventListener('click', () => closeSharePopover(true))
shareNative.addEventListener('click', async () => {
  const moment = currentShareMoment()
  if (moment) await openNativeShare(moment)
})
shareCopy.addEventListener('click', async () => {
  const moment = currentShareMoment()
  if (!moment) return
  try {
    await copyShareLink(moment.url)
    shareCopy.textContent = '✓ Rainy moment copied'
    clearTimeout(shareCopyResetTimer)
    shareCopyResetTimer = setTimeout(() => { shareCopy.textContent = 'Copy link' }, 2200)
  } catch {
    shareCopy.textContent = 'Copy unavailable'
    clearTimeout(shareCopyResetTimer)
    shareCopyResetTimer = setTimeout(() => { shareCopy.textContent = 'Copy link' }, 2200)
  }
})

keyboardHelpTrigger.addEventListener('click', () => setKeyboardHelp(keyboardHelpPanel.hidden))

function toggleMusicMute() {
  state.musicMuted = !state.musicMuted
  if (state.ready) {
    if (state.musicMuted) state.player.mute()
    else {
      state.player.unMute()
      state.player.setVolume(state.musicVolume)
    }
  }
  playerElement.classList.toggle('is-muted', state.musicMuted)
  setShortcutStatus(state.musicMuted ? 'Music muted.' : 'Music unmuted.')
}

rainMixerTrigger.addEventListener('click', () => {
  const open = rainMixerPanel.hidden
  rainMixerPanel.hidden = !open
  rainMixerTrigger.setAttribute('aria-expanded', String(open))
  if (open) rainMixerPanel.querySelector('button, input')?.focus()
})

document.addEventListener('pointerdown', (event) => {
  if (!rainMixerPanel.hidden && !rainMixer.contains(event.target)) {
    rainMixerPanel.hidden = true
    rainMixerTrigger.setAttribute('aria-expanded', 'false')
  }
  if (!keyboardHelpPanel.hidden && !keyboardHelp.contains(event.target)) setKeyboardHelp(false)
  if (!sharePopover.hidden && !sharePopover.contains(event.target) && !shareButton.contains(event.target)) closeSharePopover()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !keyboardHelpPanel.hidden) setKeyboardHelp(false, true)
  if (event.key === 'Escape' && !todaysRainCard.hidden) {
    todaysRainCard.hidden = true
    todaysRainTrigger.setAttribute('aria-expanded', 'false')
    todaysRainTrigger.focus()
  }
  if (event.key === 'Escape' && !sharePopover.hidden) closeSharePopover(true)
  if (event.key === 'Escape' && !rainMixerPanel.hidden) {
    rainMixerPanel.hidden = true
    rainMixerTrigger.setAttribute('aria-expanded', 'false')
    rainMixerTrigger.focus()
  }

  if (!desktopShortcuts.matches || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target
  if (target instanceof Element && target.closest('input, button, a, textarea, select, [contenteditable="true"]')) return

  const shortcut = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (![' ', 'ArrowRight', 'ArrowLeft', 'm', 'r', 'd', '?'].includes(shortcut)) return
  event.preventDefault()

  if (shortcut === ' ') playButton.click()
  if (shortcut === 'ArrowRight' && !nextButton.disabled) nextButton.click()
  if (shortcut === 'ArrowLeft' && !previousButton.disabled) previousButton.click()
  if (shortcut === 'm') toggleMusicMute()
  if (shortcut === 'r') rainMixerTrigger.click()
  if (shortcut === 'd') themeSwitch.click()
  if (shortcut === '?') setKeyboardHelp(keyboardHelpPanel.hidden)
})

rainAmbienceToggle.addEventListener('click', () => {
  state.rainEnabled = !state.rainEnabled
  storage.set('monsoon-rain-enabled', String(state.rainEnabled))
  if (state.rainEnabled) playRainAmbience()
  else stopRainAmbience()
  updateMixer()
})

document.querySelectorAll('[data-atmosphere-preset]').forEach((button) => {
  button.addEventListener('click', () => applyAtmospherePreset(button.dataset.atmospherePreset))
})

todaysRainTrigger.addEventListener('click', () => {
  closeSharePopover()
  const presetKeys = Object.keys(atmospherePresets)
  const choices = presetKeys.filter((key) => key !== state.atmospherePreset)
  const presetKey = choices[Math.floor(Math.random() * choices.length)] || presetKeys[0]
  applyAtmospherePreset(presetKey)

  state.todaySessionActive = true
  $('#todays-rain-time').textContent = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date())
  $('#todays-rain-weather').textContent = rainLabel(state.rain)
  $('#todays-rain-title').textContent = 'Finding a song…'
  $('#todays-rain-artist').textContent = 'Monsoon Radio'
  $('#todays-rain-line').textContent = todaysRainLines[Math.floor(Math.random() * todaysRainLines.length)]
  todaysRainCard.hidden = false
  todaysRainTrigger.setAttribute('aria-expanded', 'true')

  const previousPlaylist = state.playlistIndex
  state.playlistIndex = Math.floor(Math.random() * PLAYLIST_IDS.length)
  if (PLAYLIST_IDS.length > 1 && state.playlistIndex === previousPlaylist) state.playlistIndex = (previousPlaylist + 1) % PLAYLIST_IDS.length
  state.playlistPrepared = false
  state.playlistFailures = 0
  state.pendingPlay = true
  state.sharedVideoId = ''
  state.sharedTrackLoaded = false
  state.sharedSeekApplied = true
  setPlayerStatus('Choosing today’s rain song…', true)

  if (!state.apiRequested) loadYouTubeApi()
  else if (state.ready) state.player.cuePlaylist({ listType: 'playlist', list: activePlaylist(), index: 0 })
})

$('#todays-rain-close').addEventListener('click', () => {
  todaysRainCard.hidden = true
  todaysRainTrigger.setAttribute('aria-expanded', 'false')
  todaysRainTrigger.focus()
})

document.querySelectorAll('[data-rain-level]').forEach((button) => {
  button.addEventListener('click', () => {
    clearAtmospherePreset()
    state.rain = button.dataset.rainLevel
    storage.set('monsoon-rain', state.rain)
    drops = []
    if (state.rainEnabled) playRainAmbience()
    updateMixer()
  })
})

thunderToggle.addEventListener('click', () => {
  state.thunderEnabled = !state.thunderEnabled
  storage.set('monsoon-thunder-enabled', String(state.thunderEnabled))
  if (state.thunderEnabled) {
    setMixerNote('Distant thunder will arrive occasionally.')
    scheduleThunder(true)
  } else {
    clearTimeout(thunderTimer)
    thunderAudio.pause()
    setMixerNote('Distant thunder is off.')
  }
  updateMixer()
})

musicVolume.addEventListener('input', () => {
  clearAtmospherePreset()
  state.musicVolume = Number(musicVolume.value)
  storage.set('monsoon-music-volume', String(state.musicVolume))
  state.player?.setVolume(state.musicVolume)
  $('#music-volume-output').textContent = `${state.musicVolume}%`
  updateMixer()
})

rainVolume.addEventListener('input', () => {
  clearAtmospherePreset()
  state.rainVolume = Number(rainVolume.value)
  storage.set('monsoon-rain-volume', String(state.rainVolume))
  rainAudio.volume = state.rainVolume / 100
  thunderAudio.volume = Math.min(.45, (state.rainVolume / 100) * .55)
  $('#rain-volume-output').textContent = `${state.rainVolume}%`
  $('#rain-mixer-summary').textContent = `${rainLabel(state.rain)} · ${state.rainVolume}%`
  updateMixer()
})

updateMixer()
if (state.rainEnabled) setMixerNote('Rain is ready and will begin after your next interaction.')
if (state.thunderEnabled) setMixerNote('Rain and distant thunder are ready for your next interaction.')

const canvas = $('#rain-canvas')
const context = canvas.getContext('2d')
let drops = []
let rainFrame = 0
let lightningTimer = 0
let width = 0
let height = 0
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

function resizeRain() {
  const ratio = Math.min(devicePixelRatio || 1, 1.5)
  width = innerWidth
  height = innerHeight
  canvas.width = width * ratio
  canvas.height = height * ratio
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  drops = []
}

function makeDrop(top = false) {
  const setting = rainLevels[state.rain] || rainLevels.Rain
  return { x: Math.random() * width, y: top ? Math.random() * height : -20, length: (8 + Math.random() * 24) * setting.length, speed: (4 + Math.random() * 7) * setting.speed, opacity: .08 + Math.random() * .2, drift: .35 + Math.random() * .9 }
}

function drawRain() {
  const setting = rainLevels[state.rain] || rainLevels.Rain
  while (drops.length < setting.count) drops.push(makeDrop(true))
  if (drops.length > setting.count) drops.length = setting.count
  context.clearRect(0, 0, width, height)
  context.lineWidth = .7
  for (let index = 0; index < drops.length; index += 1) {
    const drop = drops[index]
    const day = document.documentElement.dataset.theme === 'day'
    context.strokeStyle = day ? `rgba(64,89,101,${Math.min(.32, drop.opacity * .95)})` : `rgba(184,214,220,${drop.opacity})`
    context.beginPath()
    context.moveTo(drop.x, drop.y)
    context.lineTo(drop.x - drop.drift, drop.y + drop.length)
    context.stroke()
    drop.y += drop.speed
    drop.x -= drop.drift * .16
    if (drop.y > height + 30) drops[index] = makeDrop()
  }
  rainFrame = requestAnimationFrame(drawRain)
}

function scheduleLightning() {
  clearTimeout(lightningTimer)
  lightningTimer = setTimeout(() => {
    $('.scene').classList.add('scene--lightning')
    setTimeout(() => $('.scene').classList.remove('scene--lightning'), 360)
    scheduleLightning()
  }, 20000 + Math.random() * 40000)
}

resizeRain()
addEventListener('resize', resizeRain)
if (!reducedMotion) {
  rainFrame = requestAnimationFrame(drawRain)
  scheduleLightning()
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(rainFrame)
      clearTimeout(lightningTimer)
    } else {
      rainFrame = requestAnimationFrame(drawRain)
      scheduleLightning()
    }
  })
}

addEventListener('beforeunload', () => {
  cancelAnimationFrame(rainFrame)
  clearTimeout(lightningTimer)
  clearTimeout(thunderTimer)
  rainAudio.pause()
  thunderAudio.pause()
})
