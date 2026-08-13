import supportQrUrl from '../source-assets/backgrounds/GooglePay_QR.jpg'

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
  const seconds = Math.max(0, Math.min(86400, Number.parseInt(params.get('t') || '0', 10) || 0))
  return { videoId: match[1], seconds }
}

const sharedMoment = sharedListeningState()

const FALLBACK_ART = '/covers/monsoon-fallback.svg'
const RAIN_AUDIO = '/audio/liecio-light-rain-109591.mp3'
const THUNDER_AUDIO = '/audio/thunder-sound.mp3'
const THUNDER_FALLBACK = '/audio/distant-thunder.wav'
const ATMOSPHERE_SCENES = {
  'cozy-window': { night: '/backgrounds/atmospheres/cozy-window.jpg', day: '/backgrounds/atmospheres/cozy-window-day.jpg' },
  'night-train': { night: '/backgrounds/atmospheres/night-train.jpg', day: '/backgrounds/atmospheres/night-train-day.jpg' },
  'monsoon-cafe': { night: '/backgrounds/atmospheres/monsoon-cafe.jpg', day: '/backgrounds/atmospheres/monsoon-cafe-day.jpg' },
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
  rainEnabled: storage.get('monsoon-rain-enabled') !== 'false',
  thunderEnabled: storage.get('monsoon-thunder-enabled') !== 'false',
  musicVolume: storedVolume('monsoon-music-volume', 65),
  rainVolume: storedVolume('monsoon-rain-volume', 20),
  musicMuted: false,
  todaySessionActive: false,
  sharedVideoId: sharedMoment?.videoId || '',
  sharedTime: sharedMoment?.seconds || 0,
  sharedTrackLoaded: false,
  sharedSeekApplied: false,
  activeScene: 'monsoon-city',
}

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
  presenceLabel.textContent = count === 1 ? 'listener in the rain' : 'listeners in the rain'
  presenceElement.setAttribute('aria-label', `${count} ${count === 1 ? 'listener' : 'listeners'} in the rain`)
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
  updateAtmosphereSceneSource()
  updateSceneThumbnails()
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

const atmosphereScene = $('#atmosphere-scene')

function renderSceneSelection(sceneId) {
  document.querySelectorAll('.scene-option').forEach((option) => {
    option.classList.toggle('is-selected', option.dataset.scene === sceneId)
  })
}

function updateAtmosphereSceneSource() {
  const sources = ATMOSPHERE_SCENES[state.activeScene]
  if (!sources) return
  const theme = document.documentElement.dataset.theme === 'day' ? 'day' : 'night'
  atmosphereScene.style.backgroundImage = `url('${sources[theme]}')`
  atmosphereScene.dataset.theme = theme
}

function updateSceneThumbnails() {
  const theme = document.documentElement.dataset.theme === 'day' ? 'day' : 'night'
  document.querySelectorAll('.scene-option img[data-day][data-night]').forEach((image) => {
    image.src = image.dataset[theme]
  })
}

function applyVisualScene(sceneId, persist = false) {
  const sources = ATMOSPHERE_SCENES[sceneId]
  if (!sources) {
    atmosphereScene.style.backgroundImage = ''
    atmosphereScene.dataset.scene = ''
    $('.scene').classList.remove('has-atmosphere-scene')
    state.activeScene = 'monsoon-city'
  } else {
    atmosphereScene.dataset.scene = sceneId
    $('.scene').classList.add('has-atmosphere-scene')
    state.activeScene = sceneId
    updateAtmosphereSceneSource()
    const currentTheme = document.documentElement.dataset.theme === 'day' ? 'day' : 'night'
    const alternate = new Image()
    alternate.src = sources[currentTheme === 'day' ? 'night' : 'day']
  }
  renderSceneSelection(state.activeScene)
  if (persist) storage.set('barsaat-visual-scene', state.activeScene)
}

