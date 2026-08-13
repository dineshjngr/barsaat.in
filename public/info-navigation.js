const returnToPlayer = document.querySelector('[data-return-to-player]')

returnToPlayer?.addEventListener('click', (event) => {
  let hasPlayerOpener = false
  try {
    hasPlayerOpener = Boolean(
      window.opener
      && !window.opener.closed
      && window.opener.location.origin === window.location.origin
    )
  } catch {
    hasPlayerOpener = false
  }

  if (!hasPlayerOpener) return

  event.preventDefault()
  window.opener.focus()
  window.close()
  setTimeout(() => window.location.assign('/'), 120)
})
