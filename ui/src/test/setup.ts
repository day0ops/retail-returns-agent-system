import '@testing-library/jest-dom/vitest'

// jsdom doesn't implement matchMedia; useTheme's system-preference fallback
// needs it. Default to "no preference" so tests are deterministic.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