function restoreSavedScene() {
  const saved = storage.get('barsaat-visual-scene', 'monsoon-city')
  applyVisualScene(ATMOSPHERE_SCENES[saved] ? saved : 'monsoon-city')
}
updateSceneThumbnails()
restoreSavedScene()

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
const supportTrigger = $('#support-trigger')
const supportDialog = $('#support-dialog')
const supportClose = $('#support-close')
const siteContext = $('.site-context')
const siteContextDetails = $('.site-context__details')
const siteInfoPanel = $('#site-info-panel')
const siteInfoButtons = [...document.querySelectorAll('[data-site-info]')]
const sceneTrigger = $('#scene-trigger')
const sceneDialog = $('#scene-dialog')
const sceneClose = $('#scene-close')
const mobileShare = matchMedia('(max-width: 700px)')
const desktopShortcuts = matchMedia('(min-width: 701px) and (pointer: fine)')
let thunderTimer = 0
let shareCopyResetTimer = 0
let supportPreviousFocus = null
let scenePreviousFocus = null

$('#support-qr').src = supportQrUrl

function setSiteInfoPanel(name = '') {
  const open = name !== ''
  siteInfoPanel.hidden = !open
  siteInfoButtons.forEach((button) => button.setAttribute('aria-expanded', String(open && button.dataset.siteInfo === name)))
  document.querySelectorAll('[data-site-info-content]').forEach((content) => {
    content.hidden = !open || content.dataset.siteInfoContent !== name
  })
}

siteInfoButtons.forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault()
    const name = button.dataset.siteInfo || ''
    const alreadyOpen = !siteInfoPanel.hidden && button.getAttribute('aria-expanded') === 'true'
    siteContextDetails.open = false
    setSiteInfoPanel(alreadyOpen ? '' : name)
  })
})

siteContextDetails.addEventListener('toggle', () => {
  if (siteContextDetails.open) setSiteInfoPanel('')
})

$('#site-reset-consent').addEventListener('click', (event) => {
  try { localStorage.removeItem('monsoon-analytics-consent') } catch { /* Consent remains unchanged if storage is unavailable. */ }
  window.gtag?.('consent', 'update', { analytics_storage: 'denied' })
  event.currentTarget.textContent = 'Choice reset'
})

function updateMixer() {
  const summaryEl = $('#rain-mixer-summary')
  if (summaryEl) summaryEl.textContent = `Rain · ${state.rainVolume}%`
  if (rainAmbienceToggle) {
    rainAmbienceToggle.setAttribute('aria-pressed', String(state.rainEnabled))
    const statusB = rainAmbienceToggle.querySelector('b')
    if (statusB) statusB.textContent = state.rainEnabled ? 'ON' : 'OFF'
  }
  if (thunderToggle) {
    thunderToggle.setAttribute('aria-pressed', String(state.thunderEnabled))
    const statusB = thunderToggle.querySelector('b')
    if (statusB) statusB.textContent = state.thunderEnabled ? 'ON' : 'OFF'
  }
  if (musicVolume) musicVolume.value = String(state.musicVolume)
  if (rainVolume) rainVolume.value = String(state.rainVolume)
  const musicOut = $('#music-volume-output')
  if (musicOut) musicOut.textContent = `${state.musicVolume}%`
  const rainOut = $('#rain-volume-output')
  if (rainOut) rainOut.textContent = `${state.rainVolume}%`
}

function setMixerNote(message) {
  rainMixerNote.textContent = message
}

async function playRainAmbience() {
  if (rainAudio.dataset.source !== RAIN_AUDIO) {
    rainAudio.src = RAIN_AUDIO
    rainAudio.dataset.source = RAIN_AUDIO
  }
  rainAudio.volume = state.rainVolume / 100
  try {
    await rainAudio.play()
    setMixerNote('Rain ambience is playing.')
  } catch {
    setMixerNote(`Add ${RAIN_AUDIO} to enable this ambience.`)
  }
}

function stopRainAmbience() {
  rainAudio.pause()
  setMixerNote('Rain ambience is off.')
}

