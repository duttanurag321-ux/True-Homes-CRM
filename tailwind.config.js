/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"SF Pro Display"', 'Inter', 'system-ui', 'sans-serif']
      },
      colors: {
        base: '#F7F5F0',
        card: '#FFFFFF',
        ink: '#1B1E1B',
        muted: '#75736A',
        line: '#E7E2D6',
        accent: {
          DEFAULT: '#B08D3E',
          dark: '#8A6C2C'
        },
        success: '#34C759',
        danger: '#FF3B30',
        warning: '#FF9500',
        purple: '#5E5CE6',
        teal: '#30B0C7'
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)',
        pop: '0 4px 14px rgba(176,141,62,0.30)'
      },
      borderRadius: {
        xl2: '1.25rem'
      }
    }
  },
  plugins: []
}
