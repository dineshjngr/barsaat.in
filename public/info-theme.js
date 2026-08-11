try {
  const savedTheme = localStorage.getItem('monsoon-theme')
  document.documentElement.dataset.theme = savedTheme === 'day' ? 'day' : 'night'
} catch {
  document.documentElement.dataset.theme = 'night'
}