function triggerThunderFlash() {
  const sceneEl = $('.scene')
  document.body.classList.remove('is-lightning')
  if (sceneEl) sceneEl.classList.remove('scene--lightning')

  void document.body.offsetWidth

  document.body.classList.add('is-lightning')
  if (sceneEl) sceneEl.classList.add('scene--lightning')

  setTimeout(() => {
    document.body.classList.remove('is-lightning')
    if (sceneEl) sceneEl.classList.remove('scene--lightning')
  }, 680)
}

function playThunderBurst() {
  if (!state.thunderEnabled) return
  triggerThunderFlash()

  if (!thunderAudio.src || !thunderAudio.src.includes('thunder')) {
    thunderAudio.src = THUNDER_AUDIO
  }
  thunderAudio.volume = 0.85
  thunderAudio.currentTime = 0

  const playPromise = thunderAudio.play()
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      if (thunderAudio.src !== location.origin + THUNDER_FALLBACK) {
        thunderAudio.src = THUNDER_FALLBACK
        thunderAudio.play().catch(() => {})
      }
    })
  }
}

function scheduleThunder(immediate = false) {
  clearTimeout(thunderTimer)
  if (!state.thunderEnabled) return

  if (immediate) {
    playThunderBurst()
  }

  const nextDelay = 16000 + Math.random() * 20000
  thunderTimer = setTimeout(() => {
    thunderTimer = 0
    if (state.thunderEnabled) {
      playThunderBurst()
      scheduleThunder()
    }
  }, nextDelay)
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
    title: `${data.title} | Barsaat Monsoon Radio`,
    text: `Listening to “${data.title}” by ${data.author || 'Monsoon Radio'} on Barsaat Monsoon Radio 🌧️`,
    url: 'https://barsaat.in/',
  }
}

function closeSharePopover(restoreFocus = false) {
  sharePopover.hidden = true
  shareButton.setAttribute('aria-expanded', 'false')
  if (restoreFocus) shareButton.focus()
}

function setSupportDialog(open, restoreFocus = false) {
  supportDialog.hidden = !open
  supportTrigger.setAttribute('aria-expanded', String(open))
  document.body.classList.toggle('is-support-open', open)
  if (open) {
    supportPreviousFocus = document.activeElement
    supportClose.focus()
  } else if (restoreFocus) {
    const focusTarget = supportPreviousFocus instanceof HTMLElement ? supportPreviousFocus : supportTrigger
    focusTarget.focus()
  }
}

function setSceneDialog(open, restoreFocus = false) {
  sceneDialog.hidden = !open
  sceneTrigger.setAttribute('aria-expanded', String(open))
  if (open) {
    scenePreviousFocus = document.activeElement
    sceneClose.focus()
  } else if (restoreFocus) {
    const focusTarget = scenePreviousFocus instanceof HTMLElement ? scenePreviousFocus : sceneTrigger
    focusTarget.focus()
  }
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
supportTrigger.addEventListener('click', () => setSupportDialog(true))
supportClose.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  event.stopPropagation()
  setSupportDialog(false, true)
})
supportClose.addEventListener('click', (event) => {
  event.stopPropagation()
  if (!supportDialog.hidden) setSupportDialog(false, true)
})
supportDialog.addEventListener('pointerdown', (event) => {
  if (event.target === supportDialog) setSupportDialog(false, true)
})
sceneTrigger.addEventListener('click', () => setSceneDialog(true))
sceneClose.addEventListener('click', () => setSceneDialog(false, true))
sceneDialog.addEventListener('pointerdown', (event) => {
  if (event.target === sceneDialog) setSceneDialog(false, true)
})
document.querySelectorAll('.scene-option').forEach((option) => {
  option.addEventListener('click', () => {
    const sceneId = option.dataset.scene || 'monsoon-city'
    applyVisualScene(sceneId, true)
    $('#scene-preview-status').textContent = 'Atmosphere selected. Every scene is free.'
    setSceneDialog(false, true)
  })
})

document.querySelectorAll('.soundscape-option:not(:disabled)').forEach((option) => {
  option.addEventListener('click', () => {
    document.querySelectorAll('.soundscape-option').forEach((item) => item.classList.toggle('is-selected', item === option))
    const isDownpour = option.dataset.soundscape === 'heavy-downpour'
    state.rainEnabled = true
    state.rainVolume = isDownpour ? 82 : 20
    storage.set('monsoon-rain-enabled', 'true')
    storage.set('monsoon-rain-volume', String(state.rainVolume))
    updateMixer()
    playRainAmbience().then(() => setMixerNote(isDownpour ? 'Heavy downpour is playing.' : 'Light rain is playing.'))
  })
})
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
  if (siteContextDetails.open && !siteContextDetails.contains(event.target)) siteContextDetails.open = false
  if (!siteInfoPanel.hidden && !siteContext.contains(event.target)) setSiteInfoPanel('')
  if (!rainMixerPanel.hidden && !rainMixer.contains(event.target)) {
    rainMixerPanel.hidden = true
    rainMixerTrigger.setAttribute('aria-expanded', 'false')
  }
  if (!keyboardHelpPanel.hidden && !keyboardHelp.contains(event.target)) setKeyboardHelp(false)
  if (!sharePopover.hidden && !sharePopover.contains(event.target) && !shareButton.contains(event.target)) closeSharePopover()
})

document.addEventListener('keydown', (event) => {
  if (!supportDialog.hidden && event.key === 'Tab') {
    event.preventDefault()
    supportClose.focus()
  }
  if (event.key === 'Escape' && !supportDialog.hidden) setSupportDialog(false, true)
  if (event.key === 'Escape' && !sceneDialog.hidden) setSceneDialog(false, true)
  if (event.key === 'Escape' && siteContextDetails.open) {
    siteContextDetails.open = false
    siteContextDetails.querySelector('summary')?.focus()
  }
  if (event.key === 'Escape' && !siteInfoPanel.hidden) {
    const activeButton = siteInfoButtons.find((button) => button.getAttribute('aria-expanded') === 'true')
    setSiteInfoPanel('')
    activeButton?.focus()
  }
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

if (rainAmbienceToggle) {
  rainAmbienceToggle.addEventListener('click', () => {
    state.rainEnabled = !state.rainEnabled
    storage.set('monsoon-rain-enabled', String(state.rainEnabled))
    if (state.rainEnabled) playRainAmbience()
    else stopRainAmbience()
    updateMixer()
  })
}

todaysRainTrigger.addEventListener('click', () => {
  closeSharePopover()

  state.todaySessionActive = true
  $('#todays-rain-time').textContent = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date())
  $('#todays-rain-weather').textContent = 'Heavy rain'
  $('#todays-rain-title').textContent = 'Finding a song…'
  $('#todays-rain-artist').textContent = 'Monsoon Radio'
  $('#todays-rain-line').textContent = todaysRainLines[Math.floor(Math.random() * todaysRainLines.length)]
  todaysRainCard.hidden = false
  todaysRainTrigger.setAttribute('aria-expanded', 'true')

  if (state.rainEnabled && rainAudio.paused) playRainAmbience()
  if (state.thunderEnabled && !thunderTimer) scheduleThunder(true)

  const previousPlaylist = state.playlistIndex
  state.playlistIndex = Math.floor(Math.random() * PLAYLIST_IDS.length)
  if (PLAYLIST_IDS.length > 1 && state.playlistIndex === previousPlaylist) {
    state.playlistIndex = (previousPlaylist + 1) % PLAYLIST_IDS.length
  }
  state.playlistPrepared = false
  state.playlistFailures = 0
  state.pendingPlay = true
  state.sharedVideoId = ''
  state.sharedTrackLoaded = false
  state.sharedSeekApplied = true
  setPlayerStatus('Choosing today’s rain song…', true)

  if (!state.apiRequested) {
    loadYouTubeApi()
  } else if (state.ready && state.player) {
    const listLen = state.player.getPlaylist?.()?.length || 10
    const randomIndex = Math.floor(Math.random() * listLen)
    state.player.loadPlaylist({ listType: 'playlist', list: activePlaylist(), index: randomIndex })
    setTimeout(() => {
      try { state.player.playVideo() } catch {}
    }, 150)
  }
})

$('#todays-rain-close').addEventListener('click', () => {
  todaysRainCard.hidden = true
  todaysRainTrigger.setAttribute('aria-expanded', 'false')
  todaysRainTrigger.focus()
})

if (thunderToggle) {
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
}

musicVolume.addEventListener('input', () => {
  state.musicVolume = Number(musicVolume.value)
  storage.set('monsoon-music-volume', String(state.musicVolume))
  state.player?.setVolume(state.musicVolume)
  $('#music-volume-output').textContent = `${state.musicVolume}%`
  updateMixer()
})

rainVolume.addEventListener('input', () => {
  state.rainVolume = Number(rainVolume.value)
  storage.set('monsoon-rain-volume', String(state.rainVolume))
  rainAudio.volume = state.rainVolume / 100
  thunderAudio.volume = 0.85
  if (state.rainVolume > 0 && !state.rainEnabled) {
    state.rainEnabled = true
    storage.set('monsoon-rain-enabled', 'true')
  }
  if (state.rainVolume > 0 && rainAudio.paused) playRainAmbience()
  $('#rain-volume-output').textContent = `${state.rainVolume}%`
  $('#rain-mixer-summary').textContent = `Rain · ${state.rainVolume}%`
  updateMixer()
})

updateMixer()
if (state.rainEnabled) setMixerNote('Rain is ready and will begin after your next interaction.')
if (state.thunderEnabled) setMixerNote('Rain and distant thunder are ready for your next interaction.')

window.addEventListener('click', () => {
  if (state.thunderEnabled && !thunderTimer) scheduleThunder(true)
}, { once: true })

const bgCanvas = $('#rain-canvas')
const bgContext = bgCanvas ? bgCanvas.getContext('2d') : null
const fgCanvas = $('#fg-rain-canvas')
const fgContext = fgCanvas ? fgCanvas.getContext('2d') : null

let bgDrops = []
let staticDroplets = []
let slidingDroplets = []
let playerSplashes = []
let rainFrame = 0
let width = 0
let height = 0
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

function getRainParams() {
  const vol = state.rainVolume
  if (vol <= 0) return { bgCount: 0, bgSpeed: 0, bgLen: 0, staticCount: 0, slidingCount: 0, slidingSpeed: 0 }
  if (vol <= 25) {
    return { bgCount: 50, bgSpeed: 0.7, bgLen: 0.65, staticCount: 40, slidingCount: 1, slidingSpeed: 0.5 }
  }
  if (vol <= 45) {
    return { bgCount: 110, bgSpeed: 1.0, bgLen: 1.0, staticCount: 75, slidingCount: 2, slidingSpeed: 0.9 }
  }
  if (vol <= 68) {
    return { bgCount: 180, bgSpeed: 1.3, bgLen: 1.3, staticCount: 105, slidingCount: 4, slidingSpeed: 1.4 }
  }
  return { bgCount: 260, bgSpeed: 1.6, bgLen: 1.6, staticCount: 140, slidingCount: 6, slidingSpeed: 2.0 }
}

function resizeRain() {
  const ratio = Math.min(devicePixelRatio || 1, 1.5)
  width = innerWidth
  height = innerHeight
  
  if (bgCanvas) {
    bgCanvas.width = width * ratio
    bgCanvas.height = height * ratio
    bgCanvas.style.width = `${width}px`
    bgCanvas.style.height = `${height}px`
    bgContext.setTransform(ratio, 0, 0, ratio, 0, 0)
  }

  if (fgCanvas) {
    fgCanvas.width = width * ratio
    fgCanvas.height = height * ratio
    fgCanvas.style.width = `${width}px`
    fgCanvas.style.height = `${height}px`
    fgContext.setTransform(ratio, 0, 0, ratio, 0, 0)
  }

  bgDrops = []
  initStaticDroplets()
  slidingDroplets = []
  playerSplashes = []
}

function initStaticDroplets() {
  staticDroplets = []
  const maxStatic = 150
  for (let i = 0; i < maxStatic; i++) {
    staticDroplets.push({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 1.0 + Math.random() * 1.8,
      shimmer: Math.random() * Math.PI * 2,
      shimmerSpeed: 0.01 + Math.random() * 0.02,
      active: true
    })
  }
}

function makeBgDrop(top = false) {
  const params = getRainParams()
  return {
    x: Math.random() * width,
    y: top ? Math.random() * height : -30,
    length: (10 + Math.random() * 26) * (params.bgLen || 1),
    speed: (4.5 + Math.random() * 6.5) * (params.bgSpeed || 1),
    opacity: 0.08 + Math.random() * 0.22,
    drift: 0.35 + Math.random() * 0.9
  }
}

function makeSlidingDroplet() {
  const params = getRainParams()
  return {
    x: 10 + Math.random() * (width - 20),
    y: -20 - Math.random() * 120,
    r: 1.5 + Math.random() * 1.5,
    vy: (0.35 + Math.random() * 0.6) * (params.slidingSpeed || 1),
    maxVy: (1.2 + Math.random() * 1.6) * (params.slidingSpeed || 1),
    tailLength: 12 + Math.random() * 25,
    opacity: 0.45 + Math.random() * 0.3,
    splashedOnPlayer: false
  }
}

// Player rain splash effect. Isolated here so it can be removed without changing rain physics.
function makePlayerSplash(x, y, speed) {
  const particleCount = 3 + Math.floor(Math.random() * 3)
  playerSplashes.push({
    x,
    y,
    age: 0,
    life: 26 + Math.floor(Math.random() * 10),
    radius: 5 + Math.min(5, speed * 1.8),
    particles: Array.from({ length: particleCount }, (_, index) => ({
      direction: particleCount === 1 ? 0 : index / (particleCount - 1) * 2 - 1,
      height: 4 + Math.random() * 7,
      distance: 3 + Math.random() * 7,
      size: 0.7 + Math.random() * 0.8,
    })),
  })

  if (playerSplashes.length > 18) playerSplashes.shift()
}

function renderPlayerSplashes(context, isDay) {
  for (let index = playerSplashes.length - 1; index >= 0; index--) {
    const splash = playerSplashes[index]
    splash.age += 1
    const progress = splash.age / splash.life

    if (progress >= 1) {
      playerSplashes.splice(index, 1)
      continue
    }

    const alpha = Math.sin(Math.PI * progress) * (isDay ? 0.72 : 0.82)
    const color = isDay ? `rgba(255,255,255,${alpha})` : `rgba(205,235,248,${alpha})`

    context.save()
    context.translate(splash.x, splash.y)
    context.strokeStyle = color
    context.lineWidth = 0.8
    context.beginPath()
    context.ellipse(0, 0, splash.radius * progress, splash.radius * 0.22 * progress, 0, Math.PI, Math.PI * 2)
    context.stroke()

    for (const particle of splash.particles) {
      const particleX = particle.direction * particle.distance * progress
      const particleY = -Math.sin(Math.PI * progress) * particle.height
      context.beginPath()
      context.arc(particleX, particleY, particle.size * (1 - progress * 0.45), 0, Math.PI * 2)
      context.fillStyle = color
      context.fill()
    }
    context.restore()
  }
}

function renderRainSystem() {
  const params = getRainParams()
  const isDay = document.documentElement.dataset.theme === 'day'
  const player = $('#music-player')
  const pRect = player ? player.getBoundingClientRect() : null

  // 1. Render Background Rain Lines
  if (bgContext) {
    bgContext.clearRect(0, 0, width, height)
    if (params.bgCount > 0) {
      while (bgDrops.length < params.bgCount) bgDrops.push(makeBgDrop(true))
      if (bgDrops.length > params.bgCount) bgDrops.length = params.bgCount

      bgContext.lineWidth = 0.8
      for (let i = 0; i < bgDrops.length; i++) {
        const drop = bgDrops[i]
        bgContext.strokeStyle = isDay 
          ? `rgba(64,89,101,${Math.min(0.32, drop.opacity * 0.95)})` 
          : `rgba(184,214,220,${drop.opacity})`
        bgContext.beginPath()
        bgContext.moveTo(drop.x, drop.y)
        bgContext.lineTo(drop.x - drop.drift, drop.y + drop.length)
        bgContext.stroke()

        drop.y += drop.speed
        drop.x -= drop.drift * 0.16
        if (drop.y > height + 30) bgDrops[i] = makeBgDrop(false)
      }
    }
  }

  // 2. Render Foreground Glass Droplets (Interacting with Player)
  if (fgContext) {
    fgContext.clearRect(0, 0, width, height)

    // Render static glass condensation beads
    const activeStaticLimit = Math.min(staticDroplets.length, params.staticCount)
    for (let i = 0; i < activeStaticLimit; i++) {
      const s = staticDroplets[i]
      if (!s.active) continue

      s.shimmer += s.shimmerSpeed
      const shimAlpha = 0.75 + Math.sin(s.shimmer) * 0.25
      const inPlayer = pRect && (s.x >= pRect.left && s.x <= pRect.right && s.y >= pRect.top && s.y <= pRect.bottom)
      const alphaMult = inPlayer ? 0.3 : 0.55

      fgContext.beginPath()
      fgContext.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      fgContext.fillStyle = isDay 
        ? `rgba(70,95,105,${0.22 * shimAlpha * alphaMult})` 
        : `rgba(180,215,235,${0.28 * shimAlpha * alphaMult})`
      fgContext.fill()

      fgContext.beginPath()
      fgContext.arc(s.x, s.y - s.r * 0.3, s.r * 0.6, Math.PI * 1.1, Math.PI * 1.9)
      fgContext.strokeStyle = isDay 
        ? `rgba(255,255,255,${0.5 * shimAlpha * alphaMult})` 
        : `rgba(255,255,255,${0.85 * shimAlpha * alphaMult})`
      fgContext.lineWidth = 0.5
      fgContext.stroke()
    }

    // Render sliding droplets & wet trails
    if (params.slidingCount > 0) {
      while (slidingDroplets.length < params.slidingCount) slidingDroplets.push(makeSlidingDroplet())
      if (slidingDroplets.length > params.slidingCount) slidingDroplets.length = params.slidingCount

      for (let i = 0; i < slidingDroplets.length; i++) {
        const d = slidingDroplets[i]

        const overPlayer = pRect && (d.x >= pRect.left - 5 && d.x <= pRect.right + 5 && d.y >= pRect.top - 10 && d.y <= pRect.bottom + 10)
        const hittingTopEdge = pRect && (d.x >= pRect.left && d.x <= pRect.right && Math.abs(d.y - pRect.top) < 8)

        if (hittingTopEdge) {
          if (!d.splashedOnPlayer) {
            makePlayerSplash(d.x, pRect.top + 1, d.vy)
            d.splashedOnPlayer = true
          }
          d.vy = Math.max(0.3, d.vy * 0.85)
        } else {
          d.vy = Math.min(d.maxVy, d.vy + 0.025)
        }

        d.y += d.vy

        // Absorb static droplets
        for (let j = 0; j < activeStaticLimit; j++) {
          const s = staticDroplets[j]
          if (s.active && Math.abs(s.x - d.x) < d.r * 2.0 && Math.abs(s.y - d.y) < d.r * 2.0) {
            s.active = false
            d.vy = Math.min(d.maxVy + 0.4, d.vy + 0.15)
            d.r = Math.min(4.0, d.r + 0.1)
            setTimeout(() => {
              s.x = Math.random() * width
              s.y = Math.random() * height
              s.active = true
            }, 4000 + Math.random() * 8000)
          }
        }

        // Render delicate, thin wet trail
        const tailY = d.y - d.tailLength
        const grad = fgContext.createLinearGradient(d.x, tailY, d.x, d.y)
        const opacityMult = overPlayer ? 0.3 : 0.6

        if (isDay) {
          grad.addColorStop(0, 'rgba(70,95,105,0)')
          grad.addColorStop(0.7, `rgba(70,95,105,${0.14 * opacityMult})`)
          grad.addColorStop(1, `rgba(70,95,105,${0.28 * opacityMult})`)
        } else {
          grad.addColorStop(0, 'rgba(215,240,255,0)')
          grad.addColorStop(0.7, `rgba(215,240,255,${0.2 * opacityMult})`)
          grad.addColorStop(1, `rgba(255,255,255,${0.4 * opacityMult})`)
        }

        fgContext.beginPath()
        fgContext.moveTo(d.x, tailY)
        fgContext.lineTo(d.x, d.y)
        fgContext.strokeStyle = grad
        fgContext.lineWidth = Math.max(0.8, d.r * 0.5)
        fgContext.stroke()

        // Render teardrop lens body
        const stretchY = 1 + d.vy * 0.1
        fgContext.save()
        fgContext.translate(d.x, d.y)
        fgContext.scale(1, stretchY)

        // Outer soft lens shadow
        fgContext.beginPath()
        fgContext.ellipse(0, 0, d.r * 0.9, d.r * 1.1, 0, 0, Math.PI * 2)
        fgContext.fillStyle = isDay ? `rgba(20,35,45,${0.18 * opacityMult})` : `rgba(0,0,0,${0.32 * opacityMult})`
        fgContext.fill()

        // Liquid bead body
        fgContext.beginPath()
        fgContext.ellipse(0, d.r * 0.05, d.r * 0.85, d.r * 1.0, 0, 0, Math.PI * 2)
        fgContext.fillStyle = isDay 
          ? `rgba(180,205,215,${0.22 * opacityMult})` 
          : `rgba(140,185,210,${0.3 * opacityMult})`
        fgContext.fill()

        // Top specular highlight crescent
        fgContext.beginPath()
        fgContext.arc(0, -d.r * 0.35, d.r * 0.55, Math.PI * 1.15, Math.PI * 1.85)
        fgContext.strokeStyle = isDay 
          ? `rgba(255,255,255,${0.75 * opacityMult})` 
          : `rgba(255,255,255,${0.9 * opacityMult})`
        fgContext.lineWidth = 0.7
        fgContext.stroke()

        // Dark bottom refraction shadow rim
        fgContext.beginPath()
        fgContext.arc(0, d.r * 0.45, d.r * 0.55, Math.PI * 0.15, Math.PI * 0.85)
        fgContext.strokeStyle = isDay 
          ? `rgba(30,45,55,${0.35 * opacityMult})` 
          : `rgba(10,20,30,${0.45 * opacityMult})`
        fgContext.lineWidth = 0.6
        fgContext.stroke()

        fgContext.restore()

        if (d.y > height + 40) {
          slidingDroplets[i] = makeSlidingDroplet()
        }
      }
    }

    renderPlayerSplashes(fgContext, isDay)
  }

  rainFrame = requestAnimationFrame(renderRainSystem)
}

resizeRain()
addEventListener('resize', resizeRain)
if (!reducedMotion) {
  rainFrame = requestAnimationFrame(renderRainSystem)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(rainFrame)
    } else {
      rainFrame = requestAnimationFrame(renderRainSystem)
    }
  })
}

addEventListener('beforeunload', () => {
  cancelAnimationFrame(rainFrame)
  clearTimeout(thunderTimer)
  rainAudio.pause()
  thunderAudio.pause()
})
